import base64
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import server

PNG_1PX = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


@pytest.fixture
def srv(tmp_path, project):
    paths = server.Paths(tmp_path)
    paths.static.mkdir()
    (paths.static / "index.html").write_text("<title>ok</title>")
    paths.projects.mkdir()
    (paths.projects / "demo.json").write_text(json.dumps(project))
    httpd = server.serve(0, paths)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", paths
    httpd.shutdown()


def call(method, url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_serves_static_and_loads_project(srv):
    base, _ = srv
    with urllib.request.urlopen(base + "/") as r:
        assert b"ok" in r.read()
    status, p = call("GET", base + "/api/projects/demo")
    assert status == 200 and p["id"] == "china_re_overview"


def test_save_keeps_history_and_returns_integrity(srv):
    base, paths = srv
    _, p = call("GET", base + "/api/projects/demo")
    p["elements"][0]["text"] = "Edited title"
    status, r = call("PUT", base + "/api/projects/demo", p)
    assert status == 200 and r["integrity"] == []
    assert json.loads((paths.projects / "demo.json").read_text())["elements"][0]["text"] == "Edited title"
    assert len(list((paths.history / "demo").glob("*.json"))) == 1


def test_rejects_invalid_project_and_names(srv):
    base, _ = srv
    assert call("PUT", base + "/api/projects/demo", {"schema": "nope"})[0] == 422
    assert call("GET", base + "/api/projects/..%2Fsecret")[0] == 400
    assert call("GET", base + "/api/projects/Bad.Name")[0] == 400
    assert call("GET", base + "/api/nothing")[0] == 404


def test_export_png(srv):
    base, paths = srv
    url = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()
    status, r = call("POST", base + "/api/projects/demo/export", {"png": url, "label": "final"})
    assert status == 200 and (paths.static.parent / r["saved"]).read_bytes() == PNG_1PX
    assert call("POST", base + "/api/projects/demo/export", {"png": "data:image/png;base64,aGVsbG8="})[0] == 400
    assert call("POST", base + "/api/projects/demo/export", {"png": url, "label": "../x"})[0] == 400


def test_change_request_round_trip(srv, project):
    base, paths = srv
    project["annotations"].append(dict(id="req-a1", kind="element", element_ids=["geo-gap"],
                                       instruction="Show revenue by country", status="open"))
    status, r = call("POST", base + "/api/projects/demo/requests/req-a1", project)
    assert status == 200 and r["scope_element_ids"] == ["geo-gap"]
    assert "--tools ''" in r["suggested_command"] and "--json-schema" in r["suggested_command"]
    assert (paths.requests / "demo" / "req-a1.request.json").exists()
    assert call("GET", base + "/api/projects/demo/requests/req-a1/patch")[0] == 404
    patch = {"request_id": "req-a1", "ops": [], "research_requests": [{"description": "Revenue by country"}]}
    (paths.requests / "demo" / "req-a1.patch.json").write_text(json.dumps(patch))
    assert call("GET", base + "/api/projects/demo/requests/req-a1/patch")[1] == patch
    status, v = call("POST", base + "/api/patch/validate", {"project": project, "request_id": "req-a1", "patch": patch})
    assert v["ok"] and v["project"]["research_requests"][-1]["description"] == "Revenue by country"
    bad = {"request_id": "req-a1", "ops": [{"op": "update", "id": "kpi-roe", "set": {"x": 0}}]}
    status, v = call("POST", base + "/api/patch/validate", {"project": project, "request_id": "req-a1", "patch": bad})
    assert not v["ok"] and "outside the request scope" in v["errors"][0]


def test_research_endpoints_round_trip(srv, project):
    base, paths = srv
    fx = paths.root / "fixtures" / "research_responses"
    fx.mkdir(parents=True)
    src = Path(__file__).resolve().parents[1] / "fixtures" / "research_responses"
    for f in src.glob("*.json"):
        (fx / f.name).write_text(f.read_text())
    status, c = call("POST", base + "/api/classify", {"project": project, "instruction": "Add revenue by country chart; research FY2025"})
    assert status == 200 and c["intent"] == "research"
    status, r = call("POST", base + "/api/research/create",
                     {"project": project, "instruction": "Add revenue by country chart; research FY2025",
                      "region": {"x": 32, "y": 513, "w": 384, "h": 84}})
    assert status == 200 and r["request"]["status"] == "pending_research"
    p, rid = r["project"], r["request"]["id"]
    status, h = call("POST", base + f"/api/projects/demo/research/{rid}", p)
    assert status == 200 and (paths.root / h["request"]).exists()
    assert call("GET", base + f"/api/projects/demo/research/{rid}/response")[0] == 404
    status, lst = call("GET", base + "/api/fixtures")
    assert {f["name"] for f in lst} == {"test_fixture_geo_region_fulfilled", "test_fixture_geo_country_not_available"}
    status, resp = call("POST", base + "/api/research/fixture", {"name": "test_fixture_geo_country_not_available", "request_id": rid})
    assert resp["request_id"] == rid
    (paths.research / "demo" / f"{rid}.response.json").write_text(json.dumps(resp))
    status, loaded = call("GET", base + f"/api/projects/demo/research/{rid}/response")
    status, a = call("POST", base + "/api/research/apply", {"project": p, "response": loaded})
    assert a["ok"] and a["project"]["research_requests"][-1]["status"] == "not_available"
    status, rv = call("POST", base + "/api/research/revert", {"project": a["project"], "request_id": rid})
    assert rv["project"]["research_requests"][-1]["status"] == "pending_research"
    assert call("POST", base + "/api/research/fixture", {"name": "../secret", "request_id": rid})[0] == 400
