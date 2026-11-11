# Gate E: design knowledge from the curated references, organised into the Skill

**Branch:** `feature/workspace-v2`, local commit only. **Date:** 2026-11-12.
**Scope:** an audit of the Skill, knowledge extracted from every reference you sent (20 images) and the 9 library slides studied earlier, a modular knowledge architecture, runtime wiring, and a small demonstration on the France project. No full-deck redesign.

**Private files** (outside the repository, because they describe or contain licensed material):
- `frr-design-library/knowledge/references.jsonl`: one record per reference;
- `REFERENCE-KNOWLEDGE-MATRIX.md`: the readable matrix;
- `renders/gate-e3-compare/*.png`: Gate D against the new slides against your references;
- `user-refs/2026-11-12/`: your images, persisted.

## 1. Skill audit: what the Skill knew before this pass (verified in files and code)

| Area | Before | Evidence |
|---|---|---|
| Entry point | `SKILL.md`, 787 words: workflow, recipe list, privacy | file |
| Design rules | `references/rules.md`, 829 words of prose (reference principles 1–7, colour roles, titles, charts, composition) | file |
| Recipes | 8 in `recipes.json` (R1–R6, agenda, divider) | file |
| Retrieval | Recipes and private layout references; **no design rules returned** | `retrieve.py` |
| App agent (Qwen) | Saw recipe ids and names only, **never any rule text** | `agent.py` |
| Runtime application | The planner built R1–R3 and R9. **R4–R6 were documented and renderable, but the app could not produce them** | `planner.ts` (no call to the proposals) |
| Reference records | **None.** Lessons lived in reports and commit messages | — |
| Status tracking | **None.** "In the Skill" could mean documented, rendered or untested | — |

**Observed but never documented:**
- donuts with central shares;
- 100% stacked bars with flags;
- maps with markers;
- small multiples with a focus panel;
- nested proportional shapes;
- pills;
- network and causal diagrams;
- radial frameworks;
- split backgrounds;
- motifs and cutouts;
- summary-to-detail brackets;
- two-level table headers.

**Too restrictive:**
- every slide was a single exhibit with one panel;
- there were no diagrams or multi-module pages;
- the frame and background could not vary;
- recipes could only choose among fixed compositions. The `columns` composition fixed that last one, but too few blocks existed to use it.

## 2. Reference knowledge matrix (summary; full matrix private)

28 records:
- u01–u20, with u16 and u17 being two crops of one slide;
- 9 library slides.

Each record covers analytical purpose, layout, distinctive techniques, chart and table patterns, typography, background, financial use cases, capacity, feasibility and editability, and the principle ids it contributes to.

| Ref | What it teaches (beyond colour and type) | Principles |
|---|---|---|
| u01 | Three modules on one page: twin donuts with serif centre shares, a stage-axis area chart with in-area callouts, a context flag | CH3, CH15, LY3, BG5 |
| u02 | 100% stacked bars with flags; explanation cards coloured like the segments (legend as argument) | CH4, CH10, LY9 |
| u03 | Bubble map with "now (then)" labels; caveat tag | CH11, ST2, TY7 |
| u04 | Grouped columns with metric rows (pills) aligned under the groups; numbered footnotes | TB4, CH13, TY8 |
| u05 | Numbered serpentine journey | DG3, TY6 |
| u06 | Small multiples in labelled groups; an enlarged focus panel; two highlight tones | CH8, CH2 |
| u07 | Stacked small multiples with dashed group separators | CH5, CH8 |
| u08 | Ecosystem diagram with labelled arrows; "+" and "»" join symbols | DG1, LY6 |
| u09 | 35-row ranking with flags and a benchmark bar | CH9, CH10 |
| u10 | Regions map; nested circles; proportional squares | CH11, CH12 |
| u11 | Highlighted increment with a big "+20%"; peer benchmarks with flags; a split KPI panel | CH7, TB6, LY4 |
| u12 | Nested circles; a big ratio statement (~2x) | CH12, ST3 |
| u13 | Map callouts with leaders and trend icons; title placed lower-left | CH11, LY7 |
| u14, u15 | Radial lever frameworks; before/after outline overlay; chevron banners | DG4, DG5 |
| u16 | Summary column bracketed to detail tables; two-level headers; in-cell bars | LY5, TB3, TB1 |
| u18–u20 | Split photo closing; line-pattern cover; duotone cutouts; numbered levers | BG3, BG4, TY6 |

