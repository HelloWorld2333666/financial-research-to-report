"""Command-line entry point: ``frr run | demo | validate | schema | check-sources``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from frr.config import load_settings
from frr.pipeline import load_bundle, run, write_outputs
from frr.schema import ResearchRecord, Scope
from frr.sourcecheck import check_bundle_files
from frr.validation import has_errors, validate_record

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_FIXTURE = REPO_ROOT / "fixtures" / "china_re_offline.json"
DEMO_SCOPE = dict(
    company="China Reinsurance (Group) Corporation",
    objective="Assess the company's business profile, financial strength and key credit risks "
    "for a short credit overview.",
    sector="insurance",
)


def _execute(scope_kwargs: dict, evidence: Path, out: Path) -> int:
    settings = load_settings()
    if settings.llm_provider != "none":
        print(f"note: FRR_LLM_PROVIDER={settings.llm_provider} is recorded, but Phase 0 makes no LLM calls.")
    try:
        scope = Scope(**scope_kwargs)
        bundle = load_bundle(evidence)
        record, issues = run(scope, bundle, llm_provider=settings.llm_provider)
    except (ValidationError, ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    paths = write_outputs(record, issues, out)
    errors = sum(i.level == "error" for i in issues)
    print(f"mode={record.mode.value} claims={len(record.claims)} gaps={len(record.gaps)} "
          f"errors={errors} warnings={len(issues) - errors}")
    for p in paths:
        print(f"wrote {p}")
    return 1 if has_errors(issues) else 0


def _check_sources(evidence: Path, file_args: list[str]) -> int:
    try:
        bundle = load_bundle(evidence)
        files = {}
        for item in file_args:
            sid, sep, path = item.partition("=")
            if not sep or not sid or not path:
                raise ValueError(f"--file expects SOURCE_ID=PATH, got '{item}'")
            if not Path(path).is_file():
                raise FileNotFoundError(f"no such file: {path}")
            files[sid] = Path(path)
        results = check_bundle_files(bundle, files)
    except (ValidationError, ValueError, FileNotFoundError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for r in results:
        print(f"{r.status.upper():8} {r.evidence_id}: {r.detail}")
    counts = {k: sum(r.status == k for r in results) for k in ("ok", "fail", "skipped")}
    print(f"{counts['ok']} ok, {counts['fail']} failed, {counts['skipped']} skipped")
    return 1 if counts["fail"] else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="frr", description="Financial research-to-report, Phase 0.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Build a research record from a scope and an evidence bundle.")
    p_run.add_argument("--company", required=True)
    p_run.add_argument("--objective", required=True)
    p_run.add_argument("--evidence", required=True, type=Path, help="Evidence bundle JSON.")
    p_run.add_argument("--sector", default="general")
    p_run.add_argument("--use-case", default="company_credit")
    p_run.add_argument("--period")
    p_run.add_argument("--out", required=True, type=Path)

    p_demo = sub.add_parser("demo", help="Run the China Re offline fixture example.")
    p_demo.add_argument("--out", type=Path, default=Path("output/china_re_demo"))

    p_val = sub.add_parser("validate", help="Validate an existing research_record.json.")
    p_val.add_argument("record", type=Path)

    sub.add_parser("schema", help="Print the ResearchRecord JSON Schema.")

    p_chk = sub.add_parser("check-sources", help="Check evidence excerpts against local source PDFs.")
    p_chk.add_argument("--evidence", required=True, type=Path, help="Evidence bundle JSON.")
    p_chk.add_argument("--file", action="append", default=[], metavar="SOURCE_ID=PATH",
                       help="Local PDF for a source id (repeatable).")

    args = parser.parse_args(argv)

    if args.command == "run":
        scope = dict(company=args.company, objective=args.objective, sector=args.sector,
                     use_case=args.use_case, period=args.period)
        return _execute(scope, args.evidence, args.out)
    if args.command == "demo":
        return _execute(DEMO_SCOPE, DEMO_FIXTURE, args.out)
    if args.command == "validate":
        try:
            record = ResearchRecord.model_validate_json(args.record.read_text(encoding="utf-8"))
        except (ValidationError, FileNotFoundError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        issues = validate_record(record)
        for i in issues:
            print(f"{i.level.upper():7} {i.code:28} {i.object_id}: {i.message}")
        print(f"{sum(i.level == 'error' for i in issues)} error(s), "
              f"{sum(i.level == 'warning' for i in issues)} warning(s)")
        return 1 if has_errors(issues) else 0
    if args.command == "check-sources":
        return _check_sources(args.evidence, args.file)
    if args.command == "schema":
        print(json.dumps(ResearchRecord.model_json_schema(), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
