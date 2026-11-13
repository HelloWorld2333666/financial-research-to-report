---
id: V16
type: family
layer: L2
name: Range and distribution
aliases: [new in revision b]
refs: []
---

**Purpose:** dispersion across a peer group, and where the focus sits within a range.

**Applies when:**
- spreads across euro-area sovereigns;
- a country's latest value within its historical range;
- the distribution of a measure across many countries.

**Hard constraints:**
- The range endpoints and the "latest" marker are bound.
- The period of the range is stated.

**Variants:**
- **Range** (lowest to highest, latest marked);
- **box plot** with every value;
- **histogram.**

**Roles:** main exhibit; context module in P3.

**Combines with:** M1 focus marker; M3 benchmark marker; S1 flags.

**Risks:**
- **Works when** dispersion or position in a range is the message.
- **Fails when** readers need the order of entities (use V05).

**Execution:**
- Thin range bars in neutral; the latest marker in the highlight colour (R2).
- Labels at the ends.

**Alternatives:** V05 dot plot; V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** frr-viz `range`, `box` and `histogram` composites (distribution intent) |
| Editability | Native shapes, bound |
| Readiness | Plain form; designed form not started |
| Visual gap | High |
