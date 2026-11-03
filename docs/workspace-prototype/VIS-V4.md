# VIS V4 Financial structures and distributions: results

**Branch:** `feature/workspace-v2`. Local commits only. Follows `VIS-01-…ARCHITECTURE.md` §3 (rows F and G) and §8 (V4).
**Date:** 2026-11-03. The evaluation of maps, Sankey and network diagrams (intent H) is a separate note for your decision: `VIS-V4-SPATIAL-FLOW-NETWORK-EVALUATION.md`.

## Delivered

| Visual | View (`viz.ts`, mirrored in `viz.py`) | Drawn as | Data source (real, verified by a second fetch) |
|---|---|---|---|
| **Yield curve** | `curve`: spot yields per maturity at one or two periods | Composite: lines on a **proportional tenor axis** (1y→2y is a tenth of 10y→20y) | Eurostat `irt_euryld_m`: euro-area curves, all ratings and AAA, 1–30 years, monthly. **One request per curve** returns every tenor; tenors are read from the response |
| **Maturity ladder** | `buckets`: one country's debt by remaining maturity at one period, shortest first | **Native column** (editable as a PowerPoint chart); horizontal bars and a doughnut are valid alternatives | Eurostat `gov_10dd_rmd`: ≤1, 1–5, 5–10, 10–30, >30 years (% of GDP). Buckets are parts of **that country's** debt only (`additive_parts_of: fr.debt_by_maturity`), so France's and Italy's never add up |
| **Box plot** | `distribution`: quartiles across entities at one period or per period | Composite: box (Q1–Q3), median line, whiskers to lowest and highest, and **every value as a dot** beside the box | Any same-unit cross-section, e.g. the EU-27 balances (`gov_10dd_edpt1`, all 27 member states) |
| **Histogram** | `histogram`: counts in equal bins at one period | Composite: contiguous bars, edges labelled, zero line, the edge rule written on the visual | Same |
| **Range plot** | `range`: each entity's lowest and highest value over a period range, with the end value marked | Composite rows sorted by the end value | Same |
| **Sensitivity table** | `sensitivity`: `debt(t+1) = debt(t) × (1 + i) / (1 + g) − primary balance` for a grid of **assumed** interest and growth rates | Composite: shaded grid (above / below today's ratio), with the formula, the verified inputs and "Scenario arithmetic, not a forecast" written on the visual | Verified debt, balance and interest of one country; the assumptions are stored on the spec (`view.params`) and shown |

**Statistics are the standard ones and stated:**
- Quartiles use linear interpolation between closest ranks (as Excel's QUARTILE.INC and Python's `statistics.quantiles(method='inclusive')`, which a test cross-checks).
- Histogram bins have equal width, are a round number near Sturges' count, include their lower edge, and the last bin includes its upper edge.
- Every derived value (quartile, count, min/max, scenario result) carries its formula and inputs. The Evidence panel shows them, down to each country's Eurostat query.

**Rules:**
- **Invalid:**
  - a box or histogram of fewer than 5 values;
  - a range with fewer than 3 periods per entity;
  - a curve with fewer than 4 maturities;
  - a maturity ladder mixing countries;
  - a sensitivity grid without one country's debt, balance and interest;
  - any of these views drawn by a chart family that would misrepresent it (e.g. a yield curve as an evenly spaced line).
- **Warnings:**
  - fewer than 10 (box) or 15 (histogram) values;
  - more than 4 curves;
  - more than 25 range rows;
  - grids larger than 7 × 7;
  - horizons over 10 years;
  - a ladder missing buckets.

**Recommender, chat and agent:**
- Four new intents: distribution, curve, maturity, sensitivity.
- Research accepts named groups (`maturity`, `yield_curve`) and `EU27`.
- `propose_visual` resolves curves, maturity buckets and sensitivity inputs, and carries the assumptions.
- `change_visual` accepts box, histogram and range.

## Acceptance (in the app, real data, chat and real clicks)

| Step | Result |
|---|---|
| EU-27 research | "Start research for countries EU27 with metrics deficit only" → 27 series. 20 were new (220 values, none failed), 7 already in the project. All 27 have a 2025 value |
| Maturity and yield curve research | → 6 maturity series and 60 tenor series (2,016 values, none failed). France 2025: ≤1y 19.1, 1–5y 40.7, 5–10y 27.4, 10–30y 25.3, >30y 3.0 % of GDP; the buckets sum to 115.5 against a reported total of 115.6 (rounding in the source) |
| **Box plot** | "Show the distribution of 2025 government deficits across the EU27" → box recommended (histogram and range as alternatives). Romania lowest (−7.9), Cyprus highest (3.0), every country as a dot; integrity OK (`vis-01/v4-box-eu27.jpg`) |
| **Histogram** | From the menu: bins of 2 % of GDP from −8 to 4, counts 2, 5, 10, 5, 2, 3 (27). The Evidence panel shows bin [−2, 0) with each country and its Eurostat query (`v4-histogram-eu27.jpg`) |
| **Range plot** | From the menu: allowed with a warning (27 rows), kept with Use anyway, 2020–2025 per country sorted by 2025 (`v4-range-eu27.jpg`); undone afterwards |
| **Yield curve** | "Show the euro-area government yield curve in September 2025 and September 2026" → yield curve recommended; 60 points on a proportional axis; the 2026 curve sits above the 2025 one (`v4-yield-curve.jpg`) |
| **Maturity ladder** | "Show France's debt by remaining maturity" → native column chart, shortest first, the values above (`v4-maturity-ladder.jpg`) |
| **Sensitivity table** | "…sensitivity table of France's debt ratio over 5 years for interest rates of 2–5 % and nominal growth of 1–4 %" → "Debt ratio in 2030, France". Inputs: 2025 debt 115.7, balance −5.1, interest 2.2 → primary balance −2.9, held constant. Range of outcomes: 116.9 (i 2 %, g 4 %) to 158.2 (i 5 %, g 1 %). A cell's provenance shows the formula, the two assumptions, and the three Eurostat inputs (`v4-sensitivity.jpg`) |
| Save, reopen, integrity | Every visual reopened after several server restarts with integrity OK. A layout change was caught by layout versions (below) and redrawn with one click |

**Tests:**
- vitest: 129 passed, 5 skipped. New `structures.test.ts`: 15 tests covering each V4 visual (render/integrity/reopen), the statistics, the proportional axis, the ladder rules, distribution thresholds, range, sensitivity arithmetic and the recommender.
- pytest: 254 passed. New tests:
  - server parity for 9 V4 cases;
  - server integrity on a saved V4 deck, including a data edit that moves a country to another bin;
  - the research task's maturity and curve fetch (one request per curve);
  - EU27 expansion;
  - fractional assumptions.
- `tsc`: 0 errors in our sources.

## Found during V4

1. **The local model (Qwen 2.5 14B) needed several tries for the new tools.**
   - It asked for all five fiscal series instead of "deficit only" (cancelled, re-asked).
   - It left out a required argument (`topic`, now optional).
   - It passed `countries: ["EU27"]` to the visual tool (now expanded there too).
   - Twice it wrote the tool call as text instead of calling it, both times in the long project thread; the short slide threads worked.
   - It once replied in Thai.
   - Once it claimed a request "has been requested and processed" without calling any tool. Nothing was created, but the text was false.

   The app's design held throughout: nothing changes without a proposal card, and a wrong call is refused with "nothing was changed".
2. **The model passed scenario assumptions as fractions** (0.02 for 2 %), even when told "2, 3, 4 and 5 percent". A grid where every value is under 0.2 is now read as fractions, converted to percent, and the conversion is stated in the card's summary; the assumptions are also printed on the visual before anything is applied.
3. **Counts in titles read as unsourced figures.** "…, 2025: 27 entities" in a slide title showed as "0/1 figures sourced". Distribution titles no longer carry counts (the note on the visual does). The box slide created before the fix keeps the old headline, since slide titles are author text.
4. **A layout change without a version bump flagged a saved visual.** Removing that count changed a composite's title, and integrity reported a label mismatch. The layout version is now 2. Older drawings were value-checked and offered **Redraw**, which brought all seven up to date.
5. **Default research scope.** With no metrics named, the research task would have fetched every registered metric, including the new maturity buckets. It now defaults to the five fiscal series.

## Known limits

- **The yield curve is euro-area wide.** Eurostat publishes no country-level curves; France's own OAT curve would need another source (Banque de France or AFT), not built.
- **The maturity ladder uses Eurostat's five buckets,** not a year-by-year redemption schedule (which AFT publishes as a file; an upload path would be needed).
- **The sensitivity grid holds the primary balance constant** and uses the debt ratio's standard arithmetic. It shows no stock-flow adjustments and no feedback from growth to the balance. It is labelled as scenario arithmetic, not a forecast.
- **A single-period box plot leaves horizontal space unused** at full slide width.
- **Slide kickers come from intents or metric names.** The two V4 slides drawn before the fix still read "YC_ALL_Y1" and "RMD_10_30".
- **The local model's reliability** with seven intents and many optional arguments is the weakest part of the flow, as listed above.
