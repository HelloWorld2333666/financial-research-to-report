import json

import pytest

from frr.cli import main
from frr.config import load_settings
from frr.pipeline import run
from frr.questions import plan_questions
from frr.schema import Scope

from conftest import FIXTURE, codes


@pytest.mark.parametrize("field,value", [("use_case", "sovereign_credit"), ("sector", "banking")])
def test_unsupported_use_case_or_sector_is_rejected(scope, bundle, field, value):
    bad = scope.model_copy(update={field: value})
    with pytest.raises(ValueError, match="Unsupported"):
        run(bad, bundle)


def test_sector_changes_question_frame():
    general, _ = plan_questions(Scope(company="Acme Corp", objective="Assess credit profile."))
    insurer, metrics = plan_questions(Scope(company="Acme Re", objective="Assess credit profile.",
                                            sector="insurance"))
    assert "q.balance_sheet" in {q.id for q in general}
    assert "q.capital" in {q.id for q in insurer}
    assert {"m.combined_ratio", "m.solvency_ratio"} <= {m.id for m in metrics}


def test_fixture_and_live_sources_cannot_mix(scope, bundle):
    bundle.sources[0].origin = "retrieved"
    _, issues = run(scope, bundle)
    assert "mode_mismatch" in codes(issues, "error")

    bundle.sources[0].origin = "fixture"
    bundle.mode = "live"
    _, issues = run(scope, bundle)
    assert "mode_mismatch" in codes(issues, "error")


def test_paid_calls_are_off_by_default():
    s = load_settings({})
    assert s.llm_provider == "none" and s.allow_paid_calls is False
    assert load_settings({"FRR_ALLOW_PAID_CALLS": "true"}).allow_paid_calls is True


def test_cli_demo_writes_outputs_and_validates(tmp_path, capsys):
    out = tmp_path / "demo"
    assert main(["demo", "--out", str(out)]) == 0
    files = {p.name for p in out.iterdir()}
    assert files == {"research_record.json", "validation_report.json", "summary.md"}
    assert "OFFLINE FIXTURE" in (out / "summary.md").read_text()
    assert main(["validate", str(out / "research_record.json")]) == 0


def test_cli_validate_flags_tampered_record(tmp_path):
    out = tmp_path / "demo"
    main(["demo", "--out", str(out)])
    path = out / "research_record.json"
    data = json.loads(path.read_text())
    data["claims"][0]["evidence_ids"] = ["ev.invented"]
    data["claims"][0]["finding_ids"] = []
    path.write_text(json.dumps(data))
    assert main(["validate", str(path)]) == 1


@pytest.mark.parametrize("args", [
    ["--use-case", "industry"],
    ["--evidence", "does/not/exist.json"],
])
def test_cli_rejects_bad_inputs(tmp_path, args):
    base = {"--company": "Acme Corp", "--objective": "Assess the credit profile.",
            "--evidence": str(FIXTURE), "--out": str(tmp_path / "o")}
    argv = ["run"]
    for k, v in base.items():
        if k not in args:
            argv += [k, v]
    assert main(argv + args) == 2


def test_cli_rejects_malformed_bundle(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"mode": "offline_fixture"}')  # missing description
    assert main(["run", "--company", "Acme Corp", "--objective", "Assess the credit profile.",
                 "--evidence", str(bad), "--out", str(tmp_path / "o")]) == 2
