---
id: D1
type: device
layer: L3
name: Relationship devices
aliases: [T39, T62, T64, LY6, LY9]
refs: [u06, u08, u16, u02, "lib:fbbb35f9e3:44"]
---

**Purpose:** make the relation between components clear, so the page reads as one argument rather than assembled parts.

**Implicit devices** (often enough on their own):
- shared colour;
- shared alignment and baselines;
- proximity;
- consistent labels;
- spatial order.

**Explicit devices:**
- **Arrow or connector to a conclusion (T39):** from a specific mark to the statement it supports. **Not on every slide.**
- **Bridging badge:** a small circular badge sitting on the boundary between evidence and conclusion (u06, u08).
- **Join symbols (T64):** "+" for "and", "»" for "therefore", on the divider between modules.
- **Bracket:** from a summary segment to its detail (P4).
- **Colour link:** a segment's colour reused in the detail or explanation that belongs to it.
- **Colour-linked explanation cards (T62):** cards in the series colours that are both legend and argument (u02).

**Hard constraints:** a connector points at the actual mark it refers to; colour links never reuse a colour for something else in the same visualization.

**Risks:**
- **Works when** the relation is specific (this value → this implication).
- **Fails when** connectors are decorative, cross data, or appear on every element.

**Execution:**
- Thin connectors (R5).
- Badges small, solid, sitting exactly on the boundary.
- Prefer an implicit relation when it suffices (R10).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** join symbols (renderable); arrows, lines and badges as decoration; colour via language tokens. No anchoring to chart marks |
| Editability | Native shapes |
| Readiness | Join symbols and badge renderable; anchored arrows and colour-linked cards not started |
| Visual gap | High |
