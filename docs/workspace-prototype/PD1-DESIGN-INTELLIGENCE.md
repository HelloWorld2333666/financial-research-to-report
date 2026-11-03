# PD1 Presentation Design Intelligence: results

**Branch:** `feature/workspace-v2`. **Date:** 2026-11-04.
**Model:** local `qwen3.8:27b` through Ollama. No paid service, external model API or new dependency was used.

PD1 adds a design layer between the research and the editable deck. The path is:

1. financial evidence;
2. a slide objective and its main message;
3. a design specification (`frr-design/1`);
4. a layout;
5. native, editable GenOffice elements;
6. layout QA;
7. manual editing and AI redesign that keeps the user's edits.

Everything below was run on the France sovereign credit project with its verified Eurostat data.

## 0. Repository protection (Phase 0)

| Check | Result |
|---|---|
| Git state | Branch `feature/workspace-v2`, clean tree, 29 commits not yet on GitHub (the branch did not exist there). Remote `origin` = `HelloWorld2333666/financial-research-to-report` (**public**, admin rights) |
| M6 | Complete (`PHASE3-M6.md` and its follow-ups); nothing open |
| Tests before PD1 | vitest 143 passed, pytest 254 passed |
| Secrets and private files | The 29 commits were scanned (files and diffs): no keys or tokens, no PDFs, databases, model files or uploads. `app/server/projects/` is gitignored |
| Problem found | One experiment script hard-coded `/Users/<your account>/…`, which would have published your Mac account name. With your approval, only the unpushed commits were rewritten to make the path relative. The tree differs from the backup by exactly that line; the local branch `backup/workspace-v2-before-path-rewrite` keeps the original |
| Push | `feature/workspace-v2` pushed as a new branch (no force, nothing merged into `main`) |

## 1. Research (Phase 1)

| Source (licence) | Adopted as an idea | Integrated as code |
|---|---|---|
| **GenOffice** (Apache-2.0, already vendored) | One deck style sheet decided before any content. Choose the layout by what the content is. No placeholder figures. Type scale and spacing rules. "Fill the page". Defects to avoid, e.g. sibling KPI cards must share one unit and one source, and two lines must not repeat each other. Build → look → audit → fix, changing only objective defects | **`packages/pipelines/src/slides/layout-audit.ts`** at our pinned commit `36a509e`, added to the vendored subset with its sha256: a deterministic audit for off-slide elements, text overflow and overlaps on render nodes. Its licence and NOTICE were already included |
| **slidepoise** (MIT) | Keep a slide's argument separate from its composition. A deck-level inventory of recurring roles (claim title, subtitle, table, data highlight). A shared frame outside the content area. Checks reject bad inputs but never score beauty. Separate "where to look" from "what was found" from "the intended box". Pages can be revised independently | None. Its pipeline generates an image, then reconstructs it with OpenCV; that needs image generation and loses exact data, so it doesn't fit an editable, evidence-bound product |
| **frontend-slides** (MIT) | A fixed 16:9 stage that scales and never reflows. Density modes (speaker-led vs reading-first). Split rather than shrink. Show visual alternatives instead of asking abstract questions. Design files with palette, type scale, spacing scale and grid | None (its output is HTML) |
| **Presenton** (Apache-2.0) | A layout is a typed contract of content slots. The model chooses a layout per slide by purpose; the user's explicit constraints win over variety | None (Next.js and Tailwind HTML rendering, too heavy for this need) |

## 2. Architecture and files

| Area | Files |
|---|---|
| Design specification and validator | `app/web/src/core/design/spec.ts` |
| Design profiles (project style) | `core/design/profiles.ts` |
| Wording from data (every figure bound to evidence) | `core/design/insight.ts` |
| Slide planner (three purposes, two to three designs each) | `core/design/planner.ts` |
| Layout engine (three families) | `core/design/layout.ts` |
| Design → editable elements, redesign, ownership | `core/design/build.ts`, `core/design/style.ts` |
| Layout QA (slide and deck) | `core/design/qa.ts` (uses the vendored audit) |
| Commands | `design.apply` (new slide or redesign), `design.profile`, `slide.delete` (`core/commands.ts`). User ownership is recorded in `core/store.ts` (`markOwned`) |
| Sidecar | `designs` (per slide: the spec and the element realizing each object) and `owned` (per element: position, text, chart choice). Bindings can carry a design `style` beside the spec |
| AI | Agent tools `design_slide` and `set_design_profile` (`app/server/agent.py`). Chat cards `DesignTool` and `ProfileTool` (`chat.tsx`) |
| Tests | `core/design.test.ts` (7). Browser checks `pd1_designs_editable_and_clean` and `pd1_redesign_keeps_user_edits` (`checks.ts`). Headless test `test_pd1_designed_slides_render_16_9_at_1440_and_1100` |
| Other fixes found along the way | A chat error boundary (a malformed saved thread had taken the whole editor down). Design colours follow the profile. A `?slide=N` and a `?probe=1` URL parameter for headless screenshots. A 20 s timeout for the slow chart-audit test |

