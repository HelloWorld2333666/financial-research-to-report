"""M4: the agent's tools return proposals; numbers never come from the model.

The model is scripted with PydanticAI's FunctionModel (no Ollama, no network); Eurostat is a fake.
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("pydantic_ai")
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart  # noqa: E402
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel  # noqa: E402
from pydantic_ai.ui import StateDeps  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent as A  # noqa: E402
import integrity  # noqa: E402
import service  # noqa: E402
from projects import ProjectStore  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "france-bundle.json"


def scripted(tool: str, args: dict, writer: list[str] | None = None) -> FunctionModel:
    """The conversation model calls `tool` once, then stops; the writer (no tools) replies from `writer` in turn."""
    drafts = list(writer or [])

    def fn(messages, info: AgentInfo) -> ModelResponse:
        if not info.function_tools:  # the rewrite writer
            return ModelResponse(parts=[TextPart(drafts.pop(0))])
        if any(isinstance(p, ToolReturnPart) for m in messages for p in getattr(m, "parts", [])):
            return ModelResponse(parts=[TextPart("Done, it has been added.")])  # prose the app must not show
        return ModelResponse(parts=[ToolCallPart(tool, args)])

    async def stream(messages, info: AgentInfo):  # AG-UI runs stream
        part = fn(messages, info).parts[0]
        yield part.content if isinstance(part, TextPart) else {0: DeltaToolCall(name=part.tool_name, json_args=json.dumps(part.args))}
    return FunctionModel(fn, stream_function=stream)


@pytest.fixture
def setup(tmp_path):
    store = ProjectStore(tmp_path)
    b = json.loads(FIXTURE.read_text())
    pid = store.create("france", "M4 test")["meta"]["id"]
    b["project"]["id"] = pid
    store.save(pid, b)
    elements = integrity.read_deck(base64.b64decode(b["deck"]))
    return store, pid, b, elements


def binding(b, kind, role=None, slide="s_1"):
    return next((k, v) for k, v in b["sidecar"]["bindings"].items() if v["kind"] == kind and v.get("slide") == slide and (role is None or v.get("role") == role))


def title_state(setup, figures=None):
    store, pid, b, el = setup
    tid, tb = binding(b, "text", "title")
    figs = figures if figures is not None else [A.Figure(key=f"n{i + 1}", text=n["text"], evidence=n.get("evidence"), derivation=n.get("derivation")) for i, n in enumerate(tb["numbers"])]
    return A.WorkspaceState(project=pid, thread="s_1", slide="s_1", selection=[A.Selected(id=tid, kind="text", role="title", text=el[tid]["text"], figures=figs)])


def tool_result(run) -> dict:
    return next(p.content for m in run.all_messages() for p in m.parts if isinstance(p, ToolReturnPart))


def test_compose_deck_returns_bound_slides(setup):
    store, pid, *_ = setup
    ag = A.create_agent(store, scripted("compose_deck", {"country": "FR", "peer": "DE"}))
    r = tool_result(ag.run_sync("Make a deck", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert r["kind"] == "deck_proposal" and [s["key"] for s in r["slides"]] == ["debt", "fiscal", "market", "ratings"]
    assert "nothing has changed yet" in r["summary"] and sum(len(v) for s in r["slides"] for v in s["numbers"].values()) == 14
    r = tool_result(A.create_agent(store, scripted("compose_deck", {"country": "JP"})).run_sync("x", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert r["kind"] == "error" and "no verified data" in r["message"]


def jsonstat(values: dict[str, float]) -> bytes:
    return json.dumps({"value": {str(i): v for i, v in enumerate(values.values())},
                       "dimension": {"time": {"category": {"index": {p: i for i, p in enumerate(values)}}}}}).encode()


def test_add_comparison_fetches_twice_and_keeps_only_confirmed_values(setup):
    store, pid, b, _ = setup
    cid, cb = binding(b, "chart")
    first = jsonstat({"2022": 138.4, "2023": 134.0, "2024": 134.3, "2025": 136.7})
    second = jsonstat({"2022": 138.4, "2023": 134.0, "2024": 134.3, "2025": 137.0})  # 2025 disagrees
    calls = []
    def get(url):
        calls.append(url)
        return first if len(calls) == 1 else second
    st = A.WorkspaceState(project=pid, selection=[A.Selected(id=cid, kind="chart", label=cb["chart"]["title"], metric="debt", datasets=cb["chart"]["series"])])
    r = tool_result(A.create_agent(store, scripted("add_comparison", {"country": "IT"}), get=get).run_sync("Compare with Italy", deps=StateDeps(st)))
    assert len(calls) == 2 and calls[0] == calls[1] and "geo=IT" in calls[0] and "sinceTimePeriod=2022" in calls[0]
    assert r["kind"] == "series_proposal" and r["rejected"] == 1 and [o["date"] for o in r["dataset"]["observations"]] == ["2022", "2023", "2024"]
    ev = r["evidence"]["ev.live.it.debt.2022"]
    assert ev["retrieval"]["query_url"] == calls[0] and ev["retrieval"]["content_sha256"] == hashlib.sha256(first).hexdigest() and ev["value"] == 138.4
    assert "1 rejected" in r["summary"] and "independent re-fetch" in r["summary"]


def test_add_comparison_needs_a_chart_and_reuses_project_data(setup):
    store, pid, b, _ = setup
    r = tool_result(A.create_agent(store, scripted("add_comparison", {"country": "IT"}), get=lambda u: b"").run_sync("x", deps=StateDeps(A.WorkspaceState(project=pid))))
    assert r == {"kind": "error", "message": "Select a chart on the canvas first."}
    cid, cb = binding(b, "chart", slide="s_3")  # growth chart: FR and DE already there
    st = A.WorkspaceState(project=pid, selection=[A.Selected(id=cid, kind="chart", label="g", metric="growth", datasets=["ds.fr.growth"])])
    r = tool_result(A.create_agent(store, scripted("add_comparison", {"country": "DE"}), get=lambda u: 1 / 0).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "series_proposal" and not r["retrieved"] and r["evidence"]  # from the project, no fetch


def test_rewrite_refuses_typed_numbers_and_retries_inside_the_tool(setup):
    store, *_ = setup
    drafts = ["France's debt rose from 111.4% to {n2} (2022–2025)",  # typed number
              "France's debt rose from {n1} to {n2} (2022–2025); Germany: {n3} in 2025 (up from {n4})",  # n4 without its year
              "France's debt rose from {n1} to {n2} (2022–2025); Germany: {n3} in 2025, {n4} in 2022"]
    r = tool_result(A.create_agent(store, scripted("rewrite_text", {"instruction": "more concise"}, drafts)).run_sync("Rewrite", deps=StateDeps(title_state(setup))))
    assert r["kind"] == "rewrite_proposal" and r["attempts"] == 3 and "after 2 refused drafts" in r["summary"]
    assert r["after"] == "France's debt rose from 111.4% to 115.7% (2022–2025); Germany: 62.8% in 2025, 64.1% in 2022"
    assert [n["text"] for n in r["numbers"]] == ["111.4%", "115.7%", "62.8%", "64.1%"] and all(n["evidence"] for n in r["numbers"])


def test_rewrite_gives_up_honestly(setup):
    store, *_ = setup
    r = tool_result(A.create_agent(store, scripted("rewrite_text", {}, ["Debt is 120%"] * 3)).run_sync("Rewrite", deps=StateDeps(title_state(setup))))
    assert r["kind"] == "error" and "No acceptable wording after 3 drafts" in r["message"] and "Nothing was changed" in r["message"]


def test_rewrite_checks_a_draft_from_the_conversation_model_first(setup):
    store, *_ = setup
    ok = "Debt: {n1} in 2022, {n2} in 2025; Germany {n3} in 2025, {n4} in 2022"
    r = tool_result(A.create_agent(store, scripted("rewrite_text", {"text": ok}, [])).run_sync("Rewrite", deps=StateDeps(title_state(setup))))
    assert r["kind"] == "rewrite_proposal" and r["attempts"] == 1
    r = tool_result(A.create_agent(store, scripted("rewrite_text", {"text": "Debt hit 999%"}, [ok])).run_sync("Rewrite", deps=StateDeps(title_state(setup))))
    assert r["kind"] == "rewrite_proposal" and r["attempts"] == 2


def test_figures_from_the_browser_are_rechecked_against_saved_data(setup):
    store, pid, b, _ = setup
    project = store.load(pid)["project"]
    forged = [A.Figure(key="n1", text="111.4%", evidence="ev.exp2.1"), A.Figure(key="n2", text="99.9%", evidence="ev.exp2.4")]
    assert [f.key for f in A.trusted_figures(project, forged)] == ["n1"]


def test_build_rewrite_rules():
    F = A.Figure
    figs = [F(key="n1", text="111.4%", evidence="a"), F(key="n2", text="+4.3 pp", derivation="d")]
    assert A.build_rewrite("Up {n2} pp since 2022, to {n1}%", figs, "2022", {"n1": "2022"})[0] == "Up +4.3 pp since 2022, to 111.4%"
    for bad, why in [("{n3}", "unknown placeholders"), ("Up 4.3 pp", "placeholder"), ("{n1} in 2024", "not in the original"), ("Rose to {n1}", "keep 2022")]:
        with pytest.raises(ValueError, match=why):
            A.build_rewrite(bad, figs, "2022", {"n1": "2022"})
    assert A.template_of("from 111.4% to x", figs) == "from {n1} to x"


def test_layout_and_research_proposals(setup):
    store, pid, *_ = setup
    st = A.WorkspaceState(project=pid, slide="s_2", selection=[A.Selected(id="e_1", kind="text"), A.Selected(id="e_2", kind="chart")])
    r = tool_result(A.create_agent(store, scripted("layout_suggestion", {"action": "align_top"})).run_sync("x", deps=StateDeps(st)))
    assert r["commands"] == [{"kind": "elements.align", "ids": ["e_1", "e_2"], "mode": "top"}]
    r = tool_result(A.create_agent(store, scripted("layout_suggestion", {"action": "distribute_vertical"})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "error" and "at least 3" in r["message"]
    r = tool_result(A.create_agent(store, scripted("start_research", {"topic": "rating history"})).run_sync("x", deps=StateDeps(st)))
    assert r["kind"] == "research_proposal" and r["slide"] == "s_2" and "No research has run" in r["summary"]


def test_ag_ui_endpoint_streams_the_proposal(setup, tmp_path):
    store, pid, b, _ = setup
    app = service.create_app(projects_root=store.root, model=scripted("compose_deck", {"country": "FR"}))
    body = {"threadId": f"{pid}:project", "runId": "run-1", "state": {"project": pid, "thread": "project", "selection": []},
            "messages": [{"id": "m1", "role": "user", "content": "Analyze France and make four slides"}], "tools": [], "context": [], "forwardedProps": {}}
    with TestClient(app) as c:
        r = c.post("/api/agent", json=body, headers={"accept": "text/event-stream"})
        assert r.status_code == 200
        events = [json.loads(line[5:]) for line in r.text.splitlines() if line.startswith("data:")]
        cfg = c.get("/api/agent/config").json()
    kinds = [e["type"] for e in events]
    assert kinds[0] == "RUN_STARTED" and "TOOL_CALL_START" in kinds and kinds[-1] == "RUN_FINISHED"
    result = json.loads(next(e for e in events if e["type"] == "TOOL_CALL_RESULT")["content"])
    assert result["kind"] == "deck_proposal" and len(result["slides"]) == 4
    assert {"provider", "model", "url", "reachable"} <= set(cfg)
