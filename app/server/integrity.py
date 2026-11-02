"""Server-side integrity: the SAVED deck (.pptx bytes) checked against the Evidence Core.

The client checks integrity after every change (app/web/src/core/integrity.ts); this module checks
independently what was actually written to disk, so a save or an export never relies on the
client's word. It reads the OOXML directly:

- bound charts: every series point in the chart part's cache equals the working value;
- bound tables: every data cell's text equals the working value as formatted for the dataset;
- bound text: every figure written is backed by a number reference (evidence or derivation) whose
  CURRENT working value still rounds to what the text says.

Durable element ids follow GenOffice (pptx-engine/src/identity.ts): ``e_<first 8 hex of the
a16:creationId GUID>`` or, without one, ``e_<cNvPr id>``.
"""

from __future__ import annotations

import io
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from frr import derive  # noqa: E402

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "a16": "http://schemas.microsoft.com/office/drawing/2014/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
ELEMENT_TAGS = {f"{{{NS['p']}}}{t}" for t in ("sp", "graphicFrame", "grpSp", "pic", "cxnSp")}
WORKING_STATUSES = {"manual_unverified", "verified"}

# Figures in prose: numbers that are not years, tenors ("10-year") or parts of identifiers (gov_10dd).
FIGURE_RE = re.compile(r"(?<![\w.])[+\-−]?\d+(?:\.\d+)?(?![\w.]|-year|-month|-day| ?years?\b)")


# ------------------------------------------------------------------ Evidence Core projections (mirror evidence.ts)
def effective(project: dict, did: str) -> dict[str, dict]:
    ds = project.get("datasets", {}).get(did) or {}
    out = {o["date"]: {"value": o["value"], "edited": False, "evidence_id": o.get("evidence_id")} for o in ds.get("observations", [])}
    for date, w in (ds.get("working") or {}).items():
        base = out.get(date, {"value": None, "evidence_id": None})
        out[date] = {**base, "value": None if w.get("deleted") else w.get("value"), "edited": True, "status": w.get("status")}
    return dict(sorted(out.items()))


def decimals_of(ds: dict | None) -> int:
    d = 1
    for o in (ds or {}).get("observations", []):
        if o.get("value") is not None:
            d = max(d, len(repr(float(o["value"])).split(".")[1].rstrip("0") or ""))
    return min(d, 2)


def cell_text(project: dict, did: str, date: str) -> str:
    o = effective(project, did).get(date)
    if not o or o["value"] is None:
        return "—"
    return f"{o['value']:.{decimals_of(project['datasets'].get(did))}f}" + (" ✎" if o["edited"] else "")


def chart_data(project: dict, spec: dict) -> dict:
    eff = {d: effective(project, d) for d in spec["series"]}
    dates = sorted({x for e in eff.values() for x in e})
    return {"categories": dates, "series": [{"name": (project["datasets"].get(d) or {}).get("entity", d),
                                             "values": [eff[d].get(x, {}).get("value") for x in dates]} for d in spec["series"]]}


def evidence_index(project: dict) -> dict[str, tuple[str, str]]:
    """evidence id -> (dataset id, date) for every source observation."""
    return {o["evidence_id"]: (did, o["date"]) for did, ds in project.get("datasets", {}).items()
            for o in ds.get("observations", []) if o.get("evidence_id")}


def current_value(project: dict, ref: dict, index: dict | None = None, _stack: tuple = ()) -> float | None:
    """Working value behind a number reference: evidence (with manual edits applied) or a derivation recomputed."""
    index = index if index is not None else evidence_index(project)
    if ref.get("evidence"):
        where = index.get(ref["evidence"])
        if where:
            return effective(project, where[0]).get(where[1], {}).get("value")
        ev = project.get("evidence", {}).get(ref["evidence"])
        return ev.get("value") if ev else None
    d = project.get("derivations", {}).get(ref.get("derivation"))
    if not d or d["id"] in _stack:
        return None
    env = {}
    for name, src in d["inputs"].items():
        v = current_value(project, {"evidence": src} if src not in project.get("derivations", {}) else {"derivation": src}, index, _stack + (d["id"],))
        if v is None:
            return None
        env[name] = v
    try:
        got = derive.evaluate(d["formula"], env)
    except ValueError:
        return None
    return round(got, d["rounding"]) if d.get("rounding") is not None else got


def figures(text: str) -> list[tuple[str, float, int]]:
    """(as written, value, decimals) for each figure in prose, in reading order."""
    out = []
    for m in FIGURE_RE.finditer(text.replace(",", "")):
        raw = m.group(0).replace("−", "-")
        v = float(raw)
        if "." not in raw and 1900 <= abs(v) <= 2100:
            continue  # a year
        out.append((m.group(0), v, len(raw.split(".")[1]) if "." in raw else 0))
    return out