## 3. Gap analysis

- **Captured before this pass (and still tested):**
  - action titles;
  - finding-led exhibit headers;
  - type scale;
  - key figures in serif;
  - commentary with bold lead-ins;
  - ranked table;
  - scorecard matrix;
  - gap brackets, shaded periods and callouts;
  - full-height implications panel;
  - navigation.
- **Existed only in the implementation (now documented):** colour roles per language, sparkline windows, the ranking direction rule.
- **Observed but never documented (now documented):** the 30 principles first recorded in this pass (marked "new" in the private matrix).
- **Missing and now implemented (renderable and tested):**
  - two-period increment (CH7);
  - flags (CH10);
  - benchmark list (TB6);
  - multi-module pages with dividers (LY3);
  - split background (LY4);
  - thematic motifs (BG2);
  - node-and-edge and causal-chain diagrams (DG1, DG2).
- **Still missing (documented with fallbacks):**
  - donuts, stacked and grouped bars, small multiples;
  - benchmark bar (needs a derived average with provenance);
  - maps (no geo shapes);
  - nested shapes, pills, stage-area charts;
  - two-level headers, aligned metric rows, heatmaps;
  - brackets between exhibits, explanation cards;
  - journeys, radial frameworks, banners;
  - licensed imagery, line-pattern covers;
  - ratio statements;
  - deck-level QA.

## 4. Knowledge architecture

```
.claude/skills/financial-slide-design/      (public, our own words)
  SKILL.md                     compact entry: workflow, statuses, fallbacks, how to add references
  modules/                     loaded one or two at a time
    typography.md  charts.md  tables.md  layout.md  diagrams.md  assets.md  storytelling.md  qa.md
  knowledge/principles.json    58 deduplicated principles: id, module, rule, purposes, needs, status, impl, fallback
  references/taxonomy.md       retrieval vocabulary
app/web/src/core/design/recipes.json        11 recipes, each listing its principle ids
app/server/design_library/retrieve.py       one retrieval module for the Skill and the app agent
frr-design-library/knowledge/               (private) references.jsonl + the matrix
```

- **Rules live once,** in `principles.json`. Modules hold the decision logic ("which form for which question") and point to principle ids.
- **References link to principles;** a new reference adds a record, and a new principle only when no existing one covers it.

## 5. Skill updates in this pass

- **Principles:** `principles.json`, 58 entries.
- **Skill files:** eight modules; `SKILL.md` rewritten; `rules.md` retired into the modules.
- **Recipes:** R7 `multi-module`, R8 `exec-split`, R9b `causal-chain`; every recipe lists its principles.
- **Engine:**
  - `columns` options: `split`, `dividers`, `diagram`, and asset slots;
  - decoration kinds (cards, arrows, lines, arrowheads, edge labels, pictures with provenance);
  - chart forms `delta` and `benchList`;
  - `flags`;
  - self-authored motifs (`motifs.ts` with `motifFor`);
  - the burgundy language revised: white and warm ivory, burgundy only for focal data, antique-gold hairlines, warm taupe peers, near-black only for titles and figures.
- **Editor fix:** pictures now display in the editor, its thumbnails, chat previews and the render page. Until now no inserted or imported picture was drawn anywhere.

## 6. Implementation status (58 principles)

