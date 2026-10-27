import copy

import pytest

import slidemodel as sm

from .helpers import add_region, el

TAKEAWAYS = dict(x=427, y=451, w=823, h=150)


def codes(issues, level=None):
    return {i["code"] for i in issues if level is None or i["level"] == level}


# ---------------------------------------------------------------- built project

def test_built_project_is_valid_and_clean(project):
    assert sm.validate_project(project) == []
    assert sm.check_integrity(project) == []
    assert project["snapshot_sha256"] == sm.snapshot_hash(project)


def test_every_figure_is_bound_to_verified_evidence(project):
    bound = [i for e in project["elements"] for i in sm.bound_evidence_ids(e)]
    assert len(bound) == 27
    assert all(project["evidence"][i]["verification"] == "verified" for i in bound)
    # Bound elements store references, never the numbers themselves.
    assert "value" not in el(project, "kpi-income") and "value" not in el(project, "seg-chart")["bars"][0]


def test_geography_gap_is_a_placeholder_with_open_research_request(project):
    gap = el(project, "geo-gap")
    assert gap["type"] == "gap" and not sm.numbers_in(gap["text"])
    assert project["research_requests"][0]["gap_id"] == "gap.cr.geography"


# ---------------------------------------------------------------- integrity

def test_tampering_with_evidence_snapshot_is_an_error(project):
    project["evidence"]["ev.cr.roe.fy2025"]["value"] = 12.5
    assert "snapshot_modified" in codes(sm.check_integrity(project), "error")


def test_moving_and_restyling_does_not_affect_integrity(project):
    k = el(project, "kpi-income")
    k.update(x=900, y=600, w=250)
    k["style"]["fill"] = "#000000"
    assert sm.check_integrity(project) == []


def test_editing_cited_text_is_flagged(project):
    el(project, "owner")["text"] = "• Central Huijin Investment Ltd.: controlling shareholder"
    assert "cited_text_edited" in codes(sm.check_integrity(project), "warning")


def test_unsourced_number_in_free_text_is_flagged(project):
    project["elements"].append(dict(id="note", type="text", x=10, y=10, w=100, h=20, text="Overseas share 35%", refs={}))
    issues = sm.check_integrity(project)
    assert any(i["code"] == "unsourced_number" and i["element_id"] == "note" and "35" in i["message"] for i in issues)


def test_number_backed_by_cited_evidence_is_accepted(project):
    project["elements"].append(dict(id="note", type="text", x=10, y=10, w=100, h=20,
                                    text="Core solvency 155%", refs={"evidence": ["ev.cr.solvency_core.2025"]}))
    assert "unsourced_number" not in codes(sm.check_integrity(project))


def test_detached_value_and_removed_evidence_are_reported(project):
    roe = el(project, "kpi-roe")
    i = project["elements"].index(roe)
    project["elements"][i] = dict(id="kpi-roe", type="text", x=roe["x"], y=roe["y"], w=roe["w"], h=roe["h"],
                                  text="Weighted avg. ROE\n9.18%", refs={}, detached_from="ev.cr.roe.fy2025")
    issues = sm.check_integrity(project)
    assert {"detached_citation", "unsourced_number"} <= codes(issues, "warning")
    assert "evidence_removed" in codes(issues, "info")


def test_dangling_reference_is_an_error(project):
    el(project, "cr-table")["rows"][0]["cells"][0]["evidence_id"] = "ev.cr.missing"
    assert "dangling_ref" in codes(sm.check_integrity(project), "error")


def test_structure_errors(project):
    project["elements"].append(copy.deepcopy(el(project, "title")))
    project["elements"].append(dict(id="x", type="video", x=0, y=0, w=-5, h=10))
    errors = sm.validate_project(project)
    assert any("duplicate element id title" in e for e in errors)
    assert any("unknown type" in e for e in errors) and any("positive" in e for e in errors)


# ---------------------------------------------------------------- change requests

def test_region_scope_is_elements_intersecting_the_rectangle(project):
    rid = add_region(project, TAKEAWAYS)
    ids, rect = sm.scope_of(project, project["annotations"][-1])
    assert ids == ["takeaways-bg", "takeaways-h", "takeaways"] and rect == TAKEAWAYS
    req = sm.build_change_request(project, rid)
    assert req["scope_element_ids"] == ids
    assert set(req["evidence_in_scope"]) == {"ev.cr.controlling_shareholder", "ev.cr.solvency_core.2025",
                                             "ev.cr.solvency_agg.2025", "ev.cr.solvency_unaudited"}
    assert "Never write financial figures as text" in sm.render_prompt(req)


def card(x, y, text, refs):
    return {"op": "add", "element": {"type": "text", "x": x, "y": y, "w": 392, "h": 50, "text": text, "refs": refs}}


