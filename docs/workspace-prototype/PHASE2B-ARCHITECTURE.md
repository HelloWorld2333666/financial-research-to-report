# Phase 2b: product architecture, reconsidered

**Branch:** `research/phase2-reuse`. This is documentation only. Nothing was installed, built or executed. Repositories were read through the GitHub API and npm registry metadata on 2026-11-01. Star counts and push dates are as of that day.

**Evidence labels** used throughout:
- **[P] proven**: I read it in the source code.
- **[I] inference**: reasonable engineering judgement from the source.
- **[U] unknown**: needs a prototype to settle.

**Supersedes** the Phase 3 recommendation in `PHASE2.md` (PptxGenJS export). Section F explains why.

---

## A. Refined product vision

**What we're building:** a workspace where an AI research agent and a person build one evidence-backed financial presentation together. The research, data, storyline and slides live in one project, and every number on a slide can be traced to a verified source.

**Primary workflows:**
1. **Brief to deck.** "Analyse France's sovereign credit risk; four slides."
   - The agent turns the brief into research questions.
   - It gathers data from official statistics, filings and reports, capturing the source for every value.
   - Values are verified, then an evidence-linked storyline is proposed.
   - Slides are generated with real charts and tables bound to datasets.
2. **Inspect and correct.** Click any number, chart or sentence to see its source, the working edits and their verification status. Edit text, cells, series, colours and layout directly; the AI is never the only way to change anything.
3. **Converse in context.**
   - The project-level chat plans and researches.
   - Each slide's chat edits that slide.
   - Selection-aware requests ("make this table compare against Germany") come back as proposals with preview, apply and reject.
4. **Run work in parallel.** Research and redesign tasks run in the background with visible progress; their results arrive as proposals, not silent changes.

