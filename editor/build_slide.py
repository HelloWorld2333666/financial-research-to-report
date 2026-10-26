"""Build the initial China Re overview slide project from the research bundle.

    python editor/build_slide.py [--bundle PATH] [--out PATH]

Reads research/china_re/fy2025_bundle.json as data (no import of the research
pipeline). Every figure on the slide is an evidence_id reference; free text
either carries citations (and keeps its original wording for edit detection)
or contains no figures.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from slidemodel import SCHEMA, bound_evidence_ids, check_integrity, element_evidence_ids, \
    now_iso, snapshot_hash, validate_project

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "research" / "china_re" / "fy2025_bundle.json"
OUT = Path(__file__).resolve().parent / "projects" / "china_re_overview.json"
SLIDE_ID = "overview"

INK, MUTED, ACCENT, PANEL, LINE = "#0f2742", "#5b6b7f", "#c8102e", "#f3f5f8", "#d5dbe3"
BN = {"scale": 1e6, "decimals": 1, "prefix": "RMB ", "suffix": "bn"}  # RMB thousand -> bn
BN_M = {"scale": 1e3, "decimals": 1, "suffix": ""}  # RMB million -> bn
PCT2 = {"decimals": 2, "suffix": "%"}
PCT0 = {"decimals": 0, "suffix": ""}


def text(id, x, y, w, h, body, size=11, weight=400, color=INK, refs=None, cited=False, **style):
    el = dict(id=id, type="text", x=x, y=y, w=w, h=h, text=body,
              style=dict(fontSize=size, fontWeight=weight, color=color, **style), refs=refs or {})
    if cited:
        el["cited_text_original"] = body
    return el


def header(id, x, y, w, label):
    return text(id, x, y, w, 16, label, size=9.5, weight=700, color=ACCENT, letterSpacing="0.06em")


def panel(id, x, y, w, h, fill=PANEL, border=None):
    return dict(id=id, type="panel", x=x, y=y, w=w, h=h, shape="rect", refs={},
                style=dict(fill=fill, borderColor=border or "transparent", borderWidth=1 if border else 0, radius=4))


def metric(id, x, label, ev, prev, fmt, kind, note):
    return dict(id=id, type="metric", x=x, y=100, w=195, h=88, label=label, evidence_id=ev,
                delta=dict(**{"from": prev}, kind=kind), fmt=fmt, note=note, refs={},
                style=dict(fill="#ffffff", borderColor=LINE, accent=INK))


def build(bundle: dict, bundle_path: Path) -> dict:
    ev = {e["id"]: {k: e.get(k) for k in ("kind", "statement", "excerpt", "page", "locator", "source_id",
                                          "subject", "period", "value", "unit", "metric_id",
                                          "issuer_definition", "verification", "verified_by")}
          for e in bundle["evidence"]}
    ev = {k: {f: v for f, v in d.items() if v is not None} for k, d in ev.items()}
    findings = {f["id"]: f for f in bundle["findings"]}
    claims = {}
    for c in bundle["claims"]:
        cited = set(c.get("evidence_ids", [])) | {x for f in c.get("finding_ids", []) for x in findings[f]["evidence_ids"]}
        verified = all(ev[i]["verification"] == "verified" for i in cited) and cited
        claims[c["id"]] = dict(statement=c["statement"], nature=c["nature"], evidence=sorted(cited),
                               support="supported" if verified else "not fully verified",
                               caveats=c.get("caveats"))
    sources = {s["id"]: {k: s.get(k) for k in ("title", "publisher", "url", "published_date", "notes")}
               for s in bundle["sources"]}
    gaps = {g["id"]: {k: g.get(k) for k in ("description", "reason", "suggested_action")} for g in bundle["gaps"]}

    elements = [
        text("title", 32, 20, 1216, 40,
             "China Re: state-controlled reinsurer; FY2025 earnings softened and solvency eased slightly",
             size=22, weight=700, refs={"claims": ["c.cr.state_control", "c.cr.earnings_softer", "c.cr.capital_buffer"]}),
        text("subtitle", 32, 62, 1216, 20, "Company overview · FY2025 vs FY2024 · IFRS 17 basis · RMB",
             size=11, color=MUTED, refs={"evidence": ["ev.cr.ifrs17"]}),
        dict(id="rule", type="panel", x=32, y=88, w=1216, h=2, shape="rect", refs={},
             style=dict(fill=INK, borderColor="transparent", borderWidth=0, radius=0)),
        # Left column
        panel("profile-bg", 32, 100, 384, 164),
        header("profile-h", 44, 108, 360, "PROFILE & HISTORY"),
        text("profile", 44, 128, 360, 132,
             "• Origin: People's Insurance Company of China, est. October 1949; joint-stock company since October 2007\n"
             "• Listed on the HKEX Main Board on 26 October 2015 (stock code 1508)\n"
             "• Businesses: P&C reinsurance, life & health reinsurance, primary P&C insurance, asset management, "
             "insurance intermediary",
             size=10.5, refs={"evidence": ["ev.cr.history", "ev.cr.listing", "ev.cr.business_lines"]}, cited=True),
        panel("owner-bg", 32, 276, 384, 112),
        header("owner-h", 44, 284, 360, "OWNERSHIP & CONTROL"),
        text("owner", 44, 304, 360, 80,
             "• Central Huijin Investment Ltd.: 71.56% (controlling shareholder)\n"
             "• Ministry of Finance: 11.45%\n"
             "• Remaining holders not itemised in the sources reviewed",
             size=10.5, refs={"evidence": ["ev.cr.shareholders", "ev.cr.controlling_shareholder"],
                              "claims": ["c.cr.state_control"]}, cited=True),
        panel("ratings-bg", 32, 400, 384, 98),
        header("ratings-h", 44, 408, 360, "EXTERNAL RATINGS (ISSUER-REPORTED)"),
        text("ratings", 44, 428, 360, 66,
             "A.M. Best: A (Excellent) · S&P Global Ratings: A\nMaintained during 2025 per the issuer; agency "
             "publications not yet reviewed",
             size=10.5, refs={"evidence": ["ev.cr.ratings_issuer"], "claims": ["c.cr.ratings_stable"],
                              "gaps": ["gap.cr.ratings_primary"]}, cited=True),
        dict(id="geo-gap", type="gap", x=32, y=510, w=384, h=86, gap_id="gap.cr.geography",
             text="Geographic revenue split not found in the sources reviewed. Not estimated; "
                  "research request open.",
             refs={"gaps": ["gap.cr.geography"]},
             style=dict(fill="#fff7e6", borderColor="#e0a100", color="#6b4e00")),
        # KPI row
        metric("kpi-income", 432, "Total income", "ev.cr.total_income.fy2025", "ev.cr.total_income.fy2024",
               BN, "pct", "FY2025 vs FY2024"),
        metric("kpi-profit", 639, "Net profit attributable", "ev.cr.net_profit_attr.fy2025",
               "ev.cr.net_profit_attr.fy2024", {**BN, "decimals": 2}, "pct", "FY2025 vs FY2024"),
        metric("kpi-roe", 846, "Weighted avg. ROE", "ev.cr.roe.fy2025", "ev.cr.roe.fy2024", PCT2, "pp",
               "FY2025 vs FY2024"),
        metric("kpi-assets", 1053, "Total assets", "ev.cr.total_assets.2025", "ev.cr.total_assets.2024",
               BN, "pct", "31 Dec 2025 vs 31 Dec 2024"),
        # Charts and tables
        dict(id="seg-chart", type="barchart", x=432, y=200, w=404, h=244,
             title="Insurance revenue by segment, FY2025 (RMB bn, before eliminations)",
             bars=[dict(label="Primary P&C insurance", evidence_id="ev.cr.seg_rev.primary_pc.fy2025"),
                   dict(label="P&C reinsurance", evidence_id="ev.cr.seg_rev.pc_re.fy2025"),
                   dict(label="Life & health reinsurance", evidence_id="ev.cr.seg_rev.lh_re.fy2025")],
             fmt=BN_M, refs={}, style=dict(fill="#ffffff", borderColor=LINE, bar=INK)),
        dict(id="cr-table", type="table", x=848, y=200, w=400, h=136,
             columns=["Combined ratio (%)", "FY2024", "FY2025", "Change (pp)"],
             rows=[dict(label=label, cells=[dict(evidence_id=f"ev.cr.cr.{key}.fy2024", fmt=PCT2 | {"suffix": ""}),
                                            dict(evidence_id=f"ev.cr.cr.{key}.fy2025", fmt=PCT2 | {"suffix": ""}),
                                            dict(delta={"from": f"ev.cr.cr.{key}.fy2024",
                                                        "to": f"ev.cr.cr.{key}.fy2025", "kind": "pp"})])
                   for key, label in [("overseas_pc_chaucer", "Overseas P&C and Chaucer"),
                                      ("domestic_pc_re", "Domestic P&C reinsurance"),
                                      ("primary_pc", "Primary P&C insurance")]],
             footnote="IFRS 17 basis, issuer definition. Primary P&C incl. insurance finance items: 100.41%.",
             refs={"evidence": ["ev.cr.cr.primary_pc_incl_finance", "ev.cr.ifrs17"],
                   "claims": ["c.cr.underwriting_divergence"]},
             style=dict(fill="#ffffff", borderColor=LINE)),
        dict(id="solv-table", type="table", x=848, y=346, w=400, h=100,
             columns=["Group solvency (%)", "31 Dec 2024", "31 Dec 2025"],
             rows=[dict(label="Core", cells=[dict(evidence_id="ev.cr.solvency_core.2024", fmt=PCT0),
                                              dict(evidence_id="ev.cr.solvency_core.2025", fmt=PCT0)]),
                   dict(label="Aggregated", cells=[dict(evidence_id="ev.cr.solvency_agg.2024", fmt=PCT0),
                                                    dict(evidence_id="ev.cr.solvency_agg.2025", fmt=PCT0)])],
             footnote="31 December 2025 figures unaudited (issuer).",
             refs={"evidence": ["ev.cr.solvency_unaudited"], "claims": ["c.cr.capital_buffer"]},
             style=dict(fill="#ffffff", borderColor=LINE)),
        # Takeaways
        panel("takeaways-bg", 432, 456, 816, 140, fill="#eef2f7"),
        header("takeaways-h", 446, 464, 790, "KEY TAKEAWAYS"),
        text("takeaways", 446, 484, 790, 108,
             "• Majority state-owned: Central Huijin is the controlling shareholder.\n"
             "• Earnings softened despite top-line growth; see the KPI cards for computed changes.\n"
             "• Overseas P&C underwriting strengthened while domestic P&C reinsurance and primary P&C margins narrowed.\n"
             "• Group solvency eased slightly in 2025 to 155% core and 189% aggregated (unaudited).",
             size=11, refs={"claims": ["c.cr.state_control", "c.cr.earnings_softer", "c.cr.underwriting_divergence",
                                       "c.cr.capital_buffer"],
                            "evidence": ["ev.cr.controlling_shareholder", "ev.cr.solvency_core.2025",
                                         "ev.cr.solvency_agg.2025", "ev.cr.solvency_unaudited"]}, cited=True),
        dict(id="sources", type="sources", x=32, y=608, w=1216, h=56, prefix="Sources:", refs={},
             style=dict(fontSize=8.5, color=MUTED)),
        text("footer", 32, 670, 1216, 18,
             "Figures verified against source PDFs by an AI assistant; human review pending. Segment revenue is "
             "before inter-segment eliminations.", size=8.5, color=MUTED),
    ]
    # A panel, its header and its text form one module: dragging any part moves all three.
    modules = {"profile": "g-profile", "owner": "g-owner", "ratings": "g-ratings", "takeaways": "g-takeaways"}
    for e in elements:
        e["slide_id"] = SLIDE_ID
        base = e["id"].removesuffix("-bg").removesuffix("-h")
        if base in modules:
            e["group"] = modules[base]
    project = dict(
        schema=SCHEMA, id="china_re_overview", title="China Re overview (FY2025)",
        size=dict(w=1280, h=720), created=now_iso(),
        slides=[dict(id=SLIDE_ID, title="Company overview")],
        transfer_requests=[],
        generated_from=dict(bundle=str(bundle_path.relative_to(ROOT)),
                            bundle_sha256=hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
                            company=bundle["company"]),
        evidence=ev, sources=sources, claims=claims, gaps=gaps,
        elements=elements, annotations=[],
        research_requests=[dict(id="rr-geo", gap_id="gap.cr.geography", status="open", source="bundle gap",
                                created=now_iso(), description=gaps["gap.cr.geography"]["description"])],
    )
    project["snapshot_sha256"] = snapshot_hash(project)
    project["baseline_evidence_shown"] = sorted(set().union(*(element_evidence_ids(e) for e in elements)))
    return project


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bundle", type=Path, default=BUNDLE)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    bundle_path = args.bundle.resolve()
    project = build(json.loads(bundle_path.read_text(encoding="utf-8")), bundle_path)
    errors = validate_project(project)
    issues = check_integrity(project)
    for i in issues:
        print(f"{i['level']:7} {i['code']:20} {i['element_id'] or '-'}: {i['message']}")
    if errors:
        print("\n".join(errors))
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(project, indent=1, ensure_ascii=False), encoding="utf-8")
    bound = sum(len(bound_evidence_ids(e)) for e in project["elements"])
    print(f"wrote {args.out} ({len(project['elements'])} elements, {bound} bound values, "
          f"{len(project['evidence'])} evidence records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
