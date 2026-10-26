# Slide editor spike (prototype)

This is a local, browser-based editor for one dense 16:9 financial slide. It shows real China Re figures that are bound to the verified research bundle. You can rearrange and edit the slide freely, attach region-scoped change requests for an AI agent, validate the agent's proposed changes against data-safety rules, and export a clean PNG.

It is a **spike**, kept separate from the research pipeline (`src/frr/`). It reads `research/china_re/fy2025_bundle.json` only as data.

## Run it (macOS, Python 3.11+, no Node needed)

```bash
python3 editor/server.py            # serves on 127.0.0.1 only
```

Open **http://127.0.0.1:8765/?project=china_re_overview**

To regenerate the initial slide from the bundle (this overwrites `editor/projects/china_re_overview.json`):

```bash
python3 editor/build_slide.py
```

Tests (part of the repo suite):

```bash
.venv/bin/python -m pytest editor/tests
```

## What you can do

| Action | How |
|---|---|
| Select | Click; shift-click to add or remove; drag a marquee over empty slide area |
| Move / resize | Drag the element or its handles. Snapping guides align to other elements. Arrow keys nudge 1px (Shift: 10px) |
| Edit text | Double-click any text, label, table header or row label, chart title or footnote. Esc or click away to commit |
| Insert | **+ Text**, **+ Panel**, **+ Ellipse**, and **+ Metric…** (a card bound to a chosen verified evidence item) |
| Arrange | Duplicate (⌘D), Delete (⌫), Group (⌘G) / Ungroup (⇧⌘G), Front / Back, align ×6, distribute horizontally / vertically |
| Style | Properties panel: position, size, font size and weight, colours, fill, border, radius, number of decimals for metrics |
| Undo | ⌘Z / ⇧⌘Z (in-memory history, 200 steps) |
| Revert | **Revert to saved** reverts only the selected elements, or the whole slide when nothing is selected |
| Save / reload | ⌘S writes `editor/projects/<name>.json` and keeps the previous version in `projects/.history/` |
| Region request | **Region request** (R), then drag a box over the slide and describe the change |
| Element request | Select elements, then **Ask AI about this element…** |
| Export | **Export PNG** produces 2560×1440 with no handles, request boxes, citation badges or lock icons; saved to `editor/exports/` and downloaded |

### Slide content (A) and edit requests (B) are separate

- **(A) Slide elements** live in `project.elements` and render in `#stage`. Only these are exported.
- **(B) Annotations** (region or element change requests) live in `project.annotations` and render in a separate `#annotLayer` that is never part of the export. They point at slide coordinates or element ids, so the slide underneath stays structurally editable.

## Financial data rules (enforced in `slidemodel.py`)

- **Figures are references, not text.** Metric cards, table cells and chart bars store an `evidence_id` and a display format. The value comes from the project's evidence snapshot, so moving, resizing or restyling cannot change a figure, and a figure can't be typed over (🔒).
- **Tamper detection.** The evidence, sources, claims and gaps snapshot carries a SHA-256 hash; any edit to it is a data-integrity **error**.
- **Data-integrity panel**, recomputed after every change:
  - an edited cited text → warning
  - a detached value → warning
  - a number in text that no cited evidence supports → warning
  - a dangling reference → error
  - evidence that is no longer shown → info
- **Computed changes.** Percent and percentage-point changes are calculated from two evidence values; nobody types them.
- **Missing data is a research request.** If a metric is missing, **+ Metric… → "Metric is missing"** or an agent patch raises a research request instead of inventing a number. The geography gap is shown as an explicit placeholder.

## AI change-request workflow

1. Draw a region (or select elements) and type an instruction.
2. **Export for agent** writes `editor/requests/<project>/<id>.request.json` and `<id>.prompt.md`. These contain the instruction, region, in-scope elements, the other elements' boxes, the verified evidence available, rules and the patch JSON Schema.
3. An agent returns a **patch**: a list of `update`, `add` and `delete` ops plus `research_requests`, written to `<id>.patch.json`.
4. **Load agent patch** sends it to `/api/patch/validate`, which applies it all-or-nothing and rejects it when:
   - it touches elements outside the scope
   - it places new content outside the region
   - it changes `evidence_id`, `refs`, ids or types
   - it rebinds chart or table figures
   - it uses unknown or unverified evidence
   - it adds a number in text that no cited evidence supports
