# VIS V3 Composite visuals: results

**Branch:** `feature/workspace-v2`. Local commits only. Follows `VIS-01-…ARCHITECTURE.md` §5 (composite-shapes adapter, decision D-V2) and §8 (V3).
**Date:** 2026-11-03.

## Delivered

| Area | What exists now |
|---|---|
| **Eight composites** (`app/web/src/core/composite.ts`) | Dumbbell, slope, dot plot, lollipop, waterfall/bridge, step line, small multiples, KPI spotlight and rating timeline. Each is drawn as one **DrawingML group of ordinary shapes** (rectangles, circles, paths, text): editable as shapes in the app and in PowerPoint, never a picture |
| **Deterministic layouts** | Each layout is a pure function of the spec, the projection and the design space, so the group is rebuilt from the data on every change. Values use the same decimals rule as tables. Missing values are shown as missing ("2019 n/a", a note, a break in a line), never zero |
| **New views** (`viz.ts`, mirrored in `viz.py`) | `pair` (two periods per entity, each value with its own evidence) for dumbbell, slope and KPI. `bridge` (one dataset: the start level, each period's change as a derived `end − start` with both inputs, the end level). `ratings` (rating-action evidence on an ordinal notch scale). Undated actions are listed, not placed |
| **Rating scale** (`ratings.ts`, `viz.py`) | S&P/Fitch, Moody's and Morningstar DBRS symbols on one ordinal notch index (AA- = Aa3 = AA (low)). It is used for drawing only, never averaged. Unknown symbols are refused |
| **Identity across rebuilds** | `realizeAt` replaces the bound element with its new realization (composite → composite, chart → composite, composite → chart). It **reuses the element's creationId**, so the durable id stays the same, and so do the binding key, the selection and chat references. Z-order and placement are kept. A group keeps its design space, so a resize by the user scales it. A bound composite cannot be ungrouped into loose shapes |
| **Integrity** | Client: a fresh layout from current data must match the group: each data mark's value (named `frr-mark <series> <category> <value>`), each mark and value label's position (±1 px) and each label's text. Server (`integrity.py`): reads the group's mark names from the saved PPTX and compares the values with its own projection, including rating notches against the evidence |
| **Layout versions** | Groups record the layout version. A drawing from an earlier layout version is still checked on its values. Positions and labels are compared again after **Redraw** (re-project), which the status line offers |
| **Rules** (`constraints.ts`) | **Invalid:** a bridge with a missing period (with a fix: the gap-free range); a KPI of several datasets; a rating timeline without a dated action; plus the composites' shape rules. **Warnings:** small bridge steps next to the level; a step line on continuous data; more than 25 dot/lollipop rows or 15 dumbbell rows; more than 10 slope lines; more than 12 panels |
| **Recommender** (`recommend.ts`) | Composites are options per intent, and two intents are new. Many series over time → **small multiples** ("7 series over 11 periods: one panel each on the same scale…"). One dataset's change → **bridge**. Several entities' change → diverging bars, with dumbbell, slope and lollipop as alternatives. **spotlight** → KPI (latest vs the period before). **ratings** → rating timeline |
| **Agent and chat** | `propose_visual` accepts `spotlight` and `ratings` (it collects the project's rating actions). `change_visual` accepts the composite families and views (`two_periods`, `bridge`). The chat cards and the change-visual menu list composites with the same three states |
| **Evidence panel** | Lists every value a composite shows: evidence cards for observations, formula and inputs for bridge changes, and symbol, outlook and date for rating actions, with undated actions listed |

## Acceptance (VIS-01 §8, V3)

| Criterion | Result |
|---|---|
| **Renders at slide size** | **Pass.** All nine families render as one group across the full chart frame (1200 × 400 px). In the app, with real Eurostat data for seven countries fetched through the chat:<br>• **small multiples** of balances 2015–2025, recommended (`vis-01/v3-small-multiples.jpg`)<br>• a **bridge** of French debt 2022–2025: 111.4 → −1.9, +3.1, +3.1 → 115.7, allowed with a warning that the steps are small, kept with Use anyway (`v3-bridge.jpg`)<br>• a **dumbbell** of 2019 vs 2025 balances, sorted, with France and Germany shown as "2019 n/a" (their series start in 2020) (`v3-dumbbell.png`)<br>• an Italy **KPI** (`v3-kpi.png`)<br>• then from the menu: **slope** (`v3-slope.png`, taken before the missing-value fix below), **lollipop** (`v3-lollipop.jpg`) and **step line**, via Use anyway. The menu itself: `v3-change-visual-menu.jpg` |
| **Survives save/reopen** | **Pass.** Unit tests: each family reopens with the same durable id and integrity OK. In the app: after reloads and a server restart, all composites reopened with integrity OK |
| **Re-realizes on data edits** | **Pass.** Unit tests: an edit rebuilds the group in place, keeping its id and z-order, with the new value and integrity OK; undo restores it. In the app: editing Greece's 2025 balance in the Data tab rebuilt the small multiples and the lollipop (slides 1 and 3) with integrity OK; undo restored the Eurostat value |
| **Provenance in the Evidence panel** | **Pass.** Lollipop: France 2025 −5.1 → its Eurostat query and retrieval. Bridge: the three changes as `end − start` with both inputs. Rating timeline: each action's symbol, outlook and date, linked to the PDF evidence |
| **Rating timeline, end to end** | **Pass, with synthetic agency documents.** The real DBRS actions from M5 have no verified date, so they can't be placed (the timeline says so and the ratings table lists them). For a dated run: a three-page "Example Ratings" PDF from the M5 test generator (marked *TEST FIXTURE – fictional agency*) went through M5's real pipeline. Steps: placeholder from chat → upload and rating task (through the API the Evidence tab uses) → three verified actions → ratings table → "Show France's rating history" → timeline: AA negative (Apr 2023) → AA− stable (May 2024) → AA− negative (Mar 2025) (`v3-rating-timeline.jpg`) |
| **Integrity catches tampering** | **Pass (unit and server).** A mark moved inside the group, an edited label, a stale value and a changed rating are each reported |

**Tests:** vitest 115 + 4 skipped (new `composite.test.ts`: 29, covering each family × render/integrity and save/reopen, plus rebuild, tampering, conversions, ungroup, layout bounds, recommender, rules, provenance and layout versions). Pytest 245 (new: composite parity and saved-deck integrity in `test_viz.py`, agent tools in `test_vis_v2.py`, page dating in `test_m5.py`). `tsc` 0 errors in our sources.

## Found during V3

1. **M5 dated every rating action with page 1's date.** An action found on a later page, such as a row of DBRS's rating-history table, would have carried the press release's date. A timeline would have drawn it at the wrong time. Now page 1 actions take the release date; later pages take the single date printed on their page, or none (`research_runs.action_date`, with a test).
2. **A dialog opened from the menu left the whole app unclickable** (a V2 bug). The modal dropdown set `pointer-events: none` on the body, and the "Use anyway" dialog restored that value when it closed. The V2 browser check missed it because nothing was clicked after the dialog. The dropdown is now non-modal; in the app, Undo works right after Use anyway.
3. **The status line's buttons were under the canvas** (since M6). "Re-project from data" and the new "Redraw" could not be clicked. The status line now sits above the canvas.
4. **A layout change made old drawings fail integrity.** Positions are checked, so improving a layout flagged every saved composite. Hence layout versions: older drawings are checked on values until Redraw.
5. **Composite fixes from the in-app review:**
   - bridge changes labelled "Δ 2023" (they shared "2025" with the end level)
   - slope missing values moved into a note (they sat at the bottom of an axis like low values)
   - step end labels spread apart
   - a zero line in small multiples of signed data
   - KPI compares with the previous period by default
   - a reason typo ("seriess")
   - the bridge was never recommended for one dataset (scored on its own category count)

## Known limits (for V4)

- **Text sizes are estimated** (character count × font size), not measured, so a long label can overrun its box. There is no wrapping inside composites.
- **Composites have no per-shape style controls** in the app beyond what the slide editor gives any shape. Recolouring a mark is allowed; moving one fails integrity by design.
- **Colours cycle through the four Design DNA series colours**, so a slope with seven entities repeats colours; labels are direct.
- **A placeholder fill retitles its slide** (M5 behaviour); in this acceptance it retitled the KPI slide, because the rating placeholder was placed there.
- **The stage scrolls sideways when the Data tab is open** at 1440 px. That's an M6 layout issue, noted not fixed.
- **Chat cards recompute their reason text** on render, so an applied card can describe the current recommender (e.g. the KPI card now says "since 2024" while the applied KPI compares with 2015).
- **The change-visual menu omits families whose view cannot be computed** for the data (e.g. a bridge for seven datasets); they are not offered rather than listed as invalid.
