# Phase 2c: results of Experiments 1 and 2

**Branch:** `research/phase2b-experiments` (from `research/phase2-reuse`). This is throwaway experiment code and results. Nothing was pushed or merged, and our editor is unchanged.
**Date:** 2026-11-01. Run on an Apple M5 with 32 GB RAM, in the built-in Chromium at 1440×900.
**Approvals used:**
- Experiments 1 and 2, as proposed in PHASE2B.
- Installing Ollama and Qwen 2.5 14B.
- No Docling (we used lightweight text extraction instead).
- Node 22 was downloaded as the official checksum-verified tarball into the scratchpad. No paid APIs were called.

**Method labels:** "real" means the browser tool's own mouse and keyboard. "Scripted" means pointer events dispatched from JavaScript, used only where the tool cannot act (frame-rate timing) and labelled wherever it was used.

---

## Experiment 1: GenOffice canvas behind our Evidence Core

**Setup.** GenOffice is pinned at commit `36a509e8` (see `experiments/exp1-canvas/GENOFFICE_COMMIT`).
- **Reviewed and imported:** `pptx-engine`, `pptx-ops`, `pptx-render`, `SlideCanvas.tsx` and `konva-adapter.ts`, bundled with Vite. GenOffice's root `postinstall` (`install-electron`) was never run. Our harness installed 10 direct dependencies (about 150 packages including transitive ones) with `--ignore-scripts`; only esbuild's and fsevents' install scripts were skipped. Every installed package licence is MIT, ISC, BSD, Apache or CC-BY (caniuse data); jszip is dual MIT/GPL, and we take MIT.
- **Browser shims for Node APIs:** `buffer` (MIT), a 40-line sha256 and `randomUUID` shim, and fflate's `zlibSync`.
- **Bundle:** 3.2 MB minified, 0.97 MB gzip. This includes i18n dictionaries that tree-shaking could likely remove (not attempted).
- **Our adapter, `experiments/exp1-canvas/src/deck.ts`:**
  - builds the France slide from `workspace_demo.json` using **only `pptx-ops`** (`addElement`, `addChart`, `addTable`, `setTableCell`)
  - keys an evidence-binding sidecar by GenOffice durable ids (`e_<guid8>`, from `a16:creationId`)
  - compiles chart series and table cells from our **working layer** (`chartSeries`, `effectiveObs` from our `model.js`)

### Results against the acceptance criteria

| # | Criterion | Result | Method and evidence |
|---|---|---|---|
| 1a | Renders in a plain browser, no Electron | **Pass** | SlideCanvas and the engine run in Vite + React 19. The slide is built entirely through operations |
| 1b | Select, move, resize, rotate with real mouse | **Pass** | Real drag moved the commentary, one undo step. Real corner-handle drag resized the bar chart (456×230 → 419×193 px) and the chart re-laid itself out. Real rotation-handle drag rotated the source note by 76.5° |
| 1c | Text editing | **Pass, with work for us** | A real click on text opens editing; real typing then commits through `setText`, keeping bold, size and colour. GenOffice's rich-text editor overlay lives in its Electron `App.tsx`, so the harness used a plain textarea. **We must supply the text editor (for example TipTap) or extract GenOffice's.** In-group text editing was not tested |
| 1d | Table cell editing | **Pass** | A real double-click on Germany 2025 opened the editor with the **working value** (65.7, not the formatted text). Typing 66.6 wrote `working[2025]` (status `manual_unverified`); the source stays 65.7. The table cell, the line chart and the bar chart updated in **one atomic step (5 operations)** |
| 1e | Group, ungroup, in-group | **Partial** | Real Shift-click plus Cmd+G grouped two text boxes, and Cmd+Shift+G ungrouped them (the group was selected by script). **The engine cannot group charts or tables** (`groupElements` refuses graphic frames; PowerPoint allows it). In-group editing was not exercised |
| 1f | Marquee selection | **Not verified** | The tool's drag is too fast to register a marquee. The code is present in `SlideCanvas` |
| 1g | Copy/paste | **Pass, with a caveat** | Real Cmd+C/Cmd+V. The paste gets a new unique durable id, and our adapter copied the binding (10/10 bindings, 81 points). **The pasted chart shares the original's chart part** (`chart2.xml`, same rId), so the copy is linked: editing one chart's data or formatting changes both. PowerPoint makes independent copies |
| 1h | Drag ≥ 50 fps with 20 elements | **Pass** | With 23 elements, a scripted 90-frame drag ran at **59.9 fps** (p95 17.4 ms, max 21.8 ms). Rebuilding the draw list takes **2.9 ms**. The real drags felt instant but are too short to time |
| 2 | AI batch: dry-run preview, atomic apply, one undo; invalid batch untouched | **Pass** | A real click proposed 5 operations (`setTransform`, `setText`, `setFill`, `alignElements`, `addElement`). The dry run returned a 5-line plan and left the slide unchanged. Apply ran atomically as one step, and one real Cmd+Z reverted all five. The invalid batch (one bad id) was caught at dry run with a guided error listing valid ids; the forced apply was refused and **the slide stayed byte-for-byte identical** (structural comparison), with no history entry. **The dry run gives a text plan, not a visual preview.** A visual preview would mean applying to a cloned deck and rendering it (snapshot clone is about 1 ms; not built) |
| 3 | Charts from ChartSpec + working data, **gaps kept** | **Pass after a patch** | The chart model and file are correct: missing values are omitted from the XML and `dispBlanksAs="gap"` is written; 78/78 points match the working layer, including Italy 2005 = null. **But GenOffice's renderer joins across gaps** (`build-chart.ts` skips nulls and builds one polyline). A 15-line patch (`genoffice-gap-patch.diff`) breaks the line at nulls: Italy then draws as segments of 3 and 21 points. Clearing Germany 2010 in our data editor (real input) produced a working deletion, a visible gap (segments of 8 and 16), and the source value 62.4 kept |
| 4 | Bindings survive move, duplicate, copy/paste, group, undo/redo, save/reopen | **Partial** | They survive move, resize, rotate, text edits, data edits, copy/paste (adapter re-binds by durable-id difference), undo/redo and save→reopen (21 KB, save 61 ms, open 15 ms, 9/9 bindings, 78 points, 9 cells match). **Grouping changes children's durable ids** (`e_d538a444` → `e_10`: GenOffice's `identity.ts` falls back to `cNvPr` ids inside groups, and its comment calls creationId continuity in groups "a known follow-up"). Two of nine bindings stop resolving until ungroup, which restores the original ids (9/9) because the GUID is still in the bytes |
| 5 | Licence report | **Pass** | GenOffice is Apache-2.0; `ee/` is empty. All harness dependencies are permissive (listed above). Liberation Sans is SIL OFL 1.1 |

