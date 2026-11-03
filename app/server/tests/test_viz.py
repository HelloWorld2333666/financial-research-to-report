"""VIS V1: the frr-viz/1 spec on the server (validation, projection parity with the client, integrity).

viz-parity.json is written by the client (`WRITE_FIXTURES=1 npx vitest run src/core/viz.test.ts`): the
same specs projected by app/web/src/core/viz.ts, including a working-layer gap.
"""

import base64
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import integrity  # noqa: E402
import viz  # noqa: E402
from projects import BundleError, ProjectStore  # noqa: E402

FIX = Path(__file__).parent / "fixtures"
WEB_FIX = Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "fixtures"


def test_projection_matches_the_client_for_every_family():
    parity = json.loads((FIX / "viz-parity.json").read_text())
    project = json.loads((WEB_FIX / "france-project.json").read_text())
    project["datasets"].update(parity.get("extra", {}))  # synthetic additive datasets used by part-to-whole cases
    project["evidence"].update(parity.get("extraEvidence", {}))  # synthetic rating actions (rating timeline)
    w = parity["working"]
    project["datasets"][w["dataset"]]["working"][w["date"]] = w["entry"]
    assert len(parity["cases"]) >= 11
    for case in parity["cases"]:
        got = viz.project_view(project, case["spec"])
        exp = case["expected"]
        assert got["shape"] == exp["shape"], case["name"]
        assert got["categories"] == exp["categories"], case["name"]
        assert [s["values"] for s in got["series"]] == exp["series"], case["name"]
        if exp["x"] is not None:
            assert got["x"] == exp["x"], case["name"]


def spec(**over):
    s = {"schema": "frr-viz/1", "id": "viz_a1", "title": "Debt", "family": "line", "view": {"datasets": ["ds.fr.debt"], "transform": "none"}, "missing": "gap"}
    return {**s, **over}


def test_spec_validation():
    assert viz.validate_spec(spec()) == []
    assert viz.validate_spec(spec(view={"datasets": ["ds.fr.debt"], "transform": "rank", "order": "asc"})) == []
    for bad in (spec(family="pie3D"), spec(id="chart1"), spec(missing="zero"), {**spec(), "option": {"series": []}},
                spec(view={"datasets": [], "transform": "none"}), spec(view={"datasets": ["d"], "transform": "smooth"})):
        assert viz.validate_spec(bad), bad


def test_server_refuses_mixed_units_and_impossible_changes():
    project = json.loads((WEB_FIX / "france-project.json").read_text())
    with pytest.raises(viz.VizError, match="different units"):
        viz.project_view(project, spec(view={"datasets": ["ds.fr.debt", "ds.fr.growth"], "transform": "none"}))
    with pytest.raises(viz.VizError, match="two different periods"):
        viz.project_view(project, spec(view={"datasets": ["ds.fr.debt"], "transform": "diff", "between": ["2025", "2025"]}))


def test_saved_deck_integrity_follows_the_spec_and_the_data():
    b = json.loads((FIX / "france-bundle.json").read_text())
    deck = base64.b64decode(b["deck"])
    assert integrity.check(deck, b["project"], b["sidecar"])["ok"]
    vid, vb = next((k, v) for k, v in b["sidecar"]["bindings"].items() if v["kind"] == "viz")
    edited = copy.deepcopy(b)
    edited["project"]["datasets"]["ds.fr.debt"]["working"]["2025"] = {"value": 116.0, "by": "you", "at": "t", "status": "manual_unverified"}
    r = integrity.check(deck, edited["project"], edited["sidecar"])
    assert not r["ok"] and any("data 116.0, chart 115.7" in m["detail"] for m in r["mismatch"])
    # the same chart under a spec for another view no longer matches what the slide shows
    other = copy.deepcopy(b)
    other["sidecar"]["bindings"][vid]["spec"]["view"] = {"datasets": vb["spec"]["view"]["datasets"], "transform": "latest"}
    assert not integrity.check(deck, other["project"], other["sidecar"])["ok"]


def test_decks_saved_before_v1_still_check_on_the_server():
    b = json.loads((FIX / "france-bundle.json").read_text())
    for k, v in list(b["sidecar"]["bindings"].items()):
        if v["kind"] == "viz":
            b["sidecar"]["bindings"][k] = {"kind": "chart", "slide": v["slide"], "chart": {"type": "line", "title": v["spec"]["title"], "series": v["spec"]["view"]["datasets"]}}
    assert integrity.check(base64.b64decode(b["deck"]), b["project"], b["sidecar"])["ok"]


def test_save_refuses_an_invalid_spec(tmp_path):
    store = ProjectStore(tmp_path)
    b = json.loads((FIX / "france-bundle.json").read_text())
    pid = store.create("france", "V1")["meta"]["id"]
    b["project"]["id"] = pid
    store.save(pid, b)
    vid = next(k for k, v in b["sidecar"]["bindings"].items() if v["kind"] == "viz")
    b["sidecar"]["bindings"][vid]["spec"]["family"] = "bar3D"
    with pytest.raises(BundleError, match="visual specs refused"):
        store.save(pid, b)


