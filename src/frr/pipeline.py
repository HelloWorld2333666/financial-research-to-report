"""Phase 0 research pipeline.

    scope -> research questions + metric definitions -> evidence bundle
          -> computed claim support, question status, missing-information gaps
          -> validated ResearchRecord

The evidence bundle currently comes from a JSON file (an offline fixture or,
later, analyst/LLM-gathered material). Nothing here fabricates evidence: if a
question has no evidence, the pipeline records a gap instead of an answer.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from frr.questions import plan_questions, validate_scope
from frr.schema import (
    EvidenceBundle,
    EvidenceKind,
    Gap,
    GapReason,
    QuestionStatus,
    RecordMode,
    ResearchRecord,
    Scope,
    SupportStatus,
    Verification,
)
from frr.validation import Issue, claim_evidence_ids, validate_record


def load_bundle(path: Path) -> EvidenceBundle:
    return EvidenceBundle.model_validate_json(Path(path).read_text(encoding="utf-8"))


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def _support(record: ResearchRecord, claim_id: str) -> SupportStatus:
    evidence = {e.id: e for e in record.evidence}
    cited = [evidence[i] for i in claim_evidence_ids(record, claim_id) if i in evidence]
    if not cited:
        return SupportStatus.unsupported
    verified = [e.verification == Verification.verified for e in cited]
    if all(verified):
        return SupportStatus.supported
    return SupportStatus.partially_verified if any(verified) else SupportStatus.unverified


def _metric_values(record: ResearchRecord) -> set[str]:
    return {e.metric_id for e in record.evidence if e.kind == EvidenceKind.metric_value and e.metric_id}


def _question_status(record: ResearchRecord, qid: str) -> QuestionStatus:
    question = next(q for q in record.questions if q.id == qid)
    linked = [e for e in record.evidence if qid in e.question_ids]
    has_finding = any(qid in f.question_ids for f in record.findings)
    if not linked and not has_finding:
        return QuestionStatus.open
    metrics_missing = set(question.metric_ids) - _metric_values(record)
    all_verified = all(e.verification == Verification.verified for e in linked)
    has_gap = any(qid in g.question_ids for g in record.gaps)  # a recorded gap means not fully answered
    if has_finding and not metrics_missing and all_verified and not has_gap:
        return QuestionStatus.answered
    return QuestionStatus.partially_answered


def _auto_gaps(record: ResearchRecord) -> list[Gap]:
    """Record missing information that the bundle did not already explain."""
    gaps: list[Gap] = []
    explained_q = {q for g in record.gaps for q in g.question_ids}
    explained_m = {m for g in record.gaps for m in g.metric_ids}
    have_metrics = _metric_values(record)

    for q in record.questions:
        if q.status == QuestionStatus.open and q.id not in explained_q:
            gaps.append(Gap(
                id=f"gap.auto.{q.id}",
                description=f"No evidence collected for: {q.text}",
                reason=GapReason.not_yet_researched,
                question_ids=[q.id],
                suggested_action="Collect: " + "; ".join(q.evidence_needed),
                auto_detected=True,
            ))
        for mid in q.metric_ids:
            if mid not in have_metrics and mid not in explained_m:
                explained_m.add(mid)
                gaps.append(Gap(
                    id=f"gap.auto.{mid}",
                    description=f"No value recorded for metric {mid}.",
                    reason=GapReason.not_found,
                    question_ids=[q.id],
                    metric_ids=[mid],
                    suggested_action="Locate the figure in the issuer's filings and record the issuer's definition.",
                    auto_detected=True,
                ))

    for c in record.claims:
        if c.support in (SupportStatus.unverified, SupportStatus.partially_verified):
            gaps.append(Gap(
                id=f"gap.auto.verify.{c.id}",
                description=f"Claim '{c.id}' relies on evidence not yet verified against its source.",
                reason=GapReason.needs_verification,
                suggested_action="Check each cited evidence item at its locator and mark it verified.",
                auto_detected=True,
            ))
    return gaps


def run(scope: Scope, bundle: EvidenceBundle, llm_provider: str = "none",
        now: datetime | None = None) -> tuple[ResearchRecord, list[Issue]]:
    validate_scope(scope)
    questions, metrics = plan_questions(scope)
    now = now or datetime.now(timezone.utc)

    record = ResearchRecord(
        record_id=f"{_slug(scope.company)}-{now:%Y%m%dT%H%M%SZ}",
        mode=bundle.mode,
        created_at=now,
        llm_provider=llm_provider,
        scope=scope,
        questions=questions,
        metrics=metrics,
        sources=bundle.sources,
        evidence=bundle.evidence,
        findings=bundle.findings,
        claims=[c.model_copy() for c in bundle.claims],
        gaps=bundle.gaps,
        slide_modules=bundle.slide_modules,
    )
    # Support is always recomputed: input must not be able to assert it.
    for c in record.claims:
        c.support = _support(record, c.id)
    for q in record.questions:
        q.status = _question_status(record, q.id)
    record.gaps = record.gaps + _auto_gaps(record)

    return record, validate_record(record)


def write_outputs(record: ResearchRecord, issues: list[Issue], out_dir: Path) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "record": out_dir / "research_record.json",
        "validation": out_dir / "validation_report.json",
        "summary": out_dir / "summary.md",
    }
    paths["record"].write_text(record.model_dump_json(indent=2), encoding="utf-8")
    paths["validation"].write_text(json.dumps({
        "record_id": record.record_id,
        "mode": record.mode.value,
        "errors": sum(i.level == "error" for i in issues),
        "warnings": sum(i.level == "warning" for i in issues),
        "issues": [i.to_dict() for i in issues],
    }, indent=2), encoding="utf-8")
    paths["summary"].write_text(render_summary(record, issues), encoding="utf-8")
    return list(paths.values())


def render_summary(record: ResearchRecord, issues: list[Issue]) -> str:
    s = record.scope
    lines = [f"# Research record: {s.company}", ""]
    if record.mode == RecordMode.offline_fixture:
        lines += [
            "> **OFFLINE FIXTURE — NOT REAL RESEARCH.** All sources, figures and claims below are",
            "> synthetic test data used to exercise the pipeline. Do not cite or rely on them.",
            "",
        ]
    lines += [
        f"- Record: `{record.record_id}` (schema {record.schema_version}, mode `{record.mode.value}`)",
        f"- Objective: {s.objective}",
        f"- Use case / sector: {s.use_case} / {s.sector}" + (f"; period {s.period}" if s.period else ""),
        f"- LLM provider: {record.llm_provider}",
        "",
        "## Research questions",
        "",
    ]
    lines += [f"- **{q.id}** [{q.status.value}] {q.text}" for q in record.questions]

    lines += ["", "## Claims and support", ""]
    for c in record.claims:
        cited = sorted(claim_evidence_ids(record, c.id))
        lines.append(f"- **{c.id}** ({c.nature.value}, {c.support.value}) {c.statement}  ")
        lines.append(f"  evidence: {', '.join(cited) or 'none'}")

    lines += ["", "## Metrics recorded", ""]
    metric_ev = [e for e in record.evidence if e.kind == EvidenceKind.metric_value]
    if metric_ev:
        lines += ["| Evidence | Metric | Period | Value | Unit | Verification |", "|---|---|---|---|---|---|"]
        lines += [f"| {e.id} | {e.metric_id} | {e.period} | {e.value:g} | {e.unit} | {e.verification.value} |"
                  for e in metric_ev]
    else:
        lines.append("None.")

    lines += ["", "## Missing information and open questions", ""]
    lines += [f"- **{g.id}** [{g.reason.value}{', auto' if g.auto_detected else ''}] {g.description}"
              for g in record.gaps] or ["None recorded."]

    errors = [i for i in issues if i.level == "error"]
    warnings = [i for i in issues if i.level == "warning"]
    lines += ["", f"## Validation: {len(errors)} error(s), {len(warnings)} warning(s)", ""]
    lines += [f"- {i.level.upper()} `{i.code}` {i.object_id}: {i.message}" for i in errors + warnings]
    return "\n".join(lines) + "\n"
