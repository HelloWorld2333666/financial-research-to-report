import pytest
from pydantic import ValidationError

from frr.pipeline import run
from frr.schema import Evidence, ResearchRecord, Scope, Source


def test_fixture_bundle_loads_and_is_marked_as_fixture(bundle):
    assert bundle.mode.value == "offline_fixture"
    assert bundle.sources and all(s.origin.value == "fixture" for s in bundle.sources)
    assert all(s.title.startswith("[SYNTHETIC FIXTURE]") for s in bundle.sources)


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        Source(id="s", title="t", publisher="p", source_type="news", origin="retrieved", rating="AAA")


def test_invalid_enum_is_rejected():
    with pytest.raises(ValidationError):
        Evidence(id="e", source_id="s", kind="rumour", statement="x")


@pytest.mark.parametrize("company,objective", [
    ("", "Assess the credit profile."),
    ("X", "Assess the credit profile."),
    ("Some Company", "short"),
    ("   ", "Assess the credit profile."),
])
def test_scope_rejects_empty_or_too_short_inputs(company, objective):
    with pytest.raises(ValidationError):
        Scope(company=company, objective=objective)


def test_record_round_trips_through_json(scope, bundle):
    record, _ = run(scope, bundle)
    again = ResearchRecord.model_validate_json(record.model_dump_json())
    assert again == record
