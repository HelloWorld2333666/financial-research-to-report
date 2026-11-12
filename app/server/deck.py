"""Deck workflow for the financial-slide-design Skill: from a research project to rendered, checked, editable slides.

The design model (the Skill) writes a storyboard and one plan per slide; this tool does everything mechanical around
those decisions, so no deck needs code of its own:

    python app/server/deck.py new      --title "…"                 a blank research project (prints its id)
    python app/server/deck.py eurostat <pid> --geos IT,FR,DE --metrics fiscal,maturity,yield_curve [--since 2015]
                                                                  Eurostat series (each value confirmed by a second request)
    python app/server/deck.py profile  <pid>                      what the evidence can support (datasets, periods, facts)
    python app/server/deck.py fact     <pid> --id ev.x.y --subject … --statement … --url … --title … --published 2026-05-04
                                          --excerpt "…" [--value 4.1 --unit "US$ bn" --period 2025]
                                                                  a sourced fact from a web page; the excerpt is looked
                                                                  for on the page (verified) or the fact is marked reported
    python app/server/deck.py identity <pid> --id teal-report --primary "#0F6E6E" [--type sans] [--base-language atlas] [--paper #FFFFFF]
                                                                  the deck's identity (one per project)
    python app/server/deck.py build    <pid> [--out DIR] [--only m01,m03]
                                                                  render every plan in plans/deck.json, contact sheet,
                                                                  report.json + report.md (slide QA, validation, missing
                                                                  assets, deck checks)
    python app/server/deck.py apply    <pid>                      apply the deck to the live project (editable slides in
                                                                  the app; saved as a new version of the project)

plans/deck.json: {"title": …, "slides": ["m01-cover", …], "storyboard": [{"slide": …, "role": …, "message": …, "cards": […],
"assets": […]}]}. Plans are frr-design JSON with figure tokens (app/web/src/core/design/plans.ts).
Rendering needs the app server (default http://127.0.0.1:8791) and Chrome.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from projects import ProjectStore  # noqa: E402
import render_slides  # noqa: E402

STORE = ProjectStore(HERE / "projects")


def _load(pid: str) -> dict:
    return STORE.load(pid)


# ------------------------------------------------------------------ profile
def profile(pid: str) -> dict:
    p = _load(pid)["project"]
    rows = []
    for d in p["datasets"].values():
        obs = [o for o in d["observations"] if o.get("value") is not None]
        if not obs:
            continue
        rows.append({"id": d["id"], "entity": d.get("entity"), "geo": d.get("geo"), "metric": d.get("metric"), "unit": d.get("unit"),
                     "frequency": d.get("frequency"), "from": obs[0]["date"], "to": obs[-1]["date"], "n": len(obs), "last": obs[-1]["value"],
                     "parts_of": (d.get("measure") or {}).get("additive_parts_of")})
    metrics = Counter(r["metric"] for r in rows)
    facts = [{"id": e["id"], "statement": e.get("statement", "")[:140], "value": e.get("value"), "verification": e.get("verification")}
             for e in p["evidence"].values() if e.get("kind") in ("fact",) or e.get("retrieval", {}).get("method") == "web"]
    return {"project": pid, "title": p.get("title"), "identity": p.get("identity"), "datasets": len(rows),
            "metrics": dict(sorted(metrics.items())), "entities": sorted({r["entity"] for r in rows if r["entity"]}),
            "rows": sorted(rows, key=lambda r: (r["metric"] or "", r["geo"] or "")), "facts": facts}


def eurostat(pid: str, geos: list[str], metrics: list[str], since: str) -> dict:
    """Eurostat datasets through the app's own verified fetchers (agent.fetch_verified, agent.fetch_curve)."""
    import agent
    from evidence import CURVES, GROUPS, METRICS
    ms = [x for m in metrics for x in GROUPS.get(m, [m])]
    b = _load(pid)
    p, done, failed = b["project"], [], []
    for m in ms:
        try:
            if m in CURVES:
                parts = agent.fetch_curve(agent.http_get, m, "2023-01")
            elif m in METRICS:
                parts = [agent.fetch_verified(agent.http_get, m, g, since) for g in geos]
            else:
                raise ValueError("unknown metric")
        except Exception as e:  # noqa: BLE001
            failed.append(f"{m}: {e}")
            continue
        for x in parts:
            if x["dataset"]["observations"]:
                p["datasets"][x["dataset"]["id"]] = x["dataset"]; p["evidence"].update(x["evidence"]); done.append(x["dataset"]["id"])
    STORE.save(pid, b)
    return {"added": len(done), "failed": failed}


