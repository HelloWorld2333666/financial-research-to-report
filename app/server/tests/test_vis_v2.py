"""VIS V2: the agent's visual tools only REQUEST visuals (the client recommender and its hard constraints decide),
datasets carry measure metadata, and research can cover several countries. Scripted model, fake Eurostat."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
import pytest  # noqa: E402
from pydantic_ai.ui import StateDeps  # noqa: E402

import agent as A  # noqa: E402
import evidence  # noqa: E402
from test_m4 import binding, jsonstat, scripted, setup, tool_result  # noqa: E402,F401


def test_propose_visual_returns_a_request_for_the_client_to_resolve(setup):
    store, pid, *_ = setup
    st = A.WorkspaceState(project=pid, slide="s_2")
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "ranking", "metric": "debt", "period": "2024"})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "visual_request" and r["intent"] == "ranking" and r["at"] == "2024" and r["slide"] == "s_2"
    assert r["datasets"] == ["ds.de.debt", "ds.fr.debt"] and r["missing"] == []  # every country with that metric
    assert "family" not in r and "Nothing has changed yet" in r["summary"]  # the model never picks the chart type
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "change", "metric": "debt", "countries": ["FR", "IT"], "start": "2022", "end": "2025"})).run_sync("x", deps=StateDeps(st)))
    assert r["datasets"] == ["ds.fr.debt"] and r["missing"] == ["ds.it.debt"] and r["between"] == ["2022", "2025"] and "no verified data for ds.it.debt" in r["summary"]


def test_propose_visual_without_data_asks_for_research(setup):
    store, pid, *_ = setup
    st = A.WorkspaceState(project=pid)
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "ranking", "metric": "deficit", "countries": ["PT", "EL"]})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "error" and "Portugal" in r["message"] and "Greece" in r["message"] and "start_research" in r["message"]
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "relationship", "metric": "interest", "countries": ["FR"], "second_metric": "pmi"})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "error"  # one side of the pair missing: no half-relationship


def test_change_visual_needs_a_selected_chart_and_maps_the_view(setup):
    store, pid, b, _ = setup
    vid, vb = binding(b, "viz")
    r = tool_result(A.create_agent(store, scripted("change_visual", {"family": "pie"})).run_sync("x", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert r["kind"] == "error" and "Select a chart" in r["message"]
    st = A.WorkspaceState(project=pid, selection=[A.Selected(id=vid, kind="chart", label=vb["spec"]["title"], datasets=vb["spec"]["view"]["datasets"])])
    r = tool_result(A.create_agent(store, scripted("change_visual", {"family": "bar", "view": "change"})).run_sync("x", deps=StateDeps(st)))
    assert r == {"kind": "visual_change_request", "element": vid, "family": "bar", "transform": "diff", "summary": r["summary"]}
    assert "checks it against the data first" in r["summary"]


class FakeCenter:
    def __init__(self):
        self.created = []

    def create(self, pid, kind, params, title):
        self.created.append((pid, kind, params, title))
        return {"id": "t_1", "title": title}


def test_research_for_several_countries_starts_one_pack(setup):
    store, pid, *_ = setup
    c = FakeCenter()
    st = A.WorkspaceState(project=pid)
    r = tool_result(A.create_agent(store, scripted("start_research", {"topic": "fiscal balances", "countries": ["it", "ES", "PT", "EL", "BE"]}), center=c).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "task_started" and "25 Eurostat series" in r["summary"] and "Italy, Spain, Portugal, Greece, Belgium" in r["summary"]
    assert c.created[0][1:3] == ("eurostat_pack", {"geos": ["IT", "ES", "PT", "EL", "BE"], "metrics": list(A.METRICS), "since": "2015"})


def test_fetched_datasets_carry_measure_metadata():
    data = jsonstat({"2023": -5.5, "2024": -5.8})
    got = A.fetch_verified(lambda url: data, "deficit", "FR", "2023")
    assert got["dataset"]["measure"] == {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"}
    # the client keeps a fallback table for older datasets; the two must agree
    fallback = (Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "constraints.ts").read_text()
    for key, m in evidence.MEASURES.items():
        assert f"{key}: {{ kind: '{m['kind']}'" in fallback and f"signed: {json.dumps(m['signed'])}" in fallback, key


def test_server_stores_acknowledged_warnings_but_never_an_invalid_code(tmp_path):
    import re
    import typing

    import viz
    from projects import BundleError, ProjectStore

    client = (Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "constraints.ts").read_text()
    assert set(re.findall(r"warn\('([a-z_]+)'", client)) == set(typing.get_args(viz.WarningCode))
    b = json.loads((Path(__file__).parent / "fixtures" / "france-bundle.json").read_text())
    store = ProjectStore(tmp_path)
    pid = store.create("france", "V2 override")["meta"]["id"]
    b["project"]["id"] = pid
    vid = next(k for k, v in b["sidecar"]["bindings"].items() if v["kind"] == "viz")
    b["sidecar"]["bindings"][vid]["spec"]["accepted_warnings"] = ["overlapping_areas"]
    store.save(pid, b)
    assert store.load(pid)["sidecar"]["bindings"][vid]["spec"]["accepted_warnings"] == ["overlapping_areas"]
    for bad in (["not_parts"], ["missing_parts"], "overlapping_areas"):
        b["sidecar"]["bindings"][vid]["spec"]["accepted_warnings"] = bad
        with pytest.raises(BundleError, match="visual specs refused"):
            store.save(pid, b)


def test_visual_tools_cover_composites_and_rating_timelines(setup):
    store, pid, b, _ = setup
    st = A.WorkspaceState(project=pid)
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "ratings"})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "error" and "no rating actions" in r["message"]  # the France fixture has none
    p = store.load(pid)
    p["project"]["evidence"]["ev.r.1"] = {"id": "ev.r.1", "kind": "fact", "subject": "France", "statement": "test", "rating": {"agency": "A (test)", "action": "affirmed", "rating": "AA", "outlook": None, "date": "2024-05-31"}}
    p["project"]["evidence"]["ev.r.2"] = {"id": "ev.r.2", "kind": "fact", "subject": "France", "statement": "test", "rating": {"agency": "A (test)", "action": "affirmed", "rating": "AA", "outlook": None, "date": None}}
    store.save(pid, p)
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "ratings", "countries": ["FR"]})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "visual_request" and r["intent"] == "ratings" and sorted(r["evidence"]) == ["ev.r.1", "ev.r.2"] and r["datasets"] == []
    assert "1 without a verified date cannot be placed" in r["summary"]
    vid, vb = binding(b, "viz")
    sel = A.WorkspaceState(project=pid, selection=[A.Selected(id=vid, kind="chart", label=vb["spec"]["title"], datasets=vb["spec"]["view"]["datasets"])])
    for family, transform in (("dumbbell", "pair"), ("waterfall", "bridge"), ("multiples", "none"), ("lollipop", None)):
        r = tool_result(A.create_agent(store, scripted("change_visual", {"family": family})).run_sync("x", deps=StateDeps(sel)))
        assert r["kind"] == "visual_change_request" and r["family"] == family and r.get("transform") == transform, family
