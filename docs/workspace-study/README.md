# AI-native financial presentation workspace: research and design study

**Status:** research and design, 2026-11-01. No product code was changed. This branch (`research/workspace-study`) adds documents, a reproducible benchmark (`editor/static/bench/`) and static mockups (`editor/static/mockups/`). Everything quantitative in the mockups and benchmark is **SYNTHETIC**, and every AI message is **illustrative copy**: no model was called and no research was performed.

## Executive summary

1. **Recommended concept: "canvas first, conversation always within reach, evidence one click away."**
   - A professional editor frame: slide rail, a large canvas, a compact top bar.
   - **One** resizable right-hand Context panel with modes (Chat · Data · Design · Layers). Chat is the default.
   - A per-slide thread plus a whole-deck thread, and selection-aware context chips.
   - AI changes arrive as **scoped proposals**, previewed as an overlay on the canvas, then applied, rejected or regenerated.
   - A Data mode with checkbox selection turns verified datasets into deterministic charts. An Evidence Shelf and a task center come in the second stage. ([04](04-ux-concepts.md))
2. **Recommended architecture: selective migration, not a rewrite or an SDK swap.**
   - **Keep:** the Python authority layer (model, integrity, patch validation, research and transfer contracts), DOM slide rendering and Moveable/Selecto (behind an adapter).
   - **Replace:** the 929-line vanilla frontend, which re-renders the whole deck through `innerHTML` and keeps JSON-string undo. The replacement is React + TypeScript, an Immer-patch store and per-slide memoised rendering.
   - **One change format:** patches are used for user edits, undo, AI proposals and validation. ([05](05-architecture.md))
3. **Deterministic charts:** a domain **ChartSpec** holds dataset references, never values. It compiles to **ECharts (SVG)** in the editor and to **native PPTX charts** (PptxGenJS) for editable export, with optional Matplotlib for print output and parity checks.
   - Gaps are shown, never interpolated. Frequency and observation type are checked before charting.
   - AI can change only the visual fields. ([02 §4](02-technology-assessment.md), [05 §4](05-architecture.md))
4. **Performance, measured** ([07](07-benchmark.md)):
   - DOM rendering beat Konva at both 25 and 400 objects, and both held 60 fps, so there's **no performance case for a canvas rewrite**.
   - Charts are cheap: ≤ 8.5 ms even for 3 × 6,391 daily points.
   - The real bottleneck is the current whole-deck re-render on every edit: **≈20 ms per commit at 30 slides**. The new store and the thumbnail cache fix it.
5. **Licensing:**
   - PPTist is **AGPL**, so no code reuse. tldraw needs a **commercial licence for production**, and Polotno is **commercial**.
   - Presenton (Apache-2.0), open-slide (MIT), Konva, Fabric, Excalidraw, ECharts, TipTap, TanStack and PptxGenJS are permissive.
   - No SDK models evidence or provenance, which is our differentiator. ([02](02-technology-assessment.md))
6. **Roadmap:** six stages, from Foundations (parity on the new shell) through core editing, data-grounded exhibits, AI proposals, research and tasks, to the design partner. The smallest credible end-to-end prototype is defined in [06](06-roadmap.md).

## Documents

| | Document | Deliverable |
|---|---|---|
| 01 | [Competitive UX and implementation study](01-competitive-study.md) | A: Canva, PowerPoint, Figma Slides, Gamma, Pitch, plus AI-native patterns (ChatGPT canvas, Cursor) |
| 02 | [Open-source and editor technology assessment](02-technology-assessment.md) | B: editors, SDKs, frameworks, libraries, licences, chart technology |
| 03 | [Current codebase audit](03-codebase-audit.md) | What works, what's a stub, what to keep, refactor or replace |
| 04 | [UX concepts and recommendation](04-ux-concepts.md) | C: three concepts compared; innovations scored against the six questions |
| 05 | [Architecture recommendation](05-architecture.md) | D: three options, target architecture, data model, chart pipeline, performance budgets, migration risks |
| 06 | [Feature classification and roadmap](06-roadmap.md) | E/F: essential / second stage / later; staged plan; smallest prototype |
| 07 | [Performance benchmark](07-benchmark.md) | Measured results and how to re-run them |

## Mockups (static HTML, live at `/mockups/index.html?state=…` when `editor/server.py` runs)

| State | Screenshot | Shows |
|---|---|---|
| `chat` | [chat.png](mockups/chat.png) | Slide-level chat with selection chips; a proposal with invariant checks; overlay preview of the new geometry on the canvas |
| `deck` | [deck.png](mockups/deck.png) | Whole-deck thread: storyline, a deck-scoped proposal with affected slides marked in the rail, consistency review |
| `data` | [data.png](mockups/data.png) | Data mode: checkbox selection, compatibility check, deterministic preview, Insert / Place; Evidence Shelf (verified vs provisional vs needs research) |
| `chart` | [chart.png](mockups/chart.png) | Chart editing with source data: series bindings, observation table, a user revision pending verification, missing year as a gap, values locked |
| `alternatives` | [alternatives.png](mockups/alternatives.png) | Three layout strategies from the same verified content, each with invariant badges |
| `tasks` | [tasks.png](mockups/tasks.png) | Task center across four slides; "AI working" ring on the affected table; conflict notice |
| `fullscreen` | [fullscreen.png](mockups/fullscreen.png) | Focus mode: floating tools, slide pager, chat bubble with a pending proposal |
| `grid` | [grid.png](mockups/grid.png) | Deck overview with key messages |

## What this study could and couldn't verify

- **Verified:**
  - licences, activity and stars, through the GitHub API on 2026-11-01
  - source structure of Presenton (Konva editor plus a separate HTML renderer; charts as raw values), open-slide (slides as TSX, agent dock) and Excalidraw (separate static and interactive canvases)
  - our own codebase and tests (153 passing)
  - all benchmark numbers (one machine; see 07)
- **From documentation only (not hands-on):** Canva, PowerPoint, Figma Slides, Gamma and Pitch behaviour. Vendor docs sometimes conflict; this is noted inline.
- **Not done:** hands-on use of the commercial products, screenshots of them, real-mouse testing, low-end hardware runs, a working AI integration, or the Research Engine (it still doesn't exist).
