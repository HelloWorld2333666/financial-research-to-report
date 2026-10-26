import copy

import pytest

import research as rs
import slidemodel as sm
import transfer as tf

from .helpers import el

GEO = "Turn this into a separate page focused on geographic exposure, and add a regional bar chart."


@pytest.fixture
def deck(project):
    """The overview slide plus two blank pages."""
    p, s2 = sm.add_slide(project, "Underwriting & capital")
    p, s3 = sm.add_slide(p, "Geographic exposure")
    return p, s2, s3


def on(project, slide_id):
    return {e["id"] for e in sm.slide_elements(project, slide_id)}


# ---------------------------------------------------------------- multi-slide model

def test_legacy_single_slide_project_is_migrated(project):
    legacy = copy.deepcopy(project)
    legacy["schema"] = sm.LEGACY_SCHEMA
    for key in ("slides", "transfer_requests"):
        legacy.pop(key)
    for e in legacy["elements"]:
        e.pop("slide_id")
    up = sm.migrate(legacy)
    assert up["schema"] == sm.SCHEMA and sm.slide_ids(up) == ["china_re_overview"]
    assert all(e["slide_id"] == "china_re_overview" for e in up["elements"])
    assert sm.validate_project(up) == [] and sm.check_integrity(up) == []


def test_add_duplicate_delete_slides(deck):
    p, s2, s3 = deck
    assert [s["title"] for s in p["slides"]] == ["Company overview", "Underwriting & capital", "Geographic exposure"]
    assert {e["type"] for e in sm.slide_elements(p, s2)} == {"text", "sources"}  # title + per-slide source line
    d, s4 = sm.duplicate_slide(p, "overview")
    assert sm.slide_ids(d)[1] == s4 and len(sm.slide_elements(d, s4)) == len(sm.slide_elements(p, "overview"))
    copies = sm.slide_elements(d, s4)
    assert not on(d, s4) & on(d, "overview")  # new ids
    assert next(c for c in copies if c["type"] == "metric")["evidence_id"].startswith("ev.cr.")  # same bindings
    assert sm.validate_project(d) == [] and sm.check_integrity(d) == []
    gone = sm.delete_slide(d, s4)
    assert sm.slide_ids(gone) == sm.slide_ids(p) and gone["elements"] == p["elements"]
    with pytest.raises(ValueError, match="at least one slide"):
        sm.delete_slide({**p, "slides": p["slides"][:1]}, "overview")


def test_element_on_unknown_slide_is_invalid(deck):
    p, _, _ = deck
    el(p, "kpi-roe")["slide_id"] = "nowhere"
    assert any("kpi-roe: slide_id" in e for e in sm.validate_project(p))


def test_region_scope_stays_on_its_slide(deck):
    p, s2, _ = deck
    p["annotations"].append(dict(id="req-s2", kind="region", slide_id=s2, rect=dict(x=0, y=0, w=1280, h=720),
                                 instruction="x", status="open"))
    ids, _ = sm.scope_of(p, p["annotations"][-1])
    assert set(ids) == on(p, s2)


# ---------------------------------------------------------------- literal transfers

def test_move_as_is_keeps_ids_bindings_and_geometry(deck):
    p, s2, _ = deck
    before = copy.deepcopy(el(p, "solv-table"))
    new, res = tf.transfer(p, ["solv-table"], s2, "move")
    moved = el(new, "solv-table")
    assert moved["slide_id"] == s2 and res["element_ids"] == ["solv-table"] and res["transfer_request"] is None
    assert {k: v for k, v in moved.items() if k != "slide_id"} == {k: v for k, v in before.items() if k != "slide_id"}
    assert new["transfer_requests"] == [] and sm.check_integrity(new) == []
    assert p == deck[0]  # input untouched


def test_group_travels_together_and_avoids_overlap(deck):
    p, s2, _ = deck
    new, res = tf.transfer(p, ["owner"], s2, "move", drop={"x": 640, "y": 40})  # dropped on the title band
    assert set(res["module_ids"]) == {"owner-bg", "owner-h", "owner"}
    bg = el(new, "owner-bg")
    assert bg["y"] >= tf.CONTENT["y"]  # moved to free space, not over the title
    title = next(e for e in sm.slide_elements(new, s2) if e["type"] == "text" and e["id"] not in res["module_ids"])
    assert not sm._intersects(bg, title)
    # relative layout inside the module is preserved
    assert el(new, "owner")["x"] - bg["x"] == el(p, "owner")["x"] - el(p, "owner-bg")["x"]


