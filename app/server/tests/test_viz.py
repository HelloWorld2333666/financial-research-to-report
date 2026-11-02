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