# ------------------------------------------------------------------ facts
def _page_text(url: str) -> str:
    r = httpx.get(url, timeout=40, follow_redirects=True, headers={"User-Agent": "frr-workspace/0.3 (research-to-report prototype)"})
    r.raise_for_status()
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", r.text, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def add_fact(pid: str, a) -> dict:
    b = _load(pid)
    p = b["project"]
    norm = lambda s: re.sub(r"[^a-z0-9.%$]+", " ", s.lower()).strip()  # noqa: E731
    try:
        found = norm(a.excerpt) in norm(_page_text(a.url))
        how = "frr-web-check (excerpt found on the page)" if found else "frr-web-check (excerpt NOT found: page changed or blocked)"
    except Exception as e:  # noqa: BLE001
        found, how = False, f"frr-web-check (page not readable: {type(e).__name__})"
    now = datetime.now(timezone.utc)
    e = {"id": a.id, "source_id": "src.web." + hashlib.sha1(a.url.encode()).hexdigest()[:10], "kind": "fact" if a.value is None else "metric_value",
         "subject": a.subject, "statement": a.statement, "excerpt": a.excerpt, "locator": f"{a.title} ({a.published})",
         "verification": "verified" if found else "reported", "verified_by": how, "verified_on": now.date().isoformat(),
         "source_title": a.title, "source_url": a.url,
         "retrieval": {"method": "web", "query_url": a.url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": None, "series_key": None,
                       "note": f"published {a.published}"}}
    if a.value is not None:
        e.update({"value": float(a.value) if "." in a.value else int(a.value), "unit": a.unit, "period": a.period, "metric_id": a.id.split(".")[-2] if a.id.count(".") > 2 else a.id})
    p["evidence"][a.id] = e
    STORE.save(pid, b)
    return {"id": a.id, "verification": e["verification"], "verified_by": how}


def set_identity(pid: str, a) -> dict:
    b = _load(pid)
    idn = {"id": a.id, "base": a.lang_base, **({"primary": a.primary} if a.primary else {}), **({"type": a.type} if a.type else {}),
           **({"paper": a.paper} if a.paper else {}), **({"alert": a.alert} if a.alert else {}), **({"name": a.name} if a.name else {})}
    b["project"]["identity"] = idn
    if a.primary:  # the chart families drawn from Design DNA (native charts, generic composites) follow the identity too
        mix = lambda c, t, k: "#" + "".join(f"{round(int(c[i:i + 2], 16) + (int(t[i:i + 2], 16) - int(c[i:i + 2], 16)) * k):02X}" for i in (1, 3, 5))  # noqa: E731
        P = a.primary.upper()
        b["project"]["design_dna"] = {"font": "Inter", "ink": "#141414", "accent": a.alert or P, "muted": "#5C5C5C", "rule": "#141414",
                                      "series": [P, mix(P, "#FFFFFF", 0.5), "#8C8C8C", mix(P, "#000000", 0.35)]}
    STORE.save(pid, b)
    return idn


# ------------------------------------------------------------------ deck checks (flagged, never enforced: DK)
def signature(plan: dict) -> str:
    c = plan.get("composition", {})
    prm = c.get("params", {})
    cols = "+".join(f"{x['span']}{'t' if x.get('tint') else ''}" for x in prm.get("columns", []))
    return f"{c.get('kind')}:{cols}{':split' if prm.get('split') else ''}{':' + prm.get('art', '') if c.get('kind') == 'cover' else ''}"


