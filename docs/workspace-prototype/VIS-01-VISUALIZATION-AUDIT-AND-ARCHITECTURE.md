# VIS-01 Intelligent visualization system: audit and proposed architecture

**Status:** investigation and design for your approval. Nothing in the product changed except an audit test. M6 is paused (its shell changes stay uncommitted in the working tree).
**Date:** 2026-11-03.
**Scope note:** your brief was cut off partway through section 4 (it ends at "Do not store only an opaque vendor-specific `option` object as the authoritative chart definition."). Everything below covers sections 1–4. If there are further sections, send them and I'll fold them in before implementation.

## Summary

1. **Our editor is not limited to line charts. Our *product logic* is.**
   - The vendored GenOffice engine writes **13 chart types**. All 13 insert, parse, render, survive save/reopen and undo/redo, accept data edits and change type in our app. That is tested, not inferred (`app/web/src/engine/chart-capability.test.ts`).
   - The France deck is all lines for three reasons:
     - our composer hard-codes `type: "line"`;
     - our chart binding type allows only `'line' | 'bar'`;
     - no layer reasons about *why* a chart fits.
2. **The engine renders semantically invalid charts without complaint.** It drew a stacked and a 100% stacked chart of three countries' debt ratios. Those are not parts of a whole, and a missing value made 2023 look like a fall in total debt. **Hard, deterministic constraints must run before anything reaches the renderer.**
3. **Three data-integrity defects:** F2 is confirmed by test, F3 by source and screenshot, and F4 is in upstream code we don't vendor:
   - **F2 (confirmed):** the engine's chart rebuild turns gaps into zeros when a chart edit doesn't resend the data. That includes **every type change and every style-only edit** (`v ?? 0`). We are safe today only because our re-projection always resends series.
   - **F3 (source + screenshot):** stacked and 100% stacked totals treat missing values as 0.
   - **F4 (upstream, not vendored):** the upstream data dialog converts empty or invalid cells to 0, as you found.
4. **Rendering quality is mixed:**
   - **Good:** columns, bars, line with gaps, pie, doughnut and combo with a secondary axis.
   - **Poor defaults:** standard area (opaque overlapping series hide each other), scatter with years (the x-axis starts at 0) and 3-D (crammed axes; 3-D also distorts comparisons).
5. **Recommendation:** make a **renderer-independent visualization spec** (`frr-viz/1`) the authoritative chart definition, bound to Evidence Core views. A **deterministic recommender** (intent → data profile → candidates → hard constraints → scoring) sits on top of it, with the model only classifying intent and wording explanations. GenOffice charts become one *realization* of the spec, regenerated and integrity-checked like today's bound charts. Visuals the engine can't draw natively (dumbbell, slope, waterfall, dot plot, small multiples…) are realized as editable grouped shapes from the same spec.
6. **Phasing** (section 8):
   - **V0:** fix the gap defects (small, independent).
   - **V1:** the spec and adapter for native types.
   - **V2:** the recommender and the "change visual" flow.
   - **V3:** composite visuals.
   - **V4:** financial structures, distributions, and an evaluation of maps, flows and diagrams.

## 1. How the audit was done

- **Upstream source:** read at our pinned GenOffice commit `36a509e8`. A full copy from Phase 2 was verified file by file: **292/292 hashes match** our manifest. That covers `ChartTypeDialog.tsx`, `ChartDataDialog.tsx`, `ChartBody.tsx`, `ai/slides-skill.ts`, `pptx-engine` (`chart.ts`, `chartex.ts`, `chart-insert.ts`, `chart-workbook.ts`, `editChartElement`), `pptx-render/build-chart.ts` and `pptx-ops` (`addChart`, `setChart`).
- **Our integration:** `app/web/src/core/{commands,evidence,integrity,types}.ts`, `app/server/{composer,agent}.py` and the four vendor patches.
- **Executed audit:** `app/web/src/engine/chart-capability.test.ts` drives each of the 13 writable types through **our real store and commands**. Each type is inserted with two series containing gaps, then checked through these steps:
  - parse;
  - render (primitives counted);
  - save → reopen;
  - undo → redo;
  - data edit;
  - type change to and from column;
  - style-only edit;
  - our evidence-bound compose with integrity, and a gap edit through the working layer.

  The raw result is in `vis-01/audit-matrix.json`. The test now **asserts** these facts, including F2 as a known failure that must be flipped when fixed.
