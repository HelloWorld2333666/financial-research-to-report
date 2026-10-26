"""Integrity checks for a ResearchRecord.

Pydantic already guarantees field types; this module checks what types cannot:
cross-references, evidence-to-claim support, and fixture/live separation.
Errors mean the record must not feed slide planning. Warnings flag things a
reviewer should look at.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass

from frr.schema import (
    EvidenceKind,
    RecordMode,
    ResearchRecord,
    SourceOrigin,
    SupportStatus,
    Verification,
)


@dataclass(frozen=True)
class Issue:
    level: str  # "error" | "warning"
    code: str
    object_id: str
    message: str

    def to_dict(self) -> dict:
        return asdict(self)


def claim_evidence_ids(record: ResearchRecord, claim_id: str) -> set[str]:
    """Evidence cited by a claim directly or through its findings."""
    claim = next(c for c in record.claims if c.id == claim_id)
    findings = {f.id: f for f in record.findings}
    ids = set(claim.evidence_ids)
    for fid in claim.finding_ids:
        if fid in findings:
            ids.update(findings[fid].evidence_ids)
    return ids


def validate_record(record: ResearchRecord) -> list[Issue]:
    issues: list[Issue] = []

    def err(code: str, oid: str, msg: str) -> None:
        issues.append(Issue("error", code, oid, msg))

    def warn(code: str, oid: str, msg: str) -> None:
        issues.append(Issue("warning", code, oid, msg))

    collections = [
        record.questions, record.metrics, record.sources, record.evidence,
        record.findings, record.claims, record.gaps, record.slide_modules,
    ]
    counts = Counter(obj.id for coll in collections for obj in coll)
    for oid, n in counts.items():
        if n > 1:
            err("duplicate_id", oid, f"id '{oid}' is used {n} times; ids must be unique across the record")

    question_ids = {q.id for q in record.questions}
    metric_ids = {m.id for m in record.metrics}
    source_ids = {s.id for s in record.sources}
    evidence = {e.id: e for e in record.evidence}
    finding_ids = {f.id for f in record.findings}
    claims = {c.id: c for c in record.claims}

    def check_refs(oid: str, refs: list[str], known: set[str] | dict, kind: str) -> None:
        for ref in refs:
            if ref not in known:
                err("dangling_reference", oid, f"references unknown {kind} '{ref}'")

    # Fixture and live material must never mix.
    for s in record.sources:
        if record.mode == RecordMode.offline_fixture and s.origin != SourceOrigin.fixture:
            err("mode_mismatch", s.id, "offline_fixture records may only contain fixture sources")
        if record.mode == RecordMode.live and s.origin == SourceOrigin.fixture:
            err("mode_mismatch", s.id, "live records must not contain fixture sources")

    for e in record.evidence:
        check_refs(e.id, [e.source_id], source_ids, "source")
        check_refs(e.id, e.question_ids, question_ids, "question")
        if e.kind == EvidenceKind.metric_value:
            missing = [f for f in ("metric_id", "value", "unit", "period") if getattr(e, f) in (None, "")]
            if missing:
                err("incomplete_metric", e.id, f"metric_value evidence is missing: {', '.join(missing)}")
            if e.metric_id and e.metric_id not in metric_ids:
                err("unknown_metric", e.id, f"metric '{e.metric_id}' has no definition in this record")
        elif e.value is not None or e.metric_id is not None:
            err("unexpected_value", e.id, f"{e.kind.value} evidence must not carry a metric value")
        if e.locator is None:
            warn("no_locator", e.id, "evidence has no page/section locator; harder to verify")

    for f in record.findings:
        check_refs(f.id, f.question_ids, question_ids, "question")
        check_refs(f.id, f.evidence_ids, evidence, "evidence")
        if not f.evidence_ids:
            err("unsupported_finding", f.id, "finding cites no evidence")

    for c in record.claims:
        check_refs(c.id, c.evidence_ids, evidence, "evidence")
        check_refs(c.id, c.finding_ids, finding_ids, "finding")
        if not claim_evidence_ids(record, c.id) & evidence.keys():
            err("unsupported_claim", c.id, "claim is not linked to any existing evidence")
        elif c.support in (SupportStatus.unverified, SupportStatus.partially_verified):
            warn("unverified_support", c.id, f"claim support is {c.support.value}; verify before use")

    for g in record.gaps:
        check_refs(g.id, g.question_ids, question_ids, "question")
        check_refs(g.id, g.metric_ids, metric_ids, "metric")

    for m in record.slide_modules:
        check_refs(m.id, m.claim_ids, claims, "claim")
        for cid in m.claim_ids:
            if cid in claims and claims[cid].support == SupportStatus.unsupported:
                err("module_on_unsupported_claim", m.id, f"slide module relies on unsupported claim '{cid}'")

    covered = {q for e in record.evidence for q in e.question_ids}
    covered |= {q for f in record.findings for q in f.question_ids}
    gapped = {q for g in record.gaps for q in g.question_ids}
    for q in record.questions:
        if q.id not in covered and q.id not in gapped:
            warn("silent_question", q.id, "question has neither evidence nor a recorded gap")

    for e in record.evidence:
        if e.verification == Verification.unverified and record.mode == RecordMode.live:
            warn("unverified_evidence", e.id, "live evidence not yet verified against source")

    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(i.level == "error" for i in issues)
