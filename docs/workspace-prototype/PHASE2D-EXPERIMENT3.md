# Phase 2d: Experiment 3, vertical slice of the AI-native loop

**Branch:** `research/phase2b-experiments`. This is throwaway experiment code in `experiments/exp3-loop`. Nothing was pushed or merged.
**Date:** 2026-11-01. Run on an Apple M5 with 32 GB RAM, in the built-in Chromium at 1440×900. The model is **Qwen 2.5 14B on local Ollama**. No paid APIs were called.
**Method:** every acceptance step was driven by the browser tool's **real** mouse and keyboard. Checks read state by JavaScript only, and one regression suite was scripted (see the table).

## What was built

```
 assistant-ui threads (Project · Slide 1..n)  ──AG-UI (HttpAgent)──▶  PydanticAI agent (Qwen 2.5 14B, local)
   │  canvas selection rides as AG-UI state                              tools return PROPOSALS, never numbers:
   │  tool results render as proposal cards                              compose_deck · add_comparison · start_background_research
   ▼                                                                       │ add_comparison: live Eurostat fetch + re-fetch validation
 Proposal card: Preview (apply → render → restore) · Apply · Reject        │ background task: polled via /api/tasks
   │ Apply = one validated pptx-ops step (undoable)                        ▼
 GenOffice SlideCanvas (Exp 1 engine + gap patch)  ◀── project = Evidence Core (Exp 2 record: 10 datasets, 64 evidence, 52 obs)
   └ bindings sidecar (durable id → chart spec / table spec / text role / placeholder + research request)
 Claim checker: every number in slide text vs the working value for entity · metric · year (+ direction words)
```

Layers and dependencies:
- **Frontend:** React 19, `@assistant-ui/react` 0.15.32, `@assistant-ui/react-ag-ui` 0.1.1 and `@ag-ui/client` 1.0.3 (all MIT), plus the Experiment 1 GenOffice packages.
- **Bundle:** 4.3 MB minified, 1.25 MB gzip.
- **Backend:** Starlette, `pydantic-ai-slim[ag-ui]` 2.64 (`AGUIAdapter.dispatch_request`, `StateDeps`), uvicorn.
- **Installs:** all `npm install` runs used `--ignore-scripts`. Every licence is MIT, ISC, BSD, Apache, 0BSD or CC-BY.

## Acceptance results

| # | Criterion (PHASE2B §G) | Result | Evidence |
|---|---|---|---|
| 1 | Four-slide France deck assembled **through operations only**, each step a proposal | **Pass** | The brief was typed in the project thread. The local model called `compose_deck` over AG-UI, and 4 proposal cards appeared (about 20 s). **Preview** rendered the proposed slide while the live deck stayed empty (0 elements, 0 undo). Each **Apply** was one validated step: 4 slides, 4 undo steps, 30 bindings, integrity OK. Slide titles and bullets are generated from verified data (for example, debt rose from 111.4% to 115.7% of GDP, 2022–2025, and the spread was 76 bp derived from two yields) |
| 2 | Selection-aware request gives a previewable, rejectable batch | **Pass** | With the debt chart selected (chip "chart · Gross debt, % of GDP") in the Slide 1 thread, I typed "Compare this chart with Italy". The model called `add_comparison("IT")` using the selection carried in AG-UI state. Italy wasn't in the project, so the backend **fetched it live from Eurostat** and verified 4 values by independent re-fetch (`ev.live.it.debt.*`). The preview showed a third line; Apply added it as one step (36 chart points match) |
| 3 | After AI changes, manual edits to text, a table cell and a chart value keep provenance | **Pass** | **Text:** a real click opened the title and real typing changed it. **Table cell:** a real double-click on France's 2025 interest; typing 2.3 wrote `working[2025]` (`manual_unverified`), the verified source 2.2 is kept (`ev.exp2.32`), and the table updated. **Chart value:** Data tab, Germany 2023 debt = 62.0; the chart updated and the source 61.8 is kept. Integrity OK throughout; 2 unverified edits are counted |
| 3+ | Year-aware claim checker on slide text | **Pass** | The typed title "fell from 111.4% in 2022 to 112.0% in 2025" was flagged for the value (data 115.7) **and** the direction (data rose). After the table edit, the AI-written fiscal title ("interest costs reached 2.2% in 2025") was flagged **stale** (data 2.3) |
| 4 | Background "rating history" task runs while editing continues and arrives as a proposal | **Pass** | Requested in the Slide 4 thread; the model called `start_background_research`. While it ran, a real drag moved a text box (committed). Result in Tasks: France's debt agency 403, S&P 403, Fitch 86 chars, Moody's 0, so no usable primary text. Its proposal, applied with a real click, placed a **research request** (`frr-research-request/0.1`) on the ratings slide. Real Cmd+Z removed it and Cmd+Shift+Z restored it |
| 5 | Regression specification | **Pass (scripted)** | `/?checks=1` runs **16/16 passing** checks on a fresh deck with no model. The 26 Phase 1 checks are mapped below |

