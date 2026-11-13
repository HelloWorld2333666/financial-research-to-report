---
id: V14
type: family
layer: L2
name: Waterfall / bridge
aliases: [new in revision b]
refs: []
---

**Purpose:** decompose a movement into additive contributions from a start value to an end value.

**Applies when:**
- **Debt-ratio change by driver:** primary balance, interest–growth effect, stock-flow adjustment.
- **Budget bridges.**
- **Earnings bridges.**
- **Year-by-year steps** of one series.

**Hard constraints:**
- The steps are **additive** and reconcile the start to the end.
- Each step is bound (or derived, with provenance).
- Signs are explicit.

**Heuristics:**
- Few enough steps that each is legible.
- Group minor steps into "other", with a note.

**Roles:** main exhibit; the explanation module beside V07 (the path) in P3.

**Combines with:**
- M4 callout on the dominant driver;
- M1 (the dominant driver in the focal tone, others neutral, totals dark);
- A1 net change as a figure.

**Risks:**
- **Works when** the drivers are the message.
- **Fails when:**
  - the steps are not additive;
  - there are many tiny steps;
  - signs are unclear (colour must not be the only cue to sign).

**Execution:**
- Start and end bars in a dark neutral.
- Increases and decreases in two diverging tones (R2).
- Thin connectors between steps (R5).
- Values on the bars.

**Alternatives:** V04 stacked contributions per year; V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** frr-viz `waterfall` composite, a bridge of **one dataset's yearly changes**. A multi-component decomposition (contributions from several datasets or derivations) is **not** supported |
| Editability | Native shapes, bound |
| Readiness | Plain form (yearly bridge); designed form and decomposition not started |
| Visual gap | High |
