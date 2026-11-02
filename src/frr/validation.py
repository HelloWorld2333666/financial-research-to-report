"""Integrity checks for a ResearchRecord.

Pydantic already guarantees field types; this module checks what types cannot:
cross-references, evidence-to-claim support, and fixture/live separation; and
(schema 0.2) that derivations recompute, numbers in claims equal what they cite,
and working edits point at real evidence.
Errors mean the record must not feed slide planning. Warnings flag things a
reviewer should look at.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import asdict, dataclass

from frr import derive
from frr.schema import (
    EvidenceKind,
    RecordMode,
    ResearchRecord,
    RetrievalMethod,
    SourceOrigin,
    SupportStatus,
    Verification,
    WorkingStatus,
)

NUMBER_RE = re.compile(r"[+\-−]?\d+(?:\.\d+)?")


def number_in(text: str) -> tuple[float, int] | None:
    """The first number in ``text`` and how many decimals it was written with."""
    m = NUMBER_RE.search(text.replace(",", ""))
    if not m:
        return None
    raw = m.group(0).replace("−", "-")
    return float(raw), len(raw.split(".")[1]) if "." in raw else 0


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
        record.findings, record.claims, record.gaps, record.slide_modules, record.derivations,
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
        if record.mode != RecordMode.live:
            continue
        if e.verification == Verification.unverified:
            warn("unverified_evidence", e.id, "live evidence not yet verified against source")
        elif not (e.verified_by and e.verified_on):
            warn("verification_unattributed", e.id, "verified evidence should record verified_by and verified_on")
        if e.verification == Verification.verified and not (e.page and e.excerpt):
            warn("verification_not_checkable", e.id, "verified evidence has no page + excerpt for automated checks")

    # ---- schema 0.2: retrieval, derivations, numbers in claims, working edits
    for e in record.evidence:
        r = e.retrieval
        if r and r.method == RetrievalMethod.api and not r.query_url:
            err("retrieval_without_query", e.id, "API retrieval must record the query URL")

    derivations = {d.id: d for d in record.derivations}
    values: dict[str, float | None] = {}  # derivation id -> recomputed value (None when it cannot be)
    cyclic: set[str] = set()

    def value_of(ref: str, stack: tuple[str, ...]) -> float | None:
        if ref in evidence:
            return evidence[ref].value
        if ref in derivations:
            return recompute(derivations[ref], stack)
        return None

    def recompute(d, stack: tuple[str, ...] = ()) -> float | None:
        if d.id in stack:
            if d.id not in cyclic:
                cyclic.add(d.id)
                err("derivation_cycle", d.id, f"derivation depends on itself via {' -> '.join(stack + (d.id,))}")
            return None
        if d.id in values:
            return values[d.id]
        values[d.id] = None
        env = {}
        for name, ref in d.inputs.items():
            v = value_of(ref, stack + (d.id,))
            if v is None:
                return None
            env[name] = v
        try:
            values[d.id] = derive.evaluate(d.formula, env)
        except ValueError:
            return None
        return values[d.id]

    for d in record.derivations:
        try:
            free = derive.names(d.formula)
        except ValueError as exc:
            err("bad_formula", d.id, str(exc))
            continue
        if free != set(d.inputs):
            err("formula_inputs", d.id, f"formula reads {sorted(free)} but inputs name {sorted(d.inputs)}")
            continue
        for name, ref in d.inputs.items():
            if ref in evidence:
                if evidence[ref].kind != EvidenceKind.metric_value or evidence[ref].value is None:
                    err("non_numeric_input", d.id, f"input '{name}' cites evidence '{ref}', which has no value")
            elif ref not in derivations:
                err("dangling_reference", d.id, f"input '{name}' references unknown evidence or derivation '{ref}'")
    for d in record.derivations:
        got = recompute(d)
        if got is not None and not derive.matches(got, d.value, d.rounding):
            err("derivation_mismatch", d.id, f"formula gives {got:g} from its inputs; the derivation states {d.value:g}")

    for c in record.claims:
        for n in c.numbers:
            ref = n.evidence_id or n.derivation_id
            if ref not in (evidence if n.evidence_id else derivations):
                err("dangling_reference", c.id, f"number '{n.text}' references unknown {'evidence' if n.evidence_id else 'derivation'} '{ref}'")
                continue
            target = evidence[ref].value if n.evidence_id else derivations[ref].value
            written = number_in(n.text)
            if target is None or written is None:
                err("number_unresolved", c.id, f"number '{n.text}' cannot be compared with '{ref}'")
            elif not derive.matches(target, written[0], written[1]):
                err("number_mismatch", c.id, f"claim writes '{n.text}' but '{ref}' is {target:g}")

    for w in record.working_edits:
        wid = f"working[{w.dataset}@{w.period}]"
        if w.evidence_id:
            if w.evidence_id not in evidence:
                err("dangling_reference", wid, f"working edit overrides unknown evidence '{w.evidence_id}'")
            elif evidence[w.evidence_id].period not in (None, w.period):
                err("period_mismatch", wid, f"evidence '{w.evidence_id}' is for {evidence[w.evidence_id].period}, the edit for {w.period}")
        if w.status == WorkingStatus.manual_unverified:
            warn("unverified_working_edit", wid, f"manual value by {w.by} is not verified; final export needs acknowledgement")
    dup = Counter((w.dataset, w.period) for w in record.working_edits)
    for (ds, period), n in dup.items():
        if n > 1:
            err("duplicate_working_edit", f"working[{ds}@{period}]", f"{n} working edits for the same point; keep one")

    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(i.level == "error" for i in issues)
