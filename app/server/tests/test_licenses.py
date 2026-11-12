import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import licenses  # noqa: E402


def test_all_third_party_licences_are_on_the_allow_list(capsys):
    licenses.main(write=False)  # exits non-zero on anything not allowed
    assert "all on the allow-list" in capsys.readouterr().out
