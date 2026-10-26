from pathlib import Path

import pytest

from frr.pipeline import load_bundle
from frr.schema import EvidenceBundle, Scope

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "china_re_offline.json"


@pytest.fixture
def bundle() -> EvidenceBundle:
    return load_bundle(FIXTURE)


@pytest.fixture
def scope() -> Scope:
    return Scope(
        company="China Reinsurance (Group) Corporation",
        objective="Assess business profile, financial strength and key credit risks.",
        sector="insurance",
    )


def by_id(items, oid):
    return next(i for i in items if i.id == oid)


def codes(issues, level=None):
    return {i.code for i in issues if level is None or i.level == level}