def text_numbers(text: str, refs: list[dict], project: dict, index: dict | None = None) -> list[dict]:
    """Each figure in ``text`` with the reference it resolves to and whether the data still says so."""
    index = index if index is not None else evidence_index(project)
    pool = [dict(r) for r in refs]
    out = []
    for raw, v, dec in figures(text):
        ref = next((r for r in pool if r.get("text") and figures(r["text"]) and figures(r["text"])[0][0] == raw and not r.get("_used")), None)
        if ref is None:
            out.append({"text": raw, "status": "unsourced"})
            continue
        ref["_used"] = True
        want = current_value(project, ref, index)
        ok = want is not None and derive.matches(want, v, dec)
        out.append({"text": raw, "status": "ok" if ok else "stale", "ref": {k: ref[k] for k in ("text", "evidence", "derivation") if k in ref},
                    "data": want})
    return out


# ------------------------------------------------------------------ deck reading
def durable_id(el: ET.Element) -> str | None:
    nv = next(iter(el), None)
    cnvpr = nv.find("p:cNvPr", NS) if nv is not None else None
    if cnvpr is None:
        return None
    cid = cnvpr.find(".//a16:creationId", NS)
    if cid is not None and cid.get("id"):
        return "e_" + cid.get("id").strip("{}")[:8].lower()
    return f"e_{cnvpr.get('id')}" if cnvpr.get("id") else None


def _paragraph_text(container: ET.Element | None) -> str:
    if container is None:
        return ""
    return "\n".join("".join(t.text or "" for t in p.iter(f"{{{NS['a']}}}t")) for p in container.findall("a:p", NS))


def _rels(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    folder, name = part.rsplit("/", 1)
    rels = f"{folder}/_rels/{name}.rels"
    if rels not in z.namelist():
        return {}
    out = {}
    for r in ET.fromstring(z.read(rels)).findall("rel:Relationship", NS):
        target = r.get("Target", "")
        parts = (target.lstrip("/") if target.startswith("/") else f"{folder}/{target}").split("/")
        norm: list[str] = []
        for seg in parts:
            if seg == "..":
                norm.pop()
            elif seg != ".":
                norm.append(seg)
        out[r.get("Id")] = "/".join(norm)
    return out


def _chart(z: zipfile.ZipFile, part: str) -> dict:
    root = ET.fromstring(z.read(part))
    series = []
    for ser in root.iter(f"{{{NS['c']}}}ser"):
        def pts(node):
            return {int(pt.get("idx")): (pt.findtext("c:v", namespaces=NS)) for pt in node.iter(f"{{{NS['c']}}}pt")} if node is not None else {}
        # scatter charts keep points in c:xVal / c:yVal instead of c:cat / c:val
        yv = ser.find("c:val", NS) if ser.find("c:val", NS) is not None else ser.find("c:yVal", NS)
        xv = ser.find("c:xVal", NS)
        cats, vals, xs = pts(ser.find("c:cat", NS)), pts(yv), pts(xv)
        count = yv.find(".//c:ptCount", NS) if yv is not None else None
        n = int(count.get("val")) if count is not None else (max(vals) + 1 if vals else 0)
        series.append({"categories": [cats.get(i) for i in range(n)], "values": [float(vals[i]) if i in vals else None for i in range(n)],
                       **({"x": [float(xs[i]) if i in xs else None for i in range(n)]} if xv is not None else {})})
    return {"series": series}


def read_deck(deck: bytes) -> dict[str, dict]:
    """durable id -> {slide, kind, text | rows | chart} for every element of every slide."""
    z = zipfile.ZipFile(io.BytesIO(deck))
    out: dict[str, dict] = {}
    slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[0]))
    for part in slides:
        sid = "s_" + re.findall(r"\d+", part.rsplit("/", 1)[1])[0]
        rels = _rels(z, part)
        tree = ET.fromstring(z.read(part)).find("p:cSld/p:spTree", NS)

        def visit(container: ET.Element, sid: str = sid, rels: dict = rels) -> None:
            for el in container:
                if el.tag not in ELEMENT_TAGS:
                    continue
                did = durable_id(el)
                kind = el.tag.split("}")[1]
                info: dict = {"slide": sid, "kind": kind}
                if kind == "sp":
                    info["text"] = _paragraph_text(el.find("p:txBody", NS))
                elif kind == "graphicFrame":
                    tbl = el.find(".//a:tbl", NS)
                    chart = el.find(".//c:chart", NS)
                    if tbl is not None:
                        info["kind"] = "table"
                        info["rows"] = [[_paragraph_text(tc.find("a:txBody", NS)) for tc in tr.findall("a:tc", NS)] for tr in tbl.findall("a:tr", NS)]
                    elif chart is not None and rels.get(chart.get(f"{{{NS['r']}}}id")) in z.namelist():
                        info["kind"] = "chart"
                        info["chart"] = _chart(z, rels[chart.get(f"{{{NS['r']}}}id")])
                elif kind == "grpSp":
                    # composite visuals (VIS V3) name their data marks "frr-mark s c v" / "frr-rating <evidence> <notch>"
                    info["names"] = [c.get("name", "") for c in el.findall("p:sp/p:nvSpPr/p:cNvPr", NS)]
                    visit(el)
                if did:
                    out.setdefault(did, info)

        if tree is not None:
            visit(tree)
    return out


