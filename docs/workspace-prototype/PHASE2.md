# Phase 2: open-source reuse and integration feasibility

> **Superseded in part by [PHASE2B-ARCHITECTURE.md](PHASE2B-ARCHITECTURE.md).** The licence and code findings below still hold. The architecture recommendation and the PptxGenJS Phase 3 proposal have been withdrawn.

**Branch:** `research/phase2-reuse` (from `feature/workspace-editable` 8b4155e). This is documentation only. Nothing was pushed, merged or installed.
**Method:** I read each repository through the GitHub API and npm registry metadata. Nothing was cloned and run. No third-party script was executed. Presenton's export package was unpacked into a scratch folder only so I could read its manifest; it was never run.
**Date:** 2026-11-01. Star counts and push dates are as of that day.

## 1. Summary

- **Recommendation: A.** Keep our editor and reuse selected permissive components. No candidate can replace our core: evidence and working data, ChartSpec bound to datasets, and the integrity and export policy. Every candidate editor stores chart and table values as plain numbers with no source.
- **Presenton (Apache-2.0)** really does have manual chart-data and table-cell editing. There's nothing worth taking as code:
  - Its editor is tied to Next.js, Konva and its Template V2 model.
  - Its PPTX export is a closed, prebuilt, unlicensed package.
  - Its useful ideas (series reordering, a draft preview in the data modal) are UX patterns we can copy by design.
- **PPTist (AGPL-3.0)** is the most complete slide editor of the four. Its code is excluded:
  - Mixing AGPL code into a network-served app would put the whole workspace under AGPL.
  - Nothing it has justifies that, or the commercial licence.
  - Its two MIT dependencies, PptxGenJS and pptxtojson, are fine to use.
- **OpenManus (MIT)** is a general tool-calling agent. It doesn't fit our research needs:
  - no citation or provenance model
  - its "safe" Python tool is `exec` with full builtins in a subprocess
  - search scrapes Google, Baidu, DuckDuckGo and Bing
  - browsing installs and runs `browser-use` through `uvx` at run time
- **OWL** is a thin layer of examples and a Gradio app over **CAMEL (Apache-2.0)**. It has no meaningful advantage over OpenManus for our workflow. CAMEL itself is the better agent library if we ever need one, because it has Pydantic `response_format` and native Ollama support. Neither is needed until a real Research Engine is built. Only one framework should ever be installed.
- **Highest-value Phase 3 integration: editable PPTX export with PptxGenJS (MIT).** It builds native PowerPoint charts (with embedded, editable data), tables and text boxes from our ChartSpec and working data, and carries provenance in speaker notes. Today we export PNG only, and finished financial slides are delivered as PowerPoint.

## 2. Candidates, evidence by criterion

### 2.1 Presenton (`presenton/presenton`, Apache-2.0)

| Criterion | Finding (evidence) |
|---|---|
| 1. Capability | **AI deck generation** from prompt or documents, templates (Template V2), a web editor, and PPTX/PDF export. **Manual chart-data editing is real.** `servers/nextjs/components/slide-editor/charts/ChartEditorContent.tsx` has `updateCategory`, `updateSeriesName`, `updateValue`, `updateValueDraft`, `addRow`, `deleteRow`, `addSeries`, `deleteSeries` and `moveSeries`, with a draft preview. **Table-cell editing is real.** `tables/TableInlineEditor.tsx` has `updateCell`; `tables/TableToolbar.tsx` adds and deletes rows and columns. **Values have no source, unit, date or status field**, and missing values aren't modelled as gaps |
| 2. Files and modules | `servers/nextjs` (React editor on Konva: `react-konva` Stage, Layer and Group), `servers/fastapi` (generation API, SQL models, alembic migrations, `services/export_task_service.py`), `electron/` (desktop app). Export is driven by `scripts/run-presentation-export.mjs` and `servers/nextjs/lib/run-bundled-presentation-export.ts` |
| 3. Compatibility | Low. Its slide model is Template V2 JSON rendered by Konva; ours is DOM, Preact and ChartSpec. Its components expect its own Redux store and layout schema |
| 4. Complexity | High: Next.js, FastAPI, a database and Electron |
| 5. Dependencies and build | Node build plus Python services. Export needs `puppeteer` 25 and a downloaded Chromium |
| 6. Performance | Konva canvas is fast to edit. Export renders HTML in headless Chromium, then writes PPTX |
| 7. Licensing | The repo is Apache-2.0. **The export engine is `@presenton/export-core` 1.0.51, a prebuilt tarball with no licence field and no public source** (manifest read: it depends on `@office-open/pptx`, `@office-open/xml` and `puppeteer`). We can't safely reuse or ship it |
| 8. Maintainability | Very active, but a fast-moving schema (eight Template V2 migrations) makes any extracted module go stale |
| 9. Effort reduction | Little. Extracting the chart-data modal means rewriting its store bindings and adding provenance, which is most of the work we've already done |
| 10. Reuse method | **Learn from the design:** a series-reorder control and a draft preview inside the data modal |

