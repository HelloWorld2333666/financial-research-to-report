---
id: V08
type: family
layer: L2 (also a page pattern, see P3)
name: Small multiples
aliases: [T16, CH8]
refs: [u06, u07, "lib:fbbb35f9e3:31"]
---

**Purpose:** the same comparison repeated across many entities or buckets, so the pattern across panels becomes visible.

**Applies when:** one measure (or one structure) across many entities, buckets or scenarios.

**Hard constraints:**
- **A shared scale when panels are compared directly.**
- Different scales only for different measures or objectives, clearly labelled (R11).
- frr-viz requires more than four panels to be the primary visual.

**Heuristics:** 4–20 panels; label rows when entities fall into groups.

**Roles:** main exhibit; the context tier beside an enlarged focus panel.

**Combines with:**
- M1 two highlight roles in neutral context;
- G1 dashed separators between groups;
- S1 flags as panel titles;
- P1 implications panel;
- D1 bridging badge.

**Risks:**
- **Works when** each panel is stripped to its essentials.
- **Fails when** each panel carries axes, gridlines and legends; or scales differ without labels.

**Execution:**
- One shared legend.
- Direct value labels.
- No per-panel axes (R11).
- The focus panel enlarged rather than recoloured.
- Row labels for groups.

**Variants:** column multiples; stacked-column multiples (with V04).

**Alternatives:** V09 heatmap; V05 (one period); V07 with highlights.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** frr-viz `multiples` composite |
| Editability | Native shapes, bound |
| Readiness | Plain form. Row groups, focus enlargement and two-role intensity not started |
| Visual gap | Medium–high |