# ------------------------------------------------------------------ checks
def _composite(res: dict, durable: str, el: dict, want: dict, spec: dict) -> None:
    """A composite's data marks (their names carry the values) must equal the projection from current data.
    Positions and label texts are checked by the client against a fresh layout."""
    title = spec.get("title") or spec["family"]
    if el.get("kind") != "grpSp":
        res["mismatch"].append({"element": durable, "detail": f"visual “{title}”: expected a {spec['family']} (shapes), found {el.get('kind')}"})
        return
    got: dict[str, str] = {}
    for n in el.get("names", []):
        parts = n.split(" ")
        if parts[0] == "frr-mark" and len(parts) == 4:
            got[f"{parts[1]} {parts[2]}"] = parts[3]
        elif parts[0] == "frr-rating" and len(parts) == 3:
            got[parts[1]] = parts[2]
    if want["shape"] == "ratings":
        expect = {eid: str(n) for _, _, n, eid in want["points"]}
    else:
        expect = {f"{si} {i}": _js_num(v) for si, s in enumerate(want["series"]) for i, v in enumerate(s["values"]) if v is not None}
    for k, v in expect.items():
        res["points"] += 1
        if got.get(k) != v:
            res["mismatch"].append({"element": durable, "detail": f"{title} {k}: data {v}, visual {got.get(k, 'missing')}"})
    for k in got.keys() - expect.keys():
        res["mismatch"].append({"element": durable, "detail": f"{title} {k}: on the visual but not in the data"})