def test_copy_as_is_into_new_slide(deck):
    p, _, _ = deck
    new, res = tf.transfer(p, ["cr-table"], None, "copy", new_slide_title="Combined ratio detail")
    sid = res["target_slide_id"]
    assert res["created_slide"] and sm.slide_ids(new).index(sid) == 1  # inserted after the source slide
    assert sm.slide_title(new, sid) == "Combined ratio detail"
    c = el(new, res["element_ids"][0])
    assert c["origin"] == {"element_id": "cr-table", "slide_id": "overview", "via": "copy"}
    assert sm.bound_evidence_ids(c) == sm.bound_evidence_ids(el(new, "cr-table"))
    assert c["refs"] == el(new, "cr-table")["refs"]  # claims and evidence links kept, not flattened
    assert sm.validate_project(new) == [] and sm.check_integrity(new) == []


@pytest.mark.parametrize("ids,target,mode,msg", [
    ([], "s", "move", "at least one module"),
    (["nope"], "s", "move", "unknown element"),
    (["sources"], "s", "move", "source line"),
    (["kpi-roe"], "overview", "move", "different slide"),
    (["kpi-roe"], "s-unknown", "move", "unknown slide"),
    (["kpi-roe"], "s", "teleport", "unknown transfer mode"),
])
def test_invalid_transfers_are_rejected(deck, ids, target, mode, msg):
    p, s2, _ = deck
    with pytest.raises(ValueError, match=msg):
        tf.transfer(p, ids, s2 if target == "s" else target, mode)


# ---------------------------------------------------------------- adaptive transfers

def test_move_and_adapt_creates_structured_request(deck):
    p, s2, _ = deck
    new, res = tf.transfer(p, ["kpi-roe"], s2, "move_adapt",
                           instruction="Keep the evidence, but rewrite the message for the capital discussion.")
    req = res["transfer_request"]
    assert req["schema"] == tf.TRANSFER_SCHEMA and req["status"] == "pending_adaptation" and req["mode"] == "move_adapt"
    assert req["source_slide_id"] == "overview" and req["target_slide_id"] == s2 and not req["target_is_new_slide"]
    assert req["module_ids"] == ["kpi-roe"] and req["target_element_ids"] == ["kpi-roe"]
    assert req["linked"]["evidence_ids"] == ["ev.cr.roe.fy2024", "ev.cr.roe.fy2025"]
    assert req["linked"]["metric_ids"] == ["m.roe"] and req["linked"]["source_ids"]
    assert req["module_snapshots"][0]["evidence_id"] == "ev.cr.roe.fy2025" and req["created"]
    assert req["classification"]["intent"] == "layout" and req["research_request_ids"] == []
    assert el(new, "kpi-roe")["transfer_id"] == req["id"] and new["transfer_requests"] == [req]
    assert [i["code"] for i in sm.check_integrity(new)] == ["pending_adaptation"]


def test_table_to_new_page_with_missing_chart_adds_research_placeholder(deck):
    p, _, s3 = deck
    new, res = tf.transfer(p, ["cr-table"], s3, "move_adapt", instruction=GEO)
    req = res["transfer_request"]
    assert req["classification"]["intent"] == "research" and req["classification"]["uncovered_topics"] == ["geography"]
    [rid] = req["research_request_ids"]
    rr = next(r for r in new["research_requests"] if r["id"] == rid)
    assert rr["schema"] == rs.REQUEST_SCHEMA and rr["slide_id"] == s3 and rr["transfer_id"] == req["id"]
    ph = el(new, rr["placeholder_element_id"])
    assert ph["slide_id"] == s3 and ph["type"] == "pending" and ph["title"].startswith("Pending research")
    assert rr["placeholder_element_id"] in req["placeholder_element_ids"]
    # the placeholder does not cover the moved table or the slide frame
    others = [e for e in sm.slide_elements(new, s3) if e["id"] != ph["id"]]
    assert not any(sm._intersects(ph, e) for e in others)
    assert sm.validate_project(new) == []


