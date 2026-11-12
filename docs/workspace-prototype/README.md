# Workspace prototype (end-to-end architecture slice)

**Branch:** `feature/workspace-prototype` (from `research/workspace-study`). Not merged.
**What it is:** the "smallest credible end-to-end prototype" from [06-roadmap.md](../workspace-study/06-roadmap.md). It's a working slice of the recommended architecture, not a product.

**Honesty notes**
- The slide assistant is **simulated**: deterministic keyword rules in `simai.js`. No model is called and nothing is paid for.
- France, Germany and Italy data are **SYNTHETIC** (seeded random walks) and labelled SAMPLE throughout.
- The China Re slide uses the real, hand-verified evidence bundle.
- No research is performed. "Request research" creates a Research Request through the existing contract, and nothing fulfils it.

## Run it

```bash
python3 editor/server.py
```

Then open http://127.0.0.1:8765/workspace/index.html.

- **Reset the demo project:** `python3 editor/build_workspace_demo.py` (overwrites `editor/projects/workspace_demo.json`).
- **Scripted states:** `?scenario=chat | data | chart | dna | focus`
- **End-to-end checks:** `?scenario=smoke`. Results go to `window.__scenario`; the scenario never saves.

## What it demonstrates

| Requirement | How to try it | Where |
|---|---|---|
| Multi-slide workspace: rail · large canvas · one resizable, collapsible Context panel | Drag the panel's left edge (300–560 px); ⇥ collapses it to an icon strip; **Focus** or `F` for a full canvas | `app.js` |
| Real editable canvas | Click or shift-click to select; drag, resize and snap (Moveable); arrows nudge; double-click text to edit; ⌫ deletes; ⌘Z / ⇧⌘Z | `app.js` Canvas |
| Slide-level chat with selection context | Select the chart and table on slide 2 → they appear as chips → "Make the chart larger and the table narrower" | `panels.js` ChatPanel, `simai.js` |
| Proposal → preview → apply / reject → undo | The proposal card lists the objects affected, invariants ("only position/size", "only this slide"), **Preview on slide** (dashed outlines), **Apply**, **Reject**, **Undo** | `panels.js`, `store.js` |
| Stale-proposal protection | Edit an object after a proposal is made, then Apply → refused as *stale* | `panels.js` apply |
| Data selection by checkbox → deterministic chart | **Data** tab: tick France/Germany/Italy debt → compatibility check (unit, frequency, observation type; gaps listed) → live preview → **Insert on slide**. Mixing annual and quarterly is blocked | `panels.js` DataPanel, `model.js` |
| Source-linked chart editing | Select a chart → **Design**: series bindings, source-data table (gaps shown as *missing*, user revision marked † *pending verification* and **not plotted**), and the parity line "74 plotted points = 74 dataset observations". **Style** changes type, labels, axis and range; values never change | `panels.js` ChartEditor, `charts.js` |
| Whole-deck style (Design DNA) | Nothing selected → **Design**: font, title size, ink, accent, series colours, presets. Every slide and thumbnail restyles through style roles; charts re-render from the same data | `panels.js` DesignPanel, `workspace.css` `--dna-*` |
| Research gap → Research Request | Data → *France · 5Y sovereign CDS* (no data) → **Request research** → a pending placeholder plus a Research Request through the existing `/api/research/create` | `panels.js`, `research.py` (unchanged contract) |
| Python stays the authority | Save (⌘S) validates through `slidemodel.validate_project`, now including datasets and charts. The **data checks** chip shows server-side integrity (sample data on a slide, pending revision, incomparable series, dangling chart or dataset refs) | `charts.py`, `slidemodel.py` |

## Architecture as built (maps to 05-architecture.md)

```
Moveable (adapter in Canvas) ─┐                      ┌─ SlideView / ElementView (memoised per element)
chat / data / design panels ──┼─► store.commit()  ───┤
simulated assistant ── propose() → patches ─► applyTracked()   └─ ChartView: ChartSpec → ECharts (SVG)
                              │      (Immer patches = undo + proposals)
                              └─► PUT /api/projects (Python validation) · POST /api/integrity
```

- **One change format.** Every user edit is an Immer patch set, and so is every accepted AI proposal and every undo step (`store.js`). Proposals are stored with their patches and the base geometry they assume.
- **Structural sharing.** An edit keeps unchanged element objects identical. Memoised components skip them, and per-slide element arrays keep their identity, so untouched thumbnails don't re-render (`model.elementsBySlide`).
- **Deterministic charts.**
  - The ChartSpec holds dataset references and visual settings only; `charts.validate` rejects specs that store values.
  - `chartSeries` (JS) mirrors `charts.chart_series` (Python): values come straight from observations and gaps stay `null`.
  - ECharts runs with `animation:false` and `connectNulls:false`, without sampling.
  - Thumbnails use the static deterministic SVG renderer, so they don't need a chart-engine instance.
