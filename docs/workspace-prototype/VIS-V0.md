# VIS V0 Chart integrity fixes: results

**Branch:** `feature/workspace-v2`. Local commits only. Follows `VIS-01-VISUALIZATION-AUDIT-AND-ARCHITECTURE.md` §8 (V0), approved 2026-11-03.
**Date:** 2026-11-03. Verified by unit tests on the vendored engine, the VIS-01 audit test, and the running app (screenshots `vis-01/v0-*`).

## Delivered

| Fix | What changed | Where |
|---|---|---|
| **F2: gaps survive chart rebuilds** (patch 0005) | A chart edit that doesn't resend data (type change, style-only edit such as colours, row/column swap) used to rebuild values with `v ?? 0`, turning gaps into zeros. Missing values now stay missing, and the writer omits them so `dispBlanksAs="gap"` applies. The data getter used by upstream's data dialog no longer zero-fills either. Value types now say `(number \| null)[]` | `vendor/genoffice/patches/0005-chart-rebuild-keeps-gaps.diff` (`pptx-engine` index.ts, chart-insert.ts) |
| **F3: honest stacks** (patch 0006) | In stacked and 100% stacked charts (columns, horizontal bars, stacked lines and areas), a category missing one of its components is **left empty** instead of stacking a false total or false shares. Complete categories are unchanged. PowerPoint's explicit `dispBlanksAs="zero"` is still honoured | `vendor/genoffice/patches/0006-honest-stacks-area-gaps-scatter-axis.diff` (`pptx-render` build-chart.ts) |
| **F5: area charts** (patch 0006) | Areas break at gaps like lines (only `dispBlanksAs="span"` bridges them). Overlapping unstacked series are translucent (55% fill), so a later series can't hide an earlier one. A single area stays opaque | same |
| **F6: scatter axes** (patch 0006) | As in Excel, an automatic axis starts near the data when the data's minimum is within a sixth of its maximum, with whole-number steps for whole-number data. Years now sit on 2021–2026 instead of 0–2,500. Wide-spread data still starts at 0 | same |
| **F7: no 3-D** (decision D-V3) | Our commands refuse to create 3-D pie and column charts (`slide.compose`, and `addChart`/`setChart` through raw ops), with the reason. Decks that already contain 3-D charts still open and render | `app/web/src/core/vocabulary.ts`, `core/commands.ts` |

## Acceptance (VIS-01 §8, V0)

| Criterion | Result |
|---|---|
| The audit test's F2 assertions flip to true | **Pass.** `chart-capability.test.ts` now asserts that a type change **and** a style-only edit keep gaps for all 11 offered types. The 3-D types assert that our commands refuse them. Matrix: `vis-01/audit-matrix-v0.json` |
| Screenshots show no misleading stack | **Pass.** `v0-1-columns-and-bars.jpg`: the stacked and 100% stacked charts leave 2023 (France missing) and 2024 (Germany missing) empty, where before they showed shrunken or re-normalised totals (`1-columns-and-bars-zoom.png`). `v0-2-…`: all three area series visible and broken at gaps. `v0-3-…`: the scatter spans 2021–2026 |
| Existing suites green | **Pass.** Vitest 47 + 2 skipped (new `v0-patches.test.ts`: 9 tests); pytest 229 including the headless browser checks; `tsc` 0 errors in our sources |
| Patches reproducible | **Pass.** All six patches apply in order to a pristine copy of the pinned upstream files (commit `36a509e8`), and **every one of the 292 vendored files** comes out byte-identical to `vendor/genoffice/src` |

## Found during V0

- **My first scatter test passed vacuously.** Axis labels use thousands separators ("2,000"), so a four-digit filter matched nothing and the assertions ran on an empty list. The browser screenshot showed the axis unchanged. The cause was in the renderer: the data minimum is computed as `arrayMin(allX, 0)`, seeded with 0, so it is never above zero (which is also why the axis always started at 0). The patch now uses the true data minimum, and the test asserts the exact ticks `2021…2026`.
- **Values isolated between two gaps** can't form a line or an area segment and aren't drawn (same as lines since patch 0001). Markers or labels for such points are a candidate for V1's missing-value policy (`missing: 'gap'` with visible isolated points).
- **Stacked areas** get the stack rule in the renderer, but our chart writer has no stacked-area kind, so that path is exercised only by decks made elsewhere (not by our tests).

## Not in V0

The renderer-independent spec, the recommender and new visual families are V1–V3 as planned. M6 (premium shell) remains paused at its acceptance pass, with its changes uncommitted in the working tree.