### 2.2 PPTist (`pipipi-pikachu/PPTist`, AGPL-3.0)

| Criterion | Finding (evidence) |
|---|---|
| 1. Capability | The most complete web slide editor reviewed. It covers ProseMirror rich text, tables, charts, shapes, lines, images, layers, grouping, alignment, shortcuts, history snapshots, PPTX export and PPTX import. Its module structure is visible from the tree: `src/hooks/useHistorySnapshot.ts`, `useCombineElement.ts`, `useOrderElement.ts`, `useExport.ts`, `useImport.ts`, `useSlideHandler.ts`, `src/store/{slides,snapshot,keyboard}.ts`, `src/utils/prosemirror/{schema,commands,plugins}` |
| 2–6 | Vue 3 and Pinia: incompatible with our Preact stack. Export uses **PptxGenJS** and import uses **pptxtojson** |
| 7. Licensing | **AGPL-3.0.** Serving modified code over a network requires releasing the whole combined work under AGPL. The README offers three routes: a commercial licence (2,999 RMB a year or 5,999 RMB perpetual), sponsorship, or an unmaintained Apache-2.0 snapshot from May 2022 (commit `f1a35bb8`) |
| 8. Maintainability | Active and single-maintainer |
| 9. Effort reduction | Would be high if adopted wholesale, but that means replacing our editor, which you've ruled out |
| 10. Reuse method | **No code.** It's useful as a behaviour checklist of editor features from its README and demo. **Reuse its MIT dependencies directly:** PptxGenJS (export) and pptxtojson (import; MIT, same author, 2.2.0 published 2026-09-19) |

**Licensing decision.** We won't take a commercial licence or integrate AGPL code. The capabilities we lack (export, import, rich text) come from MIT libraries PPTist itself uses. Its slide-management features don't justify the licence and would duplicate our editor. I didn't read PPTist source to write any of our code, and Phase 3 won't need to.

### 2.3 OpenManus (`FoundationAgents/OpenManus`, MIT; 58.9k stars; pushed 2026-10-31; 444 open issues)

| Area | Finding (file evidence) |
|---|---|
| Orchestration | `app/agent/base.py` → `react.py` → `toolcall.py` → `manus.py`: a ReAct loop, `max_steps = 20`. `app/flow/planning.py` (`PlanningFlow`) builds a plan with an LLM and dispatches steps to executor agents, tracked by `PlanStepStatus` |
| Browser automation | `manus.py` connects an MCP server started as `uvx browser-use --cli-mcp`, which downloads and runs a package at run time. It forwards an optional `BROWSER_USE_API_KEY` (a cloud service) |
| Web research | `app/tool/web_search.py`: Google, Baidu, DuckDuckGo and Bing via scraping libraries (`googlesearch-python`, `baidusearch`, `duckduckgo_search`), with fallback between them. `WebContentFetcher.fetch_content` returns page text. **No citation, page, retrieval-date or quote model** |
| Tool execution | `app/tool/{bash,str_replace_editor,file_operators,ask_human,terminate,mcp}.py`. A Docker sandbox lives in `app/sandbox/`; Daytona is optional |
| Python analysis | `app/tool/python_execute.py` runs `exec(code, safe_globals)` in a `multiprocessing.Process` with a 5 s timeout. `safe_globals` is a **full copy of builtins**, so it isn't a sandbox. `app/tool/chart_visualization/` is a separate Node/TypeScript package |
| Structured output | Tool calls only (`llm.ask_tool`, `tool_choice` auto/required/none). No JSON-schema or Pydantic response format |
| Model configuration | TOML `[llm]` with `model`, `base_url`, `api_key` and `api_type` (azure, aws/bedrock, ollama). `config/config.example-model-ollama.toml` points at `http://localhost:11434/v1`, so local models work with no paid API |
| Dependencies | `requirements.txt` has 40+ pins, including `playwright`, `browsergym`, `gymnasium`, `docker`, `boto3`, `crawl4ai`, `datasets`, `huggingface-hub` and `fastapi` |
| Reuse method | **Learn from the design** (plan and step status, tool registry). Don't integrate it as our research engine: it can't produce evidence that would pass `apply_response()` without a provenance layer we'd have to write anyway |

