---
id: V09
type: family
layer: L2
name: Tables (ranked table, scorecard, heatmap, icon and pill table)
aliases: [T12, T17, T19, T28, T29, T30, T31, T32, TB1, TB2, TB3, TB5, CH14]
refs: [u16, "lib:fbbb35f9e3:30", "lib:fbbb35f9e3:42", "lib:3ba4dd80ba:4 (low resolution)"]
---

**Purpose:** precise values with their pattern. The table type follows the question.

**Types:**
- **Ranked table (T12):** rank, flag, name, in-cell bar of the latest value, earlier value, change, focus row tinted.
- **Scorecard (T17):** numbered rows per measure; focus against reference; gap, change, sparkline, a computed reading; a summary row.
- **Heatmap (T31):** entities × criteria on an ordered scale, with the scale explained.
- **Icon and pill table (T32):** icon column headers, categorical values as coloured pills.

**In-cell modifiers:**
- **T30:** in-cell bars, labels inside.
- **T19:** sparklines sharing one stated window, with no end labels.

**Structure options:**
- **T28, multi-level headers: optional.** Use when columns form natural groups.
- **T29, totals and assumptions: conditional.** A totals row only when rows are additive; an assumptions box only for modelled figures.

**Hard constraints:**
- Every cell figure is bound.
- Sparklines share a window.
- Heat scales are explained.

**Roles:** substantiation tier (P2); detail of P4; main exhibit for assessments.

**Combines with:** S1 flags and logos as row identifiers; M1 tinted focus row; V01 or V04 above (P2) or beside (P4); H1 conclusion row.

**Risks:**
- **Works when** exact values matter.
- **Fails when** heavy grids, centred numerals, or a table used where a gist is needed.

**Execution:**
- Hairline rows; a strong rule only under the header and above a conclusion row (R3, R5).
- Numerals right-aligned.
- The focus row tinted, not boxed.
- In-cell bars in the same colour as the segment they detail (D1).

**Alternatives:** V05 (gist of order); V08 (pattern across many).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders; native tables |
| Builder | **Exposed:** designed `rankTable`; `columns` matrix (header, badges, sparklines); native table object; frr-viz `heatmap` composite |
| Editability | Native shapes or a table, bound |
| Readiness | Designed (tested) for the ranked table, matrix and sparklines. Multi-level headers, pills and icon headers not started |
| Visual gap | Low–medium (ranked table, scorecard); medium–high (others) |
