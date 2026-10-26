"""Shared research data structure.

Provenance chain: Source -> Evidence -> (Finding) -> Claim -> SlideModule.

Every object has a stable string id so later stages (slide planning, revision)
can reference it without repeating research. Cross-reference integrity is not
enforced here; see ``frr.validation``.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "0.1"


class _Model(BaseModel):
    # Reject unknown fields so typos in fixtures or LLM output fail loudly.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RecordMode(str, Enum):
    offline_fixture = "offline_fixture"  # synthetic inputs, never real-world results
    live = "live"  # evidence gathered from real sources


class SourceOrigin(str, Enum):
    fixture = "fixture"  # synthetic test material
    retrieved = "retrieved"  # fetched from a public source
    user_provided = "user_provided"  # supplied by the analyst


class SourceType(str, Enum):
    annual_report = "annual_report"
    interim_report = "interim_report"
    exchange_filing = "exchange_filing"
    rating_report = "rating_report"
    regulatory_disclosure = "regulatory_disclosure"
    official_statistics = "official_statistics"
    news = "news"
    other = "other"


class EvidenceKind(str, Enum):
    metric_value = "metric_value"  # a number for a defined metric
    fact = "fact"  # a qualitative disclosed fact
    quote = "quote"  # a short attributed statement (e.g. rating agency view)


class Verification(str, Enum):
    verified = "verified"  # checked against the cited source location
    unverified = "unverified"  # extracted but not yet checked


class Nature(str, Enum):
    fact = "fact"  # directly stated by evidence
    interpretation = "interpretation"  # analytical judgement drawn from evidence


class QuestionStatus(str, Enum):
    open = "open"
    partially_answered = "partially_answered"
    answered = "answered"


class GapReason(str, Enum):
    not_disclosed = "not_disclosed"
    not_found = "not_found"
    not_comparable = "not_comparable"
    needs_verification = "needs_verification"
    not_yet_researched = "not_yet_researched"


class SupportStatus(str, Enum):
    supported = "supported"  # >=1 evidence and all cited evidence verified
    partially_verified = "partially_verified"  # some cited evidence unverified
    unverified = "unverified"  # all cited evidence unverified
    unsupported = "unsupported"  # no evidence at all


class Scope(_Model):
    company: str = Field(min_length=2, max_length=200)
    objective: str = Field(min_length=10, max_length=1000)
    use_case: str = "company_credit"
    sector: str = "general"
    period: Optional[str] = None  # e.g. "FY2021-FY2024"
    in_scope: list[str] = Field(default_factory=list)
    out_of_scope: list[str] = Field(default_factory=list)


class MetricDefinition(_Model):
    id: str
    name: str
    definition: str
    unit: str
    formula: Optional[str] = None
    caveats: Optional[str] = None


class ResearchQuestion(_Model):
    id: str
    text: str
    rationale: str
    evidence_needed: list[str] = Field(min_length=1)
    metric_ids: list[str] = Field(default_factory=list)
    status: QuestionStatus = QuestionStatus.open


class Source(_Model):
    id: str
    title: str
    publisher: str
    source_type: SourceType
    origin: SourceOrigin
    url: Optional[str] = None
    published_date: Optional[date] = None
    accessed_date: Optional[date] = None
    notes: Optional[str] = None


class Evidence(_Model):
    id: str
    source_id: str
    kind: EvidenceKind
    statement: str
    locator: Optional[str] = None  # page / section / table within the source
    question_ids: list[str] = Field(default_factory=list)
    verification: Verification = Verification.unverified
    # metric_value fields
    metric_id: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    period: Optional[str] = None


class Finding(_Model):
    id: str
    statement: str
    nature: Nature
    question_ids: list[str] = Field(min_length=1)
    evidence_ids: list[str] = Field(default_factory=list)


class Claim(_Model):
    id: str
    statement: str
    nature: Nature
    evidence_ids: list[str] = Field(default_factory=list)
    finding_ids: list[str] = Field(default_factory=list)
    caveats: Optional[str] = None
    # Computed by the pipeline, never trusted from input.
    support: SupportStatus = SupportStatus.unsupported


class Gap(_Model):
    id: str
    description: str
    reason: GapReason
    question_ids: list[str] = Field(default_factory=list)
    metric_ids: list[str] = Field(default_factory=list)
    impact: Optional[str] = None
    suggested_action: Optional[str] = None
    auto_detected: bool = False


class SlideModule(_Model):
    """A candidate proof block for future slide planning (no layout yet)."""

    id: str
    claim_ids: list[str] = Field(min_length=1)
    proof_role: str  # e.g. "ownership & control", "capital strength"
    exhibit_hint: Optional[str] = None  # e.g. "timeline", "bar chart", "table"


class ResearchRecord(_Model):
    schema_version: str = SCHEMA_VERSION
    record_id: str
    mode: RecordMode
    created_at: datetime
    llm_provider: str = "none"
    scope: Scope
    questions: list[ResearchQuestion] = Field(default_factory=list)
    metrics: list[MetricDefinition] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    slide_modules: list[SlideModule] = Field(default_factory=list)


class EvidenceBundle(_Model):
    """Research material fed into the pipeline (fixture file or, later, live research)."""

    mode: RecordMode
    description: str
    sources: list[Source] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    slide_modules: list[SlideModule] = Field(default_factory=list)