### Phase 1's 26 checks against the new architecture

| Phase 1 group | Status in Experiment 3 |
|---|---|
| Text edit start, commit, style (3) | Start and commit covered by real input; style ops exist (`setText` keeps style) but no new check was written |
| Table working edit, header, add row, one undo per edit (4) | Working edit and one undo per edit covered (`table_working_edit_keeps_source`, step model). Header rename and add row are not wired in the Experiment 3 UI |
| Bar chart rendered, draft update, remove category, source intact (4) | Rendering and source-intact covered (`integrity_*`, `deleted_value_is_gap_not_zero`). No category removal in the Experiment 3 UI |
| Table–chart consistency (1) | Covered by integrity: every chart point and table cell is compared with the working layer after every step |
| Line chart single point, gap kept, add/remove series (3) | Covered (`deleted_value_is_gap_not_zero`, `add_series_one_step_and_undo`, real Italy add) |
| AI preview, apply, manual-after-AI, stale proposal (4) | Covered (`preview_renders_without_touching_live`, `compose_*`, `text_edit_after_ai`). Stale-proposal refusal is **not** reimplemented; invalid operations are refused atomically (`invalid_ops_refused_atomically`) |
| Copy/paste, group, ungroup, undo, redo, move to slide (6) | Undo/redo covered. The rest was tested at engine level in Experiment 1, not in this UI |
| Design DNA restyle (1) | Not in scope for Experiment 3 |

## Findings

**What worked better than expected:**
- **AG-UI plus assistant-ui plus PydanticAI fit together with little glue.** Tool results render as our own React proposal cards through `MessagePrimitive.Parts components.tools.by_name`. The canvas selection reaches tools through `useAgUiSetState` → `StateDeps`. Each thread is its own AG-UI thread id, and all of them stay mounted so history survives switching.
- **Tool calling on local Qwen was reliable in this design.** Every request picked the right tool with correct arguments (`compose_deck`, `add_comparison("IT")`, `start_background_research`). Experiment 2's structured-output problems didn't appear, because tools take simple arguments and return our own proposals. Latency was 18–25 s per request.
- **Preview by apply, render, restore** is cheap and exact. The preview is the real engine output, not an approximation.
- **The claim checker caught real defects:** an imprecise generated claim (no year; composer fixed), a wrong typed title, and AI text left stale by a later data edit.

**Problems found (all recorded, none hidden):**
1. **The model's replies overstate.** After proposing Italy, the reply said it "has been added" before Apply. Unprompted, it also started a background task on its own topic ("sovereign credit risk"); our backend only implements rating research, so the topic and the work didn't match. **The UI's proposal state must stay the source of truth, and assistant text should be generated from tool results or constrained.**
2. **Claim checker false positives at first** (my bugs, fixed): "spread over Germany" took Germany as the subject, and bullets lacked the slide's metric context. It is still a heuristic. A production version should bind claims to evidence ids when generated, and use the heuristic only for free text people type.
3. **Selection by parse-time id goes stale** after a re-parse (the chip showed "element" once). Selection must be keyed by durable id (as in Experiment 1).
4. **Layout polish:**
   - long titles wrap into the subtitle (fixed-height text boxes)
   - thin chart lines are hard to click
   - the canvas bleed needed stacking fixes

   This is design-system work for Phase 3.
5. **Screenshots were sometimes stale** in the browser tool. Every claim above was confirmed from state, not only from screenshots.
6. **Bundle size:** 1.25 MB gzip with assistant-ui. Acceptable for a desktop-class web app, but worth trimming.

## Verdict

**The AI-native loop works end to end in a browser, on a local model, with provenance intact:**
1. brief
2. proposals with real previews
3. approved operations on a professional canvas
4. selection-aware edits with live verified retrieval
5. background research that ends in a research request rather than invented data
6. manual edits that flow into the working layer
7. a claim checker that keeps slide text honest

Together with Experiments 1 and 2, this confirms **Strategy D**, and gives Phase 3 a concrete starting point.

**Recommended Phase 3 (for your approval):** turn the slice into the product skeleton.
- Durable-id selection and a proper store.
- A text editor overlay.
- A design system (fonts, table and chart styles, title fitting).
- Claim binding at generation time.
- Persistent projects (save/reopen with the sidecar).
- A real task centre.
- Upstreaming or maintaining the four GenOffice engine patches.
