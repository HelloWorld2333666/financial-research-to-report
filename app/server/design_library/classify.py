"""Gate A classification and layout clustering. Deterministic, no model calls, incremental.

    python -m design_library.classify --lib <private library root>

Reads   <lib>/catalog/slides.jsonl        (design_library.features)
        <lib>/cache/<sha>.json            (design_library.extract: objects, for slots)
        <lib>/renders/sheets/*-stats.json (render_slides.py stats: per-slide pixel statistics), optional
Writes  <lib>/catalog/tagged.jsonl        one record per slide: tags on five independent dimensions
        <lib>/catalog/layouts.jsonl       one record per layout cluster: tags, inferred slots, members, preview
        <lib>/catalog/index.tsv           the compact runtime index (one line per layout) the Skill and app tools read

Dimensions (multi-tag, independent):
  purpose    what the slide argues: summary, trend, comparison, kpi, survey, framework, process, matrix,
             case, recommendation, detail_table, statement, section, about
  structure  how it is arranged: chart_led, table, kpi_row, panels_N, flow, matrix_2x2, text_list, image_text,
             full_picture, title_only
  design     tone (dark/light), title style (headline/label), density, accents, type range
  compat     how it may be reused here: rebuild (geometry readable: slots and type scale derived, rebuilt natively),
             reference (look only: content baked into pictures, or the render failed)
  capacity   text volume bucket, panel count, smallest type

Clusters are stable: a layout keeps its id (the slide that founded it) across runs; new slides join an existing
layout when close enough, otherwise found a new one. Re-running after adding decks changes nothing already there.
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import math
import re
from pathlib import Path

CLASSIFIER_VERSION = 1

T = lambda *ws: re.compile("|".join(ws), re.I)
P_SUMMARY = T(r"\bsummary\b", r"key (takeaway|finding|message|insight)s?", r"highlights?", r"executive", r"at a glance", r"\boverview\b", "总结", "小结", "要点", "概要", "摘要", "核心发现", "主要发现")
P_RECO = T(r"recommend", r"next steps?", r"what (should|can|to do)", r"\bactions?\b", r"implications?", r"how to\b", r"call to action", r"priorities", "建议", "举措", "启示", "如何", "应对")
P_ABOUT = T(r"methodolog", r"\babout (the|this|us)\b", r"\bapproach\b", r"\bsample\b", r"respondents? profile", r"\bcontacts?\b", r"\bauthors?\b", "研究方法", "关于", "联系", "样本")
P_SURVEY = T(r"survey", r"respondents?", r"% of (respondents|executives|companies|consumers)", "调研", "受访", "问卷")
P_COMPARE = T(r"\bvs\.?\b", r"versus", r"compared", r"ranking", r"\btop \d+", r"largest", r"highest", r"lowest", r"\bpeers?\b", r"across (countries|markets|sectors|industries|regions)", "对比", "排名", "比较", "最高", "最大")
P_CASE = T(r"case (study|example)", r"\bexample\b", r"spotlight", r"profile", "案例")
P_MATRIX = T(r"matrix", r"quadrant", r"2x2", "矩阵", "象限")
YEAR = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")
PCT = re.compile(r"\d\s?%")
SOURCE = re.compile(r"^\s*(sources?|note|notes|资料来源|来源|注)\s*[:：]", re.I)


def box_of(o):
    return o.get("box") or {}


def panels(top: list[dict]) -> int:
    """Parallel panels: the largest set of similar-width blocks whose tops align (columns), or whose lefts align (rows)."""
    blocks = [box_of(o) for o in top if o["kind"] in ("text", "shape", "group", "picture", "table") and 0.12 < box_of(o).get("w", 0) < 0.6 and box_of(o).get("h", 0) > 0.12]
    best = 0
    for axis, size in (("y", "w"), ("x", "h")):
        c = collections.Counter((round(b[axis] * 25), round(b[size] * 20)) for b in blocks)
        for (_, _), k in c.items():
            best = max(best, k)
    return best if best >= 2 else 0


def slots(objs: list[dict], title_text: str | None) -> list[dict]:
    """Content slots inferred from geometry (the decks are PDF conversions: no placeholders). Role, box, type size and
    a capacity in characters; merged so a paragraph split into line fragments becomes one slot."""
    out = []
    texts = [o for o in objs if o["kind"] == "text" and o.get("depth", 0) == 0 and o["text"]["chars"] > 0]
    title = None
    if title_text:
        title = next((o for o in texts if o["text"]["text"][:160] == title_text[:160]), None)
    if title:
        out.append({"role": "title", "box": title["box"], "pt": title["text"].get("max_pt"), "chars": title["text"]["chars"]})
    rest = [o for o in texts if o is not title]
    # merge line fragments: same left edge (±1%), same type size, vertically adjacent
    rest.sort(key=lambda o: (round(o["box"]["x"], 2), o["box"]["y"]))
    merged: list[dict] = []
    for o in rest:
        b, pt = o["box"], o["text"].get("max_pt")
        m = merged[-1] if merged else None
        if m and abs(m["box"]["x"] - b["x"]) < 0.012 and m["pt"] == pt and 0 <= b["y"] - (m["box"]["y"] + m["box"]["h"]) < 0.035:
            mb = m["box"]; y2 = max(mb["y"] + mb["h"], b["y"] + b["h"])
            m["box"] = {"x": min(mb["x"], b["x"]), "y": mb["y"], "w": max(mb["x"] + mb["w"], b["x"] + b["w"]) - min(mb["x"], b["x"]), "h": y2 - mb["y"]}
            m["chars"] += o["text"]["chars"]; m["text"] += " " + o["text"]["text"]
        else:
            merged.append({"box": dict(b), "pt": pt, "chars": o["text"]["chars"], "text": o["text"]["text"]})
    for m in merged:
        b, pt, t = m["box"], m["pt"] or 0, m["text"]
        if SOURCE.search(t) or (b["y"] > 0.86 and pt <= 9):
            role = "footnote"
        elif pt >= 24 and m["chars"] <= 14 and re.search(r"\d", t):
            role = "figure"
        elif title and b["y"] < title["box"]["y"] + title["box"]["h"] + 0.08 and b["y"] >= title["box"]["y"] and m["chars"] > 25:
            role = "standfirst"
        elif m["chars"] < 40 and pt <= 12:
            role = "label"
        else:
            role = "body"
        out.append({"role": role, "box": b, "pt": m["pt"], "chars": m["chars"]})
    for o in objs:
        if o.get("depth", 0):
            continue
        b = box_of(o)
        if o["kind"] == "table":
            out.append({"role": "table", "box": b, "rows": o["table"]["rows"], "cols": o["table"]["cols"]})
        elif o["kind"] == "picture" and b.get("w", 0) * b.get("h", 0) > 0.03:
            out.append({"role": "picture", "box": b})
        elif o["kind"] in ("chart", "group") and b.get("w", 0) * b.get("h", 0) > 0.05:
            out.append({"role": "figure_group" if o["kind"] == "group" else "chart", "box": b})
        elif o["kind"] == "shape" and o.get("fill") and b.get("w", 0) > 0.15 and b.get("h", 0) > 0.15 and b.get("w", 0) * b.get("h", 0) < 0.7:
            out.append({"role": "panel", "box": b, "fill": o["fill"]})
    # the region of a shape-drawn chart: the bounding box of small untexted rectangles that share a baseline or left edge
    rects = [box_of(o) for o in objs if o["kind"] == "shape" and 0.002 < box_of(o).get("w", 0) < 0.5 and 0.002 < box_of(o).get("h", 0) < 0.6]
    base = collections.defaultdict(list)
    for b in rects:
        if b["w"] < 0.08:
            base[("c", round(b["y"] + b["h"], 2))].append(b)
        if b["h"] < 0.06:
            base[("b", round(b["x"], 2))].append(b)
    for (k, _), bs in base.items():
        if len(bs) >= 5:
            x0, y0 = min(b["x"] for b in bs), min(b["y"] for b in bs)
            x1, y1 = max(b["x"] + b["w"] for b in bs), max(b["y"] + b["h"] for b in bs)
            out.append({"role": "chart", "drawn": "columns" if k == "c" else "bars", "marks": len(bs), "box": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}})
    for s in out:
        s["box"] = {k: round(v, 3) for k, v in s["box"].items() if k in ("x", "y", "w", "h")}
    return out[:24]


def tag(r: dict, objs: list[dict], st: dict | None) -> dict:
    title = r["title"] or ""
    text = " ".join(o["text"]["text"] for o in objs if o["kind"] == "text")
    years = set(YEAR.findall(text))
    pcts = len(PCT.findall(text))
    sc = r["shape_chart"]
    top = [o for o in objs if o.get("depth", 0) == 0]
    np_ = panels(top)
    chart = bool(sc["kind"] or r["native_charts"])
    tables = [t for t in r["tables"]]
    big_table = any(int(t.split("x")[0]) >= 5 for t in tables)
    purpose, structure = set(), []
    if r["kind"] in ("divider", "agenda", "cover"):
        purpose.add("section")
    if P_SUMMARY.search(title):
        purpose.add("summary")
    if P_RECO.search(title):
        purpose.add("recommendation")
    if P_ABOUT.search(title) or r["kind"] == "legal":
        purpose.add("about")
    if P_SURVEY.search(title + " " + text[:400]) and pcts >= 4:
        purpose.add("survey")
    if chart and (len(years) >= 3 or sc.get("kind") == "columns") and sc["kind"] not in ("bars", "drawn_col"):
        purpose.add("trend")
    if sc["kind"] in ("bars", "drawn_col") or P_COMPARE.search(title):
        purpose.add("comparison")
    if r["big_numbers"] >= 2:
        purpose.add("kpi")
    if P_CASE.search(title) or (0.12 < r["picture_max"] < 0.6 and r["chars"] > 300 and not chart and r["pictures"] <= 3):
        purpose.add("case")
    if P_MATRIX.search(title):
        purpose.add("matrix")
    if big_table:
        purpose.add("detail_table")
    flowish = sc["lines"] >= 3 and not chart and r["big_numbers"] == 0
    if flowish and (np_ >= 3 or len(years) >= 3):
        purpose.add("process")
    elif r["kind"] == "content" and not chart and not tables and np_ >= 2 and pcts < 3 and r["big_numbers"] == 0:
        purpose.add("framework")
    if r["kind"] == "content" and r["chars"] < 260 and not chart and not tables and r["texts"] <= 6:
        purpose.add("statement")
    if not purpose and r["kind"] == "content":
        purpose.add("comparison" if pcts >= 6 else "framework" if np_ >= 2 else "statement" if r["chars"] < 500 else "detail_text")
    # structure
    if r["picture_max"] > 0.85 and r["chars"] < 150:
        structure.append("full_picture")
    if chart:
        structure.append("chart_led")
    if tables:
        structure.append("table")
    if r["big_numbers"] >= 2:
        structure.append("kpi_row")
    if np_ >= 2:
        structure.append(f"panels_{min(np_, 6)}")
    if "process" in purpose:
        structure.append("flow")
    if "matrix" in purpose:
        structure.append("matrix_2x2")
    if 0.12 < r["picture_max"] <= 0.6 and r["pictures"] <= 3:
        structure.append("image_text")
    if r["kind"] in ("divider", "cover") and r["chars"] < 160:
        structure.append("title_only")
    if not structure:
        structure.append("text_list" if r["chars"] >= 200 else "title_only")
    # design
    tone = None
    if st:
        bg = st.get("bg") or "#ffffff"
        bgl = (0.2126 * int(bg[1:3], 16) + 0.7152 * int(bg[3:5], 16) + 0.0722 * int(bg[5:7], 16)) / 255
        tone = "dark" if st["dark"] >= 0.45 or (bgl < 0.3 and st["dark"] >= 0.3) else "light"
    tp = r["title_pt"] or 0
    design = {
        "tone": tone,
        "title": "headline" if r["title_chars"] >= 45 else "label" if r["title_chars"] else "none",
        "title_pt": tp or None,
        "density": "dense" if r["chars"] >= 1100 or r["objects"] >= 80 else "medium" if r["chars"] >= 450 else "light",
        "min_pt": r["min_pt"],
        "ink": st["ink"] if st else None,
        "accents": [a[0] for a in st["accents"]] if st else [],
    }
    # compatibility: none of these decks is a native template, so nothing is copied; the question is whether the
    # geometry and type can be read and rebuilt natively (rebuild), or the look is only visible in pixels (reference)
    reasons = []
    if r["picture_max"] > 0.5 and r["chars"] < 150 and r["kind"] == "content":
        reasons.append("content is a picture")
    if st and st.get("blank"):
        reasons.append("renders blank here")
    if st and st.get("error"):
        reasons.append("render error")
    if r["texts"] == 0 and r["kind"] == "content":
        reasons.append("no text objects")
    compat = "reference" if reasons else "rebuild"
    capacity = {"chars": r["chars"], "bucket": design["density"], "panels": np_, "min_pt": r["min_pt"], "texts": r["texts"]}
    return {"purpose": sorted(purpose), "structure": structure, "design": design, "compat": compat, "compat_why": reasons, "capacity": capacity}


def archetype(L: dict) -> str:
    if L["kind"] != "content":
        return L["kind"]
    st = [t for t in L["structure"] if not t.startswith("panels")] or ["text_list"]
    p = L["capacity"]["panels"]
    return f"{st[0]}/{'single' if p < 2 else 'two' if p == 2 else 'three' if p == 3 else 'many'}"


def hamming(a: str, b: str) -> int:
    return sum(x != y for x, y in zip(a, b))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True)
    a = ap.parse_args(argv)
    lib = Path(a.lib)
    cat = lib / "catalog"
    rows = [json.loads(l) for l in (cat / "slides.jsonl").open()]
    sha_of = {l.split("\t")[1].strip(): l.split("\t")[0] for l in (lib / "manifest.tsv").read_text().splitlines() if l.strip()}
    caches = {}
    stats: dict[str, dict] = {}
    for p in glob.glob(str(lib / "renders/sheets/*-stats.json")):
        m = json.loads(Path(p).read_text())
        if "cells" not in m:
            continue
        pre = Path(p).name[:10]
        for c in m["cells"]:
            stats[f"{pre}:{c['n']}"] = c
        for n in m.get("errors", []):
            stats.setdefault(f"{pre}:{n}", {"lum": 1, "ink": 0, "accents": [], "blank": False})["error"] = True
    sheet_of = {}
    for p in glob.glob(str(lib / "renders/sheets/*.png")):
        nm = Path(p).stem  # <sha10>-<from>-<to>
        pre, f, t = nm.split("-")
        for n in range(int(f), int(t) + 1):
            sheet_of[f"{pre}:{n}"] = {"sheet": Path(p).name, "cell": n - int(f)}
    tagged = []
    for r in rows:
        sha = sha_of[r["deck"]]
        if sha not in caches:
            caches[sha] = {s["n"]: s for s in json.loads((lib / "cache" / f"{sha}.json").read_text())["slides"]}
        objs = [o for o in caches[sha][r["n"]]["objects"] if o.get("box")]
        t = tag(r, objs, stats.get(r["id"]))
        tagged.append({**{k: r[k] for k in ("id", "deck", "n", "kind", "publisher", "lang", "title", "fp")}, "sha": sha, **t,
                       "preview": sheet_of.get(r["id"]), "_objs": objs})
    # incremental clustering: existing layouts keep their ids and members; unassigned slides join or found layouts
    prev = {}
    lp = cat / "layouts.jsonl"
    if lp.exists():
        for l in lp.open():
            x = json.loads(l)
            prev[x["id"]] = x
    member_of = {m: lid for lid, x in prev.items() for m in x["members"]}
    by_id = {r["id"]: r for r in tagged}
    leaders = {lid: by_id[lid] for lid in prev if lid in by_id}

    def key(r):
        return (r["kind"], r["structure"][0], r["design"]["tone"], r["lang"] == "zh")

    def close(r, l):
        if key(r) != key(l) or r["capacity"]["panels"] != l["capacity"]["panels"]:
            return False
        if abs(math.log((r["capacity"]["chars"] + 50) / (l["capacity"]["chars"] + 50))) > 0.6:
            return False
        return hamming(r["fp"], l["fp"]) <= 7

    members = collections.defaultdict(list)
    for lid, x in prev.items():
        members[lid] = [m for m in x["members"] if m in by_id]
    for r in sorted(tagged, key=lambda r: (r["deck"], r["n"])):
        if r["id"] in member_of:
            r["layout"] = member_of[r["id"]]
            continue
        lid = next((lid for lid, l in leaders.items() if close(r, l)), None)
        if lid is None:
            lid = r["id"]
            leaders[lid] = r
        r["layout"] = lid
        members[lid].append(r["id"])
    layouts = []
    for lid, ms in members.items():
        if not ms:
            continue
        rs = [by_id[m] for m in ms]
        # the representative: the member closest to all others (medoid) with a readable render
        rep = min(rs, key=lambda x: (x["compat"] != "rebuild", sum(hamming(x["fp"], y["fp"]) for y in rs), x["id"]))
        cnt = lambda f: collections.Counter(t for x in rs for t in f(x))
        L = {
            "id": lid, "v": CLASSIFIER_VERSION, "rep": rep["id"], "members": ms, "size": len(ms),
            "decks": sorted({x["deck"] for x in rs}), "publisher": sorted({x["publisher"] for x in rs}), "lang": rep["lang"],
            "kind": rep["kind"], "purpose": [t for t, c in cnt(lambda x: x["purpose"]).most_common() if c >= max(1, len(rs) / 3)],
            "structure": rep["structure"], "design": rep["design"], "compat": rep["compat"], "capacity": rep["capacity"],
            "slots": slots(rep["_objs"], rep["title"]), "preview": rep["preview"], "title": rep["title"],
        }
        layouts.append(L)
    layouts.sort(key=lambda x: (-x["size"], x["id"]))
    # archetypes: the coarse level retrieval and review work at (kind / primary structure / panel count). Exemplars are
    # the layouts that best teach the pattern: readable, action-titled, recurring, not overcrowded, from different decks
    arch = collections.defaultdict(list)
    for L in layouts:
        L["archetype"] = archetype(L)
        arch[L["archetype"]].append(L)
    archetypes = []
    for aid, Ls in arch.items():
        good = sorted((L for L in Ls if L["compat"] == "rebuild"), key=lambda L: (L["design"]["title"] != "headline", L["design"]["density"] == "dense",
                                                                                  (L["design"].get("min_pt") or 12) < 7, -L["size"], L["id"]))
        ex, decks = [], set()
        for L in good:
            if L["decks"][0] in decks:
                continue
            decks.add(L["decks"][0]); ex.append(L["id"])
            if len(ex) == 5:
                break
        slides = sum(L["size"] for L in Ls)
        archetypes.append({"id": aid, "slides": slides, "layouts": len(Ls), "decks": len({d for L in Ls for d in L["decks"]}),
                           "purpose": collections.Counter(p for L in Ls for p in L["purpose"] for _ in range(L["size"])).most_common(5),
                           "exemplars": ex})
    archetypes.sort(key=lambda a: -a["slides"])
    (cat / "archetypes.json").write_text(json.dumps(archetypes, ensure_ascii=False, indent=0))
    with (cat / "tagged.jsonl").open("w") as f:
        for r in tagged:
            f.write(json.dumps({k: v for k, v in r.items() if k != "_objs"}, ensure_ascii=False) + "\n")
    with lp.open("w") as f:
        for L in layouts:
            f.write(json.dumps(L, ensure_ascii=False) + "\n")
    # runtime index: one short line per layout, no slide text (cheap to load, safe to log)
    cols = ["id", "archetype", "kind", "purpose", "structure", "tone", "title", "density", "panels", "slots", "compat", "size", "lang", "publisher"]
    with (cat / "index.tsv").open("w") as f:
        f.write("\t".join(cols) + "\n")
        for L in layouts:
            sl = collections.Counter(s["role"] for s in L["slots"])
            f.write("\t".join([L["id"], L["archetype"], L["kind"], ",".join(L["purpose"]), ",".join(L["structure"]), L["design"]["tone"] or "-", L["design"]["title"],
                               L["design"]["density"], str(L["capacity"]["panels"]), ",".join(f"{k}{v}" for k, v in sorted(sl.items())), L["compat"], str(L["size"]),
                               L["lang"], ",".join(L["publisher"])]) + "\n")
    print(json.dumps({"slides": len(tagged), "layouts": len(layouts), "singletons": sum(1 for L in layouts if L["size"] == 1),
                      "rebuild": sum(1 for L in layouts if L["compat"] == "rebuild"), "with_stats": sum(1 for r in tagged if r["id"] in stats)}))


if __name__ == "__main__":
    main()
