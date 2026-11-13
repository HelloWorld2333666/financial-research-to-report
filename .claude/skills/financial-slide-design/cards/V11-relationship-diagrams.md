---
id: V11
type: family
layer: L2
name: Relationship diagrams (network, causal chain, hierarchy tree)
aliases: [T45, T46, T50, DG1, DG2]
refs: [u08]
---

**Purpose:** relations a chart cannot show: who affects whom, how a cause transmits, how a structure is owned or broken down.

**Applies when:**
- actors with named relations;
- ordered causes with accounting or estimated links;
- parent–child data.

**Hard constraints:**
- **The geometry matches the relation:** mesh, chain or loop, hierarchy.
- Figures in nodes are bound.
- Edge labels carry words, not figures (validated).

**Variants by topology:**
- **T45 network or ecosystem:** nodes as circles with icons, arrows labelled with verbs.
- **T46 causal chain:** nodes carry their bound figure; one feedback edge routed separately.
- **T50 hierarchy or ownership tree:** shares as edge labels. *Heuristic:* at most three levels per slide.

**Roles:** main exhibit; with P1 (implications panel); a module of P3.

**Combines with:**
- A1 figures in nodes;
- S1 icons in nodes;
- D1 join symbols and bridging badge;
- H1 conclusion.

**Risks:**
- **Works when** every edge says something specific.
- **Fails when:**
  - every relation is drawn the same (four identical boxes and arrows);
  - nodes are text-heavy;
  - the links are generic.

**Execution:**
- **Filled nodes** for primary actors and outlined nodes for secondary ones; fill encodes the role (R9).
- Thin arrows (R5).
- Labels beside the nodes, not inside boxes.
- **Avoid outlined rectangles with heavy borders** (R3).

**Alternatives:** V09 (a matrix of relations); a numbered list (H1).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders shapes and connectors |
| Builder | **Partial:** `columns` diagram (grid nodes on tinted cards with an icon disc per node via `node.icon`, labelled edges, feedback edge) |
| Editability | Native shapes; node figures bound |
| Readiness | Designed (tested), **mechanically only**. Free placement, icon nodes, filled styling and tree layout not started |
| Visual gap | High (the current output reads as a wireframe) |