GRID = [
    {"op": "delete", "id": "takeaways"},
    card(446, 486, "Majority state-owned: Central Huijin is the controlling shareholder.", {"claims": ["c.cr.state_control"]}),
    card(848, 486, "Earnings softened despite top-line growth.", {"claims": ["c.cr.earnings_softer"]}),
    card(446, 542, "Overseas P&C underwriting strengthened.", {"claims": ["c.cr.underwriting_divergence"]}),
    card(848, 542, "Group solvency eased slightly in 2025 to 155% core and 189% aggregated (unaudited).",
         {"evidence": ["ev.cr.solvency_core.2025", "ev.cr.solvency_agg.2025", "ev.cr.solvency_unaudited"]}),
]


def test_valid_grid_patch_applies_and_marks_request(project):
    rid = add_region(project, TAKEAWAYS)
    errors, new = sm.validate_patch(project, rid, {"request_id": rid, "ops": GRID, "summary": "2x2"})
    assert errors == []
    added = [e for e in new["elements"] if e.get("created_by") == f"patch:{rid}"]
    assert len(added) == 4 and all(e["id"].startswith("ai-") for e in added)
    assert not any(e["id"] == "takeaways" for e in new["elements"])
    assert new["annotations"][-1]["status"] == "applied"
    assert sm.check_integrity(new) == []
    assert any(e["id"] == "takeaways" for e in project["elements"])  # input untouched


@pytest.mark.parametrize("op,expected", [
    ({"op": "update", "id": "kpi-income", "set": {"x": 500}}, "outside the request scope"),
    ({"op": "update", "id": "takeaways", "set": {"refs": {}}}, "may not change refs"),
    ({"op": "update", "id": "takeaways", "set": {"x": 20}}, "outside the request region"),
    ({"op": "update", "id": "takeaways", "set": {"text": "Solvency fell to 120%"}}, "number 120"),
    (card(10, 10, "Note", {}), "outside the request region"),
    (card(446, 486, "Overseas revenue share was 35%", {}), "number 35"),
    ({"op": "add", "element": {"type": "metric", "x": 446, "y": 486, "w": 190, "h": 80, "label": "Share",
                               "evidence_id": "ev.cr.overseas_share"}}, "unknown evidence"),
    ({"op": "add", "element": {"type": "image", "x": 446, "y": 486, "w": 100, "h": 50}}, "unsupported element type"),
    ({"op": "delete", "id": "nope"}, "unknown element"),
])
def test_unsafe_patch_ops_are_rejected(project, op, expected):
    rid = add_region(project, TAKEAWAYS)
    before = copy.deepcopy(project)
    errors, new = sm.validate_patch(project, rid, {"request_id": rid, "ops": [GRID[1], op]})
    assert new is None and any(expected in e for e in errors), errors
    assert project == before  # all-or-nothing


def test_patch_cannot_rebind_chart_or_table_figures(project):
    project["annotations"].append(dict(id="req-chart", kind="element", element_ids=["seg-chart"], instruction="x", status="open"))
    bars = copy.deepcopy(el(project, "seg-chart")["bars"])
    bars[0]["evidence_id"] = "ev.cr.total_assets.2025"
    errors, _ = sm.validate_patch(project, "req-chart", {"request_id": "req-chart", "ops": [
        {"op": "update", "id": "seg-chart", "set": {"bars": bars}}]})
    assert any("changes which evidence" in e for e in errors)
    # Relabelling and reordering the same bars is fine.
    bars = list(reversed(copy.deepcopy(el(project, "seg-chart")["bars"])))
    bars[0]["label"] = "L&H reinsurance"
    errors, new = sm.validate_patch(project, "req-chart", {"request_id": "req-chart", "ops": [
        {"op": "update", "id": "seg-chart", "set": {"bars": bars, "style": {"bar": "#c8102e"}}}]})
    assert errors == [] and el(new, "seg-chart")["bars"][0]["label"] == "L&H reinsurance"


def test_unverified_evidence_cannot_be_added_by_patch(project):
    project["evidence"]["ev.cr.roe.fy2025"]["verification"] = "unverified"
    rid = add_region(project, TAKEAWAYS)
    errors, _ = sm.validate_patch(project, rid, {"request_id": rid, "ops": [{"op": "add", "element": {
        "type": "metric", "x": 446, "y": 486, "w": 190, "h": 80, "label": "ROE", "evidence_id": "ev.cr.roe.fy2025"}}]})
    assert any("not verified" in e for e in errors)


def test_missing_data_becomes_research_request(project):
    project["annotations"].append(dict(id="req-geo", kind="element", element_ids=["geo-gap"], instruction="x", status="open"))
    errors, new = sm.validate_patch(project, "req-geo", {"request_id": "req-geo", "ops": [],
                                                          "research_requests": [{"description": "Revenue by country"}]})
    assert errors == []
    rr = new["research_requests"][-1]
    assert rr["status"] == "open" and rr["source"] == "patch:req-geo"


def test_patch_for_wrong_request_is_rejected(project):
    rid = add_region(project, TAKEAWAYS)
    errors, new = sm.validate_patch(project, rid, {"request_id": "req-other", "ops": []})
    assert new is None and any("does not match" in e for e in errors)
