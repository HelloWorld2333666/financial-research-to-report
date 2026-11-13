---
id: V07
type: family
layer: L2
name: Time series
aliases: [T18, CH1 (labels, see M5)]
refs: ["lib:fbbb35f9e3:44", "lib:51b7e6ea4f:5"]
---

**Purpose:** paths over time: trend, turning points, divergence, convergence.

**Applies when:** three or more periods, and the path is the message.

**Hard constraints:**
- A non-zero axis is allowed for lines, labelled.
- Projections are visibly distinct from history.

**Heuristics:**
- Up to about six series.
- Beyond that, use V08 or highlight one or two series against a neutral context.

**Roles:** main exhibit; module in P3; evidence with a commentary column (P1).

**Combines with:**
- M5 direct end labels;
- M3 shaded period, benchmark line;
- M2 gap brackets;
- M4 one callout;
- D1 connector to the commentary;
- A1 latest value as a figure.

**Risks:**
- **Works when** the reader needs the path.
- **Fails when:**
  - the message is the current order (use V05);
  - the message is the location (use V10);
  - there are many crossing series;
  - dual axes are used (use an index or V08).

**Execution:**
- **The plot is large; lines are thick enough to be the heaviest marks** (R1).
- The focus series in the highlight colour, peers neutral (R2).
- Few gridlines.

**Variants:**
- levels;
- **indexed** (rebased to 100);
- **projection fan** (central path with bands);
- step line;
- yield curve (x = maturity, not time).

**Alternatives:** V08, V06, V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders; writes a native line |
| Builder | **Exposed:** designed line with shaded band, one callout and gap brackets; frr-viz `step` and `yield_curve` composites |
| Editability | Native shapes, bound |
| Readiness | Designed (tested). Fan not started |
| Visual gap | Medium (plot size, line weight, label scale) |