| Module | Tested | Renderable | Principle only |
|---|---|---|---|
| Typography | 5 | 1 | TY7, TY8 |
| Charts | 6 | 0 | CH3, CH4, CH5, CH8, CH9, CH11, CH12, CH13, CH15 |
| Tables | 3 | 0 | TB3, TB4, TB5 |
| Layout | 4 | 2 | LY5, LY7, LY9, LY10 |
| Diagrams | 2 | 0 | DG3, DG4, DG5 |
| Assets | 2 | 0 | BG3, BG4, BG5 |
| Storytelling | 3 | 0 | ST3, ST4 |
| QA | 1 | 1 | QA3, QA4 |
| **Total** | **26** | **4** | **28** |

**What the levels mean:**
- **Tested:** rendered as native objects with integrity OK, no unsourced figures and no QA errors, in an automated test.
- **Principle only:** documented with a fallback.

None of the 28 principle-only techniques is claimed as supported.

## 7. Runtime integration check

- **What the agent receives:** the app agent's `find_layout_references` was called directly, as the local model calls it. It returned recipes plus six one-line principles with statuses, plus up to three private references.
  - summary or KPI request: `exec-split`, `risk-matrix`;
  - framework request: `causal-chain`, `risk-matrix`;
  - trend request: `chart-commentary`, `chart-rail`, `multi-module`.
- **What the planner builds:** given those recipes, it now builds the Gate E designs. This is tested for `causal-chain` and `multi-module`.
- **Not yet verified:** the local model choosing them in a live chat session.

## 8. Token efficiency

| What | Size | When |
|---|---|---|
| `SKILL.md` | about 600 words | once per session |
| One module | 150–350 words | only the one or two needed |
| Retrieval result (recipes, principles, references) | 2.5–3.2 KB, about 650–800 tokens | per slide |
| Full principle text | about 250 characters each | only on request (`retrieve principles CH7,LY4`) |
| Library index (163 KB) and reference records (15 KB) | never loaded into a prompt | — |
| Original reference images | reopened only when a visual detail is needed | — |

## 9. Demonstration (`gate-e3/`, full resolution, in-memory copy of the France project)

| Slide | Techniques applied | References |
|---|---|---|
| `v3-dashboard-0` | Two coordinated modules with finding-led headers and a divider; the increment highlighted with "+4.3 pp" large; a benchmark list with flags; an ivory figures panel with a gold edge and the Paris motif | u11, u01 |
| `v3-summary-0` | Split ivory field with the title and motif; four numbered findings with bold verdicts and large serif figures; a conclusion under a gold rule | u20, u14, library |
| `v3-dynamics-0` | Causal chain of four bound figures (yield, interest, balance, debt) with labelled accounting links and a feedback edge | u08 |
| `v2-balance-0` | Ranked table with flags, in-cell values, the focus row tinted, and a figures panel | u09, u02 |

All four render with **no QA errors**. The three new briefs pass client integrity with **0 unsourced figures** in tests, and the server agrees on the summary and the diagram (browser check). Tests: vitest **169**, pytest **261**.

**Known limits:**
- The diagram's cards are taller than their content.
- The motifs are my own line art: web imagery waits for your approval of sources and licences.
- The colour values are provisional (no HKMC image received).

## The most valuable lessons we had been missing
1. **A page can hold several coordinated exhibits.** Modules with their own finding-led headers, separated by dividers, are the norm, not the exception.
2. **Charts are constructed to make the point:** the highlighted increment, the benchmark bar, the enlarged focus panel, flags as category markers.
3. **Diagrams carry arguments that charts cannot:** transmission, causality and ownership. Their nodes show figures and their edges carry verbs.
4. **Backgrounds vary within one identity:** white, ivory panels, split fields, dark statements. Imagery is anchored to fields as cutouts or line art, never dropped in as rectangles.
5. **Then and now, and ratio statements, compress comparisons** into one label or one anchor figure.
6. **Every lesson needs a status.** Knowing a technique is not the same as being able to render it, and the Skill now says which is which.
