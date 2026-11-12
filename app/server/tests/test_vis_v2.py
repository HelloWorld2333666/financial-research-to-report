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
    assert c.created[0][1:3] == ("eurostat_pack", {"geos": ["IT", "ES", "PT", "EL", "BE"], "metrics": evidence.GROUPS["fiscal"], "since": "2015"})


def test_fetched_datasets_carry_measure_metadata():
    data = jsonstat({"2023": -5.5, "2024": -5.8})
    got = A.fetch_verified(lambda url: data, "deficit", "FR", "2023")
    assert got["dataset"]["measure"] == {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"}
    # the client keeps a fallback table for older datasets; the two must agree
    fallback = (Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "constraints.ts").read_text()
    for key in evidence.GROUPS["fiscal"]:  # the fallback covers datasets fetched before V2 (fiscal metrics only)
        m = evidence.MEASURES[key]
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



def test_research_scope_expands_eu27_and_groups(setup):
    geos, ms = A.research_scope(["EU27"], "FR", ["deficit"])
    assert len(geos) == 27 and geos[0] == "BE" and ms == ["deficit"]
    assert A.research_scope(None, "FR", ["maturity", "yield_curve"]) == (["FR"], ["rmd_le1", "rmd_1_5", "rmd_5_10", "rmd_10_30", "rmd_gt30", "rmd_total", "yc_all", "yc_aaa"])
    store, pid, *_ = setup
    c = FakeCenter()
    r = tool_result(A.create_agent(store, scripted("start_research", {"topic": "deficits", "countries": ["EU27"], "metrics": ["deficit"]}), center=c).run_sync("x", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert "27 Eurostat series for the EU-27" in r["summary"]


def test_maturity_buckets_are_parts_of_one_countrys_debt():
    data = jsonstat({"2024": 12.1, "2025": 12.9})
    fr = A.fetch_verified(lambda url: data, "rmd_le1", "FR", "2024")["dataset"]["measure"]
    it = A.fetch_verified(lambda url: data, "rmd_le1", "IT", "2024")["dataset"]["measure"]
    assert fr["additive_parts_of"] == "fr.debt_by_maturity" and it["additive_parts_of"] == "it.debt_by_maturity"  # never added across countries
    assert fr["bucket"] == {"order": 0, "label": "1 year or less"}


def curve_json(values: dict) -> bytes:
    """JSON-stat with maturity x time (the real irt_euryld_m layout, other dimensions of size 1)."""
    mats, times = sorted({m for m, _ in values}, key=lambda m: int(m[1:])), sorted({t for _, t in values})
    ids = ["freq", "yld_curv", "bonds", "maturity", "geo", "time"]
    dims = {"freq": ["M"], "yld_curv": ["SPOT_RT"], "bonds": ["CGB_EA"], "maturity": mats, "geo": ["EA"], "time": times}
    flat = {str(mats.index(m) * len(times) + times.index(t)): v for (m, t), v in values.items()}
    return json.dumps({"id": ids, "size": [len(dims[d]) for d in ids], "value": flat,
                       "dimension": {d: {"category": {"index": {c: i for i, c in enumerate(dims[d])}}} for d in ids}}).encode()


def test_a_yield_curve_is_one_dataset_per_tenor_and_drops_unconfirmed_values():
    first = curve_json({("Y1", "2026-08"): 2.01, ("Y10", "2026-08"): 2.95, ("Y2", "2026-08"): 2.1, ("Y1", "2026-09"): 2.0})
    second = curve_json({("Y1", "2026-08"): 2.01, ("Y10", "2026-08"): 2.95, ("Y2", "2026-08"): 2.2, ("Y1", "2026-09"): 2.0})  # Y2 disagrees
    calls = []
    out = A.fetch_curve(lambda url: calls.append(url) or (first if len(calls) == 1 else second), "yc_all", "2026-08")
    assert len(calls) == 2 and "maturity" not in calls[0] and "bonds=CGB_EA" in calls[0]
    by = {g["dataset"]["id"]: g for g in out}
    assert list(by) == ["ds.ea.yc_all_y1", "ds.ea.yc_all_y2", "ds.ea.yc_all_y10"]
    assert [o["value"] for o in by["ds.ea.yc_all_y1"]["dataset"]["observations"]] == [2.01, 2.0]
    assert by["ds.ea.yc_all_y2"]["dataset"]["observations"] == [] and by["ds.ea.yc_all_y2"]["rejected"] == 1
    m = by["ds.ea.yc_all_y10"]["dataset"]["measure"]
    assert (m["kind"], m["tenor"], m["curve"]) == ("yield", 10, "yc_all") and by["ds.ea.yc_all_y10"]["dataset"]["frequency"] == "monthly"


def test_the_research_task_fetches_maturity_buckets_and_yield_curves(tmp_path):
    from starlette.testclient import TestClient
    import service
    from test_m5 import project_with_deck, wait
    calls = []

    def fetch(url):
        calls.append(url)
        if "irt_euryld_m" in url:
            return curve_json({("Y1", "2026-09"): 2.0, ("Y5", "2026-09"): 2.4, ("Y10", "2026-09"): 2.9, ("Y30", "2026-09"): 3.4})
        return jsonstat({"2024": 14.0, "2025": 14.1})
    app = service.create_app(projects_root=tmp_path, fetch=fetch)
    app.state.tasks.pace = 0
    with TestClient(app) as c:
        pid, _ = project_with_deck(c, tmp_path)
        t = wait(c, pid, c.post(f"/api/projects/{pid}/tasks", json={"kind": "eurostat_pack", "params": {"geos": ["FR"], "metrics": ["rmd_le1", "yc_all"]}}).json()["id"])
    r = t["result"]
    assert t["status"] == "done" and [d["id"] for d in r["datasets"]] == ["ds.fr.rmd_le1", "ds.ea.yc_all_y1", "ds.ea.yc_all_y5", "ds.ea.yc_all_y10", "ds.ea.yc_all_y30"]
    assert sum("irt_euryld_m" in u for u in calls) == 2  # one curve = one request, fetched twice
    assert "maturity=Y_LE1" in calls[0] and "geo=FR" in calls[0]


def test_visual_requests_for_curves_maturity_and_sensitivity(setup):
    store, pid, b, _ = setup
    st = A.WorkspaceState(project=pid)
    for args, needle in (({"intent": "curve"}, "yield_curve"), ({"intent": "maturity", "countries": ["FR"]}, "maturity")):
        r = tool_result(A.create_agent(store, scripted("propose_visual", args)).run_sync("x", deps=StateDeps(st)))
        assert r["kind"] == "error" and needle in r["message"]  # the fixture has neither: research first
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "sensitivity", "countries": ["FR"], "years": 3, "rates": [2, 4]})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "visual_request" and r["datasets"] == ["ds.fr.debt", "ds.fr.deficit", "ds.fr.interest"] and r["params"] == {"years": 3, "rates": [2, 4]}
    assert "assumptions" in r["summary"]
    vid, vb = binding(b, "viz")
    sel = A.WorkspaceState(project=pid, selection=[A.Selected(id=vid, kind="chart", label=vb["spec"]["title"], datasets=vb["spec"]["view"]["datasets"])])
    for family, transform in (("box", "distribution"), ("histogram", "histogram"), ("range", "range")):
        r = tool_result(A.create_agent(store, scripted("change_visual", {"family": family})).run_sync("x", deps=StateDeps(sel)))
        assert r.get("transform") == transform, family



def test_a_visual_request_for_the_eu27_names_each_member_state(setup):
    store, pid, *_ = setup
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "distribution", "metric": "debt", "countries": ["EU27"]})).run_sync("x", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert r["kind"] == "visual_request" and r["datasets"] == ["ds.de.debt", "ds.fr.debt"] and len(r["missing"]) == 25  # the fixture has two of them



def test_sensitivity_assumptions_given_as_fractions_are_read_as_percent_and_said_so(setup):
    store, pid, *_ = setup
    st = A.WorkspaceState(project=pid)
    r = tool_result(A.create_agent(store, scripted("propose_visual", {"intent": "sensitivity", "countries": ["FR"], "rates": [0.02, 0.03], "growth": [-0.5, 0, 1.5]})).run_sync("x", deps=StateDeps(st)))
    assert r["params"] == {"rates": [2.0, 3.0], "growth": [-0.5, 0, 1.5]}  # growth already in percent: unchanged
    assert "rates [0.02, 0.03] read as [2.0, 3.0] %" in r["summary"]
