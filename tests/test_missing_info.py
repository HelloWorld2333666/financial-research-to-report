from frr.pipeline import run
from frr.schema import EvidenceBundle, QuestionStatus

from conftest import by_id, codes


def test_unresearched_questions_and_metrics_become_gaps(scope, bundle):
    record, _ = run(scope, bundle)
    gap_ids = {g.id for g in record.gaps}
    assert {"gap.auto.q.risks", "gap.auto.m.roe", "gap.auto.m.total_assets"} <= gap_ids
    assert by_id(record.questions, "q.risks").status == QuestionStatus.open


def test_explicit_gaps_are_kept_and_not_duplicated(scope, bundle):
    record, _ = run(scope, bundle)
    country = by_id(record.gaps, "gap.fx.country_split")
    assert country.reason.value == "not_disclosed" and not country.auto_detected
    assert not any(g.auto_detected and "q.business_mix" in g.question_ids for g in record.gaps)


def test_unverified_evidence_prevents_answered_status(scope, bundle):
    record, _ = run(scope, bundle)
    # q.ratings is covered only by an unverified rating quote.
    assert by_id(record.questions, "q.ratings").status == QuestionStatus.partially_answered
    assert by_id(record.questions, "q.capital").status == QuestionStatus.partially_answered
    assert any(g.reason.value == "needs_verification" for g in record.gaps)


def test_empty_bundle_produces_only_gaps_and_no_claims(scope):
    empty = EvidenceBundle(mode="offline_fixture", description="nothing collected")
    record, issues = run(scope, empty)
    assert record.claims == [] and record.evidence == []
    assert all(q.status == QuestionStatus.open for q in record.questions)
    assert {q.id for q in record.questions} <= {qid for g in record.gaps for qid in g.question_ids}
    assert "error" not in {i.level for i in issues}
    assert "silent_question" not in codes(issues)
