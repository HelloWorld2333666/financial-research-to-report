# Financial Slide Preview & AI Layout Editor (prototype)

This is a purpose-built preview workspace for **a small AI-generated financial report**: a few slides, typically 3–5. Research and slide planning produce the content and layout; this editor lets you:
- inspect every slide, with every figure traceable to source evidence
- rearrange and restyle slides, and add blocks
- **drag modules between slides**, where the drop is treated as an instruction (move, copy, or ask AI to adapt); see [TRANSFER_CONTRACT.md](TRANSFER_CONTRACT.md)
- describe changes to specific regions, including asking for **new research-backed content**
- save the approved previews for final rendering

It is **not** a presentation platform. There are no templates, themes, font libraries, asset marketplaces, deck generation or PPTX support, and none are planned here. It is kept separate from the research pipeline (`src/frr/`) and reads `research/china_re/fy2025_bundle.json` only as data.

## Run it (macOS, Python 3.11+, no Node needed)

```bash
python3 editor/server.py
```

Then open one of:

| Project | URL |
|---|---|
| **Multi-slide deck** (overview plus two blank pages, ready to drag between) | http://127.0.0.1:8765/?project=china_re_deck |
| **Transfer demo** (after four scripted drops; see below) | http://127.0.0.1:8765/?project=china_re_deck_demo&tab=requests |
| Initial slide | http://127.0.0.1:8765/?project=china_re_overview |
| Research request demo (not-available end state) | http://127.0.0.1:8765/?project=china_re_overview_research_demo&tab=requests |
| Earlier layout-editing demo | http://127.0.0.1:8765/?project=china_re_overview_demo |

- Regenerate the initial slide from the bundle (this overwrites `projects/china_re_overview.json`): `python3 editor/build_slide.py`
- Regenerate both deck projects: `python3 editor/build_deck.py`
- Older single-slide projects (`frr-slide/0.1`) open as one-slide decks and are saved in the new format.
- Tests: `.venv/bin/python -m pytest editor/tests`

## Workspace

| Area | What it does |
|---|---|
| **Top bar** | Title, save state, open research requests, undo/redo, revert, **Save** (⌘S), **Export PNG** |
| **Slide strip** | Thumbnails in page order. Click to open a slide, double-click to rename; hover for ↑ ↓ (reorder), ⧉ (duplicate), ✕ (delete). **＋ New slide** adds a blank page and is also a drop target. PageUp/PageDown switch slides |
| **Left rail** | **Select** (V), **✦ AI region** (R), then insert **Text**, **Panel**, **Shape**, **Chart**, **Table**, **Metric**. Chart, table and metric open a picker of *verified* figures. Mixing metrics, units or periods in one chart is blocked, and "Data missing → research request" switches to AI region |
| **Canvas** | A centred 16:9 slide that fits to the window. Click, shift-click or marquee to select; drag to move; handles to resize with snapping guides; double-click any text to edit; arrows nudge (Shift: 10px) |
| **Floating toolbar** | Anchored above the selection. Duplicate, Front/Back, Delete, **⇢ Slide…** (the drop menu without dragging) and **✦ Ask AI**; with several elements selected, also align ×6, distribute, and Group/Ungroup |
| **Inspector** | **Inspect**: position, size, style, and linked evidence, claims and gaps with page and excerpt. **Requests**: research requests and layout change requests. **Data**: integrity report and the evidence shown on the slide |

### Describing a change (the core interaction)

1. Draw a box with **✦ AI region**, or select elements and press **✦ Ask AI**.
2. Type what you want. As you type, the editor suggests how to handle it, and you can change the suggestion with one click:
   - **Edit layout**: rearrange or restyle what is already there.
   - **Use existing data**: new content that verified evidence already covers. No new research is triggered.
   - **Add research-backed content**: needs data the project doesn't have. A **pending research placeholder** goes in the box, and a structured Research Request is saved.
