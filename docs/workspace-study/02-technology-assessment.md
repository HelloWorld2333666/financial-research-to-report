# B. Open-source and editor technology assessment

The **license, stars and last push** columns were read from the GitHub API on 2026-11-01. Where GitHub reported `NOASSERTION`, I checked the LICENSE file itself. Architecture notes marked **(source)** come from reading the repository; everything else is from documentation.

## 1. Presentation editors and editing SDKs

| Project | License (commercial use) | Stars · last push | Rendering / stack | Verified architecture notes | Fit for us |
|---|---|---|---|---|---|
| [presenton/presenton](https://github.com/presenton/presenton) | Apache-2.0 (permissive; keep NOTICE) | 11.6k · 2026-11-01 | Next.js + Redux; **Konva canvas editor plus a separate HTML renderer** | **(source)** `servers/nextjs/components/slide-editor/README.md`:<br>• "Template V2" JSON in 1280×720 units<br>• editor path `surface/TemplateV2KonvaSlide.tsx`; HTML path `lib/template-v2-json-to-html.ts`<br>• one `commitUi()` into undo plus Redux<br>• charts are raw `series.values` numbers (`model/chart-model.ts`, Chart.js element) with no provenance<br>• design variables apply option expressions to element paths (`model/design-variables.ts`) | **Reference only.** Good patterns: toolbar placement, layering, design variables, one commit path. Two render paths can drift, and chart data has no provenance. Too coupled to lift. |
| [open-slide/open-slide](https://github.com/open-slide/open-slide) | MIT | 9.6k · 2026-10-29 | Vite + React; **each slide is a TSX file** | **(source)**:<br>• `apps/demo/slides/<name>/index.tsx` exports `design: DesignSystem` (palette, fonts, typeScale) plus page components<br>• `packages/core/src/agent/` runs Claude/Codex providers that edit the code<br>• `app/components/agent/` has the agent dock, transcript and history<br>• `inspector/` has a comment layer, inline text editor, image crop and arrange panel | **Pattern source.** The agent dock, history, comment-to-agent flow and DesignSystem object are worth adapting. Slides as code is wrong for evidence-bound data and analyst editing. |
| [pipipi-pikachu/PPTist](https://github.com/pipipi-pikachu/PPTist) | **AGPL-3.0** (network use triggers source disclosure) | 9.5k · 2026-11-01 | Vue 3, DOM/SVG | Not read for implementation (license). From its README: PowerPoint-like editing, tables, charts, PPTX import/export. | **Excluded from code reuse** while this repo is private. It's the closest feature benchmark; use the hosted demo for UX comparison only. |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | MIT | 135k · 2026-10-31 | Canvas 2D; React shell | **(source)** separate `renderer/staticScene.ts` and `renderer/interactiveScene.ts`: static content and selection/handles are drawn on different canvases; `staticSvgScene.ts` for export | Whiteboard model, hand-drawn style, no slide or table semantics. **Borrow the static/interactive layer split**, not the product. |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | **tldraw license**: "Not to use the Software in Production Environments" without a commercial license; key enforcement | 51k · 2026-10-30 | React + DOM/SVG shapes; strong store and undo | (license file read) | Technically excellent infinite-canvas SDK; **a paid license is needed for production**. An infinite canvas isn't our core need. |
| Polotno SDK ([npm `polotno`](https://www.npmjs.com/package/polotno)) | **Commercial**: free only for non-commercial or local development ([license](https://polotno.com/license)); published prices vary ([pricing update](https://polotno.com/sdk/pricing-update)) | closed source (npm 4.18.0) | Konva + MobX + React | Mature Canva-like editor SDK with templates, text and images. | Fastest route to Canva-style editing, but it's a licensed black box, its data model isn't ours, and charts with provenance would be custom work anyway. |

## 2. Canvas and interaction frameworks (you still build the editor)

| Library | License | Stars · last push | Notes from source/docs | Assessment |
|---|---|---|---|---|
| [konvajs/konva](https://github.com/konvajs/konva) (+ [react-konva](https://github.com/konvajs/react-konva), MIT) | MIT (LICENSE file; GitHub shows NOASSERTION) | 14.9k · 2026-10-31 | Scene graph on Canvas 2D, Transformer, layers, hit graph | Good for many shapes. **Text and tables must be reimplemented on canvas** (no native text editing, selection, IME or accessibility); export to HTML or PPTX needs a second renderer. Our benchmark: slower than DOM at 25 and at 400 objects (07-benchmark.md). |
| [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | MIT | 31.5k · 2026-10-31 | Canvas object model with IText | Same trade-offs as Konva, with richer canvas text editing. |
| [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | MIT | 4.5k · 2026-10-30 | Fast canvas engine aimed at editors | Promising, smaller ecosystem, docs mostly Chinese. Watch, don't adopt. |
| [daybrush/moveable](https://github.com/daybrush/moveable) / [selecto](https://github.com/daybrush/selecto) | MIT | 10.8k / 2.2k · **last push June 2024** | DOM transform handles, snapping, groups; marquee selection; React wrappers in the same repo | **Already in use, and they work** (drag ≈1.6 ms per move in our editor). Risk: no commits for 2+ years. Mitigation: hide them behind an interaction adapter so they can be replaced later. |

## 3. Supporting libraries

| Need | Candidate (license) | Status | Recommendation |
|---|---|---|---|
| Rich text | [TipTap](https://github.com/ueberdosis/tiptap) (MIT core; some paid extensions), on ProseMirror · [Lexical](https://github.com/facebook/lexical) (MIT) | 38.9k / 24.0k, both active | **TipTap** for text boxes: marks, lists, numbered footnote references and a schema that can carry `evidence` marks. Use only MIT extensions. |
| Data grid (Data panel, source-data editor) | [TanStack Table](https://github.com/TanStack/table) (MIT, headless) · [AG Grid](https://github.com/ag-grid/ag-grid) (MIT community + commercial enterprise packages) | both active | **TanStack Table** (headless, so our own styling and checkbox selection; with virtualisation it handles long series). |
| Charts (deterministic) | [Apache ECharts](https://github.com/apache/echarts) (Apache-2.0) · [Plotly.js](https://github.com/plotly/plotly.js) (MIT) · [Vega-Lite](https://github.com/vega/vega-lite) (BSD-3) · [Observable Plot](https://github.com/observablehq/plot) (ISC) · Matplotlib (PSF-style) · hand-written SVG | all active | See §4. |
| Editable PPTX export | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (MIT; last push 2025-11) · [python-pptx](https://github.com/scanny/python-pptx) (MIT; last push 2024-08) | maintained / slow | **PptxGenJS** creates native PowerPoint charts from data (so charts stay editable in PowerPoint) plus text and tables. |
| PNG / PDF export | html-to-image (MIT, in use) · headless Chromium (Playwright) | — | Browser: html-to-image for quick PNGs (measured ≈75–105 ms for a 2560×1440 PNG). Server: Chromium `page.pdf()` / `screenshot()` from the same DOM for print-grade PDF and batch export. |
| State, undo, patches | [Immer](https://github.com/immerjs/immer) (MIT; `produceWithPatches`) · [Zustand](https://github.com/pmndrs/zustand) (MIT) · [Yjs](https://github.com/yjs/yjs) (MIT, CRDT) | active | **Immer patches** as the single change format for user edits *and* AI proposals: compact undo, reviewable diffs, scoped validation. Yjs later, if real-time co-editing becomes a goal. |
| UI primitives | Radix UI (MIT) or similar headless components | active | Accessible menus, dialogs, resizable panels. |

## 4. Deterministic chart technology

**Requirements.** Geometry must be a pure function of (dataset, chart spec, box); the chart must re-render when visual settings change; missing data must show as gaps, never interpolated; and frequency and observation type must be respected. It must also export to PNG, PDF and editable PPTX, and look institutional.

| Option | Accuracy and determinism | Editability in our app | Visual quality | Performance (measured, 07) | Export |
|---|---|---|---|---|---|
| **ECharts (SVG renderer)** | Deterministic with `animation:false`, a fixed size and a pinned version; `connectNulls:false` shows gaps; time axis | Option object generated from our ChartSpec; resize without changing data | High, fully themeable | 3×6,391 daily points: mount ≈7–8 ms, resize ≈1 ms; annual: ≈2 ms | SVG in the DOM, so html-to-image and Chromium export it; server rendering possible later |
| ECharts (canvas) | same | same | same (raster) | mount ≈6 ms, resize ≈1.4 ms | raster only |
| Hand-written SVG (`editor/static/bench/svgchart.js`) | Fully transparent; we own every pixel | Full control | As good as we build it | annual 0.4–0.8 ms; daily 3–4 ms | trivial |
| Plotly.js | Deterministic | Good | Analytical look; heavier (~3+ MB bundle) | not measured | static image export needs Kaleido |
| Vega-Lite | Deterministic, declarative (good for AI to *propose* specs) | Spec-level edits | Good with config | not measured | SVG/PNG |
| Matplotlib (server) | Deterministic and print-grade | Not interactive; re-render on every change | Excellent for print | not measured | PNG/PDF/SVG |

**Choice.** Our own **ChartSpec**, a small domain schema, becomes the source of truth. It holds dataset and series references (never values), the chart type, axis and unit rules, annotations and style tokens. It **compiles to ECharts (SVG renderer)** in the editor. The same spec compiles to a **native PPTX chart** (PptxGenJS) for editable export, and optionally to Matplotlib for print-grade static output and as a cross-check.

ECharts gives us time axes, label layout, legends and themes that would take months to build by hand. The hand-written SVG renderer stays as a tiny fallback and a parity test (both must plot the same number of points). LTTB downsampling (ECharts `sampling:'lttb'`) is allowed **only as a display optimisation** above a point threshold. It is flagged in the chart's notes, and the dataset is never altered.

## 5. Recommendation for components

**Reuse:** our Python model and validators (`slidemodel`, `research`, `transfer`), the integrity rules, Moveable/Selecto (behind an adapter) and html-to-image.
**Adopt:** React with TypeScript (component model for panels and chat), Immer patches with Zustand stores, TipTap, TanStack Table, ECharts through ChartSpec, PptxGenJS, and Radix primitives.
**Avoid:** PPTist code (AGPL); tldraw or Polotno unless the company accepts commercial SDK licensing *and* their data model is a better fit (it isn't today); switching to canvas rendering (no measured benefit at our scale; large text, table and export costs).
