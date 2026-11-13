---
id: M4
type: modifier
layer: L2
name: Value callouts (circled total, callout boxes with leaders, map callouts)
aliases: [T24, T40, T43, CH6]
refs: [u13, u07, "lib:fbbb35f9e3:43"]
---

**Purpose:** pin a key value, or a short explanation, to the exact place it belongs.

**Host:** V04 (totals), V01, V07, V10, V14.

**Variants:**
- **T40 callout circle or total:** the headline number anchored to its exhibit.
- **T43 callout boxes with thin leaders,** outside the plot.
- **T24 map callouts:** flat boxes with figures and a trend icon badge overlapping the edge.

**Hard constraints:** the callout figure is bound; the leader points at the right mark.

**Heuristics:** one callout per chart for a message; a handful for briefing maps.

**Risks:**
- **Works when** each callout answers "what is this number?" where the eye already is.
- **Fails when** callouts multiply, overlap marks, or carry outlines heavier than the data.

**Execution:** flat light fields without outlines; thin leaders; figures in bold (R3, R5, R6).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** one callout (`callout: 'max' \| 'min'`) on the designed line; ellipse-with-text decoration. No anchoring of boxes or leaders to marks |
| Editability | Native shapes; bound |
| Readiness | Line callout designed (tested). Anchored callouts not started |
| Visual gap | High |