def deck_checks(plans: list[dict], project: dict) -> list[str]:
    out, sigs = [], [signature(p) for p in plans]
    for i in range(2, len(sigs)):
        if sigs[i] == sigs[i - 1] == sigs[i - 2]:
            out.append(f"{plans[i]['id']}: third slide in a row with the composition {sigs[i]} (vary it unless the pages are analytically parallel; say so in the storyboard)")
    panels = sum(1 for p in plans if p.get("composition", {}).get("kind") == "columns" and (p["composition"]["params"].get("columns") or [{}])[-1].get("tint"))
    if plans and panels / len(plans) > 0.45:
        out.append(f"{panels} of {len(plans)} slides end in a tinted commentary panel: the deck reads as one template; use other patterns where the content allows")
    def has_art(p):
        return any(o.get("kind") in ("image", "map") for o in p.get("objects", []))
    for p in (plans[:1] + plans[-1:]):
        if not has_art(p):
            out.append(f"{p['id']}: an opening or closing page without a photograph or map (S2, P5): add one or record why not")
    geos = {d["id"]: d.get("geo") for d in project["datasets"].values()}
    for p in plans:
        for o in p.get("objects", []):
            req = o.get("request") or {}
            ds = req.get("datasets", [])
            if o.get("kind") == "viz" and len(ds) >= 3 and all((geos.get(d) or "W") not in ("W", "EA") for d in ds) and (o.get("draw") or {}).get("form") in ("rankTable", "benchList") and not (o.get("draw") or {}).get("flags"):
                out.append(f"{p['id']}/{o['id']}: a ranked table of countries without flags (S1)")
    langs = {p.get("language") for p in plans}
    if len(langs) > 1:
        out.append(f"plans name {len(langs)} languages ({', '.join(map(str, langs))}): one identity per deck (set it with `deck.py identity`, omit `language` in plans)")
    kinds = Counter(o.get("request", {}).get("family") or o.get("kind") for p in plans for o in p.get("objects", []) if o.get("kind") in ("viz", "map", "image"))
    out.append("visual mix: " + ", ".join(f"{k} {n}" for k, n in kinds.most_common()))
    out.append("compositions: " + ", ".join(f"{k} ×{n}" for k, n in Counter(sigs).most_common()))
    return out


# ------------------------------------------------------------------ build and apply
def _deck(pid: str) -> tuple[dict, list[dict]]:
    folder = STORE.root / pid / "plans"
    deck = json.loads((folder / "deck.json").read_text())
    return deck, [json.loads((folder / f"{n}.json").read_text()) for n in deck["slides"]]


