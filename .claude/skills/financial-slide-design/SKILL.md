---
name: financial-slide-design
description: Design or redesign financial and economic research slides in this project (financial-research-to-report) to a consulting-report standard, from verified evidence, as editable native objects. Use when asked to create a new slide or deck section, make a slide look professional or like a research-house deck, redesign a slide, or add summary, agenda or divider slides. Do not use for text edits, number or data changes, chart-type switches, small moves, or questions about the evidence.
---

# Financial slide design

This Skill builds slides from **recipes** (`app/web/src/core/design/recipes.json`) with the project's own engine. Design knowledge is a catalog of deduplicated **principles** (`knowledge/principles.json`), drawn from curated references, with an honest status for each:
- **principle:** documented;
- **recipe:** structured;
- **renderable:** the engine draws it;
- **tested:** verified by an automated test.

Load only what the slide needs.

## Workflow
1. **Purpose and content.** Work out the message, the verified data available, and the slide's role (summary, content, agenda, divider). Never invent a figure.
2. **Retrieve.** One call returns the recipes, the principles that apply (short form) and up to three private references:
   ```bash
   cd app/server && ../../.venv/bin/python -m design_library.retrieve suggest '{"purpose":["trend"],"chart":true}'
   ```
   For full principle text: `retrieve principles TY2,CH7`.
3. **Load the module** for the main element, in `modules/`:
   - `charts`, `tables`, `layout`, `diagrams`;
   - `typography`, `assets`, `storytelling`, `qa`.
   Read one or two, not all. Open a reference image only when its visual detail is needed.
4. **Compose.** Choose a recipe and a language (`burgundy` by default, `institutional` available). Vary compositions across consecutive slides.
5. **Generate editable elements:**
   - **In the app:** `find_layout_references` then `design_slide(recipe=…)`.
   - **In code:** a brief in `core/design/proposals.ts` or `editorial.ts`. It computes every statement from data, writes every figure through `Writer`, and throws when the data don't support the sentence.
6. **Render and inspect.** Run `render_slides.py … brief:<name>:<k>` on an in-memory project copy. QA must have no errors; integrity must pass with no unsourced figures.
7. **Revise** at most twice, against named defects (`modules/qa.md`).

## Unsupported techniques
If a principle's status is `principle`, use its `fallback` and say so in the rationale. Don't approximate with pictures: analytical content stays native and bound to evidence.

## Adding references
1. Add a record to the private `frr-design-library/knowledge/references.jsonl`: purpose, layout, techniques, and the principle IDs it supports.
2. Add a new principle only when no existing one covers the lesson. Otherwise link the reference to the existing ID.

Nothing else needs reprocessing.

## Privacy
- Reference decks, images and records stay in the private library (outside the repository).
- Principles and modules are written in our own words, with no reference text, artwork or brand marks.
- Web imagery only with the user's approval of source and licence.
