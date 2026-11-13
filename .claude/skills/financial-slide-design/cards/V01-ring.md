---
id: V01
type: family
layer: L2
name: Ring (donut)
aliases: [T01, T03, T02, CH3]
refs: [u01, "lib:3ba4dd80ba:3 (low resolution)"]
---

**Purpose:** one share of a defined whole, read at a glance, without a legend.

**Applies when:** a true share is the message. Examples: penetration, completion, market share, probability, debt held by non-residents, the share of debt in a maturity bucket.

**Hard constraints:**
- Parts of a defined whole, all non-negative.
- frr-viz enforces one series at one period, with no missing or negative values.
- Not for ratios that are not shares: debt/GDP is not a share.

**Heuristics:**
- One highlighted part against the remainder, or a few parts.
- Paired rings sit side by side, each with its own small title.

**Roles:** the headline proportion; the headline tier of P2.

**Combines with:**
- P2 + V09 (worked combination T02: two rings over a substantiating table);
- M1 (the focal part in the strongest tone);
- S1 icons on the segments (variant T03);
- A1 (the centre figure acts as an anchor).

**Risks:**
- **Works when** one or two rings carry a headline share.
- **Fails when** several rings are compared by angle, slices are many, or the value is not a share.

**Execution:**
- Focal arc in the strongest colour; remainder neutral.
- The ring thick enough to read as a data mark (R1).
- A large centre figure bound by token (R6).
- A small title saying "share of what" (H1).

**Variants:**
- **T01:** single share with a centre figure.
- **T03:** segmented ring with icons and outside callouts.

**Alternatives:** a single bar or a 100% bar; an A1 figure; V04 for several entities.

**Status**
| Dimension | State |
|---|---|
| Engine | Writes a native doughnut |
| Builder | Exposed: viz family `doughnut`, with share validation |
| Editability | Native data-bound chart; or arcs as native shapes |
| Readiness | Plain form only. Designed form (centre figure, neutral remainder) not started |
| Visual gap | High |
