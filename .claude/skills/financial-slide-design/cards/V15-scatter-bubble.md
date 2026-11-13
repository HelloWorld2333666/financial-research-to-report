---
id: V15
type: family
layer: L2
name: Scatter and bubble
aliases: [new in revision b]
refs: []
---

**Purpose:** the relationship between two (or, with bubble size, three) measures, and the outliers.

**Applies when:** debt against yield across countries; growth against deficit; spread against rating.

**Hard constraints:**
- **Bubble area encodes the third measure.**
- Axes labelled with units.
- Points identifiable.
- **No causal wording** unless the evidence supports it.

**Heuristics:** label the focus and the outliers directly rather than every point; add quadrant or reference lines only when meaningful.

**Roles:** main exhibit; one module of P3.

**Combines with:**
- M1 focus point highlighted;
- M3 reference lines (averages, thresholds);
- S1 flags as point labels;
- M5 direct labels.

**Risks:**
- **Works when** the relation is the message.
- **Fails when:**
  - there are too few points;
  - the labels collide;
  - correlation is implied as causation.

**Execution:**
- Neutral points with the focus in the highlight colour (R2).
- Labels placed to avoid overlap (R14).

**Alternatives:** paired bars (V05 twice); V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Writes a native scatter; no bubble insertion |
| Builder | **Exposed:** frr-viz native `scatter`, which pairs two datasets **over time** (each point a period). **A cross-entity scatter at one date is unverified** |
| Editability | Native data-bound chart; bubbles would be native shapes |
| Readiness | Plain form; labelling, focus and bubbles not started |
| Visual gap | High |
