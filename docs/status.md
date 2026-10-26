# Status: Phase 0

_Last updated: 2026-10-26_

## Works (exercised by tests and the demo)

- Scope validation. Unsupported use cases (sovereign, industry) and sectors are rejected with a clear message.
- A deterministic question frame for company/credit research, with an insurance variant (combined ratio, solvency adequacy) and metric definitions.
- Loading an evidence bundle from JSON with strict schema parsing (unknown fields rejected).
- Computed claim support and question status. Input cannot assert that a claim is "supported".
- Automatic gaps for unresearched questions, missing metric values and claims that rest on unverified evidence. Explicit gaps (e.g. `not_disclosed`) are kept and not duplicated.
- Integrity validation: references, duplicate ids, metric completeness, unsupported claims and slide modules, and fixture/live separation.
- The CLI (`frr run | demo | validate | schema`) with meaningful exit codes.
- Output files: the record JSON, a validation report and a Markdown summary.

## Mocked or synthetic

- **All evidence in `fixtures/china_re_offline.json` is synthetic.** The company name is real. The sources, values (e.g. revenue 100 → 104, solvency ratio 180%), statements and claims are invented, and periods are labelled `FIXTURE-Y1/Y2`. Nothing in the demo output describes China Re's actual financials, ratings or disclosures.
- Evidence collection is not automated. The bundle stands in for what live research (an analyst, or an LLM with tools) will produce.
- The LLM provider configuration is recorded but unused. No API calls of any kind are made.

## Unverified

- The pipeline has **not** been run on real research material. Passing tests show the plumbing and rules behave as specified, not that the research output is accurate or useful.
- The question frame and metric definitions are a reasonable analyst checklist written by hand. They haven't been compared against a completed professional credit report.
- Metric definitions are generic. Issuers may define metrics differently (e.g. ROE on closing versus average equity), and the schema has no per-evidence "issuer definition" field yet.
- Verification status is set by whoever produces the bundle. Nothing yet checks a value against the source document.

## Test results

Run with `pytest` on macOS (Darwin 25.6), Python 3.12.15, pydantic 2.14.1, pytest 9.1.1: **31 passed**. All tests ran and none were skipped.

## Recommended next milestone (Phase 1: real research → report outline)

1. Build one real China Re evidence bundle from public filings (annual report, solvency report, rating actions), with locators. Verify each value by hand and mark it `verified`. Keep it in a git-ignored `private/` folder, or commit it if the user agrees the material is public.
2. Add one LLM-backed step behind `FRR_ALLOW_PAID_CALLS`: extract candidate evidence from a provided filing excerpt into `EvidenceBundle` JSON (validated by the existing schema). Log token usage and cost per run. Compare its output with the hand-built bundle.
3. Add a minimal Slide Planning step: a 3–5 page storyline plus a per-page Message–Evidence–Layout spec built from `claims` and `slide_modules`, and page types (overview, driver, synthesis, matrix) as described in the proposal.
4. Add an `issuer_definition` field for metric evidence, and a comparability check across periods (e.g. IFRS 17 or C-ROSS regime changes).