def test_composite_views_match_the_client_and_the_rating_scale():
    parity = json.loads((FIX / "viz-parity.json").read_text())
    project = json.loads((WEB_FIX / "france-project.json").read_text())
    project["datasets"].update(parity.get("extra", {}))
    project["evidence"].update(parity.get("extraEvidence", {}))
    w = parity["working"]
    project["datasets"][w["dataset"]]["working"][w["date"]] = w["entry"]
    names = {c["name"] for c in parity["cases"]}
    assert {"dumbbell", "kpi", "waterfall", "lollipop", "multiples", "rating_timeline"} <= names
    for case in parity["cases"]:
        assert viz.validate_spec(case["spec"]) == [], case["name"]
    assert [viz.notch(s) for s in ["AAA", "Aaa", "AA+", "Aa1", "AA (high)", "AA-", "Aa3", "AA (low)", "BBB-", "Baa3", "BBB (low)", "D"]] == [0, 0, 1, 1, 1, 3, 3, 3, 9, 9, 9, 21]
    assert [viz.notch(s) for s in ["AAA (high)", "A++", "aa", "", "Prime-1"]] == [None] * 5
    assert viz.validate_spec(spec(family="dumbbell", view={"datasets": [], "transform": "ratings"}))  # ratings need evidence


def test_server_checks_composite_marks_in_the_saved_deck():
    b = json.loads((FIX / "composite-bundle.json").read_text())
    deck = base64.b64decode(b["deck"])
    r = integrity.check(deck, b["project"], b["sidecar"])
    assert r["ok"], r["mismatch"]
    kinds = {v["spec"]["family"] for v in b["sidecar"]["bindings"].values() if v["kind"] == "viz"}
    assert kinds == {"dumbbell", "waterfall", "kpi", "rating_timeline"}
    edited = copy.deepcopy(b)
    edited["project"]["datasets"]["ds.fr.debt"]["working"]["2025"] = {"value": 116.0, "by": "you", "at": "t", "status": "manual_unverified"}
    r = integrity.check(deck, edited["project"], edited["sidecar"])
    assert not r["ok"] and any("data 116, visual 115.7" in m["detail"] for m in r["mismatch"])
    downgraded = copy.deepcopy(b)
    downgraded["project"]["evidence"]["ev.r.4"]["rating"]["rating"] = "AA-"
    r = integrity.check(deck, downgraded["project"], downgraded["sidecar"])
    assert not r["ok"] and any("ev.r.4: data 3, visual 2" in m["detail"] for m in r["mismatch"])


def test_v4_views_match_the_client():
    """Yield curve, maturity ladder, range, box plot, histogram and sensitivity: same categories and values as the client."""
    fx = json.loads((FIX / "structures-parity.json").read_text())
    assert len(fx["cases"]) == 9
    for case in fx["cases"]:
        assert viz.validate_spec(case["spec"]) == [], case["name"]
        got, exp = viz.project_view(fx["project"], case["spec"]), case["expected"]
        assert (got["shape"], got["categories"]) == (exp["shape"], exp["categories"]), case["name"]
        assert [s["values"] for s in got["series"]] == exp["series"], case["name"]
    assert viz.quantile([1, 2, 3, 4, 5, 6, 7, 8], 0.25) == 2.75 and viz.bin_edges([1, 2, 3, 4]) == [(1, 2), (2, 3), (3, 4)]
    assert viz.validate_spec(spec(family="heatmap", view={"datasets": ["a"], "transform": "sensitivity", "params": {"years": 99}}))  # horizon bounded


def test_server_checks_v4_visuals_in_the_saved_deck():
    b = json.loads((FIX / "structures-bundle.json").read_text())
    deck = base64.b64decode(b["deck"])
    r = integrity.check(deck, b["project"], b["sidecar"])
    assert r["ok"], r["mismatch"]
    assert {v["spec"]["family"] for v in b["sidecar"]["bindings"].values() if v["kind"] == "viz"} == {"yield_curve", "column", "range", "box", "histogram", "heatmap"}
    edited = copy.deepcopy(b)
    edited["project"]["datasets"]["ds.fr.debt"]["working"]["2025"] = {"value": 120.0, "by": "you", "at": "t", "status": "manual_unverified"}
    r = integrity.check(deck, edited["project"], edited["sidecar"])
    assert not r["ok"] and any("heatmap" in m["detail"] or "viz_heatmap" in m["element"] or "data " in m["detail"] for m in r["mismatch"])
    edited = copy.deepcopy(b)
    edited["project"]["datasets"]["ds.dk.bal"]["working"]["2025"] = {"value": -9.5, "by": "you", "at": "t", "status": "manual_unverified"}  # moves Denmark to another bin
    assert not integrity.check(deck, edited["project"], edited["sidecar"])["ok"]
