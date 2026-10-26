# financial-research-to-report

The foundation for an AI research-to-report system. The goal is short (3–5 slide), evidence-grounded, information-dense financial research presentations for:

- company and credit analysis
- sovereign credit risk
- industry research

The intended workflow is Research Engine → Slide Planning → High-Density Editable Preview → Final PNG Rendering → QA → Revision Management.

**This repository is in Phase 1** (Phase 0 foundation plus the first real evidence bundle). It implements a small, deterministic Research Engine for one use case: public-company financial and credit research. Its output is a structured, validated research record. It preserves provenance from source to future slide module, so later planning and revisions don't have to redo the research.

No LLM calls are made and there is no slide generation yet. There are two examples:

- `frr demo` runs a **synthetic** fixture (`fixtures/`), which is not real research.
- [`research/china_re/`](research/china_re/README.md) holds a **real**, hand-built FY2025 evidence bundle for China Re. It is drawn from two HKEX filings, with page numbers, verbatim excerpts and a review checklist.

See [docs/status.md](docs/status.md) for what works, what is mocked, and what remains unverified.

## Quick start (macOS, Python ≥ 3.11)

```bash
python3 -m venv .venv            # or: uv venv --python 3.12 .venv
source .venv/bin/activate
pip install -e ".[dev,pdf]"      # or: uv pip install -e ".[dev,pdf]"

frr demo                         # China Re offline fixture -> output/china_re_demo/
pytest                           # run the test suite
```

`frr demo` writes the following files:

| File | Contents |
|---|---|
| `output/china_re_demo/research_record.json` | The full structured record (input to future slide planning) |
| `output/china_re_demo/validation_report.json` | Errors and warnings from integrity checks |
| `output/china_re_demo/summary.md` | Human-readable view, with an "OFFLINE FIXTURE" banner when applicable |

`output/` is git-ignored.

## Commands

```bash
frr run --company "Acme Corp" --objective "Assess leverage and refinancing risk." \
        --evidence path/to/bundle.json --sector general --out output/acme
frr demo [--out DIR]
frr validate output/acme/research_record.json
frr schema > research_record.schema.json
frr check-sources --evidence BUNDLE.json --file SOURCE_ID=path/to/source.pdf   # needs .[pdf]
```

Exit codes:

- `0`: OK (warnings allowed)
- `1`: the record has validation errors, or a source check failed
- `2`: invalid or unsupported input

Phase 0 supports use case `company_credit` with sector `general` or `insurance`. Any other use case or sector is rejected with a clear message.

## Data model (one paragraph)

A `ResearchRecord` contains:

- the **scope** (company, objective, use case, sector)
- deterministic **research questions** (each with the evidence it needs)
- **metric definitions**
- **sources** (with URL and document SHA-256), and **evidence** items pointing to a source, PDF page and verbatim excerpt, with `verified`/`unverified` status and who verified it
- **findings** (fact or interpretation) built on evidence
- **claims** linked to evidence directly or through findings
- **gaps** (missing information, each with a reason such as `not_disclosed`)
- **slide modules**: candidate proof blocks referencing claims

Each evidence bundle declares the `company` it is about (plus optional `company_aliases`). A run for any other company is rejected (exit 2). Claim support and question status are always *computed*, never taken from input. Questions or metrics without evidence become explicit gaps rather than answers. Details: [docs/architecture.md](docs/architecture.md).

## Configuration

Copy `.env.example` to `.env` (never commit it). `FRR_LLM_PROVIDER` / `FRR_LLM_MODEL` are recorded in output and reserved for the first LLM-backed step. `FRR_ALLOW_PAID_CALLS` must be set to `true` before any future paid call is allowed. It defaults to off.

## Repository layout

```
src/frr/schema.py       Pydantic data model (Source → Evidence → Finding → Claim → SlideModule)
src/frr/questions.py    Question templates and metric definitions for company/credit research
src/frr/pipeline.py     Scope → questions → bundle → computed support, status, gaps → outputs
src/frr/validation.py   Cross-reference, support and fixture/live separation checks
src/frr/config.py       Environment settings (provider, model, paid-call guard)
src/frr/sourcecheck.py  Check evidence excerpts and values against local source PDFs
src/frr/cli.py          `frr` command
fixtures/               Synthetic offline fixtures only, never verified research
research/               Real evidence bundles built from public sources (with verification notes)
tests/                  pytest suite
docs/                   Architecture and status notes
```

## Data handling

Don't commit API keys, private company documents, or confidential financial information. `.gitignore` excludes `.env`, `output/`, `private/`, `*.docx` and `*.pdf`. The project proposal document is intentionally kept outside the repository.
