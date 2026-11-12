# Phase 3 · M6 Final acceptance: results

**Branch:** `feature/workspace-v2`. Local commits only.
**Date:** 2026-11-04. Checked in the built-in Chromium against `app/server/service.py` with the local model `qwen3.8:27b` (Ollama). No paid API was called. M6's shell work (design tokens, light and dark chrome, Radix menus and dialogs, top bar, panels that fold below 1,280 px) was already in place, so this pass ran the acceptance checks and fixed what failed.

## Acceptance

| Criterion (PHASE3-PLAN M6) | Result |
|---|---|
| The France scenario runs start to finish with real input | **Pass, after one fix (below).** Steps, with a real mouse and keyboard in project "France sovereign credit":<br>1. **New project:** 10 datasets and 64 evidence items from Eurostat.<br>2. **Draft deck:** 4 slides, 30/30 bindings, 14/14 figures in text sourced.<br>3. **Evidence:** selecting the chart lists its 8 values with their sources.<br>4. **Data edit:** typing 116 for France 2025 in the Data tab flagged "text says 115.7, data now 116" and "+4.3 → 4.6"; Restore brought integrity back to OK.<br>5. **Text edit:** a subtitle edit, then a bold run in the title, each committed as one step by clicking the empty stage, then undone.<br>6. **Change visual:** column chart to line from the menu (integrity OK), then Cmd+Z.<br>7. **AI proposal:** with the chart selected, "Compare this chart with Italy" in the slide thread. The model proposed "Add Italy": 4 values fetched live from Eurostat and confirmed by an independent re-fetch (about 2 minutes). Preview showed the change on a copy; Apply made it one AI step. Italy 2022–2025 = 138.4, 134, 134.3, 136.7; 36 chart points; integrity OK.<br>8. **Versions:** "Save version now" saved version 1 (11 journal steps, 4 slides).<br>9. **Export:** Final report listed one open item, the slide-4 placeholder. After it was acknowledged, the export wrote a 28 KB `.pptx`. The exported chart is native and editable, with all three countries; the export log records the acknowledgement and the server's integrity (30/30 bindings, 36 points, 14/14 sourced).<br>10. **Reload:** the deck, Italy, the 11-step journal and the slide thread with its "Applied" card all came back |
| The app looks like a creative tool, not a dashboard (screenshots for your review) | Screenshots in `m6/`:<br>• `1-light-deck.jpg`: light chrome, the deck;<br>• `2-chat-proposal-preview.jpg`: the proposal with its preview;<br>• `2-chat-proposal-applied.jpg`: the same proposal after Apply;<br>• `3-narrow-drawer-1180.jpg`: at 1,180 px the panel folds away and opens as a drawer over a dimmed slide;<br>• `4-dark-data-panel.jpg`: dark chrome with the Data panel |
| All tests are green | **vitest 138 passed** (5 skipped; new: the performance test). **pytest 254 passed**, including the headless browser checks. `tsc`: 0 errors in our sources. **Real-mouse script (M2's list, repeated):**<br>• rich text (double-click selects a word, Cmd+B, click away commits one step);<br>• resize by the corner handle (one "Move/resize" step);<br>• marquee (a drag across the bottom of the slide selects the full-width source note, which it must fully contain, as in PowerPoint);<br>• shift-click and Align left (one step).<br>All passed and were undone |

## Performance

| Measure | Result |
|---|---|
| Bundle | 4.57 MB JavaScript (1.36 MB gzipped), 22 KB CSS. The Python service serves it uncompressed; locally it arrives in about 20 ms |
| Load | Script, project (146 KB) and fonts are in by 90 ms. The app first draws at about 2.0 s: about 0.9 s goes to opening the deck and reading the eight font files (3.2 MB), and about 1 s to the first render |
| Slide switching | 80 ms median (50–133 ms over 20 switches): React plus the canvas redraw, timed in the page |
| Integrity on a large deck | 40 slides, 300 bindings, 320 chart points: **15 ms**. Laying out a slide: 0.6 ms median, 6 ms worst (`src/core/perf.test.ts`; it fails above 2 s and 250 ms) |

The browser pane reports the page as hidden, which throttles animation frames and timers to 1–2 s, so frame-based timings there are meaningless. Slide switching was timed with message-channel ticks instead, which aren't throttled.

## Found and fixed

| Problem | Fix |
|---|---|
| **An on-canvas text edit was lost when you clicked the empty stage.** The editor closed and no step was recorded. The click deselects, which rebuilds the slide's node objects; the editor's setup depends on its node, so it refilled the box with the original text and reset its "unchanged" snapshot. Its blur then saw no change and cancelled. (M2's test clicked elsewhere, where no deselect happened.) | The editor now gets the node as it was when editing began (`main.tsx`). Checked with real clicks: subtitle and bold-run edits each commit one "Edit text" step |
| The change-visual journal entry read "Change “Gross debt, % of GDP” to line, none" | "none" (no view) is left out of the summary |

## Notes

- **The local model is the slow step:** about 2 minutes for the Italy proposal in a fresh slide thread, as measured in `LOCAL-MODEL-QWEN3.8.md`.

## Follow-up: M6 leftovers (same day)

| Item | Change | Checked |
|---|---|---|
| **Fetch dates showed the UTC day.** The Italy fetch at 01:16 on 4 November (UTC+8) was labelled 2026-11-03 | Times are still stored as UTC instants. Dates written for people now use the local day of the machine the app runs on: a live fetch's source note and "verified on", and a PDF rating's "verified on". The app shows stored times in local time with the zone named (`core/time.ts`): Evidence cards ("Retrieved 2026-11-01 14:44 (UTC+8)"), the project list, the journal and the task log. The journal and task log used to print UTC clock times without saying so. Export file names stay UTC but now end in `Z`; the old slice cut it off | Unit tests; on the server 17:16 UTC on 3 November gives 2026-11-04 locally. In the app: the Evidence card and project list. Source notes saved before the change keep their old date, because they are recorded provenance |
| **An applied card still said "nothing has changed yet"** | Once a card is applied or rejected, its summary drops the closing instruction ("Preview and apply…; nothing has changed yet.", "Apply to…; nothing has changed yet."). An undone card is open again and keeps it (`core/wording.ts`; chat cards and task results) | Unit tests; in the app the Italy card now ends with what it did, then "Applied (one step; Undo reverts it)" |
| **Bundle size** (the plan's bundle-size risk) | 1. GenOffice's editor text in 22 languages (1.6 MB) is replaced at build time by its English and Chinese tables (`src/platform/shims/genoffice-strings.ts`, redirected in `vite.config.ts`; the vendored files are unchanged). GenOffice's lookup already falls back to English. 2. The chat (assistant-ui and AG-UI) and the self-checks load on demand, after the deck. 3. The service gzips the app's static files (level 6; never the API or the chat stream) | Startup script **2.20 MB, down from 4.57 MB**; it travels as **680 KB** (was 4.4 MB uncompressed). The chat file (813 KB, 214 KB on the wire) arrives at about 0.65 s, after the deck. Fonts travel at about half size. The app mounts at 0.85 s (was 0.99 s). Most of the remaining startup is reading the deck and fonts, which the bundle doesn't change |

**Tests after the follow-up:** vitest 143 passed (5 skipped; new: local time and summary wording), pytest 254 passed, `tsc` 0 errors in our sources.
