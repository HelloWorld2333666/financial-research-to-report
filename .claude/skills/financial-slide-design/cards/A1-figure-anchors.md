---
id: A1
type: figure-anchor
layer: L3 (role) / L4a (styling, R6)
name: Figure anchors (KPI figure, ratio statement)
aliases: [T35, T37, TY4, ST3]
refs: [u11, u12, "lib:51b7e6ea4f:5"]
---

**Purpose:** let a single figure, or a single relation, carry the message.

**Variants:**
- **KPI figure (T35):** one bound value with a label saying what it measures and when, plus optional bound context ("+4.3 pp since 2022").
- **Ratio statement (T37):** the comparison compressed into one figure ("~2x faster growth").

**Applies when:**
- a decisive level or change;
- a ratio that is itself the message;
- a figures panel (P1), a statement page (P6), or the centre of a ring (V01).

**Hard constraints:**
- Exactly one bound figure per anchor (validated).
- A label that names the measure and the period.
- A ratio is a derivation with provenance.

**Heuristics:** one to three anchors on a page.

**Risks:**
- **Works when** several anchors are ordered by size or position.
- **Fails when** equal-sized "heroes" have no order, or an anchor repeats the chart beside it without adding information.

**Execution:**
- Large type in the highlight colour; the label smaller in ink.
- The typeface is an identity choice (R6).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** `kpi` objects (hero, stat, band; on dark) |
| Editability | Native text, bound |
| Readiness | Designed (tested) for KPI figures; ratio statement not started as a form |
| Visual gap | Low–medium |
