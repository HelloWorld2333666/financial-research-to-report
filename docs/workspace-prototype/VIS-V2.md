# VIS V2 Visual recommender, meaning constraints and user control: results

**Branch:** `feature/workspace-v2`. Local commits only. Follows `VIS-01-…ARCHITECTURE.md` §8 (V2) and the V2 refinement on user control (three states: recommended, allowed with a warning, invalid).
**Date:** 2026-11-03.

## Delivered

| Area | What exists now |
|---|---|
| **Dataset measure metadata** (`app/server/evidence.py`, `agent.py`) | Every fetched dataset records `measure`: `kind` (ratio, balance_ratio, rate…), `of`, `signed`, `additive_parts_of`, `scale`. Older datasets fall back to a fixed table in `constraints.ts` (a test checks the two agree). Unknown measures count as **not additive** |
| **Three-state constraints** (`app/web/src/core/constraints.ts`, `viz.ts`) | Every visual is assessed into **invalid** (blocked; no acknowledgement unlocks it), **warning** (faithful but less suitable; allowed after "Use anyway") or clean. Findings have stable codes. `check()` blocks only invalid visuals, so a data edit is never stopped by a design choice. `gate()` runs on every new or changed visual |
| **Recommender** (`recommend.ts`) | Intent (trend, ranking, change, composition, relationship) → data profile → candidates → assessment → score → one recommendation with a reason built from facts ("It compares 7 entities at one point in time (2025), sorted; bars diverge from zero because 5 values are negative"). Only a clean visual is recommended; warned ones stay available as the user's choice |
| **Use anyway** | A warned visual returns its warnings instead of applying. The user reads them and confirms. The command is re-run with `accept: [codes]`, and the spec records `accepted_warnings`. Data, provenance, undo/redo and integrity are unchanged. The journal says "used anyway despite: …" with the actor. Later edits don't ask again for the same warning; a **new** warning asks again; a change to a clean visual drops the acknowledgement |
| **Fixes for invalid visuals** | Where a change of *view* makes an invalid visual valid, it is offered: a part-to-whole with a missing part → "Show 2025, the latest period where every part is reported" (or the trailing range of complete periods). No values are created or changed |
| **Change-visual menu** (`main.tsx`) | Four sections: Recommended for this data · Also valid · **Allowed with a warning** (⚠, opens the confirmation dialog) · Not valid for this data (disabled, with the reason, then any fix as a selectable item) |
| **Agent tools** (`agent.py`, `chat.tsx`) | `propose_visual(intent, metric, countries…)` and `change_visual(family, subtype, view)` return *requests*. The client recommender and its constraints decide; the model never picks the chart type. `start_research(countries=[…])` starts one Eurostat pack for several countries. Chat cards show the recommendation, alternatives, warned options (Use anyway) and invalid ones with reasons. A blocked change offers "Instead:" cards (the fix and up to two valid options) |
| **Composer** | Requests visuals by intent; the France deck's three charts become columns (4 to 6 annual periods each; a line is recommended from 12 periods) |
| **Server** (`viz.py`) | `accepted_warnings` is accepted only with **warning** codes. An invalid code (e.g. `not_parts`) in a saved bundle is refused with 400. A test checks the code list matches the client's |

## Which rules block and which only warn

The review moved six rules from refusal to warning. They draw the data faithfully but are less suitable:

| Rule | V2 first draft | Now | Why |
|---|---|---|---|
| Pie/doughnut/stack/100% of series that are **not parts of one total** (ratios, rates, balances) | refused | **invalid** | Misrepresents part-to-whole |
| Part-to-whole with a **missing part** | refused | **invalid** (+ fix: a complete period) | The total would be wrong; the gap would be lost |
| **100% stack with negative parts** | refused | **invalid** | Shares of a total can't be negative |
| Columns + line with **3+ units** | refused | **invalid** | Puts two units on one axis |
| Ordinal scale (ratings) as a line/area/pie | refused | **invalid** | Not a numeric quantity |
| V1 shape rules (line without a time axis, pie of several series, missing or negative pie values, mixed units on one axis, stacking one series, stacked area, scatter without two datasets) | refused | **invalid** | Cannot be drawn without inventing or dropping data |
| Columns + line with **one unit** | refused | **warning** | Two scales for one unit can exaggerate differences, but no value changes |
| Pie with **more than 6 slices** | refused | **warning** | Hard to compare, still correct |
| Line/area with **fewer than 3 periods** | refused | **warning** | A two-point line is a legitimate slope chart |
| **More than 7 lines** | refused | **warning** | Readability |
| **Overlapping areas** of non-additive series | refused | **warning** | Can read as a total; the engine doesn't stack them |
| **More than 60 bars** | refused | **warning** | Readability |
| Scatter with **fewer than 6 points** | refused | **warning** | Too few to suggest a relationship, still accurate |
| Stacked bars with **negative additive parts** | *allowed silently* | **warning** (new) | The bar's length is no longer the total |