- **Visual check:** all 13 rendered in the running app (four per slide; inserted by script, viewed in the built-in browser). Screenshots are in `vis-01/`.

### Levels used below

| Level | Meaning |
|---|---|
| **L1 Library** | The engine source supports it in principle |
| **L2 Renderable** | It renders in our app (verified by test and screenshot) |
| **L3 Editable** | A user can create and edit it **in our app** today |
| **L4 AI** | Our agent can create or edit it |
| **L5 E2E** | Exercised end to end with real input in the browser |

## 2. Capability matrix

### 2a. Types the engine can write (13)

Legend: ✓ yes (tested) · ✗ no · ~ partly · "src" = source only, not tested.

| Type | L1 write | L2 renders in our app | Gap handling (render) | Save/reopen · undo/redo | Data edit (engine) | Type change (engine) | Keeps gaps on type/style change | Manual insert in our app | Manual type change in our app | Bound to Evidence (adapter) | AI can create | AI can change type | Quality (observed) | L5 E2E |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Clustered column | ✓ | ✓ 6 bars (8 − 2 gaps) | ✓ missing bar | ✓ · ✓ | ✓ keeps null | ✓ | ✗ F2 | ✗ | ✗ | ~ allowed by type, unused | ✗ | ✗ | Good | ✗ |
| Stacked column | ✓ | ✓ | ✗ **missing = 0 in total (F3)** | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ (type-cast only) | ✗ | ✗ | Renders; **misleading with gaps** | ✗ |
| 100% stacked column | ✓ | ✓ | ✗ **F3: shares of an incomplete total** | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ (type-cast only) | ✗ | ✗ | **Misleading with gaps** | ✗ |
| Horizontal bar | ✓ | ✓ | ✓ | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ (type-cast only) | ✗ | ✗ | Good; legend order reversed vs bars | ✗ |
| Line | ✓ | ✓ 4 segments for 2 series | ✓ **breaks at gaps** (our patch 0001) | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✓ used by the France deck | ✓ via composer | ✗ | Good | ✓ (M1–M6 scenario) |
| Area | ✓ | ✓ | ✗ one shape across the gap | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ (type-cast only) | ✗ | ✗ | **Poor: opaque overlapping series hide each other** | ✗ |
| Pie | ✓ | ✓ wedges | ✓ null slice dropped | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✗ binding semantics wrong (dates as slices) | ✗ | ✗ | Good | ✗ |
| Doughnut | ✓ | ✓ | ✓ | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✗ (as pie) | ✗ | ✗ | Good | ✗ |
| Scatter | ✓ | ✓ markers | ✓ point omitted | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✗ x must be numeric pairs; ours are dates | ✗ | ✗ | **Poor default: years on an axis starting at 0** | ✗ |
| Radar | ✓ | ✓ | src | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ | ✗ | ✗ | Adequate; rarely right for finance | ✗ |
| Combo column + line | ✓ | ✓ secondary axis | ✓ | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ~ | ✗ | ✗ | Good (dual axis needs a rule) | ✗ |
| Pie 3-D | ✓ | ✓ projected | ✓ | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✗ | ✗ | ✗ | Renders; **3-D should not be offered** | ✗ |
| Column 3-D | ✓ | ✓ projected | ✓ | ✓ · ✓ | ✓ | ✓ | ✗ F2 | ✗ | ✗ | ✗ | ✗ | ✗ | **Crammed axis; should not be offered** | ✗ |

"Bound to Evidence (adapter)":
- Our `slide.compose` passed every type straight to the engine, and integrity checks passed for all 13. That only means the numbers match.
- A pie bound to two time series draws years as slices, which is meaningless. **Integrity proves data fidelity, not semantic validity.** That is the gap the spec and recommender must close.

### 2b. Types the engine reads and draws, but cannot create

| Type | L1 | Status |
|---|---|---|
| Bubble (`c:bubbleChart`) | parse + render (src) | Not writable; not tested |
| Stock / high-low-close (`c:stockChart`) | parse + render (src) | Not writable; not tested |
| Bar-of-pie / pie-of-pie (`c:ofPieChart`) | parse + render (src) | Not writable; not tested |
| Funnel, sunburst (chartEx) | parse + render (src) | Not writable; not tested |
| Waterfall, treemap, histogram, box-and-whisker, Pareto (chartEx) | ✗ | Parser returns null → placeholder chip |

