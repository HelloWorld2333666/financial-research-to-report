"""M5: rating evidence from PDFs, the task centre, and ratings tables in the saved deck.

The PDF is a synthetic press release from a fictional agency (tests/pdfgen.py). The model is
scripted (FunctionModel) and Eurostat is a fake: no network, no Ollama.
"""

import base64
import json
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("pydantic_ai")
from pydantic_ai.messages import ModelResponse, TextPart  # noqa: E402
from pydantic_ai.models.function import AgentInfo, FunctionModel  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import integrity  # noqa: E402
import pdfgen  # noqa: E402
import research_runs as rr  # noqa: E402
import service  # noqa: E402
import tasks as T  # noqa: E402
from frr.schema import ResearchRecord  # noqa: E402
from frr.validation import validate_record  # noqa: E402

FIX = Path(__file__).parent / "fixtures"
PDF = pdfgen.fixture_pdf()


def quoter(reply: str) -> FunctionModel:
    return FunctionModel(lambda messages, info: ModelResponse(parts=[TextPart(reply)]))


def test_pdf_pages_and_candidates():
    pages = rr.pdf_pages(PDF)
    assert len(pages) == 2 and "Example Ratings affirms France at AA-" in pages[0]
    assert rr.agency_of(pages) == "Example Ratings" and rr.find_date(pages[0]).isoformat() == "2025-03-14"
    with pytest.raises(rr.ResearchError):
        rr.pdf_pages(b"not a pdf")
    assert rr.find_date("MARCH 22, 2024PRESS RELEASE").isoformat() == "2024-03-22"  # year glued to the next word
    assert rr.find_date("Mar 22, 2024") and rr.find_date("22 March 2024") and rr.find_date("in 20245 cases") is None


def test_only_verbatim_excerpts_on_their_page_become_evidence():
    pages = rr.pdf_pages(PDF)
    candidates = [
        {"page": 1, "excerpt": "Example Ratings affirms France at AA-; Outlook Negative", "found_by": "model"},          # real
        {"page": 2, "excerpt": "Example Ratings affirms France at AA-; Outlook Negative", "found_by": "model"},          # wrong page
        {"page": 1, "excerpt": "Example Ratings has upgraded France to AAA with a Stable Outlook.", "found_by": "model"},  # invented
        {"page": 1, "excerpt": "high public debt of 113% of GDP and persistent fiscal deficits.", "found_by": "model"},     # no action
        {"page": 2, "excerpt": "Example Ratings previously downgraded France to AA- in 2024.", "found_by": "pattern"},      # earlier action
        {"page": 9, "excerpt": "Example Ratings affirms France at AA-", "found_by": "model"},
    ]
    ev, rejected = rr.rating_evidence(PDF, "example.pdf", "France", candidates, pages)
    assert [e["excerpt"] for e in ev] == ["Example Ratings affirms France at AA-; Outlook Negative"]
    assert ev[0]["rating"] == {"agency": "Example Ratings", "action": "affirmed", "rating": "AA-", "outlook": "negative", "date": "2025-03-14"}
    assert ev[0]["page"] == 1 and ev[0]["retrieval"]["method"] == "pdf_upload" and len(ev[0]["retrieval"]["content_sha256"]) == 64
    assert [r["reason"] for r in rejected] == ["excerpt not found verbatim on the page", "excerpt not found verbatim on the page",
                                               "excerpt states no rating action (verb + rating)", "refers to an earlier action, not this release's", "page out of range"]
    _, rej = rr.rating_evidence(PDF, "example.pdf", "Germany", candidates[:1], pages)
    assert rej[0]["reason"] == "page does not name Germany"


def test_rating_evidence_passes_schema_validation():
    pages = rr.pdf_pages(PDF)
    ev, _ = rr.rating_evidence(PDF, "example.pdf", "France", rr.pattern_candidates(pages), pages)
    record = json.loads((Path(__file__).resolve().parents[1] / "seeds" / "france-record.json").read_text())
    fields = set(__import__("frr.schema", fromlist=["Evidence"]).Evidence.model_fields)
    record["sources"].append({"id": ev[0]["source_id"], "title": "Example Ratings press release", "publisher": "Example Ratings",
                              "source_type": "rating_report", "origin": "user_provided", "content_sha256": ev[0]["retrieval"]["content_sha256"]})
    item = {k: v for k, v in ev[0].items() if k in fields}
    record["evidence"].append(item)
    codes = [i.code for i in validate_record(ResearchRecord.model_validate(record)) if i.level == "error"]
    assert codes == []
    item["rating"] = {**item["rating"], "rating": "AA+"}
    assert "rating_not_in_excerpt" in [i.code for i in validate_record(ResearchRecord.model_validate(record)) if i.level == "error"]


