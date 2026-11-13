---
id: ROUTER
type: router
layer: all
name: Design router (always loaded)
---

# Design router

Load this card first. It answers **what to consider**; the other cards answer **how to decide and execute**. Load a card only when one of its candidates is in play.

## Workflow

**Deck work** starts with `DK` (storyboard: role, objective, message and density for each slide).

**Each slide:**
1. **Analyse.** State the claim and its sub-findings. Name the analytical objective or objectives. Read the data profile (shapes, periods, entities, signs, whether values are parts of a whole).
2. **Shortlist.** Take two or three candidate families per objective from the table below. Drop any candidate that breaks a hard constraint.
3. **Decide.** Load the candidate family cards (`V…`), pick one per objective, and decide whether combining several adds value.
4. **Compose.** Load:
   - the pattern card (`P…`);
   - the modifier, device and anchor cards the design uses;
   - the `R` entries named in each card's **Execution**.
5. **Plan.** Write the slide design:
   - every figure as a token, never typed;
   - each region with a role;
   - modifiers and devices anchored to named marks.

   **Until the Stage 4 format extensions exist,** write a frr-design/1 `SlideDesign` and record pattern, roles and card ids in `rationale`.
6. **Assets.** List the visual assets the design needs (not optional for covers, dividers, closings, geography and entity comparisons):
   - **imagery** for covers, dividers and closings (S2): a photograph or map of the subject, never a blank field;
   - **a map** when geography is part of the mechanism (V10): routes, chokepoints, exposure by place;
   - **identity markers** (S1): flags beside countries, logos beside companies or agencies, icons for categories, process steps and lead-ins.
   Name them by asset key in the plan (`commons:<File>`, `flag:<iso2>`, `icon:<name>`, map objects); the asset library fetches and records them.
7. **Check.** Validate, render, critique against `R` (H, then P, then J), and revise at most twice.

## Renderer limits never downgrade a design

When a technique the card recommends is not drawable:
1. name the limitation;
2. decide whether it is solved by asset sourcing, asset generation or preprocessing, editable shape composition, or a small engine addition;
3. use that solution, or record why none is practical **and** what the fallback loses.

A plain table, an empty title field or an omitted map is not an acceptable silent fallback.

## Objective → candidate families

The second column gives the matching frr-viz intent for `recommend`.

| The message is about… | frr-viz intent | Candidates |
|---|---|---|
| Historical movement, turning points | trend | V07; V08 for many entities |
| Current comparison, position, gap to a benchmark | ranking | V05 (bar, dot, diverging); V09 ranked table |
| Change between two dates | change | V06 (increment, dumbbell, slope); V09 with a change column |
| Composition of a total | composition, maturity | V01, V04, V03 |
| Decomposition of a movement into drivers | change (bridge) | V14 |
| Relationship between two or three measures | relationship | V15 |
| Spread, dispersion, position in a range | distribution | V16 |
| Location matters to the argument, or geography is part of the mechanism (routes, chokepoints, contagion, exposure by place) | — | V10 (often with V05 or A1 figures pinned to the map) |
| Relations, causality, structure | — | V11 |
| Stages, sequence, cycle, dates | — | V12 |
| Categories × levels, strategic options | — | V13 |
| Assessment against several criteria | sensitivity | V09 (scorecard, heatmap) |
| One decisive figure or ratio | spotlight | A1 |
| Navigation, statement, cover | — | P5, P6, P7, S2 |

**Keywords are not objectives.** A slide that mentions several countries does not, by itself, need a map. But when the transmission runs through places (a strait, a canal, a pipeline, a border), a map is the first candidate, not the last.

## Hard constraints (H): never broken

