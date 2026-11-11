# Charts and financial visualization

**Principles:** CH1–CH15.

**Choose by the analytical question, then check the data supports the form:**

| Question | Form | Status |
|---|---|---|
| Change of one entity between two dates | delta columns (CH7) | tested |
| Several entities, two dates, rank matters | ranked table (TB1) or benchmark list (TB6) | tested |
| Trend against peers | line with direct labels (CH1); shaded period, one callout, gap brackets (CH6) | tested |
| Share of a whole | donut with central share (CH3), only for true shares | principle |
| Composition by entity | 100% stacked bars with flags (CH4) | principle |
| Same metric across many entities and buckets | small multiples with an enlarged focus panel (CH8) | principle |
| Geography is the message | map with markers (CH11) | unsupported: no geo shapes |

**Always:**
- Focus in the primary colour, peers in warm taupe (CH2).
- Values labelled directly (CH1).
- Flags beside country names in rankings (CH10).
- One window for all sparklines (CH14).
- Every value is a named mark checked by integrity. A new chart form must emit a mark for every data point, or integrity fails.

**Not yet supported:** donut, stacked bars, small multiples, maps, nested shapes, pills. Use the fallback named in each principle and say so in the rationale.

**Implemented in:** `core/design/charts.ts` (`line`, `rankBar`, `dumbbell`, and `form`: `rankTable`, `delta`, `benchList`; options `flags`, `spark`, `band`, `callout`, `annotate`).
