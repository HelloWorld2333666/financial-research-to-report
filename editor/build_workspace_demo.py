"""Build the workspace prototype project.

    python editor/build_workspace_demo.py

Writes projects/workspace_demo.json:
  slide 1  China Re overview: real, hand-verified evidence from the public-filing bundle
  slide 2  France debt dynamics: SAMPLE (synthetic) datasets, deterministic chart + data table
  slide 3  Market pricing: SAMPLE (synthetic) monthly yields
France/Germany/Italy series are seeded random walks, clearly marked ``origin: "synthetic"``;
they exist to exercise the workspace, never to be read as statistics.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import build_slide
import slidemodel as sm

OUT = Path(__file__).resolve().parent / "projects" / "workspace_demo.json"
SAMPLE_NOTE = "SAMPLE: synthetic series generated for the prototype; not official statistics."
DNA = {"font": "Helvetica Neue", "ink": "#0f2742", "accent": "#c8102e", "muted": "#5b6b7f", "title_size": 24,
       "panel": "#f3f5f8", "rule": "#0f2742", "series": ["#1f4e9c", "#c8102e", "#2e8b57", "#b8860b"]}


def walk(rng: random.Random, start: float, drift: float, noise: float, n: int, decimals: int = 1) -> list[float]:
    out, v = [], start
    for _ in range(n):
        v += drift + (rng.random() - 0.5) * noise
        out.append(round(v, decimals))
    return out


def dataset(title, entity, unit, frequency, obs_type, dates, values, definition):
    return {"title": title, "entity": entity, "unit": unit, "frequency": frequency, "observation_type": obs_type,
            "definition": definition, "origin": "synthetic", "verification": "sample", "source_note": SAMPLE_NOTE,
            "observations": [{"date": d, "value": v, "status": "missing" if v is None else "sample"}
                             for d, v in zip(dates, values)], "working": {}}


def datasets() -> dict:
    rng = random.Random(20261101)
    years = [str(y) for y in range(2002, 2027)]
    months = [f"{y}-{m:02d}" for y in range(2002, 2027) for m in range(1, 13)][:294]  # to 2026-06
    quarters = [f"{y}-Q{q}" for y in range(2015, 2027) for q in range(1, 5)][:46]
    debt = {"fr": walk(rng, 58, 2.0, 5, 25), "de": walk(rng, 60, 0.3, 5, 25), "it": walk(rng, 104, 1.0, 6, 25)}
    debt["it"][3] = None  # one missing year: shown as a gap, never interpolated
    names = {"fr": "France", "de": "Germany", "it": "Italy"}
    out = {f"ds.{c}.debt_gdp": dataset(f"{names[c]} · general government debt", names[c], "% of GDP", "annual",
                                       "end_of_period", years, debt[c], "Gross debt at year end, % of nominal GDP (sample definition).")
           for c in names}
    for c, start in (("fr", 4.9), ("de", 4.7), ("it", 5.2)):
        out[f"ds.{c}.y10_m"] = dataset(f"{names[c]} · 10Y government bond yield", names[c], "%", "monthly",
                                       "point_in_time", months,
                                       walk(rng, start, -0.004, 0.32, len(months), 2),
                                       "Month-end 10-year benchmark yield (sample definition).")
    out["ds.fr.primary_balance_q"] = dataset("France · primary balance", "France", "% of GDP", "quarterly", "flow",
                                             quarters, walk(rng, -1.5, -0.02, 1.2, len(quarters)),
                                             "Quarterly primary balance, % of GDP (sample definition).")
    out["ds.fr.cds5y"] = {**dataset("France · 5Y sovereign CDS", "France", "bp", "daily", "point_in_time", [], [],
                                    "5-year senior CDS spread (to be researched)."), "verification": "missing",
                          "gap_note": "No verified source yet: request research instead of estimating."}
    out["ds.fr.debt_gdp"]["working"]["2024"] = {"value": round(debt["fr"][22] + 0.4, 1), "by": "analyst (demo)", "at": sm.now_iso(),
                                                "note": "updated statistical vintage", "status": "manual_unverified"}
    return out


def text(id, slide, x, y, w, h, body, role, **extra):
    return {"id": id, "slide_id": slide, "type": "text", "x": x, "y": y, "w": w, "h": h, "text": body, "role": role,
            "style": {}, "refs": {}, **extra}


def build() -> dict:
    p = build_slide.build(json.loads(build_slide.BUNDLE.read_text(encoding="utf-8")), build_slide.BUNDLE)
    p.update(id="workspace_demo", title="France sovereign risk & China Re · workspace prototype")
    roles = {"title": "title", "subtitle": "subtitle"}
    for e in p["elements"]:
        if e["id"] in roles:
            e["role"] = roles[e["id"]]
        elif e["id"].endswith("-h"):
            e["role"] = "kicker"
    p["slides"][0]["title"] = "China Re overview"
    p["datasets"], p["design_dna"] = datasets(), DNA
    p["charts"] = {
        "ch.debt": {"type": "line", "title": "General government debt, % of GDP (SAMPLE)", "x": {"from": "2002", "to": "2026"},
                    "y": {"zero": False}, "labels": "end", "missing": "gap",
                    "series": [{"dataset": f"ds.{c}.debt_gdp", "label": n, "role": i}
                               for i, (c, n) in enumerate((("fr", "France"), ("de", "Germany"), ("it", "Italy")))]},
        "ch.debt_bar": {"type": "bar", "title": "Debt, % of GDP, 2026 (SAMPLE)", "x": {"mode": "snapshot", "date": "2026"},
                        "y": {"zero": True}, "labels": "none", "missing": "gap", "data_labels": True,
                        "series": [{"dataset": f"ds.{c}.debt_gdp", "label": n, "role": i}
                                   for i, (c, n) in enumerate((("fr", "France"), ("de", "Germany"), ("it", "Italy")))]},
        "ch.y10": {"type": "line", "title": "10-year government bond yield, %, month end (SAMPLE)", "x": {"from": "2002-01", "to": "2026-06"},
                   "y": {"zero": False}, "labels": "end", "missing": "gap",
                   "series": [{"dataset": f"ds.{c}.y10_m", "label": n, "role": i}
                              for i, (c, n) in enumerate((("fr", "France"), ("de", "Germany"), ("it", "Italy")))]},
    }
    s2, s3 = "s-france-debt", "s-markets"
    p["slides"] += [{"id": s2, "title": "France debt dynamics"}, {"id": s3, "title": "Market pricing"}]
    frame = lambda s, kicker, title, sub: [
        text(f"{s}-kicker", s, 40, 26, 900, 16, kicker, "kicker"),
        text(f"{s}-title", s, 40, 44, 1200, 36, title, "title"),
        text(f"{s}-sub", s, 40, 84, 1200, 18, sub, "subtitle"),
        {"id": f"{s}-rule", "slide_id": s, "type": "panel", "x": 40, "y": 108, "w": 1200, "h": 2, "role": "rule", "shape": "rect", "style": {}, "refs": {}},
        {"id": f"{s}-src", "slide_id": s, "type": "sources", "x": 40, "y": 664, "w": 1200, "h": 36, "prefix": "Source:", "style": {"fontSize": 9}, "refs": {}},
    ]
    p["elements"] += frame(s2, "FRANCE · DEBT DYNAMICS", "France's debt ratio is diverging from core peers",
                           "General government gross debt, % of GDP · annual, end of period · SAMPLE DATA") + [
        {"id": "el-debt-chart", "slide_id": s2, "type": "chart", "chart_id": "ch.debt", "x": 40, "y": 128, "w": 720, "h": 350, "style": {}, "refs": {}},
        {"id": "el-debt-bar", "slide_id": s2, "type": "chart", "chart_id": "ch.debt_bar", "x": 784, "y": 128, "w": 456, "h": 230, "style": {}, "refs": {}},
        {"id": "el-debt-table", "slide_id": s2, "type": "datatable", "x": 784, "y": 376, "w": 456, "h": 172,
         "title": "Debt, % of GDP (SAMPLE)", "dataset_ids": ["ds.fr.debt_gdp", "ds.de.debt_gdp", "ds.it.debt_gdp"],
         "dates": ["2024", "2025", "2026"], "fmt": {"decimals": 1}, "style": {}, "refs": {}},
        text("el-debt-comment", s2, 40, 496, 720, 150,
             "• France's ratio keeps rising while Germany's is broadly flat: the gap looks structural.\n"
             "• Italy remains the most indebted, but its path has been steadier.\n"
             "• Market pricing (next slide) has reflected the divergence only partly.", "body"),
    ]
    p["elements"] += frame(s3, "MARKETS · 10Y YIELDS", "Yields have priced only part of the fiscal gap",
                           "10-year benchmark yields, %, month end · SAMPLE DATA") + [
        {"id": "el-y10-chart", "slide_id": s3, "type": "chart", "chart_id": "ch.y10", "x": 40, "y": 128, "w": 820, "h": 460, "style": {}, "refs": {}},
        text("el-y10-comment", s3, 884, 140, 356, 300,
             "• Spreads to Germany widened after the rate cycle turned.\n• Italy still trades widest; France has drifted closer to it.", "body"),
    ]
    p["threads"] = {s2: {"messages": [{"role": "ai", "at": sm.now_iso(), "text":
                                       "Slide 2 assistant (simulated, rule-based). Select objects and describe a size or position change; "
                                       "I will return a proposal you can preview, apply or reject."}]}}
    p["snapshot_sha256"] = sm.snapshot_hash(p)
    return p


def main() -> int:
    p = build()
    errors = sm.validate_project(p)
    if errors:
        print("\n".join(errors))
        return 1
    OUT.write_text(json.dumps(p, indent=1, ensure_ascii=False), encoding="utf-8")
    codes = sorted({i["code"] for i in sm.check_integrity(p)})
    print(f"wrote {OUT.name}: {len(p['slides'])} slides, {len(p['elements'])} elements, {len(p['datasets'])} datasets, "
          f"{len(p['charts'])} charts; integrity: {', '.join(codes) or 'clean'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
