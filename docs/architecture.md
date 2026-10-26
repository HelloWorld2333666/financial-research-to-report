# Architecture (Phase 0)

## Design goals

- **Provenance first.** Every claim must trace back to evidence, and every piece of evidence must trace back to a source and a location within it. The proposal's chain is *Source → Metric/Fact → Claim → Proof Block → Slide*. Phase 0 implements it up to a candidate slide module.
- **Deterministic where possible.** The question frame, support computation, gap detection and validation are plain Python. LLMs are reserved for open-ended judgement (relevance, analysis, feedback interpretation) and are not used yet.
- **No fabrication.** Missing data is recorded as a typed `Gap` with a reason. The pipeline never fills a gap with a guessed value.
- **Small.** One package, about 850 lines, JSON files for storage, one runtime dependency (`pydantic`).

## Flow

```
Scope (company, objective, use_case, sector)
   │  validate_scope: reject unsupported use cases/sectors
   ▼
plan_questions ──► ResearchQuestion[] + MetricDefinition[]     (questions.py)
   │
EvidenceBundle (JSON: fixture today; analyst/LLM-gathered later)
   │
   ▼
pipeline.run                                                   (pipeline.py)
   ├─ claim.support   = f(cited evidence verification)         computed, input ignored
   ├─ question.status = f(evidence, findings, metrics, verification)
   └─ auto gaps       : open questions, missing metric values, unverified claims
   ▼
validate_record ──► Issue[] (error | warning)                  (validation.py)
   ▼
research_record.json · validation_report.json · summary.md
```

## Data model

| Object | Key links | Notes |
|---|---|---|
| `Source` | none | `origin` is `fixture`, `retrieved` or `user_provided`; `source_type` (annual report, rating report, …) |
| `Evidence` | `source_id`, `question_ids`, `metric_id` | `kind` is `metric_value`, `fact` or `quote`; `locator` gives page/section; `verification` is `verified` or `unverified` |
| `MetricDefinition` | none | name, definition, unit, formula, caveats (e.g. IFRS 17 or C-ROSS comparability) |
| `Finding` | `question_ids`, `evidence_ids` | `nature` is `fact` or `interpretation` |
| `Claim` | `evidence_ids`, `finding_ids` | `nature`; `support` is computed as `supported`, `partially_verified`, `unverified` or `unsupported` |
| `Gap` | `question_ids`, `metric_ids` | reason is `not_disclosed`, `not_found`, `not_comparable`, `needs_verification` or `not_yet_researched`; `auto_detected` |
| `SlideModule` | `claim_ids` | candidate proof block: `proof_role` and `exhibit_hint` only, with no layout |

The three-way distinction the brief asks for maps onto the model as follows:

- **verified facts**: `Evidence.verification = verified`, plus `nature = fact`
- **interpretations**: `nature = interpretation`
- **missing information**: `Gap`

## Validation rules

Errors block use of the record:

- duplicate ids, or dangling references (to sources, questions, metrics, evidence, findings or claims)
- a claim with no reachable evidence; a finding with no evidence
- a slide module that relies on an unsupported claim
- `metric_value` evidence missing its metric, value, unit or period; qualitative evidence that carries a number
- fixture sources in a `live` record, or non-fixture sources in an `offline_fixture` record

Warnings call for reviewer attention:

- a claim that rests on unverified evidence
- evidence without a locator
- unverified live evidence
- a question with neither evidence nor a gap

## Choices and alternatives

- **JSON over SQLite.** One record per run, which is easy to diff, inspect and version. SQLite becomes worthwhile once there are many projects, or revisions need querying.
- **Pydantic.** It gives typed validation, strict "extra fields forbidden" parsing (useful once an LLM produces bundles), and JSON Schema export (`frr schema`).
- **No reused external code.** FinSight, PPTAgent and DeepPresenter informed the concepts (evidence/citation tracking, structured planning). No code was copied, so no third-party licences apply yet. Check each licence before vendoring any code later.

## Where the next stages attach

- **Live research**: produces an `EvidenceBundle` with `mode = live` and `origin = retrieved` sources. The rest of the pipeline is unchanged.
- **Slide Planning**: reads `claims`, `slide_modules` and `gaps` from `research_record.json`. It doesn't need to re-run research.
- **Revisions**: stable ids let a change to one evidence item be traced to the claims and modules it affects.