def _js_num(v: float) -> str:
    """A number as JavaScript's String(v) writes it (the client names marks with String(value))."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def check(deck: bytes | None, project: dict, sidecar: dict) -> dict:
    """Integrity of the saved deck. ``ok`` is False when any bound value disagrees with the data."""
    res = {"ok": False, "bindings": 0, "resolved": 0, "points": 0, "cells": 0, "figures": 0, "sourced": 0,
           "mismatch": [], "unsourced": [], "placeholders": [], "unverified": unverified_edits(project)}
    elements = read_deck(deck) if deck else {}
    index = evidence_index(project)
    for durable, b in sidecar.get("bindings", {}).items():
        res["bindings"] += 1
        el = elements.get(durable)
        if el is None:
            res["mismatch"].append({"element": durable, "detail": "binding does not resolve to an element in the saved deck"})
            continue
        res["resolved"] += 1
        if b["kind"] == "placeholder":
            res["placeholders"].append({"element": durable, "slide": b.get("slide"), "label": b.get("label")})
        if b["kind"] == "viz":
            import viz  # noqa: PLC0415 (viz imports this module)
            try:
                want = viz.realized(project, b["spec"])
            except viz.VizError as exc:
                res["mismatch"].append({"element": durable, "detail": f"visual “{b['spec'].get('title')}”: {exc}"})
                continue
            if b["spec"]["family"] in viz.COMPOSITE:
                _composite(res, durable, el, want, b["spec"])
                continue
            got = (el.get("chart") or {}).get("series", [])
            for si, s in enumerate(want["series"]):
                for i, v in enumerate(s["values"]):
                    res["points"] += 1
                    g = got[si]["values"][i] if si < len(got) and i < len(got[si]["values"]) else None
                    if not ((v is None and g is None) or (v is not None and g is not None and abs(v - g) < 1e-9)):
                        res["mismatch"].append({"element": durable, "detail": f"{s['name']} {want['categories'][i]}: data {v}, chart {g}"})
            if want["shape"] == "pairs":
                gx = got[0].get("x", []) if got else []
                if [round(x, 9) for x in want["x"]] != [round(x, 9) if x is not None else None for x in gx[: len(want["x"])]]:
                    res["mismatch"].append({"element": durable, "detail": f"{b['spec']['title']}: x values differ from the data"})
            elif got and [c for c in got[0]["categories"]] != want["categories"]:
                res["mismatch"].append({"element": durable, "detail": f"{b['spec']['title']}: categories differ from the data"})
        if b["kind"] == "chart":  # M1-M5 binding in a deck saved before VIS V1 (the client migrates it on open)
            want = chart_data(project, b["chart"])
            got = (el.get("chart") or {}).get("series", [])
            for si, s in enumerate(want["series"]):
                for i, v in enumerate(s["values"]):
                    res["points"] += 1
                    g = got[si]["values"][i] if si < len(got) and i < len(got[si]["values"]) else None
                    if not ((v is None and g is None) or (v is not None and g is not None and abs(v - g) < 1e-9)):
                        res["mismatch"].append({"element": durable, "detail": f"{s['name']} {want['categories'][i]}: data {v}, chart {g}"})
        if b["kind"] == "table":
            rows = el.get("rows") or []
            for r, d in enumerate(b["table"]["datasets"]):
                for c, x in enumerate(b["table"]["dates"]):
                    res["cells"] += 1
                    g = rows[r + 1][c + 1] if r + 1 < len(rows) and c + 1 < len(rows[r + 1]) else None
                    w = cell_text(project, d, x)
                    if g != w:
                        res["mismatch"].append({"element": durable, "detail": f"{d} {x}: data \"{w}\", table \"{g}\""})
        if b["kind"] == "ratings":
            from research_runs import rating_cells
            rows = el.get("rows") or []
            for r, eid in enumerate(b["rows"]):
                ev = project.get("evidence", {}).get(eid)
                for c, want in enumerate(rating_cells(ev or {})):
                    res["cells"] += 1
                    got = rows[r + 1][c] if r + 1 < len(rows) and c < len(rows[r + 1]) else None
                    if ev is None or got != want:
                        res["mismatch"].append({"element": durable, "detail": f"rating {eid} column {c + 1}: evidence \"{want}\", table \"{got}\""})
        if b["kind"] == "text" and b.get("role") not in ("source",):
            for n in text_numbers(el.get("text", ""), b.get("numbers") or [], project, index):
                res["figures"] += 1
                if n["status"] == "ok":
                    res["sourced"] += 1
                elif n["status"] == "stale":
                    res["mismatch"].append({"element": durable, "detail": f"text says {n['text']}, data now {n['data']}"})
                else:
                    res["unsourced"].append({"element": durable, "slide": b.get("slide"), "text": n["text"]})
    res["ok"] = res["resolved"] == res["bindings"] and not res["mismatch"]
    return res


def unverified_edits(project: dict) -> list[dict]:
    return [{"dataset": did, "date": date, "value": w.get("value"), "deleted": bool(w.get("deleted")), "by": w.get("by"), "at": w.get("at")}
            for did, ds in project.get("datasets", {}).items() for date, w in (ds.get("working") or {}).items() if w.get("status") != "verified"]


def validate_working(project: dict) -> list[str]:
    """Problems with the working layer; a bundle with any is refused (manual edits must stay auditable)."""
    errors = []
    for did, ds in project.get("datasets", {}).items():
        dates = {o["date"] for o in ds.get("observations", [])}
        for date, w in (ds.get("working") or {}).items():
            where = f"{did}@{date}"
            if not isinstance(w, dict):
                errors.append(f"{where}: working entry must be an object")
                continue
            if w.get("status") not in WORKING_STATUSES:
                errors.append(f"{where}: status must be one of {sorted(WORKING_STATUSES)}")
            if not w.get("by") or not w.get("at"):
                errors.append(f"{where}: a manual value must record who (by) and when (at)")
            has_value = isinstance(w.get("value"), (int, float)) and not isinstance(w.get("value"), bool)
            if bool(w.get("deleted")) == has_value:
                errors.append(f"{where}: carries either a numeric value or deleted=true")
            if w.get("status") == "verified" and not (w.get("verified_by") and w.get("verified_at")):
                errors.append(f"{where}: verified values must record verified_by and verified_at")
            if not re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?|-Q[1-4])?", date) and date not in dates:
                errors.append(f"{where}: unknown period")
    for d in (project.get("derivations") or {}).values():
        try:
            if derive.names(d["formula"]) != set(d["inputs"]):
                errors.append(f"{d['id']}: formula and inputs disagree")
        except (ValueError, KeyError) as exc:
            errors.append(f"{d.get('id', '?')}: {exc}")
    return errors