## Acceptance

| Criterion | Result |
|---|---|
| Seven-country comparison, real data | **Pass.** In a new France project, the local model called `start_research` with IT, ES, PT, EL, BE when asked in chat. 25 series and 275 values were fetched, each confirmed by a re-fetch, and applied from Tasks. Asked to "Compare the 2025 fiscal balances of …", it called `propose_visual`. The card recommended a **ranked horizontal bar** with the reason above, offered a compact table and ranked columns, and listed the pie as not valid ("a pie cannot show missing or negative values"). Applied: Greece +2.0, Portugal +0.7, Spain −2.4, Germany −2.9, Italy −3.1, France −5.1, Belgium −5.2, diverging from zero; integrity OK (`vis-01/v2-recommendation-card.jpg`, `v2-seven-country-ranking.jpg`) |
| Change-visual menu with reasons | **Pass (real clicks).** Before the refinement: a disabled Pie did nothing; Ranked columns applied; undo and redo were one step each (`v2-change-visual-menu.jpg`) |
| Chat change to an invalid visual | **Pass.** "Turn this chart into a pie chart" → "Not possible: a pie cannot show missing or negative values", Apply disabled, with "Instead: Line" and "Instead: Ranked horizontal bar" cards |
| **Use anyway** in the app | **Pass (real clicks).** With the ranking selected, the menu listed Columns, Area and Columns + line under "Allowed with a warning". Choosing ⚠ Columns opened the dialog ("77 bars are hard to read at slide size"; `v2-use-anyway-dialog.jpg`). After "Use anyway": the same 7 datasets, `accepted_warnings: ["many_bars"]`, journal "used anyway despite: many_bars", integrity OK, autosaved. It survived a reload. Choosing Ranked columns again applied without a prompt and dropped the acknowledgement |
| Overrides, save/reload, AI edits after an override (unit) | **Pass.** `overrides.test.ts` covers these cases: a warned change asks first and changes nothing; with `accept` it applies with the same data, journal note, undo/redo and integrity; no acknowledgement unlocks an invalid visual (including a replacement spec that claims its own); the acknowledgement survives save and reload; a clean change drops it and the warned one asks again; after reload an **AI** `chart.addSeries` keeps the override (same warning), a data edit re-realizes it, an AI change with a **new** warning asks, and an AI change to a pie of ratios or a series in another unit is refused; an explicit warned visual in `slide.compose` needs the same acknowledgement |
| France deck no longer all lines | **Pass, with a caveat.** All three charts are now columns (4 to 6 periods each), so the deck is uniform in a different way. Variety comes from different intents, not from the recommender varying for its own sake |

**Tests:** vitest 86 + 3 skipped (new: `recommend.test.ts` 8, `overrides.test.ts` 9), pytest 241 (new `test_vis_v2.py`: 6), `tsc` 0 errors in our sources.

## Found during V2

1. **V1 tests used semantically invalid charts.** A pie of two countries' debt ratios passed V1. The tests now use synthetic additive datasets for part-to-whole cases.
2. **The first V2 draft refused too much.** Every non-recommended visual that didn't fit was a refusal, which blocked legitimate design choices (a two-point slope line, a dense column chart). The refinement split the rules as in the table above.
3. **A blocked chat card said "Use anyway".** A pie of seven countries is invalid (negative values) *and* has too many slices (warning). The card showed the warning's label on its disabled button. A blocked card now shows only the reason.
4. **A ranking changed back to a time series kept the period in its title** ("…, 2025" over 2015–2025). Changing a single-period or change view back over time now titles the chart by its series and unit.
5. **The first "Apply" click in the browser missed.** That was a stale screenshot, not the app. Clicks by element reference were used afterwards.

## Known limits (for V3)

- **The slide's own title text is not updated** when a chart's view changes. The chart title follows the view; the slide headline is the author's text, and claim checks still cover its figures.
- **Fixes are offered only for missing parts.** Other invalid visuals point to the valid options instead.
- **An acknowledgement is per chart, not per person;** the journal records who made it.
- **Warning codes are mirrored by hand** in `viz.py`; a test fails if they diverge.
- **The recommender is rule-based and deterministic**; its weights are hand-set (`score()` in `recommend.ts`).
