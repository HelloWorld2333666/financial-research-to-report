"""Design library tooling (Gates A and C) on a synthetic library: no private decks, renders or catalog data are used.

Covers freeform path statistics, chart and navigation detection, stable incremental clustering, retrieval, and the
recipe suggestions the Skill and the app agent share.
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from design_library import classify, extract, features, retrieve  # noqa: E402

A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def test_path_stats_reads_freeform_geometry():
    cg = ET.fromstring(f'<a:custGeom xmlns:a="{A}"><a:pathLst><a:path w="10" h="10" fill="none">'
                       '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' + '<a:lnTo><a:pt x="1" y="1"/></a:lnTo>' * 7 +
                       '</a:path></a:pathLst></a:custGeom>')
    assert extract.path_stats(cg) == {"pts": 8, "curves": 0, "subpaths": 1, "closed": 0, "nofill": True}


def box(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h, "rot": 0.0}


def text(t, x, y, pt=10, w=0.05, h=0.03, ph=None):
    return {"kind": "text", "ph": ph, "name": "object 1", "geom": "rect", "box": box(x, y, w, h), "fill": None, "line": None, "depth": 0,
            "text": {"chars": len(t), "paragraphs": 1, "text": t, "sizes": [pt], "max_pt": pt, "min_pt": pt, "bold_share": 0, "fonts": [], "colors": []}}


def bar(x, h):  # a column drawn as a closed four-corner freeform, as PDF conversions draw them
    return {"kind": "shape", "ph": None, "name": "object 2", "geom": "custom", "box": box(x, 0.8 - h, 0.04, h), "fill": "#0055AA", "line": None, "depth": 0,
            "path": {"pts": 5, "curves": 0, "subpaths": 1, "closed": 1, "nofill": False}}


def deck(sha, name, slides):
    return {"extractor": extract.EXTRACTOR_VERSION, "file": f"{sha}.pptx", "sha256": sha, "slides": [{"n": i + 1, "layout": None, "objects": o} for i, o in enumerate(slides)]}


def chart_slide():
    return [text("Exports rose for the fifth year while imports fell back", 0.05, 0.05, 24, w=0.8, h=0.08)] + \
        [bar(0.1 + i * 0.08, 0.1 + 0.05 * i) for i in range(6)] + [text(f"{2019 + i}", 0.1 + i * 0.08, 0.82) for i in range(6)] + \
        [text(f"{10 + i}.5%", 0.1 + i * 0.08, 0.6 - 0.05 * i) for i in range(6)]


def make_lib(tmp_path: Path, decks: list[dict]) -> Path:
    lib = tmp_path / "lib"
    (lib / "cache").mkdir(parents=True, exist_ok=True)
    for d in decks:
        (lib / "cache" / f"{d['sha256']}.json").write_text(json.dumps(d))
    (lib / "manifest.tsv").write_text("".join(f"{d['sha256']}\t{d['sha256'][:6]}.pptx\tPublisher\n" for d in decks))
    features.main(["--cache", str(lib / "cache"), "--manifest", str(lib / "manifest.tsv"), "--out", str(lib / "catalog")])
    classify.main(["--lib", str(lib)])
    return lib


def test_detects_freeform_charts_navigation_and_keeps_layout_ids(tmp_path):
    a = "a" * 64
    lib = make_lib(tmp_path, [deck(a, "a", [[text("Title of the report", 0.1, 0.4, 40, w=0.6, h=0.1)], chart_slide(),
                                            [text("Today's agenda", 0.05, 0.05, 28, w=0.4, h=0.08), text("01", 0.1, 0.3, 20), text("Markets", 0.2, 0.3, 14, w=0.3)]])])
    rows = {json.loads(l)["id"]: json.loads(l) for l in (lib / "catalog" / "tagged.jsonl").open()}
    assert rows[f"{a[:10]}:1"]["kind"] == "cover"
    assert "chart_led" in rows[f"{a[:10]}:2"]["structure"] and "trend" in rows[f"{a[:10]}:2"]["purpose"]
    assert rows[f"{a[:10]}:3"]["kind"] == "agenda"
    before = {json.loads(l)["id"] for l in (lib / "catalog" / "layouts.jsonl").open()}
    # a second deck later: existing layouts keep their ids; a near-identical chart slide joins the existing layout
    b = "b" * 64
    lib = make_lib(tmp_path, [deck(a, "a", [[text("Title of the report", 0.1, 0.4, 40, w=0.6, h=0.1)], chart_slide(),
                                            [text("Today's agenda", 0.05, 0.05, 28, w=0.4, h=0.08), text("01", 0.1, 0.3, 20), text("Markets", 0.2, 0.3, 14, w=0.3)]]),
                              deck(b, "b", [[text("Another report", 0.1, 0.4, 40, w=0.6, h=0.1)], chart_slide()])])
    after = {json.loads(l)["id"]: json.loads(l) for l in (lib / "catalog" / "layouts.jsonl").open()}
    assert before <= set(after)
    assert f"{b[:10]}:2" in after[f"{a[:10]}:2"]["members"]


def test_equal_boxes_are_not_a_chart(tmp_path):
    # a numbered list of equal cards: same baseline, same height, list numerals; no values encoded
    cards = [{**bar(0.1 + i * 0.15, 0.3), "box": box(0.1 + i * 0.15, 0.5, 0.06, 0.3)} for i in range(5)] + [text(str(i + 1), 0.1 + i * 0.15, 0.45) for i in range(5)]
    lib = make_lib(tmp_path, [deck("c" * 64, "c", [[text("Cover", 0.1, 0.4, 40)], [text("Five priorities for the year ahead", 0.05, 0.05, 24, w=0.8)] + cards])])
    row = next(json.loads(l) for l in (lib / "catalog" / "tagged.jsonl").open() if json.loads(l)["n"] == 2)
    assert "chart_led" not in row["structure"]


def test_recipes_and_references_come_from_one_module(tmp_path):
    # without the private library: recipes only, ranked by the request
    r = retrieve.suggest({"purpose": ["trend"], "chart": True})
    assert r["library"] is False and r["references"] == [] and r["recipes"][0]["id"] in ("chart-commentary", "chart-rail", "trend-annotated")
    assert retrieve.suggest({"kind": "divider"})["recipes"][0]["id"] == "divider"
    assert all(x["id"] not in ("agenda", "divider") for x in retrieve.suggest({"purpose": ["comparison"], "chart": True})["recipes"])
    # with a library: references carry their archetype and the recipes it maps to, and no slide text
    lib = make_lib(tmp_path, [deck("d" * 64, "d", [[text("Cover", 0.1, 0.4, 40)], chart_slide()])])
    r = retrieve.suggest({"purpose": ["trend"], "chart": True}, str(lib))
    assert r["library"] and r["references"][0]["archetype"].startswith("chart_led") and "trend-annotated" in r["references"][0]["recipes"]
    assert "Exports" not in json.dumps(r)
    assert len(json.dumps(r)) < 3000  # a shortlist stays a few hundred tokens


def test_recipe_table_is_the_planners():
    ids = [r["id"] for r in retrieve.recipes()]
    assert ids == ["chart-rail", "ranked-bars", "trend-annotated", "agenda", "divider", "chart-commentary", "rank-table", "risk-matrix", "multi-module", "exec-split", "causal-chain"]
    assert retrieve.RECIPES.name == "recipes.json" and "core/design" in retrieve.RECIPES.as_posix()


def test_principles_catalog_is_consistent_and_retrievable():
    ps = retrieve.principles()
    ids = [p["id"] for p in ps]
    assert len(ids) == len(set(ids)) and len(ids) >= 50
    assert {p["status"] for p in ps} <= {"principle", "recipe", "renderable", "tested"}
    for p in ps:
        if p["status"] in ("renderable", "tested"):
            assert p.get("impl"), p["id"]  # a usable principle names where it is implemented
        else:
            assert p.get("fallback") or p["module"] in ("typography", "tables", "layout", "diagrams", "assets", "storytelling", "qa", "charts"), p["id"]
    for r in retrieve.recipes():
        assert set(r.get("principles", [])) <= set(ids), r["id"]
    # retrieval returns a few one-line principles, usable ones first, and stays small
    out = retrieve.suggest({"purpose": ["summary", "kpi"]})
    assert out["recipes"][0]["id"] == "exec-split" and 0 < len(out["principles"]) <= 6
    assert all(len(p["rule"]) <= 151 for p in out["principles"]) and len(__import__("json").dumps(out)) < 3000
    assert [p["id"] for p in retrieve.load_principles(["CH7"])] == ["CH7"]
