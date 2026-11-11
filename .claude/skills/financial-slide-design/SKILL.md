---
name: financial-slide-design
description: Design or redesign financial and economic research slides in this project (financial-research-to-report) to a consulting-report standard, from verified evidence, as editable native objects. Use when asked to create a new slide or deck section, make a slide look professional or like a research-house deck, redesign a slide, or add agenda/section-divider slides. Do not use for text edits, number or data changes, chart-type switches, small moves, or questions about the evidence.
---

# Financial slide design

Turns a slide request into an evidence-bound, editable slide by choosing a **recipe** (a layout pattern abstracted from
professional research decks, `app/web/src/core/design/recipes.json`) and building it with the project's own engine
(compositions, designed charts, the institutional visual language). Nothing is copied from reference decks.

## When to use it, and when not to
- **Use:** new slides or sections; "make this look like a consulting deck"; redesigning a slide; agenda and divider slides.
- **Bypass** (use the ordinary tools, zero extra cost): text edits, number or data changes, chart-type switches, moving or resizing, evidence questions.

## Procedure
1. **Interpret.** Message, audience, the data available (verified datasets only), language, and the slide's role (content, agenda or divider). Never invent a figure: every number on a slide must come from the Evidence Core through the planner's Writer.
2. **Storyline** (multi-slide requests only). Order the slides (situation, complication, implication). Give each one action title: a conclusion in 16 words or fewer, stating a direction or a rank that the data support.
3. **Classify the need** into a request: `purpose` (trend, comparison, kpi, summary, framework, …), `chart`, `table`, `kpis`, `panels`, `chars`, `kind` (content, agenda, divider).
4. **Retrieve.** One call returns up to 3 recipes and, when the private library is configured, up to 3 reference layouts (about 500 tokens):
   ```bash
   cd app/server && ../../.venv/bin/python -m design_library.retrieve suggest '{"purpose":["trend"],"chart":true,"kpis":1}'
   ```
   - `FRR_DESIGN_LIBRARY` names the private library; without it you get recipes only.
   - To see one reference in detail: `retrieve load <id>` (about 500 tokens).
   - Look at **at most one** reference image: the `preview` names a contact sheet and a cell in `$FRR_DESIGN_LIBRARY/renders/sheets/` (a 4-column grid of 360×203 cells with 8 px gaps).
   - Never read whole decks or sheets.
5. **Choose a recipe** and read its rules in `recipes.json`:
   - **Gate E** (`columns` layouts, preferred):
     - `chart-commentary` (R4);
     - `rank-table` (R5);
     - `risk-matrix` (R6).
   - **Earlier:**
     - `chart-rail` (R1);
     - `ranked-bars` (R2);
     - `trend-annotated` (R3);
     - `agenda` and `divider` (R9).

   Also choose the **language**: `burgundy` (default for new work) or `institutional`.
   - **Vary compositions** across consecutive slides.
   - **A new layout is data:** a `columns` composition lists column spans and the slots stacked in each, and objects name their slot. Add a recipe instead of new layout code when the blocks exist (exhibit title, unit, chart, ranked table, figures, commentary with lead-ins, conclusion, matrix).
6. **Build through the engine, never by hand-placing shapes:**
   - **In the app:** the agent calls `find_layout_references`, then `design_slide` with `recipe` (and `purpose: agenda|divider` with `section` for navigation). The user previews and applies.
   - **In code:** a recipe is a composition (`core/design/compose.ts`) plus chart drawing options (`ChartDraw` in `spec.ts`, drawn in `charts.ts`). The Gate E briefs are in `core/design/proposals.ts`. A new brief is an editorial function:
     - it computes every qualitative statement from the data;
     - it writes every figure through `Writer`;
     - it throws when the data don't support its sentence.
7. **Visual QA.** Render and look once:
   ```bash
   cd app/server && ../../.venv/bin/python render_slides.py --base http://127.0.0.1:<port> --project <id> --out <dir> brief:<name>:<k>
   ```
   - The JSON next to each PNG lists QA findings. Integrity must be OK; QA must have no errors.
   - Render on a project **copy** (the render page never saves); never change the production France deck without approval.
8. **Revise** at most twice, each time against a named defect (overlap, a repeated figure, a weak focal point, a contradiction between headline and chart).

## Rules that always hold
- Editability over appearance: native text boxes, shapes and tables; designed charts are groups of named marks bound to their spec. No pictures of charts or text.
- One focal point per slide; peers quiet; direct labels, not legends; footnote with sources at 8 pt.
- Navigation slides carry no figures. Their numerals are positions in the deck; integrity exempts them and nothing else.
- See `references/rules.md` for typography, colour, chart and table conventions, and `references/taxonomy.md` for the request vocabulary.

## Privacy and licensing
- The reference decks, contact sheets and catalog are **private**. They live outside the repository (`FRR_DESIGN_LIBRARY`).
- Never copy reference text, artwork, logos or exact compositions into the repository, a slide or a prompt.
- Never upload them to an external service.
- `retrieve` output carries no slide text; keep it that way.