### 2c. Not in the engine at all

Dot plot, lollipop, dumbbell, slope, diverging bar centred on zero (possible as a bar with negatives, without a semantic baseline), step line, small multiples, fan chart, bullet, heatmap or sensitivity matrix, yield curve (as a line over tenor, possible), maturity ladder, rating timeline, maps, Sankey and network diagrams.

### 2d. UI and AI surfaces (upstream vs ours)

| Surface | Upstream GenOffice | Our app |
|---|---|---|
| Chart type dialog | 13 kinds (`ChartTypeDialog.tsx`) | **Not vendored**: no chart insert or type change UI |
| Chart data dialog | Edits cells; **empty or invalid → 0** (`ChartDataDialog.tsx:67`) | **Not vendored**. Data is edited only through the Evidence working layer (Data tab), which keeps gaps |
| AI `edit_chart` | 6 kinds: bar, barStacked, line, area, pie, doughnut | **No chart-type tool.** `compose_deck` emits line only; `add_comparison` adds a series |
| Gap writing | `dispBlanksAs="gap"` and missing points omitted on insert | Same, plus our render patch for lines |

### 2e. Findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | Composer and binding type restrict us to line (and bar) | `composer.py` uses `"type": "line"` everywhere; `types.ts` `ChartSpec.type: 'line' \| 'bar'` | Product gap |
| F2 | `setChart` without series (type change, style-only edit, row/column swap) rebuilds values with `v ?? 0` | `pptx-engine/src/index.ts` (about line 3002); audit test: all 13 types | **Data integrity**; latent for us, blocks any type-change feature |
| F3 | Stacked and 100% stacked totals treat missing as 0 | `build-chart.ts:499`, `:2388`; screenshot `1-columns-and-bars-zoom.png` | **Misleading output** |
| F4 | Upstream data dialog zero-fills | `ChartDataDialog.tsx:67` | Must never be adopted as-is |
| F5 | Area: overlapping opaque series hide each other; gaps not broken | Screenshot `2-…`; test: 1 shape per series | Quality |
| F6 | Scatter x-axis starts at 0 for year-like x | Screenshot `3-…` | Quality |
| F7 | 3-D types render but distort and cram axes | Screenshots `3-…`, `4-…` | Should be excluded from the vocabulary |
| F8 | The engine and our integrity check accept semantically invalid charts (pie of time series; stacked non-additive ratios) | Audit compose + screenshots | **Architecture gap: needs hard constraints** |

## 3. Visualization vocabulary

The vocabulary is organized by **analytical relationship**, following the Financial Times Visual Vocabulary's nine relationships (deviation, correlation, ranking, distribution, change over time, magnitude, part-to-whole, spatial, flow) and the EU Publications Office's data visualisation guide ("choose the chart from the message"). It is extended with financial structures and non-chart layouts.

| Intent (your §2) | Typical question | Candidates | Required data shape (hard) | Realization path |
|---|---|---|---|---|
| **A. Change over time** | How has debt-to-GDP moved since 2002? | Line · column (few discrete periods) · step (policy rates, ratings) · area (only a single series, or a genuine stacked total) · slope (2 points) · small multiples (many entities) · fan (published forecast bands only) | Ordered time axis; same unit; observed and forecast flagged | Native line/column/area; **composite** step, slope, small multiples, fan |
| **B. Ranking, cross-section** | How do seven countries' 2026 deficits compare? | Ranked horizontal bar · dot plot · lollipop · conditional-format table | One period (or an explicit aggregate); same unit; sorted | Native bar (sorted view); **composite** dot, lollipop; table |
| **C. Deviation, change** | Actual vs budget; 2026 vs 2012 | Diverging bar (zero baseline) · dumbbell · slope · variance bar · waterfall (additive contributions only) | Two comparable values per entity, or signed deltas | **Composite** dumbbell, slope, waterfall; native bar for signed deltas |
| **D. Part-to-whole** | Revenue by segment | Stacked bar · 100% stacked · treemap · pie or doughnut (≤ 6 parts) · composition table | **Parts of a genuine total** (metadata), non-negative, complete | Native stacked/pie; **composite** treemap |
| **E. Relationship** | Spreads vs debt ratios | Scatter · bubble · correlation matrix · small multiples | Paired numeric observations (same entity and period); n ≥ about 8 | Native scatter (fixed axes); bubble needs a writer; matrix as a table; caption: correlation ≠ causation |
| **F. Distribution, uncertainty** | Peer valuation spread | Histogram · box plot · range plot · bands | Many observations; bands only from sources | **Composite** histogram, box, range |
| **G. Financial structures** | Yield curve; maturity ladder; rating history; bridge; sensitivity | Yield curve (line over tenor) · maturity ladder (columns by year) · rating timeline (step on an ordinal scale) · rating table · bridge/waterfall · sensitivity heatmap table | Tenor/maturity axis; **ordinal rating scale** (never averaged numerically); additive bridge components | Native line/column; **composite** step, bridge; table with conditional formats |
| **H. Spatial, flow, network** | Regional exposure; ownership; capital flows | Choropleth or tile map · Sankey · network or ownership diagram | Geography codes; flow source → target → value; graph | **Separate diagram model** (not a statistical chart); evaluate later |
| **I. Non-chart** | Headline figure; rating summary; process | KPI spotlight · financial table · rating table · timeline · comparison cards · risk matrix · process or org diagram · argument-and-evidence layout | — | Slide layouts and shapes bound to evidence (we already bind tables and text figures) |

