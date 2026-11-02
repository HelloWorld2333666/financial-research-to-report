"""M3: integrity of the saved deck, working-data validation on save, and the export policy.

The fixture is a France deck composed by the real client (regenerate with
`WRITE_FIXTURES=1 npx vitest run src/core/m3.test.ts` in app/web).
"""

import base64
import copy
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

pytest.importorskip("starlette")
from starlette.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import composer  # noqa: E402
import evidence  # noqa: E402
import integrity  # noqa: E402
import service  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "france-bundle.json"


@pytest.fixture
def bundle() -> dict:
    return json.loads(FIXTURE.read_text())


@pytest.fixture
def client(tmp_path, bundle):
    c = TestClient(service.create_app(projects_root=tmp_path))
    pid = c.post("/api/projects", json={"seed": "france", "title": "M3 test"}).json()["meta"]["id"]
    bundle["project"]["id"] = pid
    assert c.put(f"/api/projects/{pid}", json=bundle).status_code == 200
    return c, pid


def deck(b: dict) -> bytes:
    return base64.b64decode(b["deck"])


def test_server_reads_the_saved_deck_like_the_client(bundle):
    r = integrity.check(deck(bundle), bundle["project"], bundle["sidecar"])
    assert r["ok"] and (r["bindings"], r["resolved"], r["points"], r["cells"]) == (30, 30, 32, 12)
    assert (r["figures"], r["sourced"], r["unsourced"]) == (14, 14, [])
    assert len(r["placeholders"]) == 1 and r["unverified"] == []


def test_edited_value_under_a_table_and_a_sentence(bundle):
    p = bundle["project"]
    p["datasets"]["ds.fr.interest"]["working"]["2025"] = {"value": 2.3, "by": "you", "at": "2026-11-02T10:00:00Z", "status": "manual_unverified"}
    r = integrity.check(deck(bundle), p, bundle["sidecar"])
    assert sorted(m["detail"] for m in r["mismatch"]) == ['ds.fr.interest 2025: data "2.3 ✎", table "2.2"', "text says 2.2, data now 2.3"]
    assert len(r["unverified"]) == 1


def test_derivation_is_recomputed_from_working_inputs(bundle):
    p = bundle["project"]
    d = p["derivations"]["der.frde.spread.2025"]
    assert d["formula"] == "(own - peer) * 100" and integrity.current_value(p, {"derivation": d["id"]}) == 76
    own = integrity.evidence_index(p)[d["inputs"]["own"]]
    p["datasets"][own[0]]["working"][own[1]] = {"value": 3.6, "by": "you", "at": "2026-11-02T10:00:00Z", "status": "manual_unverified"}
    assert integrity.current_value(p, {"derivation": d["id"]}) == 101


def test_figures_skip_years_tenors_and_identifiers():
    assert [f[0] for f in integrity.figures("Growth 0.8% in 2025; 10-year spread 76 bp (gov_10dd_edpt1), +4.3 pp, −5.1%")] == ["0.8", "76", "+4.3", "−5.1"]


def test_python_and_client_formatting_agree(bundle):
    p = bundle["project"]
    assert [integrity.cell_text(p, "ds.fr.interest", y) for y in ("2023", "2024", "2025")] == ["1.9", "2.0", "2.2"]
    assert integrity.cell_text(p, "ds.fr.yield", "2025") == "3.35"


def test_composer_numbers_all_resolve_against_the_seed():
    p = evidence.seed_project("france", "t", "t")
    slides = composer.compose(p)
    p["derivations"] = {d["id"]: d for s in slides for d in s["derivations"]}
    refs = [n for s in slides for ns in s["numbers"].values() for n in ns]
    assert len(refs) == 14
    for n in refs:
        v = integrity.current_value(p, n)
        f = integrity.figures(n["text"])[0]
        assert v is not None and abs(v - f[1]) <= 0.5 * 10 ** -f[2] + 1e-9, n


def test_save_refuses_unauditable_working_data(client, bundle):
    c, pid = client
    b = c.get(f"/api/projects/{pid}").json()
    for bad, msg in [({"value": "1", "by": "x", "at": "t", "status": "manual_unverified"}, "numeric value"),
                     ({"value": 1, "at": "t", "status": "manual_unverified"}, "who"),
                     ({"value": 1, "by": "x", "at": "t", "status": "approved"}, "status"),
                     ({"value": 1, "by": "x", "at": "t", "status": "verified"}, "verified_by")]:
        bb = copy.deepcopy(b)
        bb["project"]["datasets"]["ds.fr.debt"]["working"]["2025"] = bad
        r = c.put(f"/api/projects/{pid}", json=bb)
        assert r.status_code == 400 and msg in r.json()["error"], (bad, r.json())


