---
id: P5
type: pattern
layer: L3
name: Title-led composition (title field, title in negative space)
aliases: [T58, T59, LY4, LY7]
refs: [u14, u20, u13]
---

**Purpose:** make the title a compositional block when the page argues one idea: a framework, a summary, a set of levers, a map briefing.

**Variants:**
- **T58 title field:** the title owns a region (white, solid or gradient) beside the content.
- **T59 title in negative space:** the title sits in an empty area of a full-bleed visual, such as the ocean of a map. **It needs that empty area.**

**Applies when:** frameworks (V13), executive summaries, numbered levers (H1), map briefings (V10).

**Combines with:** V13, V10, H1 numbered sequences, S2 imagery (in the field), P7.

**Risks:**
- **Works when** the title carries the page's message and the content is self-explanatory.
- **Fails when:**
  - the field holds a small title and nothing else (accidental emptiness, R7);
  - the content needs more room than it gets.

**Execution:**
- A large title (display role).
- The content aligned to the field edge.
- Imagery in the field only at a fidelity that suits its size (R12).

**Cover composition** (`kind: "cover"`): the art (a photograph or a map) fills the right `artCols` columns, or the whole slide (`art: "full"`, faded left side under the text); the title block sits on the deep panel colour: kicker, rule, display title, standfirst, then questions or watch items as a matrix with icons. Text objects carry `tone: "onDark"`. Use it for covers, section openers and closing pages.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders; gradient writing **unverified** |
| Builder | **Exposed:** `columns` `split` (a full-height field holding the title); `cover` composition (art side or full bleed, display title, icon items). T59 over a map: via `cover` with a map as art |
| Editability | Native text and shapes; the photograph a picture |
| Readiness | Cover designed (tested) on the Middle East deck (cover and closing) |
| Visual gap | Low |