def test_exhibit_covered_by_existing_evidence_gets_pending_chart(deck):
    p, s2, _ = deck
    new, res = tf.transfer(p, ["solv-table"], s2, "move_adapt",
                           instruction="Add a bar chart of combined ratio by segment next to it")
    req = res["transfer_request"]
    assert req["research_request_ids"] == [] and len(req["placeholder_element_ids"]) == 1
    ph = el(new, req["placeholder_element_ids"][0])
    assert ph["state"] == "pending_adaptation" and ph["title"].startswith("Pending horizontal bar chart")
    assert "ev.cr.cr.primary_pc.fy2025" in ph["refs"]["evidence"]


@pytest.mark.parametrize("mode,title", [("use_as_evidence", "Pending AI adaptation"), ("summarise", "Pending summary")])
def test_source_kept_modes_insert_linked_placeholder(deck, mode, title):
    p, _, _ = deck
    new, res = tf.transfer(p, ["takeaways"], None, mode)
    req = res["transfer_request"]
    assert req["source_kept"] and req["target_is_new_slide"] and {"takeaways-bg", "takeaways-h", "takeaways"} <= on(new, "overview")
    ph = el(new, req["placeholder_element_ids"][0])
    assert ph["title"].startswith(title) and ph["text"] == tf.MODES[mode]["intent"]
    assert ph["refs"]["claims"] == req["linked"]["claim_ids"] and "c.cr.state_control" in ph["refs"]["claims"]
    assert "ev.cr.solvency_core.2025" in ph["refs"]["evidence"]
    assert sm.validate_project(new) == []


def test_split_moves_modules_and_flags_them(deck):
    p, s2, _ = deck
    new, res = tf.transfer(p, ["cr-table"], s2, "split", instruction="One card per segment")
    assert el(new, "cr-table")["slide_id"] == s2 and el(new, "cr-table")["transfer_id"] == res["transfer_request"]["id"]


def test_moving_a_research_placeholder_moves_its_request(deck):
    p, s2, _ = deck
    p, req = rs.create_request(p, "Add revenue by country chart; research FY2025", dict(x=32, y=513, w=384, h=84))
    new, _ = tf.transfer(p, [req["placeholder_element_id"]], s2, "move")
    assert next(r for r in new["research_requests"] if r["id"] == req["id"])["slide_id"] == s2
    with pytest.raises(ValueError, match="move them instead"):
        tf.transfer(p, [req["placeholder_element_id"]], s2, "copy")


def test_cancel_removes_placeholders_and_keeps_modules(deck):
    p, _, s3 = deck
    new, res = tf.transfer(p, ["cr-table"], s3, "move_adapt", instruction=GEO)
    tid = res["transfer_request"]["id"]
    back = tf.cancel_transfer(new, tid)
    t = back["transfer_requests"][0]
    assert t["status"] == "cancelled" and [h["event"] for h in t["history"]] == ["created", "cancelled"]
    assert on(back, s3) == on(p, s3) | {"cr-table"} and "transfer_id" not in el(back, "cr-table")
    rr = next(r for r in back["research_requests"] if r["id"] == t["research_request_ids"][0])
    assert rr["status"] == "closed"
    assert sm.check_integrity(back) == []
    with pytest.raises(ValueError):
        tf.cancel_transfer(back, tid)


def test_export_is_a_complete_handoff(deck):
    p, _, s3 = deck
    new, res = tf.transfer(p, ["cr-table"], s3, "move_adapt", instruction=GEO)
    h = tf.export_transfer(new, res["transfer_request"]["id"])
    assert set(h["evidence"]) == set(h["linked"]["evidence_ids"]) and "c.cr.underwriting_divergence" in h["claims"]
    assert h["research_requests"][0]["status"] == "pending_research" and h["rules"]
    assert {e["id"] for e in h["target_slide"]["elements"]} == on(new, s3)


def test_preview_does_not_change_the_project(deck):
    p, s2, _ = deck
    before = copy.deepcopy(p)
    pv = tf.preview(p, ["owner"], s2, "move_adapt", GEO)
    assert pv["ok"] and set(pv["module_ids"]) == {"owner-bg", "owner-h", "owner"}
    assert pv["placeholders"][0].startswith("Pending research") and "c.cr.state_control" in pv["linked"]["claim_ids"]
    assert tf.preview(p, ["sources"], s2, "move")["ok"] is False
    assert p == before