## 4. Recommendation system (deterministic first)

```
user request ─▶ 1 intent ─▶ 2 data profile ─▶ 3 candidates ─▶ 4a hard constraints ─▶ 4b scoring ─▶ 5 recommend (+1–2 alternatives) ─▶ 6 user may override (any valid mapping)
                 (model:     (code: Evidence      (code: rules     (code: cannot be      (code:          (model words the one-line
                 classify,    Core metadata)       by intent ×      overridden by the     weights)        reason; code supplies the facts)
                 or ask)                           shape)           model)
```

1. **Intent.**
   - The model maps the request to one intent from the table.
   - If the request is ambiguous it **asks one question** instead of guessing. For example, "France vs the PIIGS" could mean convergence over time, the current ranking, or the change since 2012.
   - The selection and the canvas context (a selected chart or table) disambiguate where possible.
2. **Data profile:** computed from Evidence Core metadata, never guessed by a model:
   - measure kind (stock, flow, rate, share, change, index, rating);
   - unit, frequency and the time span;
   - number of entities and series;
   - completeness per series and period (gaps), and signs (negatives);
   - observed vs forecast;
   - additivity (`parts_of: <total>`), ordinal scales;
   - derived-measure validity (from the M3 derivations).

   This needs a few new metadata fields on datasets: `measure_kind`, `additive_parts_of` and `scale` (ordinal for ratings).
3. **Candidates:** the intent row's candidates, filtered to what the data shape allows. Usually 2–4.
4. **Evaluate.**
   - **(a) Hard constraints**, examples:

     | Rule | Rejects |
     |---|---|
     | Part-to-whole needs a genuine total | Pie, 100% stack or treemap of debt ratios across countries (exactly what F8 showed) |
     | Stacks need complete, additive, same-unit parts | Any stack with gaps (F3) or mixed units |
     | No negatives in pie or treemap | — |
     | Time on x needs ordered periods; a single period has no time axis | Line for a cross-section |
     | Bars start at zero | Truncated bar axes (dot plots may truncate) |
     | One axis, one unit; dual axis only on explicit request and flagged | Mixed-unit single axis |
     | Missing data stays a gap | Zero-fill; interpolation only if flagged and visible |
     | Ratings use an ordinal scale | Averaging ratings as numbers |
     | Forecasts styled differently from actuals; uncertainty bands only from sources | Invented fan charts |
     | Correlation needs paired observations and n ≥ threshold, with a "not causal" caption | Scatter of unpaired data |
     | No 3-D | All 3-D variants |
     | Legibility at slide size | More than about 7 series on a line, more than 6 pie slices, more than about 25 categories on a column → suggest small multiples or a table |

   - **(b) Scoring** (weights, tunable):
     - semantic fit (from the intent table);
     - ease of the comparison the intent asks for;
     - completeness;
     - density at the actual frame size;
     - design-system fit;
     - editability (native > composite > picture);
     - rendering reliability (from this audit);
     - accessibility (colour count, direct labels).
5. **Recommend.** One line from code-supplied facts, for example: *"Recommended: ranked horizontal bar. It compares seven countries' 2026 balances at one point in time; the bars diverge from zero because four balances are negative."* Optionally 1–2 alternatives, for example a compact table. No essay by default.
6. **Override.**
   - "Change visual" lists **only the visuals the current data mapping allows**. Others are greyed with the reason ("needs parts of a total").
   - The user's choice always wins within the hard constraints.