### Other findings that matter for the decision

- **Typography.** With GenOffice's default estimated metrics, words collide ("decouplingfrom"). Measuring **and** drawing with the same real font (Liberation Sans, `?fonts=1`) gives correct spacing. **We must ship our fonts and their metrics.** That's a design-system task, not a blocker.
- **Chart polish gaps:**
  - All 25 year labels are drawn with no thinning (ECharts thins them).
  - Charts are only clickable where something is drawn, not in their empty area.
  - Tables use PowerPoint's default orange style unless we apply a table style.
- **Element ids change on every re-parse** (for example after a chart edit). Selection and any host state must use durable ids. Our harness's selection panel showed this.
- **The canvas's 160 px bleed overlaps neighbouring UI** and must be clipped or stacked. Clicks on the side panel and data editor were swallowed until fixed.
- **A click on text starts editing at once** (PowerPoint/WPS style), so a plain click on text cannot be the start of a drag. That's a UX choice we can configure.
- **Harness bugs I hit and fixed** (not engine defects):
  - text read from the wrong field (one test erased the commentary; undo restored it)
  - overlay focus stolen by the canvas
  - created ids that are transaction-local
  - the canvas bleed blocking clicks
  - a slide-pixel versus canvas-pixel mix-up in the AI note offset

### Verdict on Experiment 1

**Exit condition met: Strategy D with the GenOffice canvas is viable**, with four engine-level changes we would own:
1. gap rendering (15-line patch, done in the experiment)
2. durable ids inside groups
3. grouping graphic frames, or accepting PowerPoint-unlike behaviour
4. independent chart parts on paste

Plus host work: a text editor overlay, fonts, a visual dry-run preview, table and chart styling, and axis-label thinning.

None of these breaks provenance, because the Evidence Core remains the authority and the canvas only ever receives values projected from it.

---

## Experiment 2: evidence-capturing research agent

**Setup:**
- **Environment:** an isolated 113 MB virtual environment with `pydantic-ai-slim` 2.64 (MIT), `openai` client (Apache-2.0), Trafilatura (Apache-2.0), httpx and pypdf (BSD).
- **Model:** Ollama 0.40.13 with **Qwen 2.5 14B** (Q4_K_M), installed with Homebrew. No paid API, and no Docling.
- **Tools** (`experiments/exp2-research/research_agent.py`):
  - `eurostat_series` (the Eurostat statistics API, no key)
  - `fetch_page`, restricted to an allow-list of official, rating-agency and reference hosts
- **Capture:** every retrieval is recorded with its exact query URL or page text plus sha256, and the time.
- **Validator** (deterministic, no model):
  - accepts an API value only if it equals the captured observation **and** an independent re-fetch of the same query
  - accepts a page fact only if its excerpt appears verbatim in the captured page text
  - everything else is rejected with a reason
- **Output:** accepted items become `frr` `Evidence` (`verified_by: exp2-validator`) inside a validated `ResearchRecord`; unanswered questions become `Gap`s.

**Data sources (U5).** Eurostat covers all the core metrics, for France and Germany, by query URL (checked by direct probe before the agent ran):
- debt: `gov_10dd_edpt1` GD
- deficit: B9
- interest payable: `gov_10a_main` D41PAY
- real GDP growth: `nama_10_gdp`
- 10-year yields: `irt_lt_mcby_a`