3. **Create request.** Layout requests use the agent patch flow (below). Research requests wait for a Research Engine response; see [RESEARCH_CONTRACT.md](RESEARCH_CONTRACT.md).

### Moving content between slides (semantic transfer)

1. Select a module (clicking a panel, header or text selects its whole group) and drag it onto another slide's thumbnail, or onto **＋ New slide**.
2. The drop menu offers:
   - **Place as-is**: *Move as-is* or *Copy as-is*. The module keeps its ids (move) or gets a linked copy (copy). Evidence bindings, claim and gap refs are unchanged, and no request is created.
   - **Ask AI to adapt**:
     - *Move and adapt to target slide*
     - *Use as evidence for a new slide*
     - *Split into multiple modules*
     - *Summarise for target slide*
     
     Each stores a **Transfer Request**: source and target slides, modules, linked evidence, claims, metrics and sources, mode, your optional instruction, timestamp and status. Moved modules are flagged "✦ pending adaptation"; the source-kept modes put a linked **Pending AI adaptation** or **Pending summary** placeholder on the target.
3. If your instruction asks for an exhibit that doesn't exist yet, the drop also adds a placeholder:
   - "…add a regional bar chart" with no geographic data → a Research Request with a **Pending research** placeholder
   - an exhibit existing evidence can build → **Pending bar chart (from existing evidence)**
   
   The menu previews what will be added before you apply it.
4. In **Requests → Transfer requests**: **Show on slide**, **Send to AI** (writes a handoff file; no model call), or **Cancel request**. Every drop is one undo step (⌘Z).

## Data safety

- **Figures are references, not text.** Metric cards, table cells and chart bars store an `evidence_id`; numbers render from evidence and can't be typed over (🔒). Moving, resizing and restyling never change a figure.
- **Snapshot protection.** The research snapshot is hash-guarded. Research results are stored alongside it with their own hash and are never written into it; new responses can't overwrite existing evidence ids.
- **Data tab.** It flags:
  - edited cited text, detached values, and numbers without a supporting source
  - dangling references
  - pending research placeholders
  - TEST FIXTURE data on the slide (an error; export asks for confirmation)
  - tampered research results
- **Missing data stays visible.** It becomes an open research request or a *Not available* placeholder with a suggested alternative, never an estimate.

## Preview and final rendering

The preview and the PNG export render **the same saved slide specification** (`projects/<name>.json`) through the same DOM, so the exported PNG matches the preview. If a later stage renders the final slide with a separate generative image model, that output is **not** guaranteed to match the preview pixel for pixel. Layout, line breaks and chart proportions may drift, and figures in a generated image must be re-checked against the evidence. The saved specification remains the source of truth.

## AI execution: what is and isn't automated

- **Layout requests.** **Export for agent** writes a scoped request plus prompt. An agent returns a JSON patch, which is validated (scope, region, no rebinding of figures, verified evidence only, no unsourced numbers) and applied with undo. The server shows a tool-less `claude -p --tools '' --json-schema …` command but **never runs it**, because it would use your Claude account.
- **Research requests.**
  - **Send to Research Engine** writes the handoff file.
  - **Load engine response** reads `editor/research/<project>/<id>.response.json`.
  - **Simulate with a TEST FIXTURE** loads synthetic responses for testing the insertion path.
  
  There is no Research Engine yet.

## Acceptance test performed (2026-10-27, in the browser)

1. On the China Re slide I deleted the old geography gap box, drew an AI region in its place, and typed: "Add a horizontal bar chart showing China Re's revenue distribution by country or region. Please research… do not estimate undisclosed country-level values."
   - The editor suggested **Needs research** (no evidence for geography; known gap `gap.cr.geography`).
   - **Create request** added a Research Request (bar chart, FY2025, country scope, no-estimates constraint, related revenue evidence) and a pending placeholder at x32 y513, 384×84.