### 2.4 OWL (`camel-ai/owl`) and CAMEL (`camel-ai/camel`)

| Area | Finding |
|---|---|
| Licence | **OWL is Apache-2.0.** The text is in `licenses/LICENSE` and the `pyproject.toml` `license` field; GitHub doesn't detect it because there's no root LICENSE file. This corrects my earlier note. CAMEL is Apache-2.0 |
| What OWL is | `owl/utils/{enhanced_role_playing.py, document_toolkit.py, gaia.py}`, Gradio apps (`owl/webapp*.py`) and per-provider examples (`examples/run*.py`). The agents and tools come from CAMEL. `examples/run.py` builds a CAMEL `Workforce` with six model roles and these toolkits: Search, Browser, CodeExecution, Excel, ImageAnalysis, File and DocumentProcessing. The last change to `owl/` was 2026-02-26; recent commits only update a QR code |
| Dependencies | `camel-ai[owl]==0.2.84` plus about 50 extras: `transformers`, `ffmpeg-python`, `yt-dlp`, `unstructured`, `e2b-code-interpreter`, `pyautogui`, `playwright`, `crawl4ai`, `firecrawl`, `gradio` and more |
| CAMEL strengths | `ChatAgent.step(..., response_format=<Pydantic model>)` (`camel/agents/chat_agent.py`), `ModelPlatformType.OLLAMA` and `VLLM`, `societies/workforce/` with a `structured_output_handler.py` |
| vs OpenManus | OWL adds multi-agent role-play and GAIA benchmark tooling. Neither helps a single, contract-bound research worker. **For our workflow it has no meaningful advantage.** If we ever need a library, a single CAMEL `ChatAgent` with `response_format` set to our response schema beats both, installed alone (not `[owl]`) and run against local Ollama |

## 3. Our system as the baseline

| Area | What we have (files) | Gap |
|---|---|---|
| Data authority | `editor/slidemodel.py`: immutable evidence and observations, a working layer (`working`), and integrity reports | — |
| Charts | ChartSpec (dataset references, never values) → ECharts SVG (`static/workspace/charts.js`). No interpolation; gaps stay gaps | — |
| Editing | Preact, Immer patches, Moveable (`app.js`, `edit.js`, `sheets.js`, `inspector.js`). 26 automated checks and browser tests A–F pass | Rotation and physical-mouse checks; inline rich-text marks not browser-tested (see the Phase 1 defects list) |
| AI assistant | Rule-based proposals with preview, apply and stale refusal (`static/workspace/simai.js`) | No model; on purpose (no paid APIs) |
| Research | `editor/research.py`: `frr-research-request/0.1` → placeholder → `frr-research-response/0.1`, validated by `apply_response()`, never overwriting evidence | No engine produces responses yet |
| Export | DOM → PNG (`html-to-image`, `app.js:399`) with the draft/final policy | **No PPTX, no PDF** |
| Import | none | No PPTX import |

## 4. Reuse matrix

| Our required feature | Existing implementation | Best external candidate | Reuse method | Integration difficulty | Licensing risk | Recommendation |
|---|---|---|---|---|---|---|
| Object editing (select, move, resize, group, layers) | Moveable + Immer (`app.js`, `edit.js`) | PPTist | Learn from feature list only | — | High (AGPL) | Keep ours; add align/distribute and z-order from our own spec |
| Rich text | contentEditable + inline marks | ProseMirror (MIT, used by PPTist) | Library, our own schema | Medium | Low | Defer; adopt only if inline-format defects persist |
| Table cell editing | Grid with working layer and provenance | Presenton `TableInlineEditor` | Learn | — | Low | Keep ours |
| Chart data editing | `sheets.js` with working layer, gaps, manual series | Presenton `ChartEditorContent` | Learn (series reorder, in-modal preview) | Low | Low | Keep ours; copy two UX ideas |
| Chart rendering | ChartSpec → ECharts SVG | — | — | — | — | Keep |
| Undo/history | Immer patches | PPTist snapshots | Learn | — | High | Keep |
| **Editable PPTX export** | **None (PNG only)** | **PptxGenJS 4.0.1 (MIT)** | **Library (vendored bundle)** | **Medium** | **Low** | **Adopt in Phase 3** |
| PPTX import | None | pptxtojson 2.2.0 (MIT) | Library + mapping to manual values | Medium–high | Low | Later (Phase 4+) |
| PDF export | None | Presenton's Chromium approach | Learn: print our own DOM in headless Chrome | Low–medium | Low | Later |
| Templates/layouts | Design DNA | Presenton Template V2 | Learn | — | Low | Keep Design DNA |
| AI slide generation | Simulated assistant with proposals | Presenton generation | Learn | — | Low | Keep the proposal model; any real model must emit proposals, not slides |
| Research orchestration | Research Request contract | CAMEL `ChatAgent` (over OpenManus/OWL) | API behind our contract | Medium–high | Low | Later; one framework only, local Ollama |
| Web research with citations | Hand-verified bundles (`src/frr`) | None adequate (OpenManus search has no provenance) | Learn | — | Low; scraped search raises terms-of-service risk | Keep our evidence pipeline |
| Browser automation | None | browser-use (via OpenManus) | — | High | Low; runtime `uvx` download | Don't adopt now |
| Python analysis | None | CAMEL CodeExecution / Docker; OpenManus `PythonExecute` isn't isolated | Learn | Medium | Low | If needed, a Docker-isolated runner of our own |
| Structured output | JSON schemas validated in `apply_response` | CAMEL `response_format` | API | Low | Low | Keep our schemas as the contract |
| Model configuration | Configurable providers | OpenManus TOML layout (Ollama example) | Learn | Low | Low | Copy the config shape when a model is added |

