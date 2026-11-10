"""Deterministic PPTX extraction for the design library (Gate A).

    python -m design_library.extract --out <private dir>/cache <deck.pptx> ...

One JSON per deck, named by the file's sha256, so a deck is parsed once and re-parsed only when its bytes change.
Nothing here calls a model. Records what OOXML states; anything it cannot parse is recorded as unknown, not guessed.

Per deck: slide size, theme colours and fonts, master text defaults, layouts used.
Per slide: every object (kind, placeholder role, box as a fraction of the slide, rotation), text amount and sizes
(run size, else the master's default for the placeholder role), fonts and colours used, charts (type, series and
category counts), tables (rows x columns), pictures (area), SmartArt and OLE objects (not natively editable here).
Slide text is kept only in the private cache (it is the template owner's content).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
EXTRACTOR_VERSION = 2  # 2: picture fills on shapes (fill "picture"), e.g. full-slide photo backgrounds
CHART_KINDS = ["barChart", "bar3DChart", "lineChart", "line3DChart", "pieChart", "pie3DChart", "doughnutChart", "areaChart", "area3DChart",
               "scatterChart", "bubbleChart", "radarChart", "stockChart", "surfaceChart", "ofPieChart"]


def q(tag: str) -> str:
    pre, name = tag.split(":")
    return f"{{{NS[pre]}}}{name}"


def rels(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    d, f = posixpath.split(part)
    rp = posixpath.join(d, "_rels", f + ".rels")
    if rp not in z.namelist():
        return {}
    out = {}
    for r in ET.fromstring(z.read(rp)).findall(q("rel:Relationship")):
        t = r.get("Target", "")
        out[r.get("Id")] = t if r.get("TargetMode") == "External" else posixpath.normpath(posixpath.join(d, t))
    return out


def color_of(el) -> str | None:
    if el is None:
        return None
    s = el.find(q("a:srgbClr"))
    if s is not None:
        return "#" + s.get("val", "").upper()
    s = el.find(q("a:schemeClr"))
    if s is not None:
        return "scheme:" + s.get("val", "")
    s = el.find(q("a:sysClr"))
    if s is not None:
        return "#" + (s.get("lastClr") or "000000").upper()
    return None


def theme_of(z: zipfile.ZipFile, master_part: str) -> dict:
    for _, t in rels(z, master_part).items():
        if "theme" in t and t in z.namelist():
            root = ET.fromstring(z.read(t))
            scheme = root.find(".//" + q("a:clrScheme"))
            colors = {}
            if scheme is not None:
                for ch in scheme:
                    colors[ch.tag.split("}")[1]] = color_of(ch)
            fonts = {}
            for k in ("majorFont", "minorFont"):
                f = root.find(".//" + q("a:" + k))
                if f is not None:
                    lat, ea = f.find(q("a:latin")), f.find(q("a:ea"))
                    fonts[k] = {"latin": lat.get("typeface") if lat is not None else None, "ea": ea.get("typeface") if ea is not None else None}
            return {"name": root.get("name"), "colors": colors, "fonts": fonts}
    return {}


def master_text_defaults(z: zipfile.ZipFile, master_part: str) -> dict:
    root = ET.fromstring(z.read(master_part))
    out = {}
    for k, tag in (("title", "p:titleStyle"), ("body", "p:bodyStyle"), ("other", "p:otherStyle")):
        st = root.find(".//" + q(tag))
        lv = st.find(q("a:lvl1pPr")) if st is not None else None
        d = lv.find(q("a:defRPr")) if lv is not None else None
        out[k] = int(d.get("sz")) / 100 if d is not None and d.get("sz") else None
    return out


def box_of(xfrm, sw: int, sh: int, parent=None) -> dict | None:
    if xfrm is None:
        return None
    off, ext = xfrm.find(q("a:off")), xfrm.find(q("a:ext"))
    if off is None or ext is None:
        return None
    x, y, w, h = int(off.get("x", 0)), int(off.get("y", 0)), int(ext.get("cx", 0)), int(ext.get("cy", 0))
    if parent:  # map a group child from the group's child space to the slide
        (gx, gy, gw, gh), (cx, cy, cw, ch) = parent
        sx, sy = (gw / cw if cw else 1), (gh / ch if ch else 1)
        x, y, w, h = gx + (x - cx) * sx, gy + (y - cy) * sy, w * sx, h * sy
    return {"x": round(x / sw, 4), "y": round(y / sh, 4), "w": round(w / sw, 4), "h": round(h / sh, 4), "rot": round(int(xfrm.get("rot", 0)) / 60000, 1)}


def text_info(txbody, default_pt: float | None) -> dict:
    if txbody is None:
        return {}
    paras, sizes, fonts, colors, bold, chars = [], [], set(), set(), 0, 0
    for p in txbody.findall(q("a:p")):
        t = "".join(x.text or "" for x in p.iter(q("a:t")))
        if t.strip():
            paras.append(t)
        for r in p.findall(q("a:r")):
            rpr, tx = r.find(q("a:rPr")), (r.findtext(q("a:t")) or "")
            chars += len(tx)
            sz = int(rpr.get("sz")) / 100 if rpr is not None and rpr.get("sz") else default_pt
            if sz and tx.strip():
                sizes.append(sz)
            if rpr is not None:
                if rpr.get("b") == "1":
                    bold += len(tx)
                lat = rpr.find(q("a:latin"))
                if lat is not None and lat.get("typeface"):
                    fonts.add(lat.get("typeface"))
                c = color_of(rpr.find(q("a:solidFill")))
                if c:
                    colors.add(c)
    body = txbody.find(q("a:bodyPr"))
    return {"chars": chars, "paragraphs": len(paras), "text": "\n".join(paras)[:600], "sizes": sorted(set(sizes)), "max_pt": max(sizes) if sizes else None,
            "min_pt": min(sizes) if sizes else None, "bold_share": round(bold / chars, 2) if chars else 0, "fonts": sorted(fonts), "colors": sorted(colors),
            "autofit": None if body is None else ("shrink" if body.find(q("a:normAutofit")) is not None else "resize" if body.find(q("a:spAutoFit")) is not None else "none"),
            "vertical": body is not None and body.get("vert") not in (None, "horz")}


def chart_info(z: zipfile.ZipFile, part: str) -> dict:
    if part not in z.namelist():
        return {"kinds": [], "error": "chart part missing"}
    root = ET.fromstring(z.read(part))
    pa = root.find(".//" + q("c:plotArea"))
    kinds, series, cats = [], 0, 0
    if pa is not None:
        for ch in pa:
            name = ch.tag.split("}")[1]
            if name in CHART_KINDS:
                bd = ch.find(q("c:barDir"))
                grp = ch.find(q("c:grouping"))
                kinds.append(name + (f":{bd.get('val')}" if bd is not None else "") + (f":{grp.get('val')}" if grp is not None and grp.get("val") not in ("standard", "clustered") else ""))
                for s in ch.findall(q("c:ser")):
                    series += 1
                    pc = s.find(".//" + q("c:cat") + "//" + q("c:ptCount"))
                    if pc is not None:
                        cats = max(cats, int(pc.get("val", 0)))
    legend = root.find(".//" + q("c:legend"))
    dl = root.find(".//" + q("c:dLbls") + "/" + q("c:showVal"))
    has_ext_data = any("embeddings" in t or t.endswith(".xlsx") for t in rels(z, part).values())
    return {"kinds": kinds, "series": series, "categories": cats, "legend": legend is not None, "data_labels": dl is not None and dl.get("val") == "1",
            "title": root.find(".//" + q("c:title")) is not None, "embedded_workbook": has_ext_data}


def walk(z, slide_part, node, sw, sh, defaults, slide_rels, parent=None, depth=0) -> list[dict]:
    out = []
    for el in node:
        tag = el.tag.split("}")[1]
        if tag == "sp":
            nv = el.find(q("p:nvSpPr"))
            ph = nv.find(".//" + q("p:ph")) if nv is not None else None
            role = (ph.get("type") or "body") if ph is not None else None
            sppr = el.find(q("p:spPr"))
            geom = sppr.find(q("a:prstGeom")) if sppr is not None else None
            custom = sppr is not None and sppr.find(q("a:custGeom")) is not None
            default = defaults.get("title") if role in ("title", "ctrTitle") else defaults.get("body") if role else defaults.get("other")
            ti = text_info(el.find(q("p:txBody")), default)
            fill = color_of(sppr.find(q("a:solidFill"))) if sppr is not None else None
            if fill is None and sppr is not None and sppr.find(q("a:blipFill")) is not None:
                fill = "picture"
            line = sppr.find(q("a:ln")) if sppr is not None else None
            out.append({"kind": "text" if ti.get("chars") else "shape", "ph": role, "name": (nv.find(q("p:cNvPr")).get("name") if nv is not None else None),
                        "geom": geom.get("prst") if geom is not None else ("custom" if custom else None), "box": box_of(sppr.find(q("a:xfrm")) if sppr is not None else None, sw, sh, parent),
                        "fill": fill, "line": color_of(line.find(q("a:solidFill"))) if line is not None else None, "depth": depth, **({"text": ti} if ti.get("chars") else {})})
        elif tag == "pic":
            sppr = el.find(q("p:spPr"))
            blip = el.find(".//" + q("a:blip"))
            target = slide_rels.get(blip.get(q("r:embed"))) if blip is not None else None
            out.append({"kind": "picture", "box": box_of(sppr.find(q("a:xfrm")) if sppr is not None else None, sw, sh, parent), "media": posixpath.basename(target) if target else None,
                        "svg": bool(el.find(".//" + q("a:extLst")) is not None and b"svgBlip" in ET.tostring(el)), "depth": depth})
        elif tag == "graphicFrame":
            xfrm = el.find(q("p:xfrm"))
            gd = el.find(".//" + q("a:graphicData"))
            uri = gd.get("uri", "") if gd is not None else ""
            item = {"box": box_of(xfrm, sw, sh, parent), "depth": depth}
            if uri.endswith("/chart"):
                cref = gd.find(q("c:chart"))
                part = slide_rels.get(cref.get(q("r:id"))) if cref is not None else None
                item.update(kind="chart", chart=chart_info(z, part) if part else {"kinds": [], "error": "no chart rel"})
            elif uri.endswith("/table"):
                tbl = gd.find(q("a:tbl"))
                rows = tbl.findall(q("a:tr")) if tbl is not None else []
                cols = tbl.findall(q("a:tblGrid") + "/" + q("a:gridCol")) if tbl is not None else []
                cells = [text_info(tc.find(q("a:txBody")), defaults.get("other")) for tr in rows for tc in tr.findall(q("a:tc"))]
                sizes = sorted({s for c in cells for s in c.get("sizes", [])})
                styled = tbl.find(q("a:tblPr") + "/" + q("a:tableStyleId")) if tbl is not None else None
                item.update(kind="table", table={"rows": len(rows), "cols": len(cols), "chars": sum(c.get("chars", 0) for c in cells), "sizes": sizes, "style_id": styled.text if styled is not None else None,
                                                 "text": " | ".join(c.get("text", "") for c in cells)[:600]})
            elif "diagram" in uri:
                item.update(kind="smartart")
            elif "ole" in uri.lower():
                item.update(kind="ole")
            else:
                item.update(kind="graphic", uri=uri)
            out.append(item)
        elif tag == "grpSp":
            gp = el.find(q("p:grpSpPr"))
            xfrm = gp.find(q("a:xfrm")) if gp is not None else None
            sub = parent
            if xfrm is not None and xfrm.find(q("a:chOff")) is not None:
                off, ext, co, ce = (xfrm.find(q("a:" + k)) for k in ("off", "ext", "chOff", "chExt"))
                g = [int(off.get("x")), int(off.get("y")), int(ext.get("cx")), int(ext.get("cy"))]
                if parent:  # nested group: place the group itself first
                    b = box_of(xfrm, 1, 1, parent)
                    g = [b["x"], b["y"], b["w"], b["h"]]
                sub = (tuple(g), (int(co.get("x")), int(co.get("y")), int(ce.get("cx")), int(ce.get("cy"))))
            kids = walk(z, slide_part, el, sw, sh, defaults, slide_rels, sub, depth + 1)
            out.append({"kind": "group", "box": box_of(xfrm, sw, sh, parent) if xfrm is not None else None, "children": len(kids), "depth": depth})
            out.extend(kids)
        elif tag == "cxnSp":
            sppr = el.find(q("p:spPr"))
            out.append({"kind": "connector", "box": box_of(sppr.find(q("a:xfrm")) if sppr is not None else None, sw, sh, parent), "depth": depth})
        elif tag == "AlternateContent":
            out.extend(walk(z, slide_part, el.find("*") if el.find("*") is not None else el, sw, sh, defaults, slide_rels, parent, depth))
    return out


def extract(path: Path) -> dict:
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    z = zipfile.ZipFile(path)
    pres = ET.fromstring(z.read("ppt/presentation.xml"))
    sz = pres.find(q("p:sldSz"))
    sw, sh = int(sz.get("cx")), int(sz.get("cy"))
    prels = rels(z, "ppt/presentation.xml")
    slide_parts = [prels[s.get(q("r:id"))] for s in pres.findall(q("p:sldIdLst") + "/" + q("p:sldId"))]
    masters = [prels[m.get(q("r:id"))] for m in pres.findall(q("p:sldMasterIdLst") + "/" + q("p:sldMasterId"))]
    themes = {m: theme_of(z, m) for m in masters}
    defaults = {m: master_text_defaults(z, m) for m in masters}
    slides = []
    for n, part in enumerate(slide_parts, 1):
        root = ET.fromstring(z.read(part))
        srels = rels(z, part)
        layout = next((t for t in srels.values() if "slideLayout" in t), None)
        lname, master = None, masters[0] if masters else None
        if layout and layout in z.namelist():
            lroot = ET.fromstring(z.read(layout))
            cs = lroot.find(q("p:cSld"))
            lname = cs.get("name") if cs is not None else None
            master = next((t for t in rels(z, layout).values() if "slideMaster" in t), master)
        tree = root.find(q("p:cSld") + "/" + q("p:spTree"))
        objs = walk(z, part, tree, sw, sh, defaults.get(master, {}), srels) if tree is not None else []
        bg = root.find(".//" + q("p:bg"))
        notes = next((t for t in srels.values() if "notesSlide" in t), None)
        slides.append({"n": n, "part": part, "layout": lname, "master": master, "hidden": root.get("show") == "0", "objects": objs,
                       "background": color_of(bg.find(".//" + q("p:bgPr"))) if bg is not None and bg.find(".//" + q("p:bgPr")) is not None else ("ref" if bg is not None else None),
                       "has_notes": bool(notes)})
    return {"extractor": EXTRACTOR_VERSION, "file": path.name, "sha256": sha, "bytes": len(data), "slide_size": {"cx": sw, "cy": sh, "ratio": round(sw / sh, 3)},
            "slides": slides, "masters": masters, "themes": themes, "master_text_defaults": defaults,
            "media": sorted({posixpath.basename(n) for n in z.namelist() if n.startswith("ppt/media/")})[:200],
            "fonts_embedded": any(n.startswith("ppt/fonts/") for n in z.namelist())}


def main(argv: list[str]):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("decks", nargs="+")
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    done = skipped = failed = 0
    for d in a.decks:
        p = Path(d)
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        target = out / f"{sha}.json"
        if target.exists() and json.loads(target.read_text()).get("extractor") == EXTRACTOR_VERSION:
            skipped += 1; continue  # cached: same bytes, same extractor
        try:
            target.write_text(json.dumps(extract(p), ensure_ascii=False))
            done += 1
        except Exception as e:  # noqa: BLE001 (recorded, not hidden)
            (out / f"{sha}.error.json").write_text(json.dumps({"file": p.name, "error": repr(e)}))
            failed += 1
            print(f"FAILED {p.name}: {e!r}", file=sys.stderr)
    print(json.dumps({"extracted": done, "cached": skipped, "failed": failed}))


if __name__ == "__main__":
    main(sys.argv[1:])
