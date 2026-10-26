"""Structural checks on the hand-built real China Re bundle (no PDFs or network needed)."""
from pathlib import Path

import pytest

from frr.pipeline import load_bundle, run
from frr.schema import QuestionStatus, Scope, SupportStatus

from conftest import by_id

BUNDLE = Path(__file__).resolve().parents[1] / "research" / "china_re" / "fy2025_bundle.json"


@pytest.fixture
def real():
    return load_bundle(BUNDLE)


@pytest.fixture
def real_run(real):
    scope = Scope(company="China Reinsurance (Group) Corporation",
                  objective="Assess business profile, financial strength and key credit risks.",
                  sector="insurance", period="FY2024-FY2025")
    return run(scope, real)


def test_bundle_is_live_with_hashed_retrieved_sources(real):
    assert real.mode.value == "live"
    assert all(s.origin.value == "retrieved" and s.content_sha256 and s.url for s in real.sources)


def test_every_evidence_item_is_checkable_and_attributed(real):
    for e in real.evidence:
        assert e.page and e.excerpt and e.locator, e.id
        assert e.verification.value == "verified" and e.verified_by and e.verified_on, e.id


def test_pipeline_has_no_errors_or_warnings(real_run):
    _, issues = real_run
    assert issues == []


def test_all_claims_supported_and_modules_linked(real_run):
    record, _ = real_run
    assert all(c.support == SupportStatus.supported for c in record.claims)
    claim_ids = {c.id for c in record.claims}
    assert all(set(m.claim_ids) <= claim_ids for m in record.slide_modules)


def test_documented_gaps_keep_questions_partially_answered(real_run):
    record, _ = real_run
    assert by_id(record.gaps, "gap.cr.geography").reason.value == "not_found"
    for qid in ("q.business_mix", "q.capital", "q.ratings", "q.risks", "q.ownership"):
        assert by_id(record.questions, qid).status == QuestionStatus.partially_answered, qid
    assert by_id(record.questions, "q.performance").status == QuestionStatus.answered


def test_metric_periods_and_subjects_are_explicit(real):
    for e in real.evidence:
        if e.kind.value == "metric_value":
            assert e.period and e.subject and e.unit, e.id