## 5. Hybrid architecture (recommendation A)

```
 Preact workspace (ours) ── Immer patches ──▶ Project JSON
   canvas · sheets · inspector · assistant      evidence (immutable) · datasets/observations
                                                working layer · ChartSpec · Design DNA
                                                integrity + export policy (Python: slidemodel.py)
 Exports
   DOM → PNG                         html-to-image (have)
   ChartSpec + working → PPTX        PptxGenJS, in the browser, vendored ES bundle  ◀ Phase 3
   DOM → PDF                         headless Chrome print (later)
 Import (later)
   PPTX → pptxtojson → mapper        imported numbers become manual values (no evidence_id)
 Research (later)
   Research Request ─▶ engine adapter (one CAMEL ChatAgent, response_format = our schema,
                       local Ollama) ─▶ Research Response ─▶ apply_response() validation
```

The rule that holds this together: external code produces either a file (export) or a candidate payload (import or research). Nothing external writes to evidence or the working layer directly. Python validation stays the authority.

## 6. Phase 3 proposal: editable PPTX export (awaiting approval)

**Why it's the highest-value integration:**
- It closes the largest product gap: the deliverable format.
- It needs no model and no paid API.
- The licence is clean (MIT).
- It reuses the exact data the editor renders, so provenance carries into the file.

None of the other candidates offers a usable alternative: Presenton's exporter is closed and PPTist's code is AGPL.

**PptxGenJS evidence:**
- version 4.0.1 (published 2025-06-26), MIT
- dependencies `jszip`, `image-size`, `https`; 6.3k stars; last push 2025-11-28
- **native charts with an embedded workbook:** `src/gen-charts.ts:520` writes `ppt/embeddings/Microsoft_Excel_Worksheet*.xlsx`, so PowerPoint's own "Edit Data" works
- per-point colours, data labels, axis titles, markers, line width and `displayBlanksAs` (`gen-charts.ts:733`)
- native tables

**Risk found in the source.** Missing values are written as empty points (`<c:pt idx="n"><c:v></c:v></c:pt>`, `gen-charts.ts:982, 1266`), not omitted. PowerPoint may read an empty value as zero. That would fabricate a point, which our rules forbid. The spike's first test checks this. If it fails, a small post-processing step (JSZip, already bundled) removes empty points before saving.

**Proposed scope:**
1. Vendor the PptxGenJS bundle like our other libraries, with no build step. Record its licence in `static/vendor/licenses`.
2. Write a mapper from our project to PptxGenJS (a new `static/workspace/pptx.js`):
   - **slides:** 1280×720 → 13.33×7.5 in
   - **text and metric cards:** text boxes with Design DNA font, size, colour and weight
   - **tables:** native tables, using working values
   - **line and bar charts:** native charts from the same compiled series the editor plots, with DNA colours and gaps preserved
   - **images and shapes**
3. Add provenance: per-slide speaker notes list each evidence-bound value's source and page, and flag `manual_unverified` edits. The existing draft/final export dialog and its acknowledgement rule apply unchanged.
4. Add a server endpoint to save the `.pptx` next to PNG exports.
5. Add tests: a pytest that unzips the generated file and asserts:
   - chart cache values equal the working values
   - gaps aren't zero
   - table cells match
   - notes list the sources

   Plus a browser check of the export button. If LibreOffice is available locally, also render a visual comparison.

**Known limitations to accept:**
- ECharts end-of-line labels have no native equivalent; I'll use a legend or a label on the last point.
- Font substitution depends on the viewer's machine.

**Estimated effort:** 3–5 days.
