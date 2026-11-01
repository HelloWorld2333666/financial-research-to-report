import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("starlette")
from starlette.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service  # noqa: E402


def test_health_reports_schema_and_pinned_genoffice():
    r = TestClient(service.create_app(Path("/nonexistent"))).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    manifest = json.loads(service.MANIFEST.read_text())
    assert body["ok"] and body["genoffice_commit"] == manifest["commit"]
    assert body["evidence_schema"]


def test_serves_built_web_client(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title>")
    r = TestClient(service.create_app(tmp_path)).get("/")
    assert r.status_code == 200 and "<title>t</title>" in r.text


def test_manifest_pins_files_with_hashes():
    manifest = json.loads(service.MANIFEST.read_text())
    assert len(manifest["commit"]) == 40
    assert all(len(h) == 64 for h in manifest["files"].values())
    assert {"LICENSE", "NOTICE"} <= set(manifest["files"])
    assert not any(p.startswith("ee/") for p in manifest["files"]), "enterprise-licensed code must never be vendored"
