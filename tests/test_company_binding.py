import pytest
from pydantic import ValidationError

from frr.cli import main
from frr.pipeline import run
from frr.schema import EvidenceBundle, Scope

from conftest import FIXTURE


def renamed(scope, name):
    # Validate like the CLI does (model_copy would skip whitespace stripping).
    return Scope(**{**scope.model_dump(), "company": name})


@pytest.mark.parametrize("name", [
    "China Reinsurance (Group) Corporation",
    "china reinsurance group corporation",  # case and punctuation differences only
    "  CHINA REINSURANCE (GROUP)  CORPORATION ",
])
def test_bundle_company_matches_normalised_name(scope, bundle, name):
    record, _ = run(renamed(scope, name), bundle)
    assert record.scope.company == name.strip()


def test_aliases_are_accepted(scope, bundle):
    bundle.company_aliases = ["China Re"]
    run(renamed(scope, "China Re"), bundle)


@pytest.mark.parametrize("name", ["AIA Group Limited", "China Re", "China Reinsurance"])
def test_other_company_is_rejected(scope, bundle, name):
    # "China Re" is rejected here because the fixture lists no aliases.
    with pytest.raises(ValueError, match="Evidence bundle is for"):
        run(renamed(scope, name), bundle)


def test_bundle_must_declare_company():
    with pytest.raises(ValidationError):
        EvidenceBundle.model_validate({"mode": "live", "description": "no company"})


def test_cli_rejects_mismatched_company(tmp_path, capsys):
    code = main(["run", "--company", "AIA Group Limited", "--objective", "Assess the credit profile.",
                 "--sector", "insurance", "--evidence", str(FIXTURE), "--out", str(tmp_path / "o")])
    assert code == 2
    assert "Evidence bundle is for 'China Reinsurance (Group) Corporation'" in capsys.readouterr().err
    assert not (tmp_path / "o").exists()
