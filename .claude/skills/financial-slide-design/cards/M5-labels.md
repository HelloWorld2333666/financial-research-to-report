---
id: M5
type: modifier
layer: L2
name: Labels (direct labels, legends, "now (then)")
aliases: [T38, T84b, CH1, ST2]
refs: [u02, u03]
---

**Purpose:** let the reader read values and identities without searching.

**Variants:**
- **Direct labels:** series names and latest values at line ends; values at or inside bar ends.
- **Legend in data order:** when direct labels don't fit (stacked segments, many categories).
- **"Now (then)" (T38):** two periods in one label, as in `13 (8)`.

**Hard constraints:** labels are legible at the rendered size, never overlapping; every value label is a bound mark.

**Risks:**
- **Works when** each labelling device has its own job.
  - A legend for scanning plus explanation cards for meaning (u02) is fine.
- **Fails when** a legend, direct labels and cards all restate the same thing.

**Execution:** labels inside dark marks in bold white; outside labels in ink; label size close to body size on dense pages (R6).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** direct labels in designed charts; "then and now" rows in tables |
| Editability | Native, bound |
| Readiness | Designed (tested). "Now (then)" on map symbols not started |
| Visual gap | Low–medium |
