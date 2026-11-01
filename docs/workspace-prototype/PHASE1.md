# Phase 1: stabilise the editable workspace (results)

**Branch:** `feature/workspace-editable`. Local commits only; nothing pushed or merged.
**URL:** http://127.0.0.1:8765/workspace/index.html (`python3 editor/server.py`). Reset the demo with `python3 editor/build_workspace_demo.py`.

The France, Germany and Italy data are SAMPLE (synthetic). The China Re slide uses the hand-verified bundle. The slide assistant is simulated: rule-based, with no model calls.

## Working-data model (how editing and provenance coexist)

| Layer | Where | Editable? | What an edit does |
|---|---|---|---|
| **Original evidence** | `project.evidence` (China Re) and `datasets[*].observations` (series), with source, page, date and unit | **Never overwritten** | — |
| **Working data** | `datasets[*].working[date]` for series, and `cell.working` / `bar.working` / `metric.working` for sourced table cells, bars and metrics | Yes, freely | Stores `{value, by, at, status}` next to the source. Charts, tables and metrics **render the working value immediately** |
| **Manual values** | Table cells or bars with `value` and no `evidence_id`; manual series (`origin: "manual"`) | Yes | Plain user data, labelled "manual — no source" |
| **Verification status** | `status: "manual_unverified"` (default) or `"verified"` | Set by "Verify (simulated)" | The integrity report shows "N manually edited values — pending verification". A final export requires each category to be acknowledged |

- **Restore original** deletes the working entry; typing the source value back also removes it.
- **Missing observations** (an empty cell) become `{deleted: true}`, rendered as a gap. Nothing is ever interpolated.
- **One working value per series and date** is shared by every chart and data table that uses it. That's why a table edit moves the line chart, as verified in Test E.

## Browser acceptance tests (built-in Chromium, 1440×900, 2026-11-01)

"Real" means the browser tool's own mouse clicks and keyboard typing. "Dispatched" means DOM events sent by script to the same handlers; I used that where the tool can't act (see the notes).

| Test | Steps | Method | Result |
|---|---|---|---|
| **A: Text** | Double-click heading, type new wording, Esc; A+ twice (22→24 px); colour; Save; reload | Real double-click, typing, clicks, ⌘S. Colour via the toolbar's colour input event (a native colour picker can't be clicked by the tool) | **Pass.** Wording, size and colour persisted |
| **B: Table** | Select table → Edit table → change sourced cell 84.71→85.2; rename header; add row; Save; reload | Real clicks and typing | **Pass.** The cell keeps `evidence_id` and the working value 85.2; source 84.71 unchanged; integrity reports 1 pending edit |
| **C: Bar chart** | Select bar chart → Edit data → France 2026 = 110.5 → remove Germany | Real clicks and typing | **Pass.** The draft chart updated immediately (one undo step); source 103.1 and Germany's dataset intact; persisted after reload |
| **D: Line chart** | Double-click line chart → full 25-row series → Germany 2010 = 66.6 → remove Italy → add manual "Spain" with 2 values | Real double-click to open; cell entry, series removal and "New series" dispatched (the pane rescaled, so coordinates were unreliable) | **Pass.** Exactly one point changed; Italy's missing 2005 stays a gap; Spain plots only its 2 typed values; persisted after reload |
| **E: Manual after AI** | Simulated AI proposal → Preview → Apply; double-click the moved commentary and retype; Shift+↑×4; double-click a data-table cell and type 104.4; Save; reload | Real clicks, typing and keys | **Pass.** All persisted; the table edit updated the line chart too (France 2025 = 104.4; source 102 kept) |
| **F: Normal editing** | ⌘C/⌘V; shift-click + ⌘G; drag group; resize handle; ⌘Z×2, ⇧⌘Z; context-menu Ungroup; context-menu Move to slide 3; ⌘D; Backspace; Save; reload | Real keys and clicks for copy, paste, group, undo, ungroup, move, duplicate and delete. **Drag and resize dispatched** (the tool's drag gesture doesn't drive Moveable). Redo dispatched | **Pass.** Everything persisted; the moved card renders on slide 3 with its evidence-bound value |
| Chart formatting | Title, legend, y-axis title, line width, markers in Properties | Dispatched change events on the inspector inputs | **Pass.** Each change re-renders; plotted data identical |

**Automated regression:** `editor/tests/test_workspace_e2e.py` runs `?scenario=smoke` in headless Chrome. It makes 26 checks covering A–F, table↔chart consistency, the stale-proposal refusal and Design DNA. **`pytest`: 174 passed.**

## Defects found and fixed in this phase

1. **Double-click started two edit sessions**, and the second committed the original text back. Fixed with a single-session guard.
2. **Edited text didn't redraw** (contentEditable detached Preact's nodes). Fixed by remounting the element after commit.
3. **Edit start depended on timers or animation frames**, so keystrokes typed right after a double-click could be lost when the window was in the background. Setup is now synchronous.
4. **One cell edit produced two undo steps** (Enter, then blur). Cells commit once; identical working values are no-ops.
5. **The selection box and floating toolbar didn't follow** the canvas when the data sheet or panels resized it. Fixed: they're re-measured on resize.
6. **The chart edit counter included dates the chart doesn't show** (a 2024 edit flagged on the 2026 bar chart). It now counts only displayed dates.
7. **Blank charts.** ECharts initialised in `useEffect`, which waits for an animation frame; frames are throttled when the window isn't visible. Charts now initialise in `useLayoutEffect` and are ready within 50 ms of a slide switch.
8. **Moveable was created after the first selection effect**, throwing at mount and stopping boot-time scripts. It is now created first, with a guard.
9. **The context menu could extend below the window.** It's now clamped inside the canvas.
10. **Design DNA couldn't restyle the China Re headings**: the generator gave role text inline colours and sizes. Role elements now take typography from Design DNA; inline styles are only for your own overrides.
11. **"New manual series" used a blocking `prompt()`.** Replaced with an inline name field.
12. **The integrity checker flagged years in headers** like "2024 (FY)" when the cited period is "FY2024". Fixed.

## Remaining defects and gaps (not fixed in Phase 1)

1. **Small windows:** below about 1,100 px wide, the fixed left (236 px) and right (380 px) panels leave the canvas at about 20%. Panels don't collapse automatically.
2. **Not verified with a physical mouse or trackpad.** Drag, resize and rotate were only exercised with dispatched events. Rotation wasn't exercised at all.
3. **Not browser-tested in Phase 1** (implemented in the WIP commit):
   - inline bold, italic and underline inside a text selection
   - image upload, replace, crop and adjust
   - icons, shapes, lines and arrows
   - the export dialog and its draft/final policy
   - "Reconstruct as editable table"
   - TSV paste and column-resize drag in the table grid
   - bar-chart (China Re evidence bars) Edit data
4. **Suggestion chips in chat move** when selection chips appear above the composer, which caused a mis-click during Test E.
5. **The simulated assistant has no collision checks.** "Move the commentary down" can overlap the source note.
6. **Two edit counts don't match.** The project-level "unverified edits" count (Python integrity) counts all working edits in a dataset, while each chart's status counts only the dates it shows.
7. **Escape always keeps the typed text;** there's no "cancel edit" shortcut.
8. **Old projects** saved with the earlier `revisions` field aren't migrated to `working`. Only the demo builder was updated.
9. **Patches address elements by array index.** AI proposals guard this with an id and geometry check; a production store should key elements by id.
10. **Screenshots** of the Phase 1 state and the three style directions weren't produced; that belongs to the deferred visual phase.
