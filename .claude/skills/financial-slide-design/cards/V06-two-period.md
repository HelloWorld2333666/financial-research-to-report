---
id: V06
type: family
layer: L2
name: Two-period change
aliases: [T13, CH7]
refs: [u11]
---

**Purpose:** make the change between two dates the visual subject.

**Applies when:** two periods per entity, and the change, rather than the level, is the message.

**Hard constraints:**
- **The increment must be perceptible** on a zero-based column at the rendered size.
- Bars never use a truncated axis.

**Choosing a form:**
- **Increment columns (T13):** few entities, and an increment that is clearly visible on a zero-based column.
  - *Heuristic:* a relative change around 10% or more usually passes.
  - The real test depends on the level and scale, the size and significance of the change, the comparison entities, and whether the form could mislead.
- **Dumbbell:** many entities, or small changes on a labelled non-zero scale.
- **Slope:** a few entities, where the crossing of paths matters.
- **V09 with a change column:** when the exact change matters more than the picture.

**Roles:** main exhibit; one module of P3.

**Combines with:**
- M2 slope marker with the change as a large figure;
- A1 change as an anchor;
- V05 / T14 peer list with flags;
- P1 figures field.

**Risks:**
- **Works when** the change is large relative to the level, or the scale is labelled.
- **Fails when** a sliver increment, invisible at the rendered size (the revision 3 dashboard).

**Execution:**
- The earlier level in a dark neutral; the increment in the highlight colour (R2).
- The change stated once, large (A1, R6).

**Alternatives:** V07 (when the path matters); V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Exposed:** designed `delta` columns; frr-viz `dumbbell` and `slope` composites (plain) |
| Editability | Native shapes, bound |
| Readiness | Designed (tested) for delta. **Perceptibility check not implemented**; slope marker not started |
| Visual gap | Medium–high |