- **Chat threads are untracked state:** persisted with the project, but not part of undo.

**Deviation from the recommendation:** the plan calls for React + TypeScript + Vite. This machine has no Node toolchain, so the prototype uses **Preact 10 + htm** as ES modules with no build step, plus an import map. The component model, hooks and data flow are the same as React's, so porting is mechanical: htm templates become JSX, and Preact becomes React. TypeScript types weren't written.

## Reused vs new

| Reused unchanged | Extended | New |
|---|---|---|
| `research.py` and the Research Request contract, `transfer.py`, `server.py` endpoints, Moveable 0.53, html-to-image, the China Re evidence bundle and `build_slide.py`, old element renderers (ported to components) | `slidemodel.py`: `chart` and `datatable` element types, chart/dataset validation and integrity hooks, instrument tenors ("10Y", "10-year") no longer counted as figures | `charts.py`, `build_workspace_demo.py`, `static/workspace/*` (store, model, charts, render, panels, simulated assistant, scenarios), `bench/workspace-bench.js`, `tests/test_charts.py`, `tests/test_workspace_e2e.py` |

**Vendored libraries** (MIT/Apache, see `editor/THIRD_PARTY.md`): Preact 10.29.8, htm 3.1.1, Immer 11.1.21 and ECharts 6.1.0, in `static/workspace/vendor/`.

## Tests performed (2026-11-01)

- **`pytest`: 171 passed.** That includes 17 new tests in `test_charts.py`:
  - plotted equals stored
  - gaps aren't interpolated
  - pending revisions aren't plotted
  - specs storing values are rejected
  - incomparable series are flagged
  - restyling keeps values
  - tenor rule

  It also includes the headless-Chrome **end-to-end smoke test** (`test_workspace_e2e.py`, 11 checks, skipped when Chrome is absent).
- **The `?scenario=smoke` checks, all passing in headless Chrome 1440×900:**
  - incompatible mix blocked
  - chart inserted without values
  - parity 74/74
  - restyle keeps values
  - 3 preview outlines
  - apply changes only the 3 scoped objects
  - apply keeps datasets and charts identical
  - undo restores
  - stale proposal refused
  - DNA restyles thumbnails
  - DNA keeps values
- **Manual checks in the built-in browser:**
  - chat proposal flow with real clicks and typing
  - single-gesture press-and-drag (dispatched mouse events) → one "Moved" commit
  - save → reload keeps geometry, Design DNA and the chat thread including proposal status
  - research request creates a placeholder
  - the unknown-instruction reply
- **Not tested:**
  - a physical mouse or trackpad
  - Safari or Firefox
  - narrow laptops below 1280 px beyond CSS breakpoints
  - keyboard-only operation of panels
  - screen readers

## Performance (same session, same conditions)

`editor/static/bench/workspace-bench.js` vs `editor-bench.js`. Both duplicate the China Re slide to N slides and time a one-pixel nudge commit including rendering (median of 9; three repetitions).

| Slides | Old editor commit | Prototype commit |
|---|---|---|
| 3 | 17–21 ms | 1.1–2.4 ms |
| 10 | 62–65 ms | 1.8–2.9 ms |
| 30 | 176–196 ms | 2.7–5.1 ms |

**Caveat.** During this session the app window was not in view: animation frames ran at about 2 s and the renderer was deprioritised. The old editor measured 19–20 ms at 30 slides in the 2026-11-01 baseline, and about 9× higher here. Read the **ratio** (roughly 35× at 30 slides, with cost now nearly flat in deck size), not the absolute values.

The prototype figure covers Preact's diff and DOM updates. It excludes effects that run after paint (Moveable `updateRect`) and the debounced integrity request. Re-run both scripts with the window visible before quoting budgets.

## Known limitations

- **Simulated assistant:** size and position changes only, using keyword rules. Layout alternatives, research and verification are answered with a pointer to where they would plug in.
- **Patches address elements by array index.** Proposals guard this with id and geometry checks; a production store should key elements by id.
- **Saving writes the whole project.** There's no per-slide autosave yet, and the integrity request also posts the whole project after every change (about 410 KB with 30 slides).
- **Text** is plain (no rich text); the Layers tab is disabled; there's no copy/paste, no rotation handle (rotation exists only as a numeric field), and no image elements.
- **Chart titles** typed in the chart editor aren't yet number-checked against evidence. Text elements are.
- **Placement** of inserted charts tries three sizes, then overlaps content (and says so).
- **Headless Chrome screenshots** needed an extra Moveable re-measure; in the live browser the handles align exactly.
