# VIS V1 Renderer-independent visualization spec and native adapter: results

**Branch:** `feature/workspace-v2`. Local commits only. Follows `VIS-01-…ARCHITECTURE.md` §5 and §8 (V1).
**Date:** 2026-11-03. Before starting, M6's shell work was committed as an "in progress" checkpoint (`edf32ee`) so V1 could change the shared panel files without mixing the two. M6's acceptance pass is still open.

## Delivered

| Area | What exists now |
|---|---|
| **`frr-viz/1` spec** (`app/web/src/core/viz.ts`; `app/server/viz.py`) | The authoritative definition of a chart: stable `id`, `title`, `family` (column, bar, line, area, pie, doughnut, scatter, combo), `subtype` (clustered, stacked, percent), a **view** over working datasets, and `missing: 'gap'` (zero-fill can't even be expressed). Validated by a pydantic model on save; an invalid spec (for example a 3-D family or a vendor `option` blob) is refused with 400 |
| **Views** | `none` (time series, optional period range); `latest` (latest period every dataset has) or `at`; `rank` (sorted cross-section); `diff` (end − start; units become **pp** for % measures); `pct_change`; and paired x/y over time for scatter |
| **Provenance per value** | Every projected value carries its source: the evidence id behind the working value (with an "edited" flag), or for derived values the **formula and both inputs**, each with its own evidence |
| **Native adapter** | `realize(spec)` gives the GenOffice chart type, direction, categories, series and colours, **always with the full data**, so a rebuild never depends on old values. Horizontal rankings are reversed so they read top-down. Single-period and change views are titled by what they show ("Change: … 2022–2025, pp") so the unit is never misstated |
| **Shape rules** (meaning rules are V2) | Refused with a reason: line or area without a time axis; pie or doughnut that isn't one series at one period, or has missing or negative values; mixed units on one axis (except combo); stacking with fewer than two series; stacked area (not in the engine); scatter without exactly two datasets |
| **Commands** | `slide.compose` builds visuals from specs (`viz`) or the old shape (`chart`). `viz.update` replaces a spec. `viz.change` changes the visual **and keeps the data**: same datasets and provenance, optionally a new view (`transform`, `at`, `between`). One undo step, refused atomically. `chart.addSeries` adds a dataset to the spec (same unit only). A pasted chart gets a new spec id. Data edits re-realize every visual that reads the dataset |
| **Integrity on the spec** | Client and server compare the chart on the slide with the realization of its spec from **current working data**: values, categories, and scatter x values. The server reads scatter points (`c:xVal`/`c:yVal`), which it couldn't before |
| **Migration** | Decks saved by M1–M5 open with their `chart` bindings converted to specs (time-series view of the same datasets; deterministic id from the element id). The server still checks old-style bindings in decks saved before V1 |
| **Composer** | Emits `viz` specs. The France deck keeps its line charts on purpose: choosing better visuals is V2 |
| **Panels and agent** | The Evidence panel lists every value a visual shows, including derived ones with formula and inputs. The Data tab follows a selected visual's datasets. The agent still sees "a chart" (title, metric, datasets, and now the family) |

## Acceptance (VIS-01 §8, V1)

| Criterion | Result |
|---|---|
| The France deck re-realizes from specs with integrity OK | **Pass.** The M6 France project (charts saved as old bindings, including Italy added in M4) opened with all three charts migrated to specs; integrity OK, 30/30 bindings, 36 points. A freshly composed deck is built from `viz` specs (test fixtures regenerated; 29 headless browser checks pass) |
| Each native family round-trips save/reopen and undo | **Pass (unit).** Eleven cases (column, stacked, 100%, ranked bar, change bar, line, area, pie, doughnut, scatter, combo): built from a spec, integrity OK, spec identical after save → reopen, undo removes it, redo restores it with integrity OK |
| Gaps preserved through type change | **Pass.** Line → column with France 2023 deleted keeps the gap (null) and integrity; then → horizontal ranking. Each change is one step; an invalid change (line → pie with no single period) is refused and leaves the spec and undo stack untouched |
| Server agrees with the client | **Pass.** `viz-parity.json` (written by the client) has 11 specs, including a working-layer gap; the Python projection matches categories, values and scatter x exactly. Server integrity catches a data edit under a visual and a spec that no longer matches the chart |
| In the app | **Pass.** With the debt chart changed to a horizontal bar of the 2022–2025 change (scripted command; the menu is V2): France +4.3, Germany −1.3, Italy −1.7 pp; titled "Change: general government gross debt, 2022–2025, pp". It survived a reload. With the chart selected (real click), the Evidence panel shows `end − start` with 111.4 (2022) and 115.7 (2025), each with its Eurostat query (`vis-01/v1-change-visual-evidence.jpg`) |

**Tests:** vitest 69 + 3 skipped (new `viz.test.ts`: 23), pytest 235 (new `test_viz.py`: 6), `tsc` clean.

## Found during V1

1. **Mixed units are now refused, and that changed three tests.** Earlier tests and browser checks added Germany's GDP growth (%) to the debt chart (% of GDP); the spec refuses that. The checks now use same-unit datasets, and one test asserts the refusal.
2. **A change view kept its time-series title.** After changing the debt chart to a change view, it still read "Gross debt, % of GDP" while showing pp. Single-period and change views now take their title from the view.
3. **The server couldn't read scatter charts** (points live in `c:xVal`/`c:yVal`). Fixed, so server integrity covers scatter.

## Known limits (for V2)

- **Meaning rules aren't in yet.** V1 refuses what a family *cannot draw*, not what it *shouldn't mean*. A pie of two countries' debt ratios passes the shape rules (positive, one period) even though ratios aren't parts of a whole; one V1 test builds exactly that to exercise the adapter. V2 adds dataset metadata (`measure_kind`, `additive_parts_of`, `scale`) and the hard constraints that refuse it.
- **No "change visual" menu or agent tool yet.** `viz.change` is a command; the menu, `propose_visual` and `change_visual` are V2.
- **Titles of single-period and change views are generated;** a custom title override for those views is not in V1.
- **Colours:** cross-section views use one colour per series (no highlight of a focus country yet).
- **Combo** puts the last dataset on the secondary axis (the engine's convention); choosing which series is the line is V2/V3.
