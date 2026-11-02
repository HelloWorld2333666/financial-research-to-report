"""Schema 0.2: retrieval provenance, derivations, numbers in claims, working edits."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from frr import derive
from frr.schema import NumberRef, ResearchRecord, Retrieval, WorkingEdit
from frr.validation import has_errors, number_in, validate_record

SEED = Path(__file__).resolve().parents[1] / "app/server/seeds/france-record.json"


@pytest.fixture
def record() -> dict:
    return json.loads(SEED.read_text())


def codes(rec: dict, level: str = "error") -> list[str]:
    return [i.code for i in validate_record(ResearchRecord.model_validate(rec)) if i.level == level]


def spread(rec: dict, value: float = 76, formula: str = "(own - peer) * 100") -> dict:
    ev = {e["locator"].split(" @ ")[0].split('"geo": "')[1][:2] + "@" + e["period"]: e["id"] for e in rec["evidence"] if e["metric_id"] == "yield"}
    return {"id": "der.spread", "statement": "FR-DE 10y spread 2025", "formula": formula,
            "inputs": {"own": ev["FR@2025"], "peer": ev["DE@2025"]}, "value": value, "unit": "bp", "period": "2025", "rounding": 0}


def test_v01_records_still_load(record):
    for e in record["evidence"]:
        e.pop("retrieval")
    record["schema_version"] = "0.1"
    assert not has_errors(validate_record(ResearchRecord.model_validate(record)))


def test_seed_carries_eurostat_query_and_time_for_every_value(record):
    rec = ResearchRecord.model_validate(record)
    assert rec.schema_version == "0.2" and codes(record) == []
    for e in rec.evidence:
        r = e.retrieval
        assert r.method.value == "api" and r.query_url.startswith("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/")
        assert r.retrieved_at is not None and r.content_sha256 is None  # not captured in Experiment 2; never invented
        assert e.metric_id in {"debt", "deficit", "interest", "growth", "yield"}


def test_retrieval_rejects_bad_hash_and_api_needs_query(record):
    with pytest.raises(ValidationError):
        Retrieval(method="api", query_url="https://x", content_sha256="abc")
    record["evidence"][0]["retrieval"]["query_url"] = None
    assert "retrieval_without_query" in codes(record)


def test_derivation_recomputes_from_inputs(record):
    record["derivations"] = [spread(record)]
    assert codes(record) == []
    record["derivations"] = [spread(record, value=80)]
    assert codes(record) == ["derivation_mismatch"]


@pytest.mark.parametrize("formula,code", [("(own - other) * 100", "formula_inputs"), ("__import__('os')", "bad_formula"), ("own ** 2", "bad_formula")])
def test_derivation_formula_must_be_plain_arithmetic_over_its_inputs(record, formula, code):
    record["derivations"] = [spread(record, formula=formula)]
    assert code in codes(record)


def test_derivation_inputs_must_exist_and_not_cycle(record):
    d = spread(record)
    d["inputs"]["peer"] = "ev.missing"
    record["derivations"] = [d]
    assert "dangling_reference" in codes(record)
    a = {"id": "der.a", "statement": "a", "formula": "x + 1", "inputs": {"x": "der.b"}, "value": 1, "unit": "x"}
    b = {"id": "der.b", "statement": "b", "formula": "x + 1", "inputs": {"x": "der.a"}, "value": 1, "unit": "x"}
    record["derivations"] = [a, b]
    assert "derivation_cycle" in codes(record)


def test_numbers_in_claims_must_equal_what_they_cite(record):
    record["derivations"] = [spread(record)]
    debt = next(e for e in record["evidence"] if e["metric_id"] == "debt" and e["period"] == "2025" and e["subject"] == "France")
    claim = {"id": "c.1", "statement": "Debt reached 115.7%; the spread was 76 bp", "nature": "fact", "evidence_ids": [debt["id"]],
             "numbers": [{"text": "115.7%", "evidence_id": debt["id"]}, {"text": "76 bp", "derivation_id": "der.spread"}]}
    record["claims"] = [claim]
    assert codes(record) == []
    claim["numbers"][0]["text"] = "115.9%"
    assert codes(record) == ["number_mismatch"]
    claim["numbers"][0] = {"text": "115.7%", "evidence_id": "ev.nope"}
    assert codes(record) == ["dangling_reference"]


def test_number_ref_needs_exactly_one_origin():
    with pytest.raises(ValidationError):
        NumberRef(text="1%")
    with pytest.raises(ValidationError):
        NumberRef(text="1%", evidence_id="a", derivation_id="b")
    assert number_in("+4.3 pp") == (4.3, 1) and number_in("−5.1%") == (-5.1, 1) and number_in("76 bp") == (76.0, 0)


def test_working_edits(record):
    ev = record["evidence"][0]
    base = {"dataset": "ds.fr.debt", "period": ev["period"], "evidence_id": ev["id"], "value": 112.0, "by": "analyst", "at": "2026-11-02T10:00:00Z"}
    record["working_edits"] = [base]
    assert codes(record) == [] and "unverified_working_edit" in codes(record, "warning")
    record["working_edits"] = [{**base, "status": "verified", "verified_by": "reviewer", "verified_at": "2026-11-02T11:00:00Z"}]
    assert "unverified_working_edit" not in codes(record, "warning")
    record["working_edits"] = [{**base, "period": "1999"}, {**base, "evidence_id": "ev.nope"}, base, base]
    assert {"period_mismatch", "dangling_reference", "duplicate_working_edit"} <= set(codes(record))
    with pytest.raises(ValidationError):
        WorkingEdit(**{**base, "status": "verified"})  # who verified it?
    with pytest.raises(ValidationError):
        WorkingEdit(**{**base, "deleted": True})  # a value and a gap at once


def test_derive_matches_rounding():
    assert derive.matches(75.773, 76, 0) and not derive.matches(75.4, 76, 0)
    assert derive.evaluate("round(a / 3)", {"a": 10}) == 3