**Worked example:** "compare seven countries' 2026 fiscal balances". Intent B (ranking), one period, 7 entities, mixed signs, % of GDP.
- Candidates: ranked bar, diverging bar, dot plot, table.
- Hard rules remove line (single period) and pie (not parts).
- Recommendation: a ranked horizontal bar diverging from zero; alternative: table.

## 5. Renderer-independent visualization spec (`frr-viz/1`)

```
Evidence (immutable) ─▶ Working dataset (edits, M3) ─▶ View (filter · transform · derive, typed) ─▶ VizSpec (authoritative) ─▶ Realization (adapter) ─▶ GenOffice slide object (editable)
                                                                                                      ▲                         │
                                                                                                      └──── integrity: realization == project(spec, view) ◀┘
```

Sketch (TypeScript; final names to be settled in V1):

```ts
interface VizSpec {
  schema: 'frr-viz/1'
  id: string                          // stable, independent of the slide element
  intent: 'trend' | 'ranking' | 'deviation' | 'composition' | 'relationship' | 'distribution' | 'financial' | 'kpi' | 'table'
  family: string; subtype?: string    // e.g. 'bar' / 'ranked-horizontal', 'dumbbell', 'line' / 'step'
  view: {
    datasets: { id: string; revision: string }[]          // working-layer revision hash, not just the id
    filter?: { entities?: string[]; periods?: { from?: string; to?: string; at?: string } }
    transforms?: Array<{ op: 'latest' | 'rank' | 'diff' | 'pct_change' | 'share_of' | 'index_100' | 'yoy'; args?: any }>
    derivations?: string[]                                 // M3 derivation ids used by derived marks
  }
  encoding: { x?: Field; y?: Field; color?: Field; size?: Field; label?: Field; order?: Field; detail?: Field }
  scales?: { y?: { zero?: boolean; min?: number; max?: number; type?: 'linear' | 'log' }; x?: { type?: 'time' | 'band' | 'ordinal' | 'linear' } }
  format: { unit: string; decimals?: number; suffix?: string }
  sort?: { by: string; dir: 'asc' | 'desc' }
  missing: 'gap' | 'interpolate-flagged' | 'drop-category'       // never 'zero'
  forecast?: { from: string; style: 'dashed' | 'lighter' }
  annotations?: Array<{ text: string; at?: any; ref?: { evidence?: string; derivation?: string } }>
  legend?: { show: boolean; position?: 'b' | 'r' | 'none'; direct?: boolean }
  layout?: { w: number; h: number }; theme?: string
  provenance: 'derived-from-view'     // every mark resolves to evidence or a derivation through the view (checked, not stored per mark)
  realization?: { adapter: 'genoffice-native' | 'composite-shapes' | 'picture'; elementId: string; engineKind?: string; dataHash: string }
}
```

- **Authority:** the spec plus the Evidence view, never a vendor option object. The GenOffice chart (or shape group) is a realization that is regenerated whenever the view's data changes. Integrity compares the realization with `project(spec, view)`, extending what we already do for charts and tables.
- **Storage:** sidecar binding `{ kind: 'viz', spec }` replaces today's `ChartSpec`, with a migration hook. Old bindings map to `family: 'line'`.
- **Adapters:**
  1. **genoffice-native:** column, bar, line, area, stacked, combo, scatter, pie and doughnut. These are editable in PowerPoint as charts (requires F2 fixed so type changes keep gaps).
  2. **composite-shapes:** dumbbell, slope, lollipop/dot, waterfall/bridge, step, small multiples, KPI, rating timeline. Built as grouped DrawingML shapes from the spec. Editable as shapes, re-realized on data change, bound to the same evidence.
  3. **picture (last resort, later):** maps or Sankey drawn by a chart library to SVG/PNG. Low editability, so flagged in the UI and kept out of V1–V3.
- **Conversion:** computed, not stored. The set of families valid for the spec's view (the hard constraints) is what "Change visual" offers. Converting keeps view, format, annotations and provenance, and only re-maps the encoding.
- **AI tools** (replacing implicit line-only composition):
  - `propose_visual(intent, datasets|selection)` returns candidates with reasons;
  - `change_visual(viz_id, family)` is validated against the hard constraints.

  Both return proposals with preview, as in M4. The model never writes numbers or bypasses constraints.