## 3. The design specification (`frr-design/1`)

```ts
SlideDesign {
  schema: 'frr-design/1', id
  objective: string                 // what the slide must achieve
  claim: { text, numbers?: NumberRef[] }   // the single main message; each figure → evidence or derivation
  audience: 'executive' | 'analyst' | 'committee'
  density: 'low' | 'medium' | 'high'
  layout: { family: 'analytical_hero' | 'comparative' | 'executive_insight', params: LayoutParams }
  profile: string                   // design profile id
  objects: DesignObject[]           // what must be on the slide
  rationale: string[]               // the planner's answers to the eight planning questions
  derivations?: Derivation[]        // computed figures the text cites (change in pp, spread), as formulas over evidence
}
DesignObject =
  | text  { role: kicker|title|subtitle|takeaway|observations|narrative|caption|source, text, items? }
  | viz   { role: primary|secondary, viz: frr-viz/1 spec, emphasis?: dataset id }   // emphasis is styling only
  | table { role, table: { datasets, dates } }
  | kpi   { value: one bound figure, label (says what it measures, with unit), context? }
LayoutParams = { heroShare 0.55–1, support side|below|none, arrangement side_by_side|chart_table|stacked,
                 split 0.4–0.7, kpiPlacement row|column, takeaway top|bottom|none }
AppliedDesign (sidecar.designs[slide]) = { design, elements: objectId → element durable id }
Owned (sidecar.owned[element]) = { box?, text?, content? }
```

**What the validator enforces** (`validateDesign`, deterministic), before anything reaches the deck:
- schema, a known family and profile, and parameters within range;
- unique object ids;
- the objects each family needs (a hero needs a primary chart; a comparative layout two visual objects; an executive insight 2–4 KPIs);
- each chart's spec is valid for the data (V2 constraints), and any warning was explicitly accepted;
- a KPI shows exactly one figure and has a label;
- **every figure in the text resolves to evidence and still matches it**;
- no dataset values are copied into the design.

**What stays separate:**
- frr-viz/1 specs keep the meaning of each chart;
- the Evidence Core keeps the data;
- the design layer only references them, and its chart styling (colours, legend, gap, emphasis) lives beside the spec, so a data refresh redraws with the same styling.

## 4. The three layout families

Each family is a composition with parameters on a margin and gutter grid, with text measured using the canvas's own font metrics. None is a fixed slide.

| Family | Composition | Parameters used in the benchmark |
|---|---|---|
| **Analytical hero** | One large primary chart; the supporting column holds a KPI card for the focus country and observations, beside or below the chart | Chart at 68% width with notes beside it; or full width with one note per country below |
| **Comparative** | Two visual objects side by side or stacked; a chart with a table; notes under the table or in a strip | Trend chart (60%) plus a start/end table; ranked bars (58%) plus a two-year table |
| **Executive insight** | The claim as a band, 2–4 KPI cards (row or column), explanation beside or above the evidence chart | KPI row with explanation and chart; KPI column beside explanation and chart |

**Design profiles:**
- **Institutional** (the default): navy structure, restrained gold accent, ivory background, Inter type scale, header rule, filled KPI cards;
- **Editorial**: white page, black type, one red accent, more white space, outlined KPI cards.

`design.profile` restyles every designed slide and recolours charts; values are unchanged, which a test checks and which was confirmed on the France project.

## 5. Before and after (`docs/workspace-prototype/pd1/`)

