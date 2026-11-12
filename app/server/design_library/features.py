"""Slide features and near-duplicate grouping from the extraction cache (Gate A). Deterministic, no model calls.

    python -m design_library.features --cache <private>/cache --manifest <private>/manifest.tsv (sha, file name, optional publisher) --out <private>/catalog

Writes slides.jsonl (one compact record per slide) and groups.json (near-duplicate groups by geometry fingerprint).
The fingerprint is an 8 x 6 occupancy grid of what sits where (text, figure, picture, table, shape-drawn chart),
so a deck's repeated content template collapses into one group while different arrangements stay apart.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

NUMLABEL = re.compile(r"[-+−~<>]?\$?\d[\d.,]*\s?(%|pp|bp|bn|m|k|x|×|亿|万|B|M|K)?\+?|Q[1-4]\s?['’]?\d{2,4}|(19|20)\d\d[EF]?")
DIGITS = re.compile(r"[-+−]?\d[\d.,]*\s?(%|pp|bp|bn|m|x|×|亿|万)?")
LEGAL = re.compile(r"refers to one or more|member firms|All rights reserved|版权所有|免责|Copyright", re.I)
AGENDA = re.compile(r"^(today'?s |our )?(agenda|contents|table of contents)\b|^(目录|议程|内容)$", re.I)


def area(b) -> float:
    return (b["w"] * b["h"]) if b else 0.0


def donut(arcs: list[dict]) -> bool:
    """Three or more polygon segments overlapping into one squarish region of chart size (icons are smaller)."""
    bs = [o["box"] for o in arcs]
    seen = set()
    for i in range(len(bs)):
        if i in seen:
            continue
        comp, stack = [], [i]
        while stack:
            j = stack.pop()
            if j in seen:
                continue
            seen.add(j); comp.append(bs[j])
            a = bs[j]
            stack += [k for k in range(len(bs)) if k not in seen and not (bs[k]["x"] > a["x"] + a["w"] or a["x"] > bs[k]["x"] + bs[k]["w"] or bs[k]["y"] > a["y"] + a["h"] or a["y"] > bs[k]["y"] + bs[k]["h"])]
        if len(comp) >= 3:
            x0, y0 = min(b["x"] for b in comp), min(b["y"] for b in comp)
            w, h = max(b["x"] + b["w"] for b in comp) - x0, max(b["y"] + b["h"] for b in comp) - y0
            if w * h >= 0.008 and 0.6 < (w * 16 / 9) / max(h, 1e-6) < 1.6:
                return True
    return False


def shape_chart(objs: list[dict]) -> dict:
    """Charts drawn with shapes: several untexted rectangles sharing a baseline (columns) or a left edge (bars)."""
    # rectangles, including freeform ones (a closed four-corner path: how PDF conversions draw bars)
    is_rect = lambda o: o.get("geom") in ("rect", None) or (o.get("path") and o["path"]["closed"] == 1 and o["path"]["pts"] == 5 and not o["path"]["curves"])
    rects = [o["box"] for o in objs if o["kind"] == "shape" and is_rect(o) and o.get("fill") and o.get("box") and 0.002 < o["box"]["w"] < 0.5 and 0.002 < o["box"]["h"] < 0.6]
    base, left = collections.defaultdict(list), collections.defaultdict(list)
    for b in rects:
        if b["w"] < 0.08:
            base[round(b["y"] + b["h"], 2)].append(b["h"])
        if b["h"] < 0.06:
            left[round(b["x"], 2)].append(b["w"])
    # bars encode values, so their lengths differ; a row of equal boxes is a list or a set of cards
    varied = lambda xs: len(xs) >= 3 and (max(xs) - min(xs)) > 0.25 * max(xs)
    cols = max((len(v) for v in base.values() if varied(v)), default=0)
    bars = max((len(v) for v in left.values() if varied(v)), default=0)
    lines = sum(1 for o in objs if o["kind"] == "connector") + sum(1 for o in objs if o["kind"] == "shape" and o.get("geom") == "line")
    # charts drawn as freeform paths (PDF conversions): the reliable trace is a run of short numeric labels that share a
    # row (column chart values, a time axis) or a column (bar chart values), with marks around them
    # list numbering (1, 2, 3 … or 01, 02 …) is not an axis
    nums = [o["box"] for o in objs if o["kind"] == "text" and o["text"]["chars"] <= 9 and NUMLABEL.fullmatch(o["text"]["text"].strip() or "x")
            and not re.fullmatch(r"0?\d|1[0-2]", o["text"]["text"].strip())]
    row, col = collections.Counter(round(b["y"] * 40) for b in nums), collections.Counter(round(b["x"] * 40) for b in nums)
    marks = sum(1 for o in objs if o["kind"] == "shape" and o.get("box") and o["box"]["w"] * o["box"]["h"] < 0.05)
    axis_row, axis_col = max(row.values(), default=0), max(col.values(), default=0)
    # freeform series: open, unfilled polylines with several points (line charts); closed curved segments (donuts, pies)
    paths = [o for o in objs if o.get("path")]
    series = [o for o in paths if o["path"]["pts"] >= 8 and o["box"]["w"] > 0.06 and (o["path"]["nofill"] or not o.get("fill")) and o.get("line")]
    # donut and pie segments: closed, many-sided (polygons approximate the arcs), in a squarish box, filled
    arcs = [o for o in paths if o["path"]["closed"] and (o["path"]["curves"] >= 2 or o["path"]["pts"] >= 10) and o.get("fill")
            and 0.002 < o["box"]["w"] * o["box"]["h"] < 0.2 and 0.45 < (o["box"]["w"] * 16 / 9) / max(o["box"]["h"], 1e-6) < 2.2]
    kind = "columns" if cols >= 4 else "bars" if bars >= 4 else None
    if kind is None and max(cols, bars) == 3 and len(nums) >= 2:
        kind = "columns" if cols == 3 else "bars"
    if kind is None and (len(series) >= 3 or (series and (max(axis_row, axis_col) >= 3 or len(nums) >= 4))):
        kind = "line"
    if kind is None and donut(arcs):
        kind = "donut"
    if kind is None and marks >= 4 and max(axis_row, axis_col) >= 4:
        kind = "drawn_row" if axis_row >= axis_col else "drawn_col"
    pics = [o for o in objs if o["kind"] == "picture" and 0.04 < o["box"]["w"] * o["box"]["h"] < 0.6]
    if kind is None and pics and len(nums) >= 4 and max(axis_row, axis_col) >= 3:
        kind = "picture"  # a chart exported as an image, its labels kept as text
    return {"kind": kind, "marks": max(cols, bars), "lines": lines, "num_labels": len(nums), "axis": max(axis_row, axis_col), "series": len(series), "arcs": len(arcs)}


def drawn_table(objs: list[dict]) -> bool:
    """A table drawn as text boxes: at least four rows that share at least three column positions."""
    cells = [o["box"] for o in objs if o["kind"] == "text" and o["text"]["chars"] <= 80 and o["box"]["w"] < 0.4]
    rows = collections.defaultdict(set)
    for b in cells:
        rows[round(b["y"] * 80)].add(round(b["x"] * 50))
    colfreq = collections.Counter(x for xs in rows.values() for x in xs)
    common = {x for x, k in colfreq.items() if k >= 4}
    return len(common) >= 3 and sum(1 for xs in rows.values() if len(xs & common) >= 3) >= 4


def features(deck: dict, s: dict) -> dict:
    objs = [o for o in s["objects"] if o.get("box")]
    top = [o for o in objs if o.get("depth", 0) == 0]
    texts = [o for o in objs if o["kind"] == "text"]
    title = next((o for o in texts if o.get("ph") in ("title", "ctrTitle")), None)
    if title is None:  # no title placeholder: the largest text near the top
        cands = [o for o in texts if o["box"]["y"] < 0.25 and (o["text"].get("max_pt") or 0) >= 16]
        title = max(cands, key=lambda o: (o["text"].get("max_pt") or 0), default=None)
    chars = sum(o["text"]["chars"] for o in texts)
    pics = [o for o in objs if o["kind"] == "picture" or o.get("fill") == "picture"]
    pic_max = max((area(o["box"]) for o in pics), default=0)
    tables = [o for o in objs if o["kind"] == "table"]
    big_numbers = [o for o in texts if (o["text"].get("max_pt") or 0) >= 20 and NUMLABEL.fullmatch((o["text"]["text"] or "x").strip()) and o["text"]["chars"] <= 8
                   and not re.fullmatch(r"0?\d", o["text"]["text"].strip())]  # section numbers 01..09 are not figures
    all_text = " ".join(o["text"]["text"] for o in texts)
    sc = shape_chart(objs)
    # columns: distinct left edges of substantial content blocks
    blocks = [o for o in top if o["kind"] in ("text", "table", "picture", "group", "chart") and o["box"]["w"] > 0.12 and o["box"]["h"] > 0.08 and o is not title]
    lefts = sorted({round(o["box"]["x"] * 12) for o in blocks})
    n = s["n"]
    kind = "content"
    legal_chars = sum(o["text"]["chars"] for o in texts if LEGAL.search(o["text"]["text"] or ""))
    if n == 1:
        kind = "cover"
    elif legal_chars > 0.3 * max(chars, 1) and chars > 400:
        kind = "legal"
    elif any(AGENDA.search((o["text"]["text"] or "").strip()) and o["text"]["chars"] <= 30 and (o["text"].get("max_pt") or 0) >= 14 for o in texts):
        kind = "agenda"
    elif title and (title["text"].get("max_pt") or 0) >= 32 and chars < 220 and len(texts) <= 4:
        kind = "cover" if n <= 2 else "divider"
    elif pic_max > 0.8 and chars < 120:
        kind = "image"
    # occupancy fingerprint
    grid = [["."] * 8 for _ in range(6)]
    for o in top:
        c = {"text": "t", "picture": "p", "table": "T", "chart": "C", "group": "g"}.get(o["kind"])
        if not c or area(o["box"]) < 0.004:
            continue
        b = o["box"]
        for gy in range(6):
            for gx in range(8):
                cx, cy = (gx + 0.5) / 8, (gy + 0.5) / 6
                if b["x"] <= cx <= b["x"] + b["w"] and b["y"] <= cy <= b["y"] + b["h"]:
                    grid[gy][gx] = c if grid[gy][gx] in (".", "g") else grid[gy][gx]
    fp = "".join("".join(r) for r in grid)
    sizes = sorted({sz for o in texts for sz in o["text"].get("sizes", [])})
    fonts = sorted({f for o in texts for f in o["text"].get("fonts", [])})
    fills = collections.Counter(o.get("fill") for o in objs if o["kind"] in ("shape", "text") and o.get("fill") and o["fill"] != "picture")
    return {
        "id": f"{deck['sha256'][:10]}:{n}", "deck": deck["file"], "n": n, "kind": kind, "layout": s.get("layout"),
        "title": (title["text"]["text"][:160] if title else None), "title_pt": title["text"].get("max_pt") if title else None, "title_chars": len(title["text"]["text"]) if title else 0,
        "chars": chars, "texts": len(texts), "objects": len(objs), "shapes": sum(1 for o in objs if o["kind"] == "shape"), "groups": sum(1 for o in objs if o["kind"] == "group"),
        "pictures": len(pics), "picture_max": round(pic_max, 3), "tables": [f"{t['table']['rows']}x{t['table']['cols']}" for t in tables],
        "native_charts": [c for o in objs if o["kind"] == "chart" for c in o["chart"].get("kinds", [])], "shape_chart": sc, "drawn_table": drawn_table(objs), "smartart": sum(1 for o in objs if o["kind"] == "smartart"),
        "big_numbers": len(big_numbers), "columns": len(lefts), "sizes": sizes[:12], "min_pt": sizes[0] if sizes else None, "fonts": fonts[:6],
        "fills": [c for c, _ in fills.most_common(5)], "background": s.get("background"), "fp": fp,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    # manifest.tsv: "<sha256>\t<original file name>" per line; the library holds exactly these decks
    # manifest.tsv: "<sha256>\t<file name>[\t<publisher>]"; the publisher column is private metadata, kept out of code
    rows_m = [l.split("\t") for l in Path(a.manifest).read_text().splitlines() if "\t" in l]
    names = {r[0]: r[1] for r in rows_m}
    pubs = {r[0]: (r[2].strip() if len(r) > 2 and r[2].strip() else "unknown") for r in rows_m}
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    decks = [json.loads(p.read_text()) for p in Path(a.cache).glob("*.json") if not p.name.endswith(".error.json")]
    decks = [{**d, "file": names[d["sha256"]].strip()} for d in decks if d["sha256"] in names]
    rows = []
    for d in sorted(decks, key=lambda x: x["file"]):
        for s in d["slides"]:
            r = features(d, s)
            r["publisher"] = pubs[d["sha256"]]
            r["lang"] = "zh" if len(re.findall(r"[一-鿿]", " ".join(o.get("text", {}).get("text", "") for o in s["objects"]))) > 20 else "en"
            rows.append(r)
    # near-duplicate groups: identical fingerprint within a deck, or across decks with the same layout name
    groups: dict[str, list[str]] = collections.defaultdict(list)
    for r in rows:
        key = hashlib.sha1(f"{r['publisher']}|{r['kind']}|{r['fp']}".encode()).hexdigest()[:12]
        r["group"] = key
        groups[key].append(r["id"])
    with (out / "slides.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out / "groups.json").write_text(json.dumps({k: v for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))}, ensure_ascii=False))
    kinds = collections.Counter(r["kind"] for r in rows)
    print(json.dumps({"decks": len(decks), "slides": len(rows), "groups": len(groups), "singletons": sum(1 for v in groups.values() if len(v) == 1), "kinds": kinds}))


if __name__ == "__main__":
    main()
