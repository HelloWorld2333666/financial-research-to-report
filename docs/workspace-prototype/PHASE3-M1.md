# Phase 3 · M1 Document, store, persistence: results

**Branch:** `feature/workspace-v2`. Local commits only. **Status:** review stop (per PHASE3-PLAN).
**Date:** 2026-11-01. Verified in the built-in Chromium at 1440×900, against the app served by `app/server/service.py`.

## Delivered

| Area | What exists now |
|---|---|
| **Store** (`app/web/src/core/store.ts`) | One open project holds five parts: the deck (GenOffice `OpenedPptx`), the Evidence Core project, the bindings sidecar, the journal and the threads. **Selection is held as durable ids**, mapped to canvas source ids through each render node's `durableId`. It provides snapshot undo/redo, `preview()` (apply → read → restore), a clipboard, and bundle save/load through the service |
| **Commands** (`core/commands.ts`) | `slide.compose`, `element.transform`, `text.set`, `data.set`, `chart.addSeries`, `element.group`, `element.ungroup`, `element.delete`, `clipboard.paste`, `placeholder.add`, `ops.raw`. Every command is validated by `pptx-ops` and atomic: on any failure the snapshot is restored. Each produces **one undo step** and **one journal entry recording the actor** (`user`, `ai` or `research`) and an optional proposal id |
| **Evidence Core in the client** (`core/evidence.ts`, `integrity.ts`, `claims.ts`) | Working-layer projections, chart and table data, integrity (every bound value against the working layer) and the claim checker. Porting fixed a latent bug in the Experiment 3 checker: the spread branch called a two-argument helper with three arguments |
| **Sidecar v1** (`core/sidecar.ts`) | `frr-sidecar/1`, keyed by durable element ids. A migration hook accepts the Experiment 3 shape and bare maps, and rejects unknown schemas and non-durable keys |
| **Service** (`app/server/projects.py`, `evidence.py`, `composer.py`) | Bundle save/load: `deck.pptx`, `project.json`, `sidecar.json`, `journal.jsonl`, `threads.json` and `meta.json`, written to a temp folder and swapped in only when complete. **Versions** are frozen copies. Structure is validated (schemas, durable keys, deck is a zip under 50 MB); refused bundles write nothing. Includes the France seed from the verified Experiment 2 record, and the deterministic composer |
| **UI** (`app/web/src/main.tsx`) | Project picker, slide thumbnails, canvas, a statusline showing integrity and selection, autosave (1.5 s after a change), Save version, and Journal / Integrity / Claims / Versions panels |

## Engine patches (vendor/genoffice/patches, all with tests that fail without them)

| # | Patch | Evidence |
|---|---|---|
| 0001 | Line charts break at missing values (`dispBlanksAs`) | From M0. Vitest: 3 pass with the patch, 2 fail without |
| 0002 | **Paste creates independent chart parts.** `importClipboardParts` never reuses `ppt/charts/*` or `ppt/embeddings/*` | Vitest: the pasted chart gets its own part, and editing it leaves the original's values unchanged; it fails without the patch. Real browser: Cmd+C/Cmd+V gave `chart1.xml` and a new `chart4.xml` |
| 0003 | **Automatic thinning of axis labels.** Single-token labels (years) that collide show every k-th label when no explicit `tickLblSkip` is set | Vitest: 25 year labels thinned with no overlaps; 3 labels kept when there is room; fails without the patch |
| 0004 | **Chart frame hit area.** A transparent full-frame `Rect` in `ChartBody` | Real browser: clicking empty space inside a chart selects it (Experiment 3 needed a click on a drawn line) |

**Planned patch "0002 group-child ids" turned out unnecessary.** GenOffice already has `groupChildDurableId(group, child)`, which reads the creation GUID from the group's bytes, and its render tree uses it. Experiment 1 lost bindings on group only because my adapter used `elementDurableId` for children. The store now uses the right function, and bindings survive grouping.

**Decision D2 (grouping charts and tables): fallback taken.** Inside a group, GenOffice parses charts and tables as opaque passthrough frames (`parse.ts` → `graphicFramePassthrough`), so they would lose chart rendering and editing. Making them first-class would need parser, renderer and operation changes. Grouping them, or nesting a group, is refused with a clear message, and nothing changes.

## Acceptance

| Criterion (PHASE3-PLAN M1) | Result |
|---|---|
| All 16 Experiment 3 checks pass on the new app | **Pass.** `/?checks=1` runs them end to end against the real service, inside the pytest suite (`test_end_to_end_checks_in_the_browser`). There are **20 checks**: Experiment 3's 16 plus the M1 checks below, all ok |
| France deck saved, closed and reopened gives integrity 100% and the same content, threads and journal | **Pass.** Browser check `save_reopen_identical` compares integrity, every bound element's text, the journal and the threads, all equal. The same is covered at unit level in `store.test.ts`. **Real browser:** draft deck, then move, paste, delete and group, then autosave and reload. Result: 4 slides, the group intact, the journal (4 AI and 4 user entries) intact, integrity 30/30 |
| Grouping and ungrouping two bound text boxes keeps their bindings | **Pass.** Unit and browser checks. **Real browser:** Shift-click kicker and subtitle, then Cmd+G: grouped, integrity 30/30 bindings (Experiment 1 had 7/9) |
| A pasted chart edited alone leaves the original unchanged | **Pass.** Unit and browser checks: series added to the copy only; the original keeps 2 series and its chart values |
| Test totals | **Vitest 15/15** (engine patches 6, store 9). **Pytest 186 passed** (repo 174, service and projects 9, licences 1, headless boot 1, headless end-to-end 1). Licence report 205/205 allowed |

Also verified with real input:
- A chart selected by clicking its empty area, then dragged: journalled as a `user` move, and the selection kept through the re-render.
- Backspace deletes the pasted chart and its binding.
- Grouping a chart shows the refusal notice, and the undo stack is unchanged.

## Known limitations (carried to later milestones)

- **Undo history is per session.** It isn't saved; the journal is. Reopening starts with an empty undo stack (M4 may restore proposal state).
- **Text editing is still a plain textarea overlay.** GenOffice `TextEditOverlay` comes in M2, with real fonts (current rendering uses estimated metrics, so words look cramped).
- **A multi-element drag commits one command per element.** M2 adds a combined `elements.transform`.
- **A group's frame covers its whole bounding box.** Clicking the title area selected the kicker/subtitle group during testing. That's GenOffice's behaviour; M2 may add click-through to children.
- **Server-side integrity on save is not implemented yet.** The service validates structure only; full integrity runs in the client. It is planned with the Evidence Core endpoints in M3.
- **`tsc` reports 191 errors inside vendored GenOffice files** under our stricter compiler flags. Our own sources have 0.

## Next: M2 (editing quality)

- `TextEditOverlay`.
- Shipped fonts and theme.
- Table and chart styles.
- Titles with `autoFit: shrink`.
- Combined multi-element transforms.
- Snapping and alignment toolbar.
- Marquee check with a real mouse.
