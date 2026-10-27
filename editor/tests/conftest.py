import json
import sys
from pathlib import Path

import pytest

EDITOR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EDITOR))

import build_slide  # noqa: E402


@pytest.fixture
def project():
    """A freshly built China Re overview project (independent of the saved file)."""
    return build_slide.build(json.loads(build_slide.BUNDLE.read_text(encoding="utf-8")), build_slide.BUNDLE)
