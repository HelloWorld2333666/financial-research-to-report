import pytest

from frr.cli import main
from frr.schema import EvidenceBundle
from frr.sourcecheck import check_bundle, normalise, number_forms

SHA = "a" * 64


def make_bundle(**evidence_overrides):
    ev = dict(id="ev.1", source_id="src.1", kind="metric_value", statement="Total assets.",
              page=2, excerpt="Total assets 527,763,431 508,347,105", metric_id="m.total_assets",
              value=527763431, unit="RMB thousand", period="31 Dec 2025")
    ev.update(evidence_overrides)
    return EvidenceBundle(mode="live", company="Test Co", description="test", sources=[dict(
        id="src.1", title="t", publisher="p", source_type="exchange_filing", origin="retrieved",
        content_sha256=SHA)], evidence=[ev])


PAGES = {"src.1": ["cover page", "Total assets\n527,763,431   508,347,105\nTotal liabilities"]}


def status(bundle, pages=PAGES, shas=None):
    return check_bundle(bundle, pages, shas)[0]


def test_excerpt_found_across_line_breaks():
    assert status(make_bundle()).status == "ok"


def test_wrong_page_fails():
    assert status(make_bundle(page=1)).status == "fail"
    assert status(make_bundle(page=9)).status == "fail"


def test_value_must_appear_in_excerpt():
    result = status(make_bundle(value=508347106))
    assert result.status == "fail" and "not present" in result.detail


def test_altered_excerpt_fails():
    assert status(make_bundle(excerpt="Total assets 527,763,432")).status == "fail"


def test_document_hash_mismatch_fails():
    assert status(make_bundle(), shas={"src.1": "b" * 64}).status == "fail"
    assert status(make_bundle(), shas={"src.1": SHA}).status == "ok"


def test_missing_page_excerpt_or_file_is_skipped():
    assert status(make_bundle(page=None)).status == "skipped"
    assert status(make_bundle(), pages={}).status == "skipped"


def test_quotes_and_whitespace_are_normalised():
    assert normalise("“A (Excellent)”  rating\n") == '"A (Excellent)" rating'


@pytest.mark.parametrize("value,printed", [(124927594, "124,927,594"), (9.18, "9.18"), (189, "189"),
                                           (95.98, "95.98")])
def test_number_forms(value, printed):
    assert printed in number_forms(value)


def test_cli_rejects_malformed_file_argument(tmp_path):
    from conftest import FIXTURE
    assert main(["check-sources", "--evidence", str(FIXTURE), "--file", "no-equals-sign"]) == 2
    assert main(["check-sources", "--evidence", str(FIXTURE), "--file", f"src.x={tmp_path}/none.pdf"]) == 2
