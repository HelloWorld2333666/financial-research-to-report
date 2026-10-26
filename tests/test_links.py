from frr.pipeline import run
from frr.schema import Claim, SlideModule, SupportStatus
from frr.validation import validate_record

from conftest import by_id, codes


def test_demo_fixture_validates_without_errors(scope, bundle):
    record, issues = run(scope, bundle)
    assert "error" not in {i.level for i in issues}


def test_claim_support_is_computed_from_evidence(scope, bundle):
    record, _ = run(scope, bundle)
    assert by_id(record.claims, "c.fx.geography_limited").support == SupportStatus.supported
    # Reaches one unverified combined ratio through its findings.
    assert by_id(record.claims, "c.fx.capital_buffer").support == SupportStatus.partially_verified


def test_input_cannot_assert_claim_support(scope, bundle):
    bundle.claims.append(Claim(id="c.bad", statement="x", nature="interpretation",
                               evidence_ids=["ev.fx.rating"], support="supported"))
    record, _ = run(scope, bundle)
    assert by_id(record.claims, "c.bad").support == SupportStatus.unverified


def test_claim_without_evidence_is_an_error(scope, bundle):
    bundle.claims.append(Claim(id="c.orphan", statement="Unsupported view.", nature="interpretation"))
    bundle.slide_modules.append(SlideModule(id="sm.orphan", claim_ids=["c.orphan"], proof_role="x"))
    record, issues = run(scope, bundle)
    assert by_id(record.claims, "c.orphan").support == SupportStatus.unsupported
    assert {"unsupported_claim", "module_on_unsupported_claim"} <= codes(issues, "error")


def test_dangling_references_are_errors(scope, bundle):
    bundle.claims[0].evidence_ids.append("ev.does_not_exist")
    bundle.evidence[0].source_id = "src.missing"
    bundle.slide_modules[0].claim_ids.append("c.missing")
    _, issues = run(scope, bundle)
    dangling = {i.object_id for i in issues if i.code == "dangling_reference"}
    assert {bundle.claims[0].id, bundle.evidence[0].id, bundle.slide_modules[0].id} <= dangling


def test_duplicate_ids_are_errors(scope, bundle):
    bundle.evidence[1].id = bundle.evidence[0].id
    _, issues = run(scope, bundle)
    assert "duplicate_id" in codes(issues, "error")


def test_metric_evidence_requires_value_unit_period(scope, bundle):
    ev = by_id(bundle.evidence, "ev.fx.solvency.y2")
    ev.value = None
    ev.period = None
    _, issues = run(scope, bundle)
    assert "incomplete_metric" in codes(issues, "error")


def test_qualitative_evidence_cannot_carry_a_number(scope, bundle):
    by_id(bundle.evidence, "ev.fx.geography").value = 37.5
    _, issues = run(scope, bundle)
    assert "unexpected_value" in codes(issues, "error")


def test_validate_record_is_stable_on_reload(scope, bundle):
    record, issues = run(scope, bundle)
    assert validate_record(record) == issues