**How this differs from an AI PPT generator** (Gamma, Presenton, GenOffice's own deck generation):

| | AI PPT generators | This product |
|---|---|---|
| Unit of truth | The slide | The **evidence and dataset**; slides are views of it |
| Numbers | Typed by the model | Retrieved, verified and bound; never written in by the model |
| Charts | Pictures or numbers embedded in the chart | ChartSpec bound to a working dataset; gaps stay gaps |
| Editing a value | Changes the slide | Changes the working layer; the source is kept and the edit is flagged until verified |
| AI changes | Regenerate the slide | Validated operations, previewed, then applied atomically and undoable |

---

## B. Capability map

What we have, what's incomplete, and where each capability should come from. Line counts are from the repo; our whole front end is **about 2,100 lines** (`editor/static/workspace/*.js`), our Python editor core about 2,200, and the `src/frr` research core about 1,000.

| Capability | In our repo | State | Best source |
|---|---|---|---|
| Evidence schema: Source → Evidence → Finding → Claim → SlideModule | `src/frr/schema.py` (Pydantic, `extra="forbid"`) | **Solid** | Keep (ours) |
| Deterministic source check: SHA-256, excerpt verbatim on the page, value inside the excerpt | `src/frr/sourcecheck.py` | **Solid** | Keep; extend to API data |
| Question frame and metric definitions | `src/frr/questions.py` | Company and credit only | Keep; add a sovereign frame |
| Working-data layer, manual edits, integrity | `editor/slidemodel.py`, `model.js` | **Solid** (tests A–F) | Keep |
| ChartSpec (references, never values) → ECharts | `charts.py`, `charts.js` | **Solid** | Keep the concept; the renderer can change |
| Research Request/Response contract | `editor/research.py` | Contract only; no engine | Keep the contract; add an engine |
| Slide canvas: select, move, resize, group | `app.js`, Moveable | Works; **weakest area**: no snapping or guides, drag and rotate not checked with a physical mouse, fixed panels | **Replace** with a mature canvas (see D) |
| Text editing | contentEditable + remount | Works for plain text; inline marks untested | Replace (comes with the canvas, or use TipTap) |
| Tables on the canvas | Our renderer + Properties grid | Works; basic | Replace the canvas table; keep working-value binding |
| Data/Evidence workspace grid | `sheets.js` | Works; basic | Mature grid component |
| AI chat, proposals, preview/apply/stale | `simai.js`, `panels.js` | Rule-based prototype | Keep the proposal semantics; real agent plus chat UI library |
| Patches addressed by array index | `edit.js` | Known defect | Replace with **id-addressed operations** |
| Autonomous research | — | Missing | Build a constrained agent from mature parts (section C2) |
| Python analysis | — | Missing | Sandboxed executor |
| Layout intelligence, alternative layouts | Design DNA tokens | Tokens only | Learn from GenOffice `layout-script` and `slide-qc`; build our own |
| Premium UI chrome | Our CSS | Functional, not premium | Radix primitives (MIT) or shadcn/ui (MIT) plus our design tokens |
| PPTX/PDF export | PNG only | — | **Deferred.** Comes almost free if the canvas engine is PPTX-native (D) |

**Not worth protecting** (no sunk-cost argument):
- Preact (the AI UI ecosystem is React)
- the Moveable canvas
- the contentEditable editing
- `sheets.js`
- `simai.js`

Together that's about 1,000 lines. **Worth protecting:**
- the evidence schema and source check
- the working layer and integrity rules
- ChartSpec
- the research contract
- the proposal semantics
- the 26-check scenario suite, as a specification

---

## C. Open-source integration opportunities

### C1. Presentation editing

**New finding: GenOffice** (`genspark-ai/genoffice`). Apache-2.0, 11.5k stars, created 2026-07-31, about 1,117 commits from 56 contributors, pushed 2026-10-30. It's an Electron "AI office suite" whose Slides app is a PowerPoint-class editor with a built-in agent.

| Item | Evidence |
|---|---|
| Licence | Root `LICENSE` is Apache-2.0 [P]. `ee/` is under a separate "Enterprise License" (development and testing only), but `ee/README.md` says it's empty except the notice [P]. Third-party notices are generated at packaging time, not checked in, so its dependency licences still need an audit [U] |
| Electron-free document engine | `packages/pptx-engine`: "pptx parsing (Slide element tree with byte anchors + inheritance resolution), OOXML fragment generation, element-patch save". It depends on `jszip` and `fast-xml-parser` [P] |
| Pure-data renderer | `packages/pptx-render/src/render-tree.ts`: "a data-driven abstract draw list … Konva is just a thin adapter". Text is laid out with opentype.js metrics in `text-layout.ts` [P] |
| **Operation layer for agents** | `packages/pptx-ops/src/ops/executor.ts` [P]: "plan-then-execute with snapshot rollback". The whole batch is validated first; `dryRun` returns the plan and touches nothing; atomic mode restores the snapshot on any failure, with a "guided error". Its op families (`ops/{core,element,insert,table,text,slide,arrange,animation}-ops.ts`) each have model-facing docs (`prompts/ops/*.md`) [P] |
| **Canvas with a clean boundary** | `apps/slides/src/renderer/SlideCanvas.tsx` (2,619 lines) and `konva-adapter.ts` (1,858) have **no Electron calls** (0 uses of `window.slidesApi`) [P]. `SlideCanvas` is a controlled component: it takes a `RenderSlide` and `selectedIds` and reports `onSelect`, `onTransform(preview)`, `onTransformMulti`, `onEditText(caret)`, `onEditTableCell(row,col)`, `onTableColResize`, `onMarqueeSelect`, `onDuplicateTo`, `onEnterGroup` and `onContextMenu` [P]. Its host owns the model, which is exactly the adapter boundary we want |
| Electron-coupled shell | `App.tsx` is 4,852 lines with 79 `window.slidesApi` calls and 103 `useState` [P]. **Not reusable**; we'd write our own shell |
| AI editing patterns | `ai/edit-queue.ts`: element-scoped instructions anchored by **ids only, never coordinates or slide index**; staleness is decided at submit time [P]. `ai/slide-qc.ts`: a per-slide layout QC pass in a fresh agent loop (screenshot plus element inventory for vision models; geometry only otherwise) [P]. `ai/slides-skill.ts` tools: `plan_deck`, `generate_deck`, `apply_ops`, `edit_chart`, `read_slide`, `regenerate_slide`, `web_search`, `ask_clarification`, and others [P] |
| **Mismatch with our rules** | `components/ChartDataDialog.tsx`: "invalid/empty values count as 0"; its series are `values: number[]` with no nulls [P]. That fabricates zeros, so we must replace this dialog with ours. Nothing in it models a source, unit or verification status [P] |
| Maturity risk | Three months old and changing fast [P]. Single vendor (Mainfunc/Genspark) [P]. Its stability as a library is untested [U] |

**Other editing candidates:**

| Candidate | Licence | Fit | Verdict |
|---|---|---|---|
| PPTist | AGPL-3.0 | Mature Vue editor | Excluded (licence; see PHASE2) |
| Presenton | Apache-2.0; export core unlicensed | Web, Next.js and Konva; editor weaker than GenOffice's | Learn from its generation pipeline; don't adopt |
| tldraw | Custom licence: production use needs a licence from tldraw [P, `LICENSE.md`] | Infinite whiteboard, not slides | Not suitable for commercial use without paying |
| Excalidraw | MIT | Whiteboard; hand-drawn style; weak typography and tables | Not suitable |
| Univer | Apache-2.0 | `packages/slides` is 90 source files against 895 for sheets [P], so its slides are immature. **Univer Sheets** is a strong embeddable spreadsheet [P] | Candidate for the Data/Evidence grid; heavy [I] |
| Konva / Fabric.js | MIT | Canvas libraries; we'd still write the editor | Konva comes with GenOffice anyway |
| Penpot | MPL-2.0, Clojure | A whole design app; not embeddable | No |
| Puck, Craft.js, Plasmic, Onlook | MIT / Apache | Web-page builders, not slide canvases | Not this problem |
| TipTap, Lexical, ProseMirror | MIT | Rich text | Use for the text overlay if we keep our own canvas |
| Glide Data Grid, RevoGrid, TanStack Table | MIT | Data grids | Lighter alternative to Univer for the data workspace |
| AG Grid, Handsontable | Mixed or commercial licences (not verified in this phase) | — | Avoid |
| Radix primitives, shadcn/ui | MIT [P] | Premium accessible UI chrome | Adopt for the shell |

### C2. AI research

The question isn't whether a framework has financial citations, but **whether its tools return enough to capture evidence** that our validator can then verify deterministically.

| Need | Candidate | Licence | What I verified | Role |
|---|---|---|---|---|
| Typed model calls, tools, approvals | **PydanticAI** | MIT | `models/ollama.py` and others (local models, no paid API); `docs/deferred-tools.md`: tools that "need to be approved by the user first" and runs resumed later; an AG-UI adapter in `ui/ag_ui/` [P] | **Agent runtime.** Our schema is already Pydantic, so outputs validate against `src/frr/schema.py` directly [I] |
| Durable multi-step workflows | LangGraph | MIT | Not inspected in depth | Alternative if runs must survive restarts; heavier [I] |
| Planning and step tracking | OpenManus `app/flow/planning.py` | MIT | Plan, then step status, then executor dispatch [P] | **Learn the design only**: plan → steps → status → per-step executor |
| PDF/document capture | **Docling** (`docling-core`) | MIT | `ProvenanceItem{page_no, bbox, charspan}` on every extracted element (`types/doc/common/reference.py:205`) [P] | Maps directly to our Evidence `page` + `excerpt`, which `sourcecheck.py` already verifies. Heavy ML dependencies [I] |
| HTML capture | Trafilatura | Apache-2.0 | Main-text extraction [P: licence only] | Web pages to excerpts, with URL and retrieval time |
| Official statistics | `sdmx1` (Eurostat, ECB, IMF, OECD); `fredapi` | Apache-2.0 | Licence and activity [P] | **Best provenance**: series key + period + retrieval time; can be re-fetched to verify |
| Search | SearXNG (self-hosted, AGPL, run unmodified as a separate service), or paid APIs later | — | Licence [P] | Configurable provider. Search finds documents; it is never evidence |
| Python analysis | smolagents executors (E2B, Docker, Modal, Blaxel in `remote_executors.py`) | Apache-2.0 | Class list [P] | Pattern for a **Docker sandbox** (no network, read-only data mounts). Analysis outputs become derived evidence, recording input ids and a code hash |
| Browser automation | browser-use | MIT | — | Defer. Only inside a sandbox, for sources with no API or document |
| Deep-research reference designs | GPT-Researcher (Apache-2.0), open_deep_research (MIT), STORM (MIT) | — | GPT-Researcher tracks `source_urls` and `visited_urls` (`agent.py`) [P], which is URL-level, not value-level | Learn the query-planning designs; don't adopt |
| Heavy platforms | OpenManus, OWL, CAMEL `[owl]` | — | See PHASE2 | Not needed. One runtime only |

**The adapter can't recover missing evidence.** The workflow must capture it at retrieval time:
- documents: hash + page + excerpt
- APIs: series key + period + value + retrieval time
- analysis: inputs + code

A deterministic validator decides what becomes evidence. Model output is a *candidate* until it passes. Anything the agent "knows" without a captured source becomes a gap, never a number.

### C3. AI-native editing

| Need | Candidate | Licence | Evidence | Role |
|---|---|---|---|---|
| Agent ↔ UI event stream (messages, tool calls, state, interrupts) | **AG-UI protocol** | MIT | PydanticAI ships an adapter [P] | Wire protocol between the Python agent and the workspace |
| Chat threads, tool-call rendering, human-in-the-loop | **assistant-ui** (`@assistant-ui/react` 0.15.32) | MIT | Peer dependency `react ^18 \|\| ^19` [P] | Chat UI for slide and project threads |
| | CopilotKit | MIT | `use-frontend-tool`, `use-human-in-the-loop`, `use-agent-context` [P] | Alternative; more opinionated |
| Operations, preview, atomic apply | GenOffice `pptx-ops` executor | Apache-2.0 | dryRun plus snapshot rollback [P] | Adopt directly if we use its engine; otherwise copy the design |
| Element-anchored requests | GenOffice `edit-queue.ts` | Apache-2.0 | Ids only; staleness checked at submit [P] | Design to copy (also fixes our Phase 1 defect 9) |
| Layout QC | GenOffice `slide-qc.ts` | Apache-2.0 | [P] | Pattern for "AI-assisted redesign" checks |

**React vs Preact.** Every chat UI candidate requires React [P]. Our shell is about 2,100 lines of Preact. Moving to React costs little and opens the ecosystem [I]. Running these libraries under `preact/compat` is untested [U].

---

## D. Architecture alternatives

All four keep the **Evidence Core** (schema, source check, working layer, integrity, ChartSpec, research contract). Research and agent infrastructure is the same in A, B and D: it lives in its own Python service and doesn't depend on the editor choice.

### Strategy A: extend our current editor

```
 Preact→React shell ── our canvas (Moveable + TipTap + ECharts) ── id-addressed ops ──▶ Project JSON
       │                                                                               (Evidence Core)
       └── assistant-ui ◀─AG-UI─▶ Research/Agent service (PydanticAI · SDMX · Docling · sandbox)
```
- **Integration points:** replace `edit.js` patches with id-addressed ops; a TipTap text overlay; a grid for `sheets.js`; snapping and guides written by us.
- **For:** full control; perfect fit with the evidence model [P]; small codebase.
- **Against:**
  - We write the whole long tail of editor features: snapping, smart guides, connectors, crop, table cell merges, group editing, text fitting, typographic metrics, multi-select transforms.
  - GenOffice's canvas plus renderer is about 4,500 lines, and its engine adds roughly 100 more source files [P], so that's the scale of the work [I].
  - Reaching "Canva-class" feel would take months [I].
- **Complexity:** low to start; **high in total**.

### Strategy B: our model, a mature canvas (GenOffice engine behind an adapter)

```
 React shell (ours: panels, chat, data workspace, design system)
   │ selection / callbacks                         ▲ RenderSlide (pure data)
   ▼                                               │
 GenOffice SlideCanvas + konva-adapter   ◀── pptx-render (layout, text metrics, charts)
   │ onTransform / onEditText / onEditTableCell     ▲
   ▼                                                │ in-memory Slide tree (pptx-engine)
 Our Op Executor (id-addressed, dryRun, atomic) ──▶ Document = OOXML slide parts
   │                                                + Evidence Binding sidecar (element id → evidence /
   ▼                                                  ChartSpec / table cell bindings)
 Evidence Core (Python) ◀── validation ── Research/Agent service
```
- **Integration points:**
  - `SlideCanvas` props (verified contract)
  - `pptx-ops` executor (atomic, dryRun)
  - `pptx-engine` `chart-insert.ts` / `chart-workbook.ts`, so ChartSpec plus working data compile into an app-created chart
  - durable element ids (`ensureCreationId` in the executor) as the binding key for evidence
- **Replace:** `ChartDataDialog` (empty→0) and the table-cell edit path, both routed to our working layer.
- **For:**
  - mature hit-testing, text layout, tables, groups, connectors, marquee and duplicate-drag at once [P: present in source]
  - an agent op layer that's already designed and documented [P]
  - PPTX fidelity and export come almost free
- **Against:**
  - **two sources of truth** (OOXML for visuals, our sidecar for data), which needs strict binding rules [I]
  - charts render through OOXML semantics, not ECharts, so gap handling and visual quality are [U]
  - we follow a fast-moving upstream, so we'd vendor the packages pinned
  - Electron-free in the browser and performance are [U]
- **Complexity:** medium, if the unknowns are favourable.

### Strategy C: adopt GenOffice (or Presenton) as the application foundation

```
 Fork of GenOffice (Electron: shell, ribbon, AI panel, docs/sheets/slides)
   + our Evidence Core as a sidecar service + our research agent replacing its web_search skill
```
- **For:** the most features on day one: ribbon, animations, presenter view, comments, deck generation with QC, multi-provider models [P].
- **Against:**
  - **Desktop Electron.** The web is a requirement and its shell is tied to IPC (79 calls in `App.tsx`) [P].
  - Office/ribbon paradigm, not a premium creative tool [I].
  - Its data model has no provenance, and its chart editor fabricates zeros [P].
  - It ships Docs, Sheets, PDF and Markdown apps we don't need [P].
  - Forking a 6,400-file repo changing at about 370 commits a month means permanent merge work [I].
  - Our identity would sit on top of someone else's product.
- **Presenton as the foundation** is weaker: web-native but a less mature editor, a closed export core, and no provenance [P, PHASE2].
- **Complexity:** low to start; **very high to maintain**; a poor fit for criteria 1, 6–8 and 15.

### Strategy D (recommended): evidence-first operation protocol with a swappable canvas

D is B with the boundary drawn where it protects the product, plus a staged decision:

```
                         ┌────────────── Workspace (React, our design system) ──────────────┐
  Project chat ─┐        │  Canvas adapter  ⇄  Canvas engine   (1st choice: GenOffice SlideCanvas │
  Slide chats ──┼─AG-UI─▶│  Data workspace (grid) · Evidence inspector · Task centre            │
  Selection ────┘        │  assistant-ui threads · proposals (preview / apply / reject)         │
                         └───────────────▲────────────────────────────────┬────────────────────┘
                                         │ render                         │ Ops (id-addressed)
                         ┌───────────────┴────────────────────────────────▼────────────────────┐
                         │  Document Op Protocol: validate · dryRun · atomic apply · journal ·  │
                         │  undo; same ops for mouse, keyboard, AI and research insertions       │
                         ├───────────────────────────────────────────────────────────────────────┤
                         │  Evidence Core (Python authority): evidence · datasets · working layer│
                         │  · ChartSpec · bindings · integrity · verification · export policy    │
                         └───────────────▲───────────────────────────────────────────────────────┘
                                         │ candidates → deterministic validation → evidence
                         ┌───────────────┴───────────────────────────────────────────────────────┐
                         │  Research service: PydanticAI runtime (local Ollama now; providers     │
                         │  configurable) · plan/step state · SDMX/FRED · Trafilatura · Docling ·   │
                         │  Docker sandbox for Python · background tasks                           │
                         └───────────────────────────────────────────────────────────────────────┘
```
- **What makes D different from B:**
  - The **operation protocol and Evidence Core** are the architecture. The canvas engine is a replaceable renderer and gesture source.
  - GenOffice's canvas is the first choice. If Experiment 1 fails, we fall back to A's canvas behind the same protocol, and nothing above or below the canvas changes.
- **Rules:**
  - Every change, whether a manual gesture, an AI proposal or a research insertion, is the same kind of validated op. That's what makes preview, apply, undo, history and provenance consistent.
  - Elements are addressed by durable id.
  - Numbers on the canvas are always *rendered from bindings*, never stored on the canvas. Editing a chart or table goes through our data editor into the working layer.

### Comparison against your priorities

Scores run from 1 (poor) to 5 (strong), with the evidence label in brackets.

| # | Criterion | A: extend ours | B: GenOffice canvas | C: adopt GenOffice | **D: protocol + swappable canvas** |
|---|---|---|---|---|---|
| 1 | In-browser editing flexibility | 3 [I] | 4 [U: browser] | 2 [P: Electron] | 4 (falls back to 3) |
| 2 | UX quality | 3 [I] | 4 [I] | 3 [I] | 4 [I] |
| 3 | Visual polish | 3 (our effort) | 4 [I: text metrics] | 3 (ribbon) | 4 |
| 4 | Autonomous research | 4 (same service) | 4 | 3 (its search has no provenance) | 4 |
| 5 | AI-assisted editing | 3 (we build ops) | 5 [P: pptx-ops] | 5 [P] | 5 |
| 6 | Evidence Core compatibility | 5 [P] | 3 [U: sidecar] | 2 [P] | 4 (protocol owns it) [U] |
| 7 | Deterministic charts | 5 [P] | 3 [U: gaps; P: dialog empty→0] | 2 [P] | 4 (ECharts fallback) [U] |
| 8 | Provenance and revision history | 5 [P] | 3 [U] | 2 | 5 (journal plus working layer) [I] |
| 9 | Performance | 4 [P at demo scale] | 4 [U] | 4 | 4 [U] |
| 10 | Effort and time saved | 2 | 4 [U] | 3 short term, 1 long term | 4 [U] |
| 11 | Maintenance burden | 3 | 3 (vendored, pinned) | 1 (fork) | 3 |
| 12 | Security and tool isolation | Same research service in A, B and D: sandboxed Python, no browser automation at first, read-only data | = | 2 (BYOK agent in an Electron main process) | = |
| 13 | Licensing and commercial use | 5 | 4 [U: dependency audit] | 4 | 4 |
| 14 | Extensibility | 3 | 4 | 3 | 5 |
| 15 | Unified product, own identity | 5 | 4 | 2 | 5 |

---

## E. Critical unknowns that need a prototype

| # | Assumption | Why it matters | How to test |
|---|---|---|---|
| U1 | GenOffice `pptx-engine`, `pptx-render`, `konva-adapter` and `SlideCanvas` run **in a plain browser page**, outside Electron, at good frame rates | Decides B/D versus A | Experiment 1 |
| U2 | Evidence bindings keyed by durable element id survive move, duplicate, copy/paste, group, undo and save/reopen | Decides whether provenance can coexist with an OOXML visual model | Experiment 1 |
| U3 | A chart compiled from ChartSpec plus working data renders **gaps as gaps** and looks premium in pptx-render, or an ECharts overlay can stand in for it | Deterministic charts are non-negotiable | Experiment 1 |
| U4 | A constrained agent on a **local model** can plan a sovereign-credit question and capture evidence that passes deterministic verification at a useful rate | Decides whether autonomous research is feasible without paid APIs | Experiment 2 |
| U5 | Official statistical APIs (Eurostat, ECB, IMF via SDMX) cover the core sovereign metrics with re-fetchable series keys | Determines how much must come from PDFs and HTML | Experiment 2 |
| U6 | assistant-ui and AG-UI work with our proposal model, possibly under `preact/compat` | Decides whether to migrate to React now | Experiment 3, or a one-day check |
| U7 | GenOffice's third-party dependency licences (harfbuzzjs, opentype.js, fonts) allow commercial use | Licence hygiene | Run its notices generator inside the sandbox during Experiment 1 |

---

## F. Revised recommendations

1. **Architecture: Strategy D.** It wins because it's the only option that:
   - keeps our differentiator (verified, bound evidence) as the authority
   - gets a mature editing surface without forking a product
   - makes AI and manual editing one mechanism (validated ops)
   - keeps a fallback if the external canvas disappoints

   C fails the browser, provenance and identity criteria. A is safe but slow to reach the editing quality you want. B without the protocol-first boundary would let OOXML quietly become the source of truth.
2. **The PptxGenJS Phase 3 recommendation no longer stands.** It fixed a peripheral gap (export) and wouldn't move any of your top priorities. Under D, PPTX export becomes a side effect of the canvas engine, if Experiment 1 succeeds.
3. **Previous conclusions revised:**
   - Presenton stays "learn only". GenOffice is a stronger and more relevant source.
   - OpenManus is "learn the planning design", not "unsuitable, end of story".
   - The agent runtime should be **PydanticAI**, not CAMEL: our schema is already Pydantic, and it has approvals and AG-UI built in.
   - Docling turns the citation gap into a solved capture problem: its page, bbox and charspan feed our existing source check.
4. **Targeted replacement in our code:**
   - Replace: the Moveable canvas, contentEditable editing, index-addressed patches, `sheets.js`, `simai.js`, Preact.
   - Keep everything in the Evidence Core and the proposal semantics.

---

## G. Revised development sequence (experiments, not implementation)

Each experiment is time-boxed and throwaway, on its own branch, with no merges. The first two answer the decisive questions and can run in parallel.

### Experiment 1: canvas transplant (U1, U2, U3, U7). About 4 days

**Setup:**
- An isolated folder.
- Read GenOffice's `package.json` scripts first.
- `npm install --ignore-scripts` for only the three packages plus Konva and React.
- A Vite page served locally.

This **executes reviewed third-party code in the browser**, so I'll ask before running it.

**Acceptance:**
1. Our France and China Re demo slides (converted into in-memory slides) render in the browser. Select, move, resize, rotate, marquee, group and in-group editing, text editing and table-cell editing all work with **real mouse input**, at 1440×900, with drag above 50 fps on a 20-element slide.
2. A batch of 5 AI-style operations shows a **dryRun preview**, applies atomically, and undoes in one step. A deliberately invalid batch leaves the slide untouched.
3. A bar chart and a line chart compiled from ChartSpec plus working data render with **Italy's 2005 gap kept as a gap**. Editing a value through our data editor updates the chart; the source value is unchanged.
4. Evidence bindings survive move, duplicate, copy/paste, group/ungroup, undo/redo and save/reopen. The integrity report still finds every bound value.
5. A licence report for every bundled dependency.

**Exit decision:**
- All pass → D with the GenOffice canvas.
- 1 or 2 fails → D with our own canvas (A's path).
- 3 fails alone → keep ECharts overlays for charts.

### Experiment 2: evidence-capturing research agent (U4, U5). About 4 days, in parallel

**Setup:**
- A separate Python virtual environment.
- PydanticAI (slim) on local Ollama, if you have it or approve installing it.
- `sdmx1` against Eurostat and ECB (no keys).
- Trafilatura.
- For PDFs, our existing page-text extraction first. Docling only if you approve its heavy install.
- No paid APIs.

**Task:** "Analyse France's sovereign credit risk":
- questions → plan
- candidates for debt/GDP, deficit, interest burden, the 10-year OAT–Bund spread, growth, and recent rating actions
- validation → `ResearchRecord`

**Acceptance:**
1. 100% of accepted evidence passes deterministic verification: API values re-fetched and equal; document excerpts found on the stated page with the value inside.
2. Every rejected candidate is listed with a reason.
3. Unanswerable questions become gaps.
4. At least the four core metrics come from official APIs with series keys.
5. The plan, each step's status and all tool calls are logged.
6. We record the local model's planning quality honestly, as the input to a later decision on paid models.

### Experiment 3: vertical slice of the AI-native loop (U6). About 3 days, after 1 and 2

**Setup:**
- React shell with assistant-ui over AG-UI.
- A project thread and a slide thread.
- Uses Experiment 2's recorded research output, so no live model is needed.
- Uses whichever canvas Experiment 1 selects.

**Acceptance:**
1. A four-slide France deck is assembled through **ops only**, with each step shown as a proposal.
2. A selection-aware request ("compare this chart with Germany") produces a previewable, rejectable op batch.
3. After AI changes, manual edits to text, a table cell and a chart value work and keep their provenance.
4. A background "add rating history" task runs while editing continues, and arrives as a proposal.
5. The existing 26 scenario checks are ported as the regression specification.

After these three experiments the architecture choice rests on evidence rather than inference. Phase 3 implementation (and any PPTX export) is planned only once you've reviewed the results.