def wait(c, pid, tid, timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        t = next(t for t in c.get(f"/api/projects/{pid}/tasks").json() if t["id"] == tid)
        if t["status"] not in ("queued", "running"):
            return t
        time.sleep(0.05)
    raise AssertionError("task did not finish")


@pytest.fixture
def app_project(tmp_path):
    def make(model=None, fetch=None):
        app = service.create_app(projects_root=tmp_path, model=model, fetch=fetch)
        app.state.tasks.pace = 0
        return app
    return make, tmp_path


def project_with_deck(c, tmp_path, fixture="france-bundle.json") -> tuple[str, dict]:
    pid = c.post("/api/projects", json={"seed": "france", "title": "M5"}).json()["meta"]["id"]
    b = json.loads((FIX / fixture).read_text())
    b["project"]["id"] = pid
    assert c.put(f"/api/projects/{pid}", json=b).status_code == 200
    return pid, b


def test_upload_and_rating_task_end_to_end(app_project):
    make, tmp = app_project
    model_quote = json.dumps([{"page": 1, "excerpt": "Example Ratings affirms France at AA-; Outlook Negative"},
                              {"page": 1, "excerpt": "Example Ratings upgraded France to AAA."}])  # the second is invented
    with TestClient(make(model=quoter(model_quote))) as c:
        pid, b = project_with_deck(c, tmp)
        assert c.post(f"/api/projects/{pid}/uploads?name=x.pdf", content=b"hello").status_code == 400
        up = c.post(f"/api/projects/{pid}/uploads?name=example ratings.pdf", content=PDF).json()
        ph = next(k for k, v in b["sidecar"]["bindings"].items() if v["kind"] == "placeholder")
        t = c.post(f"/api/projects/{pid}/tasks", json={"kind": "rating_pdf", "params": {"upload": up["id"], "entity": "France", "element": ph, "slide": "s_4"}}).json()
        t = wait(c, pid, t["id"])
    r = t["result"]
    assert t["status"] == "done" and r["kind"] == "rating_proposal" and r["element"] == ph
    assert [e["excerpt"] for e in r["evidence"]] == ["Example Ratings affirms France at AA-; Outlook Negative"]
    assert "found by model" in r["evidence"][0]["verified_by"]  # the model's quote came first; the pattern duplicate was folded in
    assert any(x["excerpt"] == "Example Ratings upgraded France to AAA." and x["reason"].startswith("excerpt not found") for x in r["rejected"])
    assert r["title"] == "Rating actions: Example Ratings affirmed France at AA-, outlook negative (March 2025)"
    assert any("verifying each on its page" in line["msg"] for line in t["log"])


def test_rating_task_without_a_model_still_uses_the_pattern_finder(app_project):
    make, tmp = app_project
    def broken(messages, info: AgentInfo):
        raise RuntimeError("Ollama is not running")
    with TestClient(make(model=FunctionModel(broken))) as c:
        pid, _ = project_with_deck(c, tmp)
        up = c.post(f"/api/projects/{pid}/uploads?name=e.pdf", content=PDF).json()
        t = wait(c, pid, c.post(f"/api/projects/{pid}/tasks", json={"kind": "rating_pdf", "params": {"upload": up["id"]}}).json()["id"])
    assert t["result"]["kind"] == "rating_proposal" and "found by pattern" in t["result"]["evidence"][0]["verified_by"]
    assert any("model unavailable" in line["msg"] for line in t["log"])


def jsonstat(values):
    return json.dumps({"value": {str(i): v for i, v in enumerate(values.values())},
                       "dimension": {"time": {"category": {"index": {p: i for i, p in enumerate(values)}}}}}).encode()


def test_eurostat_pack_task_and_failures(app_project):
    make, tmp = app_project
    def fetch(url):
        if "na_item=B9" in url:
            raise ValueError("Eurostat 503")
        return jsonstat({"2023": 101.0, "2024": 102.5})
    with TestClient(make(fetch=fetch)) as c:
        pid, _ = project_with_deck(c, tmp)
        t = wait(c, pid, c.post(f"/api/projects/{pid}/tasks", json={"kind": "eurostat_pack", "params": {"geos": ["ES"], "metrics": ["debt", "deficit", "growth"]}}).json()["id"])
    r = t["result"]
    assert t["status"] == "done" and [d["id"] for d in r["datasets"]] == ["ds.es.debt", "ds.es.growth"]
    assert r["failed"] == ["ES deficit: Eurostat 503"] and "1 series failed" in r["summary"]
    assert all(e["retrieval"]["content_sha256"] for e in r["evidence"].values())


def test_cancel_retry_and_restart_recovery(app_project):
    make, tmp = app_project
    def slow(url):
        time.sleep(0.2)
        return jsonstat({"2024": 1.0})
    with TestClient(make(fetch=slow)) as c:
        pid, _ = project_with_deck(c, tmp)
        t = c.post(f"/api/projects/{pid}/tasks", json={"kind": "eurostat_pack", "params": {"geos": ["ES", "IT", "PT"]}}).json()
        time.sleep(0.7)  # at least one series done (two 0.2 s fetches each)
        c.post(f"/api/projects/{pid}/tasks/{t['id']}/cancel")
        t = wait(c, pid, t["id"])
        assert t["status"] == "cancelled" and 0 < t["progress"] < 1
        retry = c.post(f"/api/projects/{pid}/tasks/{t['id']}/retry").json()
        assert retry["title"].endswith("(retry)") and retry["params"] == t["params"]
        c.post(f"/api/projects/{pid}/tasks/{retry['id']}/cancel")
        wait(c, pid, retry["id"])
    # a task left 'running' on disk (the server stopped) is marked interrupted at the next start
    f = next((tmp / pid / "tasks").glob("task-*.json"))
    stale = json.loads(f.read_text()) | {"status": "running"}
    f.write_text(json.dumps(stale))
    with TestClient(make()) as c:
        t = next(x for x in c.get(f"/api/projects/{pid}/tasks").json() if x["id"] == stale["id"])
    assert t["status"] == "interrupted" and "retry" in t["error"]


def test_task_endpoints_refuse_bad_input(app_project):
    make, tmp = app_project
    with TestClient(make()) as c:
        pid, _ = project_with_deck(c, tmp)
        assert c.post(f"/api/projects/{pid}/tasks", json={"kind": "shell"}).status_code == 400
        assert c.post(f"/api/projects/{pid}/tasks/task-nope/cancel").status_code == 404
        assert c.post("/api/projects/nope-123/tasks", json={"kind": "eurostat_pack", "params": {}}).status_code == 404


def test_ratings_table_integrity_on_the_saved_deck():
    b = json.loads((FIX / "ratings-bundle.json").read_text())
    deck = base64.b64decode(b["deck"])
    r = integrity.check(deck, b["project"], b["sidecar"])
    assert r["ok"] and r["placeholders"] == [] and r["unsourced"] == []
    tid, tb = next((k, v) for k, v in b["sidecar"]["bindings"].items() if v["kind"] == "ratings")
    assert integrity.read_deck(deck)[tid]["rows"][1] == ["Example Ratings", "2025-03-14", "affirmed", "AA-", "negative"]
    ev = b["project"]["evidence"][tb["rows"][0]]
    ev["rating"]["rating"] = "AA"  # evidence changed under the table
    assert not integrity.check(deck, b["project"], b["sidecar"])["ok"]


def test_agent_starts_a_background_eurostat_task(app_project):
    make, tmp = app_project
    from pydantic_ai.messages import ToolCallPart, ToolReturnPart
    def fn(messages, info):
        if any(isinstance(p, ToolReturnPart) for m in messages for p in getattr(m, "parts", [])):
            return ModelResponse(parts=[TextPart("started")])
        return ModelResponse(parts=[ToolCallPart("start_research", {"topic": "Spain fiscal data", "country": "ES"})])
    app = make(model=FunctionModel(fn), fetch=lambda u: jsonstat({"2024": 1.0}))
    with TestClient(app) as c:
        pid, _ = project_with_deck(c, tmp)
        import agent as A
        from pydantic_ai.ui import StateDeps
        ag = A.create_agent(app.state.tasks.store, FunctionModel(fn), center=app.state.tasks)
        res = c.portal.call(lambda: ag.run("get Spain's data", deps=StateDeps(A.WorkspaceState(project=pid))))
        out = next(p.content for m in res.all_messages() for p in m.parts if isinstance(p, ToolReturnPart))
        assert out["kind"] == "task_started"
        t = wait(c, pid, out["task_id"])
    assert t["status"] == "done" and len(t["result"]["datasets"]) == 5
