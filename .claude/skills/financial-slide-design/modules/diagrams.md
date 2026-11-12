# Diagrams and analytical frameworks

**Principles:** DG1–DG5.

**Use a diagram when the argument is a relationship, not a quantity:**
- transmission of risk;
- debt dynamics;
- ownership or stakeholder maps;
- the steps of a transaction.

**Rules:**
- **Every node shows a bound figure where one exists.**
- **Edges carry short verb phrases** (words only, validated) and are labelled as accounting or institutional links, never as estimated effects unless an estimate is in the evidence.
- **Feedback** is drawn as one edge routed under the row (DG2).

**The `diagram` slot:**
- nodes are KPI or text objects with `node: {r, c}`;
- edges sit in the composition's `diagram.edges` (`back: true` for feedback);
- nodes are cards with a primary-colour top edge;
- connectors are native gold arrows;
- feedback edges are native lines with a triangle head.

**Not yet supported:**
- curved journey paths (DG3);
- radial wedge frameworks (DG4);
- chevron banners (DG5).

Fallbacks: matrix or numbered list.
