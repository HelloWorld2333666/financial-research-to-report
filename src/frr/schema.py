"""Shared research data structure.

Provenance chain: Source -> Evidence -> (Finding) -> Claim -> SlideModule.

Schema 0.2 adds, all optional so 0.1 records still load:
- ``Evidence.retrieval``: how a value was fetched (API query URL, time, content hash);
- ``Derivation``: a number computed from evidence (e.g. a yield spread), with formula and inputs;
- ``Claim.numbers``: each number written in a claim and the evidence or derivation it came from;
- ``WorkingEdit``: a manual change to a value, kept next to (never over) the source evidence;
- ``Evidence.rating``: a rating action quoted from an agency document (page + verbatim excerpt).

Every object has a stable string id so later stages (slide planning, revision)
can reference it without repeating research. Cross-reference integrity is not
enforced here; see ``frr.validation``.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "0.2"
_Date = date  # RatingAction has a field named `date`, which would shadow the type in its own annotations


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


class RetrievalMethod(str, Enum):
    api = "api"  # structured statistics API (e.g. Eurostat dissemination API)
    web_page = "web_page"  # HTML page text
    pdf_upload = "pdf_upload"  # a document the analyst uploaded
    manual = "manual"  # typed in by the analyst


class WorkingStatus(str, Enum):
    manual_unverified = "manual_unverified"  # entered by a person, not yet checked
    verified = "verified"  # checked and signed off by a named person


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
    content_sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    notes: Optional[str] = None


class Retrieval(_Model):
    """How a piece of evidence was obtained, precisely enough to fetch it again."""

    method: RetrievalMethod
    query_url: Optional[str] = None  # the exact request, e.g. a Eurostat API URL with filters
    retrieved_at: Optional[datetime] = None
    # Hash of the response body as received; None when it was not captured (stated, not invented).
    content_sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    series_key: Optional[str] = None  # dataset + filters identifying the series in the response
    note: Optional[str] = None


class RatingAction(_Model):
    """A credit rating action as stated in an agency document; the excerpt on `page` must contain `rating`."""

    agency: str
    action: str  # affirmed | downgraded | upgraded | confirmed | assigned | ...
    rating: str  # as printed, e.g. "AA-", "Aa3", "AA (high)"
    outlook: Optional[str] = None  # stable | negative | positive | developing, or a trend
    date: Optional[_Date] = None


class Evidence(_Model):
    id: str
    source_id: str
    kind: EvidenceKind
    statement: str
    locator: Optional[str] = None  # human-readable: printed page, section, table
    page: Optional[int] = Field(default=None, ge=1)  # 1-based PDF page, for automated checks
    excerpt: Optional[str] = None  # short verbatim text from the source at `page`
    subject: Optional[str] = None  # entity or segment the evidence is about, e.g. "Group"
    question_ids: list[str] = Field(default_factory=list)
    verification: Verification = Verification.unverified
    verified_by: Optional[str] = None
    verified_on: Optional[date] = None
    # metric_value fields
    metric_id: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    period: Optional[str] = None
    issuer_definition: Optional[str] = None  # when the issuer's definition differs from ours
    retrieval: Optional[Retrieval] = None
    rating: Optional[RatingAction] = None


class Derivation(_Model):
    """A number computed from evidence: never typed, always reproducible from its inputs."""

    id: str
    statement: str
    formula: str  # arithmetic over the input names, e.g. "(fr - de) * 100"; see frr.derive
    inputs: dict[str, str] = Field(min_length=1)  # input name -> evidence id or derivation id
    value: float
    unit: str
    period: Optional[str] = None
    rounding: Optional[int] = Field(default=None, ge=0, le=6)  # decimals `value` was rounded to


class NumberRef(_Model):
    """A number as written in a claim, and exactly one thing it comes from."""

    text: str = Field(min_length=1)  # as written, e.g. "115.7%", "52 bp"
    evidence_id: Optional[str] = None
    derivation_id: Optional[str] = None

    @model_validator(mode="after")
    def _one_origin(self) -> "NumberRef":
        if (self.evidence_id is None) == (self.derivation_id is None):
            raise ValueError("a number must reference exactly one of evidence_id or derivation_id")
        return self


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
    numbers: list[NumberRef] = Field(default_factory=list)
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


class WorkingEdit(_Model):
    """A manual value in the working layer. The source evidence it overrides stays unchanged."""

    dataset: str
    period: str
    evidence_id: Optional[str] = None  # the source observation it overrides; None adds a point
    value: Optional[float] = None
    deleted: bool = False  # a deliberate gap
    status: WorkingStatus = WorkingStatus.manual_unverified
    by: str = Field(min_length=1)
    at: datetime
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None
    note: Optional[str] = None

    @model_validator(mode="after")
    def _consistent(self) -> "WorkingEdit":
        if self.deleted == (self.value is not None):
            raise ValueError("a working edit carries either a value or deleted=true")
        if self.status == WorkingStatus.verified and not (self.verified_by and self.verified_at):
            raise ValueError("a verified edit must record verified_by and verified_at")
        return self


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
    derivations: list[Derivation] = Field(default_factory=list)
    working_edits: list[WorkingEdit] = Field(default_factory=list)


class EvidenceBundle(_Model):
    """Research material fed into the pipeline (fixture file or, later, live research)."""

    mode: RecordMode
    # The entity this material is about; a run for any other company is rejected.
    company: str = Field(min_length=2, max_length=200)
    company_aliases: list[str] = Field(default_factory=list)
    description: str
    sources: list[Source] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    slide_modules: list[SlideModule] = Field(default_factory=list)
