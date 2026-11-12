---
id: M1
type: modifier
layer: L2
name: Emphasis (intensity hierarchy, single highlight, outline, ghosting)
aliases: [T33, T36, CH2]
refs: [u06, u15, "lib:fbbb35f9e3:38"]
---

**Purpose:** tell the reader what matters most inside a visualization. **The objective decides what gets the emphasis:** the highest value, the largest change, the target entity, or a stated finding.

**Host:** any family (V01–V16); table rows (V09).

**Variants:**
- **Single highlight:** the focus in the highlight colour, everything else neutral.
- **Intensity hierarchy (T33):** darkest for the most important, a medium step for the second, neutral for context. Two highlight roles can carry two different findings (u06).
- **Outline (T36):** a thin outline in a separate semantic colour marks a key segment, cell or region without recolouring (u15).
- **Ghosting:** context faded, the subject at full strength (u15).

**Hard constraints:** within the visualization, each emphasis colour has one meaning, explained by a legend or a label.

**Risks:**
- **Works when** each step encodes a stated role.
- **Fails when** several highlights compete for "most important".
- **Categorical colour plus a focus:** can coexist if the focus uses a distinct channel (saturation, outline, label) and the categories stay readable.

**Execution:** steps from one ramp; context in neutral grey; outline thin, used once (R2, R3).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders (fills, strokes) |
| Builder | **Partial:** one focus dataset with peers (`emphasis`) in designed charts; focus row tint in tables; **intensity tiers** as chips on a four-step ramp of the structure colour in matrices (`cell.chip` 1–4) |
| Editability | Native shapes |
| Readiness | Single highlight designed (tested). Roles per mark, outline and ghosting not started |
| Visual gap | High |
