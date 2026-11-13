---
id: M2
type: modifier
layer: L2
name: Difference markers (gap bracket, range arrow, slope marker)
aliases: [T41, T42, CH6]
refs: [u01, u11, "lib:51b7e6ea4f:5"]
---

**Purpose:** make a gap or a change explicit, so the reader does not have to compute it.

**Host:** V07, V05, V06, V04.

**Variants:**
- **Gap bracket (T41):** between two values, labelled with the computed gap.
- **Range arrow (T42):** a double-headed arrow across a span, with its statement.
- **Slope marker:** a diagonal line interrupted by the change as a large figure, above two-period columns (u11).

**Hard constraints:** the marked figure is computed from evidence (a derivation), never typed.

**Risks:**
- **Works when** one or two differences carry the message.
- **Fails when** brackets multiply, or a marker crosses data.

**Execution:**
- Thin strokes in a neutral or accent tone.
- The figure in the anchor style when it is the message (A1, R6).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** gap brackets on the designed line (`annotate: 'gap'`); double-headed lines available as decoration |
| Editability | Native shapes; figures bound |
| Readiness | Gap bracket designed (tested). Range arrow and slope marker not started |
| Visual gap | Medium |
