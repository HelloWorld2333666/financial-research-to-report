# Status

_Last updated: 2026-10-26_

## Phase 1, step 1: real China Re evidence bundle (done)

- [`research/china_re/fy2025_bundle.json`](../research/china_re/README.md): 35 evidence items from two public HKEX filings (the FY2025 results announcement and the 2025 sustainability report). It has 7 findings, 6 claims, 5 candidate slide modules and 7 explicit gaps.
- Every item has a PDF page, a verbatim excerpt, a subject, a period and a unit. Issuer-specific metric definitions are recorded.
- New tooling: `frr check-sources` checks excerpts and values against the PDFs, and confirms the documents by SHA-256.
- **Verification so far:** automated excerpt and value check (35/35 ok), visual reading of every table value against its rendered column header, and recomputation of all derived figures. **This was done by an AI assistant, not a person.** Each item records that in `verified_by`. A human review checklist is in the bundle README.
- No paid API calls were made. The PDFs were downloaded from hkexnews.hk for checking and are not committed.

## Fixes from the 2026-10-27 evaluation

- **Company binding:** evidence bundles now declare their `company` and `company_aliases`, and a run under another company's name exits 2 with no output. Before this fix, the China Re bundle ran cleanly under "AIA Group Limited".
- **Exact summary values:** `summary.md` now prints exact, comma-separated values (e.g. 124,927,594 instead of `1.24928e+08`) and has a Subject column, so segment rows are distinguishable.
- **Still open:** numbers written in claim and finding text are not checked against evidence values. A claim with wrong figures is still marked "supported" if its cited evidence is verified. Derived figures were checked by hand.

## Works (exercised by tests and the examples)

- Scope validation. Unsupported use cases (sovereign, industry) and sectors are rejected with a clear message.
- A deterministic question frame for company/credit research, with an insurance variant (insurance revenue, combined ratio, core and aggregated solvency).
- Strict loading of an evidence bundle from JSON (unknown fields rejected).
- Computed claim support and question status. A question with any recorded gap is at most "partially answered".
- Automatic gaps for unresearched questions, missing metric values and claims that rest on unverified evidence.
- Integrity validation: references, duplicate ids, metric completeness, unsupported claims and slide modules, fixture/live separation, and attribution and checkability of verified live evidence.
- The CLI (`frr run | demo | validate | schema | check-sources`).

## Mocked or synthetic

- `fixtures/china_re_offline.json` is synthetic and is still used by `frr demo` and most unit tests.
- Evidence collection is manual. No LLM or search step exists yet, and the provider settings are recorded but unused.

## Unverified or limited

- **Human review of the real bundle is pending.** Until someone ticks the checklist, treat the figures as AI-verified only.
- The real bundle covers two years (FY2024–FY2025) from two documents. The full FY2025 annual report, rating agency publications and C-ROSS rules have not been reviewed, and the gaps say so.
- Findings and claims are deliberately conservative. Interpretations (`earnings_softer`, `underwriting_divergence`, `business_mix`) are labelled as such but have not been reviewed by a credit analyst.
- The pipeline still hasn't been compared against a completed professional China Re report.
- `check-sources` proves an excerpt is on the page. It cannot prove the right table column was read; the visual check covered that this time, but it isn't automated.

## Test results

Run with `pytest` on macOS (Darwin 25.6), Python 3.12.15, pydantic 2.14.1, pytest 9.1.1: **68 passed**, none skipped (2026-10-27). The real-bundle tests check structure and validation only; they need no PDFs or network. The PDF-based `check-sources` run (35/35 ok) was done manually against downloaded copies and is not part of `pytest`.

## Recommended next steps

1. Human review of the China Re checklist, then record the reviewer in `verified_by`.
2. Close the cheapest gaps: the FY2025 annual report (geographic split, risk disclosures, group combined ratio), the latest A.M. Best and S&P rating actions, and the NFRA C-ROSS minimum ratios.
3. Add a minimal Slide Planning step that turns claims and slide modules into a one-page "overview" Message–Evidence–Layout spec for China Re, the proposal's Overview Page case.
4. After that, add an LLM extraction step behind `FRR_ALLOW_PAID_CALLS`, scored against this hand-built bundle as ground truth.