| Before (old fixed layout) | After (PD1) |
|---|---|
| `before-1-debt.jpg`: the chart takes 720×400 px. QA: **44% of the content area is one empty region**; source notes at **7 pt**, below the 8 pt minimum | `test1-proposal-A-hero-side.jpg`: the hero chart fills the content height, with a focus KPI and peer notes beside it; QA clean |
| `before-2-fiscal.jpg`: QA: 40% empty, 7 pt source | `test2-proposal-A-ranked-table.jpg`: seven countries ranked with signs kept, France highlighted, an exact two-year table and notes; QA clean |
| `before-3-growth-markets.jpg`: QA: 33% empty, 7 pt source | `test3-proposal-A-kpi-row.jpg`: claim band, four KPIs (each one bound figure with its unit), explanation and evidence chart; QA clean |

## 6. Benchmark on the France project (Phase 9)

Data: the project's verified Eurostat series. For Test 2, **five more countries' fiscal balances** (Italy, Spain, Netherlands, Belgium and Austria; 55 values) were fetched live through the app's research task. Each was confirmed by an independent re-fetch, and the batch was applied by a real click.

| Step | Test 1: debt trend (FR, DE, IT) | Test 2: fiscal balance, 7 countries | Test 3: executive risk assessment |
|---|---|---|---|
| 1. Data and sources | 3 series; the card lists each with its Eurostat source | 7 series | KPIs and explanations cite debt, balance, yields and interest; the spread is derived from the two yields |
| 2. Designs proposed | 3 (hero with notes beside; full-width hero; chart and table) | 2 (ranked bars with table; ranked hero) | 2 (KPI row; KPI column) |
| 3–4. Screenshots and QA | All 7 designs clean after the fixes in §7 | | |
| Model's own wording | **Rejected:** "France has steadily closed the distance to Germany" (**false**: the gap widened from 47.3 to 52.9 pp) | **Rejected:** "span from surplus to deficit" (**false**: all seven ran deficits) | **Rejected:** "…together threaten the trajectory of public finances" (a judgment the data can't check) |
| 5. Applied (real click) | Hero with notes beside: 38/38 bindings, 24/24 figures sourced | Ranked bars with table: 50/50, 27/27 | KPI row: 62/62, 46/46. Each KPI traces in the Evidence panel (115.7 → `ds.fr.debt`; +4.3 → a derivation) |
| 6. Manual edits (real mouse) | Columns → line (menu); the title reworded; the KPI card dragged | Bars → lollipop (menu); the title reworded; the table dragged | Columns → line; the title reworded; a KPI card dragged |
| 7. Save and reload | All three edits and their ownership persisted; integrity OK | Persisted | Persisted |
| 8. AI redesign (slide thread) | "Keep the debt trend and put a table of the start and end values beside the chart" → chart and table | "Ranking as the main chart and the notes beside it" → applied the chart and table design | "KPIs in a column beside the explanation" → KPI column |
| 9. Edits kept | **Title text, line chart and KPI position kept**. Journal diff: "title: your text kept, moved; primary: your chart choice kept; kpi1: not in the new design, kept because you edited it…" | Lollipop, title and table position kept | Title and line chart kept; the moved KPI kept its place and took the new wording ("rewritten, your position kept") |
| 10. Client and server integrity | Agree: 41/41, 48 points, 18 cells, 23/23 | Agree: 50/50, 55 points, 32 cells, 27/27 | Agree: 61/61, 67 points, 32 cells, 44/44 |

**The model's first Test 1 redesign attempt was wrong:**
- **What happened:** it chose purpose "comparison" and gave no metric, and the server filled in the comparison default (deficit), so a debt slide was re-planned as a deficit ranking.
- **Fixes:**
  - on a redesign, a missing metric is taken from the slide's current design;
  - the tool description now separates the data question (purpose) from the arrangement (layout).
- **Retry:** asked the same way again, the request went through correctly.

**At 1100 px** the editor keeps the slide at 16:9 (800×450) with the panel folded (`test1-redesign-at-1100px.jpg`). The headless test asserts 16:9 at 1440 and 1100 and saves real Chrome screenshots (`pd1/headless/`).

**Profile switch** (`profile-editorial-switch.jpg`): three designed slides were restyled, values were unchanged and integrity stayed OK. It was then undone; the project stays institutional.

## 7. Visual QA findings

