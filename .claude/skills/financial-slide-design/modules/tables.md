# Tables and data presentation

**Principles:** TB1–TB6.

**Choosing the table:**
- **Ranked table (TB1):** rank, level and change for 5–12 entities. Ranked in the headline's direction; focus row tinted; hairline rows; header over a gold rule.
- **Benchmark list (TB6):** two to six entities beside another exhibit. Columns: earlier value, latest value (bold), change.
- **Scorecard matrix (TB2):**
  - three to five measures for a focus entity against a reference;
  - numbered rows; focus figure in serif primary, reference figure in near-black;
  - columns: gap, change, sparkline, and a computed reading;
  - a conclusion row under a heavier rule.
- **Two-level headers (TB3), metric rows aligned under a chart (TB4), heatmaps (TB5):** documented, not yet rendered.

**Capacity:**
- Ranked table: up to 12 rows at 720 px height.
- Matrix: up to 5 rows with sparklines, 7 without.
- Readings: one line of 40–50 characters.

**Implemented in:** `charts.ts` `rankTable`/`benchList`; `compose.ts` `matrix()` (header, badges, sparklines, centred cells).