2. I saved (⌘S) and **reloaded**. The request, placeholder and open-request counter all persisted.
3. **Send to Research Engine** wrote the handoff file. **Simulate with a TEST FIXTURE** loaded `test_fixture_geo_region_fulfilled`, which validated with a fixture warning.
4. **Insert into slide** put an editable bar chart in exactly the placeholder region:
   - each bar keeps its value, unit, period, source and excerpt
   - no other element changed and the bundle snapshot is untouched
   - Data shows `fixture_data_on_slide`, and Export asked for confirmation before writing `docs/screenshots/slide-research-fixture-inserted.png`
5. **Remove inserted content** restored the placeholder and reopened the request (history: created → response:fulfilled → reverted).
6. Loading `test_fixture_geo_country_not_available` created **no chart**. The placeholder now reads *Not available* with the reason and an alternative, and the request stays open: `docs/screenshots/workspace-research-not-available.png`.
7. Compared with a freshly built slide, the only differences are the removed gap box and the new placeholder.
8. I also checked through the same popover:
   - "Reorganize these three blocks into two columns" → **Edit layout**
   - "Add a 2×2 financial metrics section here" → **Use existing data** (23 verified items), with no research request
   - **Chart** insert: three FY2025 combined ratios were inserted; mixing ROE with total income was blocked

## Transfer test performed (2026-10-27, in the browser)

Drags were replayed as dispatched pointer events. The browser tool's own drag gesture doesn't drive Moveable, as in the earlier session.

1. **Move as-is.** Dragged the solvency table onto the slide 2 thumbnail. The drop menu opened with slide 2 preselected; the preview read "no request". Applying moved the same element (same id, same position, links intact), and slide 2's source line began citing p.20.
2. **Move and adapt with a missing chart.** Dragged the combined-ratio table onto slide 3 with "Turn this into a separate page focused on geographic exposure, and add a regional bar chart." The preview read "Will add: Pending research: horizontal bar chart … needs research (geography)". Applying produced:
   - the table on slide 3, flagged for adaptation
   - a pending research placeholder in free space beside it
   - a transfer request listing 8 evidence ids, 1 claim, `m.combined_ratio`, and the linked research request
3. **New slide.** Dropped the ROE metric card on **＋ New slide**, chose *Use as evidence for a new slide* and named the slide "Profitability". A new slide 2 appeared after the source with a linked placeholder; the source card stayed.
4. Dropped the takeaways module (3 grouped elements) on **＋ New slide** using *Use as evidence*. The result was an 816×280 placeholder carrying the module's claims and evidence.
   - **Undo** removed the new slide and the request in one step; **Redo** restored them.
   - **Cancel request** removed the placeholder and set the request to `cancelled`.
5. Duplicated, reordered and deleted slides, added a blank slide, saved, and reloaded. All 5 slides, the active slide and the cancelled transfer came back, with no integrity errors.

## Known limitations

- **No Research Engine and no automatic agent execution.** Responses come from files or fixtures; layout patches come from a hand-run agent.
- **Rough intent detection.** It uses keyword and topic rules, can misclassify, and you can override it. The "uses existing data" path records which evidence to use but doesn't build the new block automatically.
- **Text can overflow.** Text is clipped rather than reflowed; a long *Not available* message in a small box is cut off until you resize it.
- **Not every gesture was tested with a real mouse.** Moveable drag and resize handles were tested with dispatched pointer events; real-mouse use by a person is still unverified. Moveable logged unexplained internal errors in an earlier session (not reproduced since).
- **No AI adaptation.** Transfer requests are stored and exported but never fulfilled; there is no "adapted" state yet. Placement on a crowded target slide falls back to overlapping when no free space exists.
- **Narrow scope.** Plain-text editing, fixed table columns, horizontal bar charts and simple timelines only. PNG export renders the slide shown (no whole-deck export). Only checked in Chromium on macOS.
