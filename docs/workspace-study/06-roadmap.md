# E/F. Feature classification and staged roadmap

## Feature classification

**Essential for daily editing.** This is the roughly 20% that covers most real presentation work.
- **Objects:** select and multi-select, marquee, drag/resize/**rotate**, snapping and smart guides, align and distribute, group/ungroup, **layers panel (order, lock, hide, rename)**, duplicate, **copy/paste (including across slides)**, delete, keyboard nudging, undo/redo, **zoom/pan/fit**.
- **Content:** **rich text** (bold, italic, lists, size, colour, alignment, line spacing), **shapes, lines and arrows**, **images (upload, crop, fit)**, **editable tables** (rows, columns, cell styles, number formats bound to evidence), **source-linked charts** (line, bar/column, scatter), metric cards, source notes and footnotes.
- **Deck:** add, duplicate, delete and reorder slides; grid view; cross-slide move/copy (exists); slide-level background and style; **Design DNA tokens**; PNG and **PDF export**.
- **AI and data:** per-slide chat and deck chat, selection chips, a scope selector, **proposals with preview, apply, reject and undo**, per-slide version restore, a Data panel with checkbox selection and insert, and research requests (existing contract).

**Valuable second stage**
- Connectors and process diagrams, timeline component, reusable components (saved exhibits), slide splitting and merging, comment pins sent to AI, the Evidence Shelf.
- Three-layout alternatives, learning Design DNA from a reference slide, the task center with real background jobs, editable PPTX export (native charts), dataset revisions with a verification workflow, a bulk "verify this table" job.

**Advanced or low value: can wait**
- Animations and transitions, presenter mode, real-time multi-user co-editing (Yjs), PPTX **import**, master and layout inheritance, SmartArt-style graphics, 3D, video, equation editing.
- Reconstructing a slide from a screenshot (research item), generated decorative imagery, version branching, theme marketplaces.

## Staged roadmap

| Stage | Goal | Deliverables | Exit criteria |
|---|---|---|---|
| **0. Foundations** (2–3 wk) | New shell without losing anything | Vite/React/TS app; shared TS model; Immer-patch store; SlideView components; thumbnail cache; the existing Python API reused | Parity with the current editor on the China Re decks; **all 153 Python tests still pass**; benchmark commit < 4 ms at 30 slides |
| **1. Core editing + Context panel** (4–6 wk) | Daily-usable editor | Rotation, lock, layers panel, copy/paste, zoom/pan, rich text (TipTap), shapes and lines, images and crop, editable tables; Context panel (Chat / Data / Design / Layers) with resize and collapse; full-screen and grid modes; Design DNA tokens | An analyst rebuilds the China Re overview slide from scratch in under 15 minutes using only the editor |
| **2. Data-grounded exhibits** (3–4 wk) | Data → chart with provenance | Datasets and observations model; Data panel (checkbox selection, compatibility checks); ChartSpec → ECharts; chart editor with a source-data table; revisions layered over verified values; PDF export | The France debt/GDP 3-country chart is inserted from verified datasets in 4 clicks; the parity test passes; visual edits never change plotted values |
| **3. AI proposals** (4–6 wk) | Scoped, reviewable AI | Per-slide and deck threads; context packs; proposals as patches with overlay diff; stale detection; versions; first real model integration **behind a configurable provider and explicit approval of paid calls** | A small request ("enlarge the chart, narrow the table") produces a proposal touching only those two elements; reject leaves the slide identical |
| **4. Research and tasks** (4–6 wk) | Parallel slide work | Task center; Research Engine integration through the existing contract; verification jobs; Evidence Shelf | Four tasks on four slides run without cross-slide modifications; duplicate research for the same dataset is merged |
| **5. Design partner** (ongoing) | Professional layouts | Layout archetype engine; three alternatives with invariant badges; learning DNA from a reference; editable PPTX export | Alternatives keep identical evidence and claim sets (automated check); design review sign-off on 10 real slides |

## Smallest credible end-to-end prototype

This is what should be built first to prove the architecture. It's the scope for the optional prototype (G).

- **Workspace frame:** slide rail, a large canvas, a resizable and collapsible Context panel with Chat / Data / Design modes, and a full-screen toggle.
- **Canvas** with direct manipulation (drag/resize through the existing interaction approach) on 3 slides: China Re overview plus a France sovereign page (**sample data, labelled**).
- **Data mode:** check the France, Germany and Italy debt/GDP datasets; a compatibility check; **Create line chart**, rendered deterministically from the dataset, then Insert.
- **Chart selected:** a source-data table with observation, unit, frequency and source; changing a colour or size re-renders while the values stay fixed (with a parity check shown).
- **Slide chat (simulated, labelled):** the selection appears as a chip; "make the chart larger and the table narrower" returns a proposal with an overlay preview → Apply / Reject → Undo.
- **Design mode:** change a DNA token (accent colour or title size) and every slide updates through style roles.
- **Measured:** the benchmark suite runs against the prototype.
