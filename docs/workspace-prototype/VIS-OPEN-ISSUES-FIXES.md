# VIS V1–V4 open issues: fixes

**Date:** 2026-11-04. **Branch:** `feature/workspace-v2`, local commit only. Fixes the open items the VIS-V2/V3/V4 notes and the in-app checks left; no new visual families.

| Issue (where it was noted) | Fix | Checked |
|---|---|---|
| **Slide headings didn't follow their visual** (V2 known limit). Stale kickers "YC_ALL_Y1" and "RMD_10_30" and the title "…, 2025: 27 entities" (V4), which also showed "0/1 figures sourced" | A slide's kicker or title follows its visual only while it still says what the app wrote: a title equal to the visual's previous title, or a kicker equal to the one written for it (or the metric id earlier versions wrote). Headings the author edited are never changed. `viz.change` / `viz.update` apply this, and **Re-project (Redraw)** also refreshes headings earlier versions wrote. Kickers now come from one function (`kickerFor`): YIELD CURVE, DEBT MATURITY, DEBT SENSITIVITY, RATINGS, else the metric | Tests: a generated title follows a change of view, undo restores it, an authored title is untouched, a count in a title and a metric-id kicker are refreshed by Re-project. In the app, one Redraw gave "YIELD CURVE", "DEBT MATURITY" and "Government deficit (-) / surplus (+), 2025", and the status became "0/0 figures sourced" |
| **The stage scrolled sideways with the Data tab open** (V3 known limit) | The canvas extends past the slide for selection handles (1,140 px in an 892 px stage). `overflow: hidden` still allows scrolling by focus or `scrollIntoView`; the stage now uses `overflow: clip`, which can't be scrolled | In the app: a forced scroll of 124 px stays at 0 and the slide stays centred |
| **Composite label widths were estimated** (characters × size; V3 known limit) | Labels are measured with the renderer's own text metrics (`HeuristicMetrics`, the provider the app lays text out with), so label boxes match what is drawn | Layout version 3: saved composites were value-checked until Redraw; after Redraw, integrity OK on all eight |
| **A single-period box plot left the frame mostly empty** (V4 known limit) | One period gets a wider box (150 px) and a ten-column strip of dots, with the extremes named | `vis-01/fix-box-single-period.png` (27 EU balances, 2025) |
| **The change-visual menu left out visuals whose view could not be computed** (V3 known limit) | They are listed under "Not valid for this data" with the reason, e.g. "Bridge of yearly changes: a bridge follows one dataset from one period to another", "Yield curve: a yield curve needs one dataset per maturity (tenor)" | Test, and in the app on the EU-27 chart |
| **Chat cards recomputed their reason text** (V3 known limit): an applied card could describe another recommendation | A card keeps the recommendation it first showed, per project and request, in memory and in this browser's storage. Applying still checks it against current data (constraints, warnings, integrity) | Type-checked and built. Card display across reloads relies on browser storage: a new browser recomputes |

**Tests:** vitest 134 passed (5 skipped; new: 4 heading tests, the menu test); pytest 254 passed; `tsc` 0 errors in our sources. The server fixtures with composites were regenerated for layout version 3.

**Environment note:** the session's scratch Node.js was wiped by a restart. With your approval, Node.js LTS v26.13.0 (official build, SHA-256 verified) now lives in `~/.local/node`; nothing else on the system changed.

## Still open

- **Slope charts repeat colours** beyond four entities (the Design DNA has four series colours).
- **Recommendations frozen per browser:** another browser, or cleared storage, recomputes the card's reasons.
- **Slide subtitles** (e.g. "% of GDP · Eurostat · ranking") don't follow a change of visual. The rule above covers kickers and titles only.
