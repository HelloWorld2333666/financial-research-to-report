# PD2 Visual design: diagnosis, architecture changes, France prototype

**Branch:** `feature/workspace-v2`, local commit only. **Date:** 2026-11-09.
**Status: a prototype for your visual review, not a completed design milestone.** The engineering checks pass. Whether the design quality is acceptable is your call, made on the renders and the slides in the app.

## 1. Why the PD1 slides looked generic

The renders are in `pd2/before/` (1280×720, through the app's own renderer):
- `pd1-debt-0.png`, `pd1-balance-0.png`, `pd1-risk-0.png`: the PD1 planner's first designs;
- `slide-5/6/7.png`: the benchmark slides with their manual edits.

| Aspect | What the slides did | Why it reads as generated |
|---|---|---|
| Typography | One family (Inter) at four similar sizes and weights. The title was a two-line data sentence carrying four numbers | No contrast between display and text, so there is no voice. A headline that lists numbers reads as a database row, not a conclusion |
| Focal point | Title, chart title, KPI card and table all competed. In the debt chart France had no emphasis and Italy's tall bars dominated | The message (France rising, peers falling) was not encoded visually anywhere |
| Charts | Default engine charts: a heavy black chart title outweighing the slide title, Arial-like labels against Inter text, legend boxes, clustered columns for a four-year trend, default gridlines | The chart engine's defaults set most of the slide's look. Changing colours didn't change that |
| Composition | Rectangles of equal weight: a title band, then two columns, with beige cards in rows | Box packing: every region was filled because it existed, not because the message needed it. Equal weights mean no hierarchy |
| Information density | The ranking chart was repeated by a table, the notes repeated both, and the claim repeated the KPIs | Repetition fills space without adding meaning |
| Design language | Navy, gold and ivory tokens; a kicker and a hairline. The table used the built-in style (off-palette blue header) | A palette, not a system: no header treatment, motifs, figure treatment, chart style or footnote style |
| Whitespace | Leftovers: the space under short notes, the right column under a table | Whitespace was the remainder, not deliberate |

**Why all of this passed the checks.** QA detects defects: overflow, overlap, tiny type, empty regions. It cannot detect the absence of design intent, such as a missing focal point, a flat hierarchy or a message that isn't encoded. The layout engine allocated rectangles to content types, and the planner wrote template sentences.

## 2. Reference designs

**The earlier France presentation was not available.** It isn't in the repository, and this session cannot read `~/Downloads` (macOS blocks it). You offered to copy the references into `docs/design-references/`; that folder doesn't exist yet. This pass is built from your description:
- dark navy header;
- restrained gold accents;
- ivory background;
- serif titles.

A second pass against the real references is the first thing to do once they're in the folder. No Paris imagery was drawn, because I had no reference for it.

## 3. Architecture changes (the minimum)

| Change | Files | Why |
|---|---|---|
| **Visual language** instead of a palette: typography pairing (Source Serif 4 Semibold for headlines and hero figures, Inter for text and data), a type scale with strong contrast (30 pt headline, 54 pt hero, 8 pt footnote), a masthead (navy band, gold line, letter-spaced section label), hairline separators and a short gold motif, footnotes, a margin and column grid, and chart treatments (focus and peer weights, direct labels, grid) | `core/design/language.ts` | Coherence across slides comes from roles, not colours |
| **Serif font:** Source Serif 4 (Adobe, SIL OFL 1.1), downloaded with your approval: 4 faces with recorded hashes, measured and drawn with the same files | `public/fonts/SourceSerif4-*`, `core/fonts.ts` | Serif titles, as in your reference description |
| **Semantic structure separate from composition:** the spec states the headline, standfirst, focal figure, evidence chart, supporting figures, notes and footnote. A composition decides placement and scale | `core/design/spec.ts` (`composed` family, roles, `group`, `variant`, `shape`), `core/design/compose.ts` | One message can be shown several ways without changing the evidence |
| **Five compositions**, each with parameters: an evidence rail (side, chart share), a statement column, a wide chart, figure bands (first band can lead) and a lead with a dark panel. Text is measured in its own typeface | `core/design/compose.ts` | Variety comes from information structure, not from rearranging cards |
| **Charts drawn by the design engine**: line (focus heavy with every point marked; peers quiet; end labels; change and gap annotations), ranked bar (focus bar and tinted row; values at the bar ends; no axis or legend) and dumbbell (start ring, end dot; key above the rows) | `core/design/charts.ts`, `core/composite.ts` (per-mark font, letter spacing, no-fill shapes) | Default chart rendering was the largest single source of the generic look |
| **They stay inside the data contract:** every value is a mark named with its value, every label is re-laid-out and compared by client integrity, and the server checks the values. The frr-viz spec is unchanged; the drawing choice lives in the binding style (`render: 'designed'`) | `core/integrity.ts`, `app/server/integrity.py`, `app/server/viz.py` | The design can't silently change a number |
| **Editorial planner** for the three France briefs: computed directions and ranks, and every figure written through the evidence Writer, with a new `gap` derivation (own minus peer) | `core/design/editorial.ts`, `core/design/insight.ts` | Content decides composition. No unsupported conclusions |
| **Exploration loop:** a chrome-free render page (`?render=1`), a render script (headless Chrome, 1280×720 PNG plus QA), review rounds | `src/render.tsx`, `app/server/render_slides.py` | Real previews to inspect before anything reaches a slide |
| **Product path:** the `design_slide` chat card offers the editorial compositions first; the PD1 layouts remain the fallback | `core/design/planner.ts` | You choose among real previews in the chat |

Unchanged: the Evidence Core, the frr-viz specs, the editor, ownership, undo, and the PD1 commands.

## 4. Exploration: render, inspect, revise

Each round was rendered at 1280×720 and inspected by eye (by me, Claude, during development); the renders are kept in `pd2/round1…round4`.

| Round | Found | Revised |
|---|---|---|
| 1 | Headlines overflowed into the standfirst; footnotes at 7.5 pt; a unit label repeated each chart heading; "+4.3 pp" shown three times; rail figures repeated bar values; the three-row dumbbell left most of its area empty; the panel figures were top-heavy; the band middles were empty | Measured line height from the font's own metrics; footnotes at 8 pt; unit labels removed; repeated figures replaced by information the chart doesn't show (change since 2024, how the gap is defined); notes anchored to the rail foot; band text enlarged and aligned with the figure |
| 2 | Headline spacing slightly over-estimated; panel figures still top-heavy; a footnote rule crossing the two-line footnote; QA flagging a deliberate dark panel as empty and the band charts as a "small main chart" | Tighter measurement; figures centred in equal panel slots; rule moved with the footnote; QA counts filled shapes as content and applies the main-chart rule only when the slide has a primary chart |
| 3 | The small band charts didn't say which line is France; the three-country dumbbell was a weak encoding for a "the gap widened" message | Country names on the end labels; the statement slide now uses a line chart with the gap bracketed and labelled at the start (47.3 pp) and the end (52.9 pp, in gold) |
| 4 | Clean on all six | — |

**Local model:** Qwen3.8 reports vision capability, but I did not evaluate it as a visual reviewer, so I make no claim for it. In the product, the candidates are exposed for **your** review as rendered previews in the chat card.

## 5. The candidates (`pd2/after/`, sheets `pd2/compare-*.png`)

Each sheet shows the PD1 render beside the two new candidates, all at 1280×720.

| Slide | Candidate A | Candidate B |
|---|---|---|
| **Debt trend** | *Evidence rail.* Headline "France's debt kept rising while Germany's and Italy's fell". An 8-column line chart with France heavy and annotated (111.4% → 115.7%, +4.3 pp since 2022); Italy and Germany quiet with end labels. The rail holds 115.7% as the hero figure, the 52.9 pp gap to Germany (47.3 pp in 2022), and a definition of the gap | *Statement column.* Headline "The gap between France and Germany widened to 52.9 pp of GDP". The change ledger (+4.3 / −1.3 / −1.7 pp). France against Germany with the gap bracketed in 2022 and 2025 |
| **Fiscal balance** | *Ranked bars with a rail.* "France ran the second-largest deficit of the seven". France navy on a tinted row, the other six in one grey, values at the bar ends. The rail holds −5.1% and +0.7 pp since 2024. No table | *Wide change chart.* "France's deficit narrowed in 2025 but remained the second-largest of the seven". The hero figure sits beside the headline; a full-width dumbbell 2024 → 2025 with France highlighted. The standfirst names who widened and who narrowed (computed) |
| **Executive risk** | *Figure bands.* "Debt, deficit and funding cost: three pressures on France's credit". Debt leads (taller band, larger serif figure, navy rule), then deficit and funding cost; each band has its figure, one sentence and a France-against-Germany line | *Lead and dark panel.* "France's debt reached 115.7% of GDP in 2025, +4.3 pp since 2022", with its annotated chart on the paper. Deficit (−5.1%) and spread (76 bp) on a navy panel with one line each |

**My own assessment** (for your review, not a claim of quality):
- **Strongest:** debt A, balance A and risk A. They have one focal point each, a clear hierarchy and no repetition.
- **Debt B:** the bracket makes the gap the subject; its left column is text-heavy.
- **Balance B:** carries rank and change in one chart; the hero figure beside the headline is a little isolated.
- **Risk B:** high contrast; its panel has more space than it needs.
- **Not yet at the level of a top research house:**
  - no photographic or illustrated header (no references);
  - no deck-level variation between section and content slides;
  - the masthead is the same on every slide;
  - chart typography is fixed rather than tuned per chart.

**In the app:** the six candidates are now **slides 8–13 of the France project** (debt A, debt B, balance A, balance B, risk A, risk B). Slides 1–7 are unchanged as the "before" state. Undo, or Delete slide, removes them.

## 6. Engineering acceptance

| Requirement | Result |
|---|---|
| All figures verified | Every figure in headlines, standfirsts, figures and notes is bound to evidence or a derivation; the validator refuses unbound ones. France project after adding the six slides: **client and server integrity OK, 153/153 bindings, 144 chart points, 74/74 figures sourced** |
| Evidence bindings | Designed charts: every value is a named mark (server-checked) and every label and position is client-checked against a fresh layout. **Bug found and fixed:** the server compared designed ranked bars in the native bar's bottom-up order; it now uses the projection order. The browser check now covers the ranking chart |
| Editable objects | Headlines, standfirsts, figures and notes are native text boxes; the masthead, panel and rules are native shapes; charts are groups of native shapes bound to their spec. **Nothing is an image** (test asserts no pictures). Switching a designed chart to a native PowerPoint chart (`viz.change`, e.g. to columns) works, and undo brings the design back |
| Clipping and overlaps | QA (vendored GenOffice audit plus our checks) is clean on all six in the browser renders and in tests |
| Save/reload, undo/redo | Tested: data edit (chart redrawn, bound text flagged until restored), chart change, undo, text edit, save and reopen with composition, designs and integrity intact |
| **Tests** | vitest **154 passed** (new `pd2.test.ts`: 4 tests); pytest **255 passed**, including the headless browser checks (new `pd2_composed_slides_server_agrees`); `tsc` 0 errors |

## 7. Limitations

1. **The design is built from your description, not the reference slides.**
2. **Designed charts export to PowerPoint as groups of shapes, not data-editable PowerPoint charts.** In our workspace they are fully bound and regenerate from data. Anyone needing PowerPoint's chart data sheet can switch a chart to a native type from the menu (losing the designed styling).
3. **Exported fonts:** the exported `.pptx` names Source Serif 4; machines without it substitute a serif. The font is OFL and can be installed or embedded; embedding is not done.
4. **Coverage:** the editorial planner covers the three France briefs (debt trend, a balance ranking where every country is in deficit, a risk summary with a reference peer). Other requests fall back to the PD1 layouts. Generalising the briefs, and letting the model choose compositions, is the next step.
5. **Your edits as layout constraints:** elements you own still aren't obstacles for a redesign (unchanged from PD1).
6. **Aesthetics:** deterministic QA still cannot judge them. That judgment came from the review rounds above and needs yours.