1. Donut, treemap and stacked parts are **valid parts of a defined whole**.
2. **Area encodes value** (treemap tiles, bubbles, nested shapes), not radius.
3. **Bars start at zero.** Non-zero axes only on non-bar forms, and labelled.
4. **The difference that carries the message is perceptible** at the rendered size. Otherwise change the form.
5. **Small multiples compared directly share a scale.**
6. **A map only when location matters** to the argument or explains the mechanism. Map labels carry names only; figures on a map are bound text pinned to it.
7. **Every figure is bound to evidence;** every data mark is a named mark (integrity).
8. **Colour keeps one meaning within a visualization.**
9. **Text is legible at the rendered size;** our output has no broken labels or overlaps.

Every other rule in the cards is practice (P) or judgement (J). Numbers in the cards marked *heuristic* are first guesses, not limits.

## Card index

| Id | Name | Use when |
|---|---|---|
| V01 | Ring (donut) | One share of a whole, at a glance |
| V02 | Area-proportional shapes | Ratio gist on statement pages |
| V03 | Treemap | Composition with many parts |
| V04 | Stacked composition | Mix per entity, stage or period |
| V05 | Ranking and comparison | Position among peers |
| V06 | Two-period change | Change between two dates |
| V07 | Time series | Paths over time |
| V08 | Small multiples | The same comparison across many entities |
| V09 | Tables | Precise values, scorecards, heatmaps |
| V10 | Maps | Location is the message |
| V11 | Relationship diagrams | Actors, causes, structures |
| V12 | Sequence diagrams | Stages, journeys, cycles, timelines |
| V13 | Framework diagrams | Categories × levels |
| V14 | Waterfall / bridge | Decomposing a change |
| V15 | Scatter and bubble | Relationships between measures |
| V16 | Range and distribution | Dispersion, position in a range |
| M1 | Emphasis | What matters most in a chart |
| M2 | Difference markers | Making a gap or change explicit |
| M3 | Reference markers | Benchmarks, targets, periods |
| M4 | Value callouts | Pinning a key value |
| M5 | Labels | Direct labels, legends, "now (then)" |
| P1 | Dominant exhibit + panel | One proof, one meaning |
| P2 | Headline over substantiation | Gist first, evidence second |
| P3 | Multi-module | Several sub-claims on one page |
| P4 | Summary to detail | Composition linked to its detail |
| P5 | Title-led | Frameworks, summaries, statements |
| P6 | Full-bleed statement | One comparison or map as the page |
| P7 | Layered image page | Covers, dividers, closings |
| D1 | Relationship devices | Tying evidence to meaning |
| G1 | Grouping and shape | Separating without noise |
| A1 | Figure anchors | A figure or ratio carries the message |
| H1 | Text hierarchy | Titles, headers, conclusions, sequences |
| S1 | Identity markers | Flags, logos, icons, product images |
| S2 | Imagery and linework | Photos, cutouts, patterns, motifs |
| C1 | Conventions and mechanical QA | Sources, page numbers, footnotes, caveats |
| R | Refinement principles R1–R14 | Execution and critique |
| DK | Deck | Storyboard, page roles, rhythm |

## Status vocabulary (used in every card)

| Dimension | Values |
|---|---|
| **Engine** | Renders · Writes · Display-only · No |
| **Builder** | Exposed · Partial · Not exposed |
| **Editability** | Native data-bound · Native shapes · Picture |
| **Readiness** | Not started · Plain form · Designed (tested) · Visually reviewed |
| **Visual gap** | Low · Medium · High |

"Designed (tested)" means mechanically correct. Only the user's visual review makes something "visually reviewed".

## Knowledge object types

| Type | Card ids |
|---|---|
| Family | V |
| Modifier | M |
| Pattern | P |
| Device | D1 |
| Figure anchor | A1 |
| Asset | S |
| Convention | C1 |
| Principle | R |

Grouping (G1) and text hierarchy (H1) are refinement cards.

## Privacy

Reference ids in cards (`u01`, `lib:…`) are opaque. Their images and records live only in the private design library. Write cards in our own words; no reference text, artwork or brand marks.
