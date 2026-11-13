---
id: V05
type: family
layer: L2
name: Ranking and comparison
aliases: [T10, T14, TB6, T11 (see M3), T12 (see V09)]
refs: [u09, u06, u02, "lib:fbbb35f9e3:38"]
---

**Purpose:** position among peers and the gap to a benchmark, at one period.

**Applies when:** a cross-section of entities with a focus entity or group.

**Hard constraints:**
- Bars start at zero.
- Signed values extend both ways from a visible zero line.

**Heuristics:**
- Sort by value.
- 4–40 entities on one slide. Long lists need the height of the slide.

**Roles:** main exhibit; one module of P3; the comparison beside a map (V10).

**Combines with:**
- S1 flags or logos beside names;
- M1 focus highlight (one entity, or intensity steps);
- M3 benchmark bar or line;
- M2 gap bracket;
- M5 values at bar ends;
- T14 compact peer list beside another chart.

**Risks:**
- **Works when** the order is the message.
- **Fails when:**
  - unsorted;
  - categorical colours with no focus;
  - small differences shown on long bars (consider a dot plot on a labelled scale).

**Execution:**
- Bars thick relative to the row (R1).
- Peers in a neutral tone, the focus in the highlight colour (R2).
- Labels legible at the bar ends (R6).
- Optional rank numerals.

**Variants:**
- ranked bars, T10;
- **diverging bars** for signed values;
- **dot plot or lollipop** (values far from zero);
- compact peer list, T14;
- ranked table (V09, T12).

**Alternatives:** V09 ranked table (exact values plus change); V08 (several measures).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** designed ranked bar (panel, rank numerals, flags, focus; signed values kept), benchmark list; frr-viz `dot` and `lollipop` composites (plain) |
| Editability | Native shapes, bound by named marks |
| Readiness | Designed (tested) for ranked bars and the benchmark list; diverging styling and intensity steps not started |
| Visual gap | Low–medium |
