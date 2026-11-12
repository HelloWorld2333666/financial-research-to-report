---
id: V04
type: family
layer: L2
name: Stacked composition
aliases: [T05, T06, T07, CH4, CH5, CH15]
refs: [u02, u07, u16, u01]
---

**Purpose:** the mix of a total and how it differs across entities, stages or periods.

**Applies when:** additive, non-negative components per entity or step.

**Hard constraints:**
- Components add up to the total, or to 100%.
- No negative parts.

**Heuristics:**
- Few enough segments for inside labels to fit.
- Order the segments so the focal one sits on the baseline (only the first segment is aligned).

**Roles:** main exhibit; summary column of P4; one module of P3.

**Combines with:**
- S1 flags beside entity names;
- D1 explanation cards coloured like the segments (the legend becomes the argument);
- P4 bracket to detail tables;
- M4 totals above the stacks;
- M1 two coloured segments with the rest neutral.

**Risks:**
- **Works when** each segment has a meaning the reader needs.
- **Fails when** many thin segments, or comparing non-baseline segments precisely matters: use V08 or grouped bars.

**Execution:**
- Thick bars.
- **White gutters between segments** (R3).
- Values inside the segments in bold, white on dark (R6).
- Legend in segment order, or direct labels (M5).

**Variants:**
- **T05:** 100% stacked bars by entity, with flags.
- **T06:** stacked columns with totals above.
- **T07:** 100% stacked area along process stages, with statements inside the areas and a range arrow.

**Alternatives:** V08; V05 per component; V01 for a single share.

**Status**
| Dimension | State |
|---|---|
| Engine | Writes native stacked charts; area charts only standard (unstacked) |
| Builder | **Exposed:** native stacked and 100% stacked columns (viz `column`, subtypes `stacked` and `percent`). Horizontal stacked bars not verified; stacked area not exposed |
| Editability | Native data-bound chart; or native shapes (bindable) |
| Readiness | Plain form only. Designed form (gutters, inside labels, intensity) not started |
| Visual gap | High |