The data is current to the October 2026 release. **Rating actions are not machine-accessible from primary sources:**
- AFT (France's debt agency) and S&P return 403 behind bot protection.
- Fitch and Moody's return JavaScript shells.
- Only Wikipedia (a secondary source) returns rating data.

We did not try to get past any bot check.

### Four runs: what failed, what fixed it

| Run | Design | Outcome |
|---|---|---|
| 1 | Planner prompt included the tool guide | **Failed.** The model, which had no tools, emitted a tool call (`eurostat_series(...)`) instead of a plan, and failed validation 3 times |
| 2 | Planner fixed; researcher returns structured candidates in tool-call output mode | Plan in 240 s. The researcher **called the right tools** (debt, France and Germany) but then failed to produce valid structured output 3 times (501 s for one question). Stopped |
| 3 | Researcher in native JSON-schema output mode | **Made no tool calls at all** and invented 27 candidates: debt figures, a "2.80% in 2021" yield, and 2022–23 rating affirmations by S&P, Moody's and Fitch, with made-up URLs. **The validator rejected 27/27** ("source_url was never retrieved by a tool") |
| 4 | **The model chooses what to retrieve; code builds numbers from the captures**; page facts quoted by a separate no-tools step | **Passed**, details below |

### Run 4 results against the acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | 100% of accepted evidence passes deterministic verification | **Pass:** 64/64 accepted values were reproduced from the capture and an independent re-fetch. 0 rejected |
| 2 | Every rejected candidate listed with a reason | **Pass:** in run 3 (27 reasons) and in the log. Run 4 had no rejections because no model-typed number reached the validator |
| 3 | Unanswerable questions become gaps | **Pass:** `rating_history` became a gap. The model's guessed URLs were refused (`moodysdaily.com`, not on the allow-list) or blocked (S&P 403; Fitch JavaScript page) |
| 4 | At least four core metrics from official APIs with series keys | **Pass:** six series for France and Germany, 12 tool calls, each with its query URL in `locator` |
| 5 | Plan, step status and tool calls logged | **Pass:** `out/log.jsonl` |
| 6 | Honest record of local-model planning quality | See below |

**Planning quality (Qwen 2.5 14B, local):**
- The 7 questions are sensible and close to an analyst's checklist (debt, fiscal balance, interest, growth, market pricing, rating history, other factors).
- The `metric` field was never filled in.
- The four-slide storyline degenerated in **every** run: titles were copied from question ids, and one slot became a 900-character run-on.
- Plan time: 37–240 s. One question took 24–57 s. The full run took 324 s on an M5.

**Narrative quality.** The model's free-text answers are not evidence, and they show why claims need their own check:
- 21 of 23 numbers appear somewhere in the evidence, **but**:
  - 2025 outturns are described as "projected".
  - Germany's debt is said to "slightly increase" from 64.1 to 62.8.
  - "2% in 2025" uses the 2024 value (2025 is 2.2).
  - The "current" yield cited is 2023 although 2025 data was retrieved.
- `additional_factors` was marked answered because a tool ran, but the tool retrieved the deficit again rather than anything about geopolitics or policy.

**Gaps in our schema:**
- `Evidence` has no fields for API provenance (query URL, retrieval time, content hash), so they were put in `locator` and `Source.url`.
- There is no derivation lineage for computed values such as the OAT–Bund spread.

### Verdict on Experiment 2

**The capture-then-validate architecture works, and it is necessary:**
- With the model typing numbers, 27/27 were invented.
- With code taking numbers from captures, 64/64 were verified.

A local 14B model is **good enough to choose questions and tools**, but not to write structured numeric output, storylines or claims unaided. So for Phase 3:
1. Numbers must always come from tool captures.
2. Narrative claims must be generated from evidence ids and checked by a **period-aware claim validator**.
3. Rating actions need a licensed data feed or a user-uploaded document; the open web won't provide them.
4. Storyline and slide-copy quality is a reason to evaluate a stronger (possibly paid) model later; that's your decision.

---

## Combined conclusion and recommended next step

Both decisive unknowns are now answered by evidence rather than inference:
- **U1–U3 (canvas):** GenOffice's engine and canvas run in a normal browser and stay fast. A batch of AI-style operations can be checked first, applied in one undoable step, and refused cleanly when invalid. Our working-layer data drives native charts and tables. The required engine changes are known and small: gap rendering, ids inside groups, grouping charts and tables, and independent copies on paste.
- **U4–U5 (research):** official data is open and fully verifiable, rating actions are not openly accessible, and a local model is a usable planner but an unreliable author.

**Strategy D is confirmed.** The three choices it rests on are:
- **Evidence Core:** stays the authority.
- **Canvas:** GenOffice's canvas and operation layer, vendored and patched by us.
- **Research:** the model plans and chooses what to retrieve, while code takes the numbers from captures and checks them.

**Proposed Experiment 3** (unchanged in scope, now with concrete inputs): a vertical slice of the AI-native loop.
- React shell plus assistant-ui over AG-UI.
- Run 4's `record.json` as the evidence.
- Four France slides assembled through operations as proposals.
- A visual dry-run preview, built by applying to a clone and rendering it.
- A period-aware claim checker on slide text.

It waits for your approval.