def test_save_reports_server_integrity(client):
    c, pid = client
    b = c.get(f"/api/projects/{pid}").json()
    r = c.put(f"/api/projects/{pid}", json=b).json()
    assert r["integrity"]["ok"] and r["integrity"]["points"] == 32 and r["integrity"]["placeholders"] == 1


def test_server_catches_data_saved_without_reprojection(client):
    """A client that changes data but not the deck cannot get a final export, whatever it acknowledges."""
    c, pid = client
    b = c.get(f"/api/projects/{pid}").json()
    b["project"]["datasets"]["ds.de.interest"]["working"]["2023"] = {"value": 1.0, "by": "you", "at": "2026-11-02T10:00:00Z", "status": "manual_unverified"}
    assert c.put(f"/api/projects/{pid}", json=b).json()["integrity"]["ok"] is False
    pol = c.get(f"/api/projects/{pid}/export").json()
    assert [a["key"] for a in pol["acknowledge"]] == ["edits", "placeholders"]
    assert [i["detail"] for i in pol["blocking"][0]["items"]] == ['ds.de.interest 2023: data "1.0 ✎", table "0.9"']
    r = c.post(f"/api/projects/{pid}/export", json={"mode": "final", "acknowledged": ["edits", "placeholders"]})
    assert r.status_code == 409 and "disagrees" in r.json()["error"]


def test_export_flow_on_a_consistent_deck(client):
    c, pid = client
    pol = c.get(f"/api/projects/{pid}/export").json()
    assert pol["blocking"] == [] and [a["key"] for a in pol["acknowledge"]] == ["placeholders"]
    r = c.post(f"/api/projects/{pid}/export", json={"mode": "final", "acknowledged": []})
    assert r.status_code == 409 and "placeholder" in r.json()["error"]
    r = c.post(f"/api/projects/{pid}/export", json={"mode": "final", "acknowledged": ["placeholders"]})
    assert r.status_code == 201 and r.json()["acknowledged"][0]["key"] == "placeholders" and not r.json()["draft_banner"]
    f = c.get(r.json()["url"])
    assert f.status_code == 200 and f.content[:2] == b"PK" and b"Draft banner" not in f.content
    d = c.post(f"/api/projects/{pid}/export", json={"mode": "draft"}).json()
    z = zipfile.ZipFile(io.BytesIO(c.get(d["url"]).content))
    slides = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    assert d["draft_banner"] and all(b"Draft banner" in z.read(n) for n in slides)
    for n in z.namelist():
        if n.endswith(".xml"):
            ET.fromstring(z.read(n))
    log = c.get(f"/api/projects/{pid}/export").json()["exports"]
    assert [x["mode"] for x in log] == ["final", "draft"]
    assert c.post(f"/api/projects/{pid}/export", json={"mode": "publish"}).status_code == 409
    assert c.get(f"/api/projects/{pid}/exports/..%2Fcurrent%2Fdeck.pptx").status_code in (400, 404)


def test_integrity_mismatch_blocks_final_but_not_draft(client):
    c, pid = client
    b = c.get(f"/api/projects/{pid}").json()
    g = b["project"]["datasets"]["ds.fr.growth"]
    g["working"]["2025"] = {"value": 9.9, "by": "you", "at": "2026-11-02T10:00:00Z", "status": "verified", "verified_by": "you", "verified_at": "2026-11-02T10:01:00Z"}
    c.put(f"/api/projects/{pid}", json=b)
    pol = c.get(f"/api/projects/{pid}/export").json()
    assert pol["blocking"][0]["key"] == "integrity" and any(i["detail"] == "text says 0.8, data now 9.9" for i in pol["blocking"][0]["items"])
    assert c.post(f"/api/projects/{pid}/export", json={"mode": "final", "acknowledged": ["placeholders", "numbers", "edits"]}).status_code == 409
    assert c.post(f"/api/projects/{pid}/export", json={"mode": "draft"}).json()["draft_banner"]