def sheet(out: Path, names: list[str], cols: int = 3, w: int = 620) -> Path:
    cells = "".join(f'<div style="display:inline-block;margin:6px;vertical-align:top"><img src="{n}.png" width="{w}"><div style="color:#ddd;font:13px Inter,sans-serif;padding:2px 0">{n}</div></div>' for n in names)
    (out / "sheet.html").write_text(f'<html><body style="margin:0;background:#2b2b2b;width:{cols * (w + 12) + 12}px">{cells}</body></html>')
    h = -(-len(names) // cols) * (round(w * 9 / 16) + 30) + 20
    with tempfile.TemporaryDirectory() as prof:
        subprocess.run([render_slides.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", f"--user-data-dir={prof}",
                        f"--window-size={cols * (w + 12) + 12},{h}", f"--screenshot={out / 'overview.png'}", f"file://{out / 'sheet.html'}"], capture_output=True, timeout=120)
    return out / "overview.png"


def build(pid: str, out: Path, base: str, only: list[str] | None = None) -> dict:
    deck, plans = _deck(pid)
    project = _load(pid)["project"]
    out.mkdir(parents=True, exist_ok=True)
    slides = []
    for p in plans:
        if only and p["id"] not in only:
            continue
        r = render_slides.render(base, pid, f"plan:{p['id']}", out)
        errs = [q for q in r.get("qa", []) if q.startswith("error")]
        slides.append({"slide": p["id"], "error": r.get("error"), "qa_errors": errs, "qa_warnings": [q for q in r.get("qa", []) if not q.startswith("error")],
                       "assets_missing": r.get("assetsMissing", [])})
    names = [s["slide"] for s in slides if not s["error"]]
    if names:
        sheet(out, names)
    report = {"project": pid, "title": deck.get("title"), "identity": project.get("identity"), "slides": slides, "deck": deck_checks(plans, project)}
    (out / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    md = [f"# {deck.get('title', pid)}: build report", "", "| Slide | Result | QA warnings |", "|---|---|---|"]
    for s in slides:
        res = s["error"] or ("; ".join(s["qa_errors"]) if s["qa_errors"] else "ok") + (f"; assets missing: {s['assets_missing']}" if s["assets_missing"] else "")
        md.append(f"| {s['slide']} | {res} | {len(s['qa_warnings'])} |")
    md += ["", "## Deck checks (flagged, not enforced)", *[f"- {x}" for x in report["deck"]]]
    (out / "report.md").write_text("\n".join(md) + "\n")
    return report


def apply(pid: str, base: str) -> dict:
    deck, _ = _deck(pid)
    url = f"{base}/?render=1&project={pid}&plans={','.join(deck['slides'])}&apply=1"
    with tempfile.TemporaryDirectory() as prof:
        dom = render_slides.chrome(["--dump-dom"], url, prof)
    m = re.search(r'<pre id="render"[^>]*>(.*?)</pre>', dom, re.S)
    return json.loads(html.unescape(m.group(1))) if m else {"error": "the page did not finish"}


def main(argv: list[str]):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("new").add_argument("--title", required=True)
    e = sub.add_parser("eurostat")
    e.add_argument("pid"); e.add_argument("--geos", required=True); e.add_argument("--metrics", default="fiscal"); e.add_argument("--since", default="2015")
    sub.add_parser("profile").add_argument("pid")
    f = sub.add_parser("fact")
    f.add_argument("pid")
    for k in ("id", "subject", "statement", "url", "title", "published", "excerpt"):
        f.add_argument(f"--{k}", required=True)
    for k in ("value", "unit", "period"):
        f.add_argument(f"--{k}")
    i = sub.add_parser("identity")
    i.add_argument("pid")
    i.add_argument("--id", required=True)
    for k in ("primary", "type", "paper", "alert", "name"):
        i.add_argument(f"--{k}")
    i.add_argument("--base-language", dest="lang_base", default="atlas", help="frame and type sizes to start from: atlas, burgundy, institutional")
    b = sub.add_parser("build")
    b.add_argument("pid")
    b.add_argument("--out", default="")
    b.add_argument("--only", default="")
    sub.add_parser("apply").add_argument("pid")
    a = ap.parse_args(argv)
    if a.cmd == "new":
        r = {"project": STORE.create("blank", a.title)["project"]["id"]}
    elif a.cmd == "eurostat":
        r = eurostat(a.pid, [g.strip().upper() for g in a.geos.split(",")], [m.strip() for m in a.metrics.split(",")], a.since)
    elif a.cmd == "profile":
        r = profile(a.pid)
    elif a.cmd == "fact":
        r = add_fact(a.pid, a)
    elif a.cmd == "identity":
        r = set_identity(a.pid, a)
    elif a.cmd == "build":
        out = Path(a.out) if a.out else STORE.root / a.pid / "renders"
        r = build(a.pid, out, a.base, [x for x in a.only.split(",") if x] or None)
        r = {"out": str(out), "slides": [{k: s[k] for k in ("slide", "error", "qa_errors", "assets_missing")} for s in r["slides"]], "deck": r["deck"]}
    else:
        r = apply(a.pid, a.base)
    print(json.dumps(r, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
