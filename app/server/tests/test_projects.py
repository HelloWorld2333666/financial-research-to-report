import base64
import io
import sys
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("starlette")
from starlette.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service  # noqa: E402


def _deck() -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client(tmp_path):
    return TestClient(service.create_app(Path("/nonexistent"), tmp_path / "projects"))


def test_france_seed_has_verified_datasets(client):
    p = client.post("/api/projects", json={"seed": "france", "title": "France sovereign"}).json()
    ds = p["project"]["datasets"]
    assert {"ds.fr.debt", "ds.de.debt", "ds.fr.yield"} <= set(ds)
    assert all(o["evidence_id"] in p["project"]["evidence"] for o in ds["ds.fr.debt"]["observations"])
    assert p["deck"] is None and p["sidecar"]["schema"] == "frr-sidecar/1"


def test_save_load_roundtrip_and_versions(client):
    p = client.post("/api/projects", json={"seed": "france", "title": "Round trip"}).json()
    pid = p["project"]["id"]
    bundle = {k: p[k] for k in ("schema", "project", "sidecar", "journal", "threads")}
    bundle.update(deck=_deck(), sidecar={"schema": "frr-sidecar/1", "bindings": {"e_1a2b3c4d": {"kind": "decor", "slide": "s_1"}}},
                  journal=[{"seq": 1, "kind": "slide.compose", "actor": "ai"}], threads={"project": {"messages": [{"role": "user", "content": "hi"}]}})
    assert client.put(f"/api/projects/{pid}", json=bundle).status_code == 200
    back = client.get(f"/api/projects/{pid}").json()
    assert back["deck"] == bundle["deck"] and back["sidecar"] == bundle["sidecar"]
    assert back["journal"] == bundle["journal"] and back["threads"] == bundle["threads"]
    v = client.post(f"/api/projects/{pid}/versions", json={"label": "Draft 1"}).json()
    bundle["journal"].append({"seq": 2, "kind": "text.set", "actor": "user"})
    client.put(f"/api/projects/{pid}", json=bundle)
    assert len(client.get(f"/api/projects/{pid}").json()["journal"]) == 2
    assert len(client.get(f"/api/projects/{pid}/versions/{v['version']}").json()["journal"]) == 1
    assert [x["label"] for x in client.get(f"/api/projects/{pid}/versions").json()] == ["Draft 1"]


@pytest.mark.parametrize("mutate, message", [
    (lambda b: b.update(schema="other"), "bundle schema"),
    (lambda b: b["sidecar"]["bindings"].update({"sp_12": {}}), "durable element ids"),
    (lambda b: b.update(deck=base64.b64encode(b"not a zip").decode()), ".pptx"),
])
def test_invalid_bundles_are_refused_and_nothing_is_written(client, mutate, message):
    p = client.post("/api/projects", json={"seed": "blank", "title": "Guarded"}).json()
    pid = p["project"]["id"]
    bundle = {k: p[k] for k in ("schema", "project", "sidecar", "journal", "threads")} | {"deck": None}
    mutate(bundle)
    r = client.put(f"/api/projects/{pid}", json=bundle)
    assert r.status_code == 400 and message in r.json()["error"]
    assert client.get(f"/api/projects/{pid}").json()["sidecar"]["bindings"] == {}


def test_compose_writes_numbers_from_project_data(client):
    p = client.post("/api/projects", json={"seed": "france", "title": "Compose"}).json()
    slides = client.post("/api/compose", json={"project": p["project"]["id"]}).json()["slides"]
    assert [s["key"] for s in slides] == ["debt", "fiscal", "market", "ratings"]
    assert "115.7%" in slides[0]["title"] and "76 bp" in slides[2]["title"]
