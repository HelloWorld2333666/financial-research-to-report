# Current codebase audit (branch `feature/slide-editor-spike` @ 19e22d0)

I read every file under `editor/` plus the Python package boundary. All 153 tests pass (`pytest`, 2026-11-01).

## What exists and genuinely works

| Capability | Where | Status |
|---|---|---|
| Research snapshot, hash-guarded (evidence, sources, claims, gaps) | `slidemodel.snapshot_hash`, `check_integrity` | **Working, tested** |
| Multi-slide projects (`frr-slide/0.2`; flat elements with `slide_id`; migration from 0.1) | `slidemodel.migrate`, `add_slide`, `duplicate_slide`, `delete_slide` | **Working, tested** |
| Evidence-bound figures (metric, table cell, bar): render from `evidence_id`, can't be typed over | `slidemodel.bound_evidence_ids`, `editor.js renderEl` | **Working, tested** |
| Integrity report covering:<br>• dangling refs and unverified values<br>• unsourced numbers in free text<br>• edited cited text and detached values<br>• fixture data on a slide<br>• tampered research results<br>• pending items | `slidemodel.check_integrity`, `research.results_integrity` | **Working, tested.** This is our most distinctive asset |
| Scoped AI patch validation (scope, region, no rebinding, verified evidence only, no unsourced numbers; all-or-nothing) | `slidemodel.validate_patch` | **Working, tested.** The patch is supplied by hand; no agent runs |
| Research Request contract plus pending placeholders, response validation, not-available handling, revert | `research.py`, `RESEARCH_CONTRACT.md` | **Contract and validation work.** Responses come only from files or **TEST FIXTURES**. **There is no Research Engine.** |
| Cross-slide semantic transfer (6 modes; Transfer Requests carry provenance; placeholders) | `transfer.py`, `TRANSFER_CONTRACT.md` | **Working, tested.** Adaptation is **not implemented**; requests are stored and exported only |
| DOM canvas: select, marquee, drag, resize, snap, group, align, distribute, z-order, nudge, inline plain-text editing, undo/redo, revert | `static/editor.js` with Moveable/Selecto | **Working** (dispatched-event tests; real-mouse use not tested) |
| PNG export from the same DOM | html-to-image | **Working** (≈75–105 ms per slide at 2×) |
| Intent classifier (layout / existing data / research) | `research.classify` | **Deterministic keyword rules.** Not AI; misclassifies easily |
| Agent integration | `server.py` builds a `claude -p --tools ''` command | **Shown, never run** |

## What is missing for the workspace vision

- **Data:** time-series datasets (observations with date, frequency, observation type and source per point), user revisions layered over verified values, dataset-level verification requests, and a Data panel with checkbox selection.
- **Charts:** only horizontal bar charts and simple timelines. No line, scatter or column charts, axes, chart spec or chart editor.
- **AI:** no conversation model (per-slide or deck), no proposals or change sets, no before/after overlay, no versions beyond the `.history/` files written on save, no task model.
- **Editing:**
  - rich text, rotation, lock, layers panel, copy/paste across slides
  - shapes, lines, arrows and connectors, images and cropping
  - editable tables (add rows or columns), rulers, zoom and pan controls, grid view
- **Style:** no design tokens; styles are inline per element (`style.fill`, `fontSize` …). A deck-wide restyle would mean editing every element.
- **Export:** no PDF or PPTX.
- **Persistence:** save writes the whole project; no per-slide autosave; no conflict handling.

## Structures that will become hard to maintain

1. **`static/editor.js` is one 929-line IIFE holding all state in a single mutable object `S`.** Rendering, interaction, side panels, the transfer dialog and API calls live in one closure. Each new panel (chat, tasks, data) adds to the same file and the same state object.
2. **Rendering by string templates and full `innerHTML` replacement (17 call sites).** Every commit re-renders the stage, **all thumbnails** and the side panel. Measured cost grows with deck size: commit ≈3 ms at 3 slides, ≈7 ms at 10, **≈19–20 ms at 30 slides** (above the 16.7 ms frame budget). Full replacement also loses DOM state (focus, scroll, text selection), which will break rich text and chat input.
3. **Undo stores a full JSON string of the project per edit** (`S.history`, capped at 200). Memory grows with project size × edits, and nothing diffs or describes what changed. That's unusable as an AI proposal format.
4. **HTML built by string concatenation in the inspector** with event delegation by `data-*` attributes. It works, but accessibility (focus management, roles) and testing are hard.
5. **Duplicated logic between Python and JS:** `boundIds` versus `bound_evidence_ids`, `evidence_map` versus `refreshEvidence`, number formatting. Drift risk grows with every element type.
6. **Server API takes the whole project in every request body** (`POST /api/transfer {project, …}`). Simple and stateless, but payloads grow with the deck and concurrent tasks can't merge.

## What to keep, extend, refactor or replace

| Item | Decision |
|---|---|
| Python model, integrity, patch validation, research and transfer contracts | **Keep and extend.** Framework-agnostic and well tested; they become the server-side "authority" layer |
| Flat element list with `slide_id`, `evidence_id` references, groups | **Keep.** Extend with `rotation`, `locked`, `hidden`, `name`, `style_ref` |
| DOM rendering of slides | **Keep** (07-benchmark: adequate and faster than Konva at our scale; native text, accessibility and export fidelity) |
| Moveable/Selecto | **Keep behind an adapter**; they're unmaintained since 2024 |
| html-to-image | **Keep** for client PNG; add server-side Chromium for PDF |
| `editor.js` monolith, `S` object, `innerHTML` re-rendering | **Replace incrementally:** componentised frontend, a normalised store and per-slide memoised rendering |
| JSON-string undo | **Replace** with patch-based history (Immer patches) shared with AI proposals |
| Inline styles | **Refactor** to style roles referencing Design DNA tokens (inline overrides allowed but visible) |
| Bar/timeline renderers | **Replace** with ChartSpec plus ECharts; keep evidence binding semantics |
