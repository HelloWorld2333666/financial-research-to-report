"""Structural checks on the hand-built real China Re bundle (no PDFs or network needed)."""
from pathlib import Path

import pytest

from frr.pipeline import format_value, load_bundle, render_summary, run
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


def test_real_bundle_accepts_aliases_and_rejects_other_insurers(real):
    for name in ("China Re", "China Reinsurance Group"):
        run(Scope(company=name, objective="Assess the credit profile.", sector="insurance"), real)
    with pytest.raises(ValueError):
        run(Scope(company="AIA Group Limited", objective="Assess the credit profile.", sector="insurance"), real)


def test_summary_shows_exact_values_and_subjects(real_run):
    record, issues = real_run
    summary = render_summary(record, issues)
    assert "e+0" not in summary
    assert "| ev.cr.total_income.fy2025 | m.revenue | Group | FY2025 | 124,927,594 | RMB thousand |" in summary
    assert "| P&C reinsurance segment | FY2025 | 45,812 | RMB million |" in summary
    assert "| Life and health reinsurance segment | FY2025 | 10,088 |" in summary


@pytest.mark.parametrize("value,text", [(124927594.0, "124,927,594"), (9.18, "9.18"), (189.0, "189"),
                                        (95.98, "95.98"), (1234567.25, "1,234,567.25"), (None, "—")])
def test_format_value_is_exact(value, text):
    assert format_value(value) == text