**Fixed during PD1**, each found by looking at screenshots or by QA:
- Charts kept the project's old colours instead of the profile's.
- A caption repeated the chart's own title.
- Empty space under short notes in the hero layout: it now leads with a focus KPI.
- A flattened full-width chart.
- An evidence chart squeezed into a thin strip.
- "Seven of the seven countries… zero had a surplus" wording.
- A redesign labelled redrawn elements as "added".
- A redesign kept the user's KPI position but not the new profile's card style.
- The chart-size rule fired on executive slides, where the chart is supporting evidence.
- Opening a project with a malformed saved chat message crashed the editor.

**What QA checks:**
- GenOffice's audit: off-slide or out-of-bounds elements, text overflow (height and width), overlapping text and objects;
- text, source notes and chart labels below the profile's minimum size;
- chart labels that collide;
- a legend that covers data;
- crowded or flattened plots;
- tiny small-multiple panels;
- a main visual using under 30% of the content area;
- an empty region over 20% of the content area;
- near-miss alignment (edges 2–10 px apart);
- broken hierarchy (text larger than the title, or smaller than the source note);
- deck consistency: one profile and background, the same sizes per role, fonts and colours from the profile.

**Remaining defects and limits**, all seen in this benchmark:
1. **User-owned elements are not layout obstacles.**
   - When a redesign drops or moves things around an element the user positioned, that element stays where they put it and can overlap the new layout.
   - QA reports this on the card before Apply (Tests 1 and 3).
   - At 1100 px the Test 1 KPI card visibly touches the takeaway band; in Test 3 it was fixed by dragging the card into its slot.
2. **The overlap check is box-based** (the vendored audit), so a note's text box can be flagged against a card below its visible text.
3. **Composite visuals** (lollipop, dumbbell and so on) don't take design emphasis or profile colours. They use the project's Design DNA until `design.profile` is applied. France wasn't highlighted after the change to a lollipop.
4. **Hero side columns** can still leave white space under short notes; it stays below the QA threshold.
5. **Theme changes:** GenOffice's theme change remaps colours of elements a design no longer manages. The deck check flags them.
6. **Kept cards keep their old width:** a KPI card the user moved keeps its width (280 px against 350 px in the new column).
7. **Dragging text boxes:** a selected text box doesn't move when you press on its text, which starts a text interaction, as in PowerPoint. Drag it unselected, or from an empty part.
8. **Playwright wasn't added** (it would need a ~150 MB browser download). The existing headless-Chrome harness takes the screenshots and makes structural assertions (16:9, page boots, checks pass). There's no pixel-diff baseline, by design.

## 8. Tests

- **vitest:** 150 passed, 5 skipped.
- **pytest:** 255 passed, including the 3 headless browser tests (the end-to-end checks now include the two PD1 checks, plus the new screenshot test).
- **tsc:** 0 errors in our sources.

## 9. Git and remote

PD1 is committed on `feature/workspace-v2` and pushed to `origin/feature/workspace-v2` (no force, `main` untouched). The local branch `backup/workspace-v2-before-path-rewrite` is not pushed.

## 10. Recommendations for PD2

1. **Owned elements as layout constraints:** the layout engine reserves the boxes the user placed and plans around them, or the card offers "move my element into the new slot".
2. **Model wording through figure placeholders** (as the rewrite tool already does), plus a data-backed checker for qualitative claims such as "the gap widened", "the highest", "all". The model proposed wording 5 times in the benchmark; all 5 were rejected, and 2 of those messages were false.
3. **Composite visuals under the design layer:** emphasis, profile colours, and a style refresh on profile change.
4. **Style ownership:** record when the user restyles fills, fonts or colours, so redesigns keep it.
5. **Deck storyline planning:** a sequence of slide objectives with family variety across the deck (GenOffice's "no repeated layout back to back"), and a deck-level redesign preview.
6. **Visual style exploration:** three profile previews of one slide, chosen visually (the frontend-slides idea), and more profiles (consulting, corporate), each as tokens.
7. **Ink-based overlap and whitespace checks,** with per-column emptiness, and screenshot baselines per design for regression.
8. **Model latency:** 45 s to 4 min per call on this machine. A single-slide redesign could skip the model when the user picks a layout on the card.

**Implemented** is everything in §2–§8. **Only planned** is everything in §10.
