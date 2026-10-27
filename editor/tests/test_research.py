import copy
import json
from pathlib import Path

import pytest

import research as rs
import slidemodel as sm

from .helpers import el

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "research_responses"
REGION = dict(x=32, y=513, w=384, h=84)
GEO = ("Add a horizontal bar chart showing China Re's revenue distribution by country or region. Please research "
       "the necessary figures. Use FY2025 data if available, and do not estimate undisclosed country-level values.")
TIMELINE = ("Add a timeline of China Re's major corporate milestones, including its establishment, listing, and "
            "significant business developments. Research and verify the relevant dates.")


def fixture(name, request_id):
    resp = json.loads((FIXTURES / f"{name}.json").read_text())
    resp["request_id"] = request_id
    return resp


@pytest.fixture
def pending(project):
    project["elements"] = [e for e in project["elements"] if e["id"] != "geo-gap"]
    new, req = rs.create_request(project, GEO, REGION)
    return new, req


# ---------------------------------------------------------------- classification

@pytest.mark.parametrize("text,intent", [
    (GEO, "research"),
    (TIMELINE, "research"),
    ("Add a timeline of corporate milestones", "existing_data"),
    ("Add a 2×2 financial metrics section here", "existing_data"),
    ("Add a bar chart of combined ratio by segment", "existing_data"),
    ("Reorganize these three blocks into two columns", "layout"),
    ("Make this panel smaller and move it left", "layout"),
])
def test_classify_intent(project, text, intent):
    assert rs.classify(project, text)["intent"] == intent


def test_classify_extracts_request_details(project):
    c = rs.classify(project, GEO)
    assert c["content_type"] == "barchart" and c["period"] == "FY2025" and c["geographic_scope"] == "country"
    assert c["excludes_estimates"] and c["uncovered_topics"] == ["geography"]
    assert c["related_gaps"] == ["gap.cr.geography"]
    t = rs.classify(project, TIMELINE)
    assert t["matched_evidence"]["history"] == ["ev.cr.history", "ev.cr.listing"]  # reused, not re-researched
    assert t["uncovered_topics"] == ["business_developments"]


# ---------------------------------------------------------------- request creation

def test_create_request_adds_structured_request_and_placeholder(project, pending):
    new, req = pending
    assert req["schema"] == rs.REQUEST_SCHEMA and req["status"] == "pending_research"
    assert req["region"] == REGION and req["company"] == "China Reinsurance (Group) Corporation"
    assert req["content_type"] == "barchart" and req["visualization"] == "horizontal bar chart"
    assert "Do not estimate undisclosed values." in req["constraints"]
    assert req["required_data"] == ["geography data (country level), FY2025"]
    ph = el(new, req["placeholder_element_id"])
    assert ph["type"] == "pending" and (ph["x"], ph["y"], ph["w"], ph["h"]) == (32, 513, 384, 84)
    assert [i["code"] for i in sm.check_integrity(new)] == ["pending_research"]
    assert sm.validate_project(new) == []


@pytest.mark.parametrize("instruction,region", [("", REGION), ("Add a chart", dict(x=0, y=0, w=4, h=4)), ("Add", {})])
def test_create_request_rejects_bad_input(project, instruction, region):
    with pytest.raises(ValueError):
        rs.create_request(project, instruction, region)


def test_export_request_is_a_complete_handoff(pending):
    new, req = pending
    h = rs.export_request(new, req["id"])
    assert h["response_schema"] == rs.RESPONSE_SCHEMA and set(h["related_evidence"]) == set(req["related_evidence_ids"])
    assert "ev.cr.roe.fy2025" in h["existing_evidence_ids"]


# ---------------------------------------------------------------- responses

def test_fulfilled_response_inserts_chart_with_provenance(project, pending):
    new, req = pending
    errors, warnings, done = rs.apply_response(new, fixture("test_fixture_geo_region_fulfilled", req["id"]))
    assert errors == [] and any("TEST FIXTURE" in w for w in warnings)
    r = next(x for x in done["research_requests"] if x["id"] == req["id"])
    chart = el(done, r["inserted_element_id"])
    assert chart["type"] == "barchart" and (chart["x"], chart["y"], chart["w"], chart["h"]) == (32, 513, 384, 84)
    evmap = sm.evidence_map(done)
    for bar in chart["bars"]:
        e = evmap[bar["evidence_id"]]
        assert e["unit"] == "RMB billion (synthetic)" and e["period"] == "FY2025" and e["source_id"] == "src.fx.engine_test"
    assert r["status"] == "fulfilled" and [h["event"] for h in r["history"]] == ["created", "response:fulfilled"]
    # Rest of the slide and the bundle snapshot are untouched.
    others = lambda p: [e for e in p["elements"] if e["id"] not in (chart["id"], req["placeholder_element_id"])]
    assert others(done) == others(new)
    assert done["evidence"] == new["evidence"] and done["snapshot_sha256"] == sm.snapshot_hash(done)
    assert {i["code"] for i in sm.check_integrity(done)} == {"fixture_data_on_slide"}


