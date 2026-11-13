---
id: V03
type: family
layer: L2
name: Treemap
aliases: [T04]
refs: []
---

**Purpose:** the composition of a total with many parts, showing relative size and identity together.

**Applies when:** positive parts of a total, possibly nested in groups. Examples: revenue by segment, holdings by sector, exposures by type.

**Hard constraints:**
- Valid positive parts of a defined whole.
- **Tile area proportional to value.**

**Fitness test** (replaces a category count):
- The parts differ enough to compare by area.
- **Every tile that needs a label, and an icon, can hold it at the rendered size.**
- Otherwise:
  - group small parts into "Other" with a note;
  - or label them outside;
  - or switch to V05 or V04.

**Roles:** the main exhibit of a composition slide; the headline tier of P2.

**Combines with:**
- M1 intensity (the focus or the largest part darkest);
- S1 white icons inside tiles (replacing a legend);
- M5 labels inside tiles;
- M4 callout on the key tile.

**Risks:**
- **Works when** area, colour and icon each do one job.
- **Fails when:**
  - parts are similar in size;
  - there are negative values;
  - colour is categorical and also meant to signal importance (see M1 for how they can coexist).

**Execution:**
- A squarified layout so tiles are near-square.
- White gutters between tiles, not outlines (R3).
- Labels and figures inside, top-left aligned.
- Icons from one set, sized to the tile (R9).

**Alternatives:** V05 ranked bars (precise); V04 a single stacked bar (few parts); V01 (one share).

**Example:** no treemap is among the references examined. Ask the user for one before relying on visual details.

**Status**
| Dimension | State |
|---|---|
| Engine | No native treemap: the renderer falls back to a placeholder |
| Builder | Not exposed |
| Editability | **Reconstructable** as native rectangles through a squarified layout; bindable through named marks; icons need an approved set |
| Readiness | Not started |
| Visual gap | High |