## 6. What this means for the France deck

| Slide | Today | With VIS |
|---|---|---|
| Debt | Line FR vs DE 2022–2025 | Line (trend), or a slope chart if the message is "2022 → 2025"; Italy and Spain as small multiples if many peers |
| Fiscal | Line deficit + interest table | Diverging bar of the 2025 balance across peers (ranking), plus a trend line if asked |
| Markets | Growth line + yield table | Spread over Germany as a ranked bar or dumbbell (2022 vs 2025); yield curve if tenor data is added |
| Ratings | Ratings table (M5) | Rating timeline (step on an ordinal scale) when several actions exist; the table otherwise |

## 7. Risks and open questions

- **Composite visuals** are editable as shapes, not as PowerPoint "charts" (no Edit Data in PowerPoint). That's acceptable for consulting decks, but it's a decision (D-V2).
- **Metadata:** measure kind and additivity must be recorded at ingestion, from Eurostat dimensions or user confirmation. A wrong flag defeats the constraints, so the default is "not additive".
- **F2 is in vendored code**, and the fix is a patch we own (like 0001–0004), small and testable.
- **Local model:** intent classification and explanations are within Qwen 14B's reach (M4 showed reliable tool choice). Selection itself is code.

## 8. Proposed phases (for approval)

| Phase | Scope | Accept when |
|---|---|---|
| **V0 Integrity fixes** (≈1 day) | Patch 0005: `setChart` rebuild keeps nulls (type, style, switch row/col). Patch 0006: stacked totals skip missing and gaps are visible; area breaks at gaps with translucent overlapping series; scatter auto-ranges year-like x. Exclude 3-D from our vocabulary | The audit test's F2 assertions flip to `true`; screenshots show no misleading stack; existing suites green |
| **V1 VizSpec + native adapter** (≈4 days) | `frr-viz/1` schema (TS + Python validation); views with `latest`, `rank`, `diff`, `pct_change`; native adapter for column, bar, line, area, stacked, combo, scatter, pie and doughnut; binding migration; integrity on spec | The France deck re-realizes from specs with integrity OK; each native family round-trips save/reopen and undo; gaps preserved through type change |
| **V2 Recommender + change visual** (≈4 days) | Data profile from metadata (`measure_kind`, `additive_parts_of`, `scale`); hard-constraint engine; scoring; `propose_visual` / `change_visual` tools; "Change visual" menu with reasons; the composer uses the recommender | The seven-country 2026 balance request yields a ranked diverging bar (alternative: table); pie and stack are refused for ratios with a reason; the France deck is no longer all lines; human override works within the constraints |
| **V3 Composite visuals** (≈5 days) | Dumbbell, slope, dot/lollipop, waterfall/bridge, step, small multiples, KPI spotlight, rating timeline, all evidence-bound | Each renders at slide size, survives save/reopen, re-realizes on data edits, and shows provenance in the Evidence panel |
| **V4 Financial structures and evaluation** (≈4 days) | Yield curve, maturity ladder, sensitivity heatmap table, histogram/box/range; evaluation note on maps, Sankey and network diagrams (diagram model, picture adapter) | Each with the hard constraints from §4; recommendation on H-type visuals for your decision |

## Decisions for you

- **D-V1:** approve `frr-viz/1` as the authoritative chart definition, with GenOffice charts as realizations.
- **D-V2:** accept composite (shape-based) realizations for visuals the engine can't draw natively, editable as shapes rather than as PowerPoint charts.
- **D-V3:** exclude 3-D charts from the vocabulary entirely.
- **D-V4:** order: V0 first (independent fixes), then V1 → V2 → V3 → V4. Also whether to resume and finish M6 (acceptance pass remaining) before V0, or after.
- **The truncated brief:** send any sections after §4.

## Sources

- Financial Times, Visual Vocabulary (chart-doctor): https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md
- EU Publications Office, Data visualisation guide: choosing charts by the message: https://data.europa.eu/apps/data-visualisation-guide/choosing-charts-the-message and visual vocabulary: https://data.europa.eu/apps/data-visualisation-guide/visual-vocabulary
- UK Government Analysis Function, communicating analysis (charts guidance hub): https://analysisfunction.civilservice.gov.uk/support/communicating-analysis
- ONS service manual, data visualisation principles: https://service-manual.ons.gov.uk/data-visualisation/guidance/principles