def test_not_available_response_creates_no_chart(pending):
    new, req = pending
    errors, _, done = rs.apply_response(new, fixture("test_fixture_geo_country_not_available", req["id"]))
    assert errors == []
    ph = el(done, req["placeholder_element_id"])
    assert ph["type"] == "pending" and ph["state"] == "not_available" and "Suggested alternative" in ph["text"]
    assert [e["id"] for e in done["elements"] if e["type"] == "barchart"] == ["seg-chart"]
    r = next(x for x in done["research_requests"] if x["id"] == req["id"])
    assert r["status"] == "not_available" and r["unresolved"][0]["alternative"]
    assert [i["code"] for i in sm.check_integrity(done)] == ["research_not_available"]


def test_revert_restores_placeholder_and_keeps_history(pending):
    new, req = pending
    _, _, done = rs.apply_response(new, fixture("test_fixture_geo_region_fulfilled", req["id"]))
    back = rs.revert_insertion(done, req["id"])
    r = next(x for x in back["research_requests"] if x["id"] == req["id"])
    assert r["status"] == "pending_research" and [h["event"] for h in r["history"]] == ["created", "response:fulfilled", "reverted"]
    assert el(back, req["placeholder_element_id"])["state"] == "pending_research"
    assert "ev.fx.geo.region_a.fy2025" not in sm.evidence_map(back)  # reverted evidence no longer active
    assert back["research_results"][0]["reverted"] is True
    # A new response can now be applied to the reopened request.
    errors, _, again = rs.apply_response(back, fixture("test_fixture_geo_country_not_available", req["id"]))
    assert errors == [] and again is not None


def mutate(resp, fn):
    resp = copy.deepcopy(resp)
    fn(resp)
    return resp


@pytest.mark.parametrize("change,expected", [
    (lambda r: r["evidence"].__setitem__(0, {**r["evidence"][0], "id": "ev.cr.roe.fy2025"}), "may not overwrite existing evidence"),
    (lambda r: r["evidence"][0].__setitem__("verification", "unverified"), "is not verified"),
    (lambda r: r["evidence"][0].__setitem__("unit", "USD billion"), "not comparable"),
    (lambda r: r["evidence"][1].__setitem__("period", "FY2024"), "not comparable"),
    (lambda r: r["evidence"][0].pop("value"), "missing value"),
    (lambda r: r["evidence"][0].__setitem__("source_id", "src.nowhere"), "unknown source"),
    (lambda r: r["visualization"].__setitem__("title", "Region A grew 42% in FY2025"), "number 42"),
    (lambda r: r["visualization"]["items"].append({"label": "X", "evidence_id": "ev.fx.missing"}), "unknown evidence"),
    (lambda r: r.__setitem__("visualization", None), "needs a visualization"),
    (lambda r: r.__setitem__("schema", "other"), "response schema"),
    (lambda r: r.__setitem__("request_id", "rr-unknown"), "unknown research request"),
])
def test_unsafe_responses_are_rejected(pending, change, expected):
    new, req = pending
    before = copy.deepcopy(new)
    resp = mutate(fixture("test_fixture_geo_region_fulfilled", req["id"]), change)
    errors, _, done = rs.apply_response(new, resp)
    assert done is None and any(expected in e for e in errors), errors
    assert new == before


def test_not_available_with_chart_is_rejected(pending):
    new, req = pending
    resp = fixture("test_fixture_geo_country_not_available", req["id"])
    resp["visualization"] = fixture("test_fixture_geo_region_fulfilled", req["id"])["visualization"]
    errors, _, done = rs.apply_response(new, resp)
    assert done is None and any("must not include a visualization" in e for e in errors)


def test_response_from_existing_evidence_needs_no_new_research(project):
    new, req = rs.create_request(project, "Add a timeline of corporate milestones", dict(x=432, y=456, w=816, h=140))
    resp = {"schema": rs.RESPONSE_SCHEMA, "request_id": req["id"], "status": "fulfilled", "sources": [], "evidence": [],
            "visualization": {"type": "timeline", "title": "Corporate milestones", "events": [
                {"label": "Oct 1949", "text": "Origin in the People's Insurance Company of China", "evidence_id": "ev.cr.history"},
                {"label": "Oct 2007", "text": "Restructured into a joint-stock company", "evidence_id": "ev.cr.history"},
                {"label": "26 Oct 2015", "text": "Listed on the HKEX Main Board", "evidence_id": "ev.cr.listing"}]}}
    errors, _, done = rs.apply_response(new, resp)
    assert errors == []
    tl = el(done, next(x for x in done["research_requests"] if x["id"] == req["id"])["inserted_element_id"])
    assert tl["type"] == "timeline" and tl["refs"]["evidence"] == ["ev.cr.history", "ev.cr.history", "ev.cr.listing"]
    assert sm.check_integrity(done) == []
    bad = copy.deepcopy(resp)
    bad["visualization"]["events"][0]["label"] = "Oct 1952"  # a date the evidence does not support
    errors, _, _ = rs.apply_response(new, bad)
    assert any("number 1952" in e for e in errors)


def test_tampering_with_stored_response_is_detected(pending):
    new, req = pending
    _, _, done = rs.apply_response(new, fixture("test_fixture_geo_region_fulfilled", req["id"]))
    done["research_results"][0]["response"]["evidence"][0]["value"] = 99.0
    assert "research_result_modified" in {i["code"] for i in sm.check_integrity(done)}