5. **Apply** puts it on the undo stack (⌘Z reverts it).

### Is Claude Code integration automated? No, not in this spike

The server prints a suggested command but **never runs it**:

```bash
claude -p --tools '' --output-format json --no-session-persistence --json-schema '<patch schema>' < editor/requests/<project>/<id>.prompt.md
```

- `--tools ''` disables every tool, so the agent can't read or write files. It can only return JSON, which the validator then checks.
- I confirmed these flags exist in Claude Code 2.1.296 (`claude --help`) but did not run the command, because it uses your Claude account and you asked for no paid calls.
- In the demo below, the patches were written by the Claude Code session that built this spike. It read the exported request file, wrote `<id>.patch.json`, and the editor then validated and applied the patch. That shows the data flow works with a real agent; it is not an automated integration.

## Demo performed (2026-10-27)

Everything below was done in the browser against the running server. Screenshots are in `editor/docs/screenshots/`.

1. Loaded the slide (25 elements, 27 evidence-bound figures, integrity clean): `slide-initial.png`.
2. Shrank the profile panel with its resize handle.
3. Grouped the three ownership elements with real shift-clicks and ⌘G, then moved the group.
4. Grouped and moved the ratings block, nudged it with Shift+↓, and corrected a mis-click with ⌘Z.
5. Moved the data-gap box.
6. Double-clicked the title and typed a new one.
7. Inserted a panel and a text box with the toolbar, then typed a note into the box.
8. Drew a region over Key Takeaways and typed: "Turn the key takeaways into a 2x2 grid of cards… do not add new figures." The scope resolved to `takeaways-bg`, `takeaways-h` and `takeaways`.
9. Asked about the geography gap element: "Replace this box with a chart of revenue by country (top five, FY2025)."
10. Saved, reloaded the page, and confirmed every edit persisted.
11. Exported both requests. The agent patches:
    - **Takeaways:** a 2×2 grid of cards; it validated and was applied.
    - **Geography:** no country data exists in the evidence, so the patch has no layout change and raises a research request.
12. Pasted a **deliberately invalid** hand-written patch (invented country shares, a rebound KPI, an unknown evidence id). It was **rejected with 7 reasons**, and the slide was unchanged.
13. Tested undo and revert:
    - Recoloured the title, then **Revert to saved** on the title only; the grid was unaffected.
    - ⌘Z undid the patch and brought the original takeaways back; redo reapplied it.
    - Detaching the ROE value raised `detached_citation` and `unsourced_number` warnings; undo restored the bound value.
14. Exported the modified slide (`slide-modified.png`). `editor-ui-modified.png` shows the editor with request overlays, which are not exported.

## Known limitations

- **Agent execution is manual.** There is no button that runs Claude Code, and no streaming or progress.
- **Small model.** One slide per project; no slide list, no thumbnails, no PPTX.
- **Plain text editing.** No rich text (bold or colour within a run). Tables have fixed columns, with no add or remove row or column. The bar chart is a simple HTML component with horizontal bars only.
- **Text overflow is not detected.** Text can overflow its box silently.
- **Undo history is lost on reload.** Previous saved versions are on disk in `projects/.history/`, but there's no UI to browse them yet.
- **Number checks are heuristic.** They match numbers literally (with rescaling) against cited evidence values and excerpts, so a correct derived number in free text is flagged too. Treat warnings as "review", not proof.
- **Not every gesture was tested with a real mouse.** Selection, shift-click, ⌘G, keyboard nudges, undo, typing, toolbar clicks and region drawing were. Moveable drag and resize handles were driven by dispatched pointer-event sequences, because the browser automation's drag doesn't send intermediate moves. They have not been tried with a physical mouse by a person.
- **Unexplained console errors.** During automated testing, Moveable logged six internal errors (`Cannot set properties of null (setting 'dist')`). Targeted attempts to reproduce them (pointer-only, duplicate pointer and mouse streams, pressing a grouped element directly, press and release without moves, select-then-drag) produced none. No model or file corruption was observed, but the cause is unknown.
- **Fonts.** Export uses system fonts (Helvetica Neue / Arial); there are no embedded web fonts.
- **Untested elsewhere.** Only checked on macOS in Chromium-based browsers.
