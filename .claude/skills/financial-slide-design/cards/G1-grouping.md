---
id: G1
type: refinement
layer: L3 (decided) / L4a (executed)
name: Grouping and shape (whitespace and fields, rounded cards, dashed group separators, banners)
aliases: [T61, T63, T65, DG5 (banners, see V13)]
refs: [u02, u07, u15]
---

**Purpose:** separate and group content without visual noise.

**Options:**
- **Whitespace and subtle fields (T61):** the recommended default. Subtle borders and rules remain allowed where they help.
- **Rounded cards (T63):** for highlights and explanation cards. Tables and analytical charts usually keep straight edges.
- **Dashed separators (T65):** between groups of panels or rows (u07).
- **Arrow-shaped banners:** headings for the two sides of a comparison (u15; see V13).

**Hard constraints:** none beyond legibility. This is practice and judgement (R3, R4, R5).

**Risks:**
- **Works when** each separator has a role.
- **Fails when** heavy or awkward borders sit between coloured regions (the revision 3 gold edge), or a box goes around everything.

**Execution:**
- Gutters and fills first; lines second; outlines only when they improve grouping.
- A consistent corner radius per deck (R3).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders: rounded-rectangle preset with adjustable radius; chevrons |
| Builder | **Exposed:** fields, tints, rules, cards. Dashed lines **unverified** |
| Editability | Native |
| Readiness | Renderable |
| Visual gap | Medium (execution, not capability) |
