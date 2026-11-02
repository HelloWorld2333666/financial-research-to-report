# Phase 3 · M2 Editing quality: results

**Branch:** `feature/workspace-v2`. Local commits only.
**Date:** 2026-11-02. Verified in the built-in Chromium at 1440×900 against the app served by `app/server/service.py`. "Real" means the browser tool's own mouse and keyboard; "scripted" is labelled where used.

## Delivered

| Area | What exists now |
|---|---|
| **Rich text** | GenOffice `TextEditOverlay` (vendored, unchanged) replaces M1's textarea. The caret lands where you click. Commits send `EditParagraph[]`, so runs keep bold, italic, underline, size and colour (`text.set` accepts paragraphs). A **B / I / U toolbar** appears while editing; it uses `mousedown`+`preventDefault`, so the editor keeps focus and the selection. Bullet-indent CSS is carried over from GenOffice's stylesheet (Apache-2.0, attributed) |
| **Fonts** (`core/fonts.ts`, `public/fonts`) | Inter 4.1 and Liberation Sans, four styles each, OFL-1.1 with licence files and provenance (`public/fonts/README.md`). Text is **measured** with opentype.js and **drawn** with the same files through `FontFace` |
| **Theme** | New decks get `applyTheme` from Design DNA: Inter for headings and body, accent1 navy, and the rest of the palette. The Design DNA default font is now Inter (decision D3) |
| **Table style** | Bound tables take the built-in `Light Style 2 - Accent 1` (theme navy). PowerPoint's default style is gone |
| **Number formatting** | Each dataset uses consistent decimals: as many as its source values carry, between 1 and 2. M1 showed "1.90 / 2.0 / 2.20" in one column |
| **Title fit** | Titles and bullets use `bodyPr autoFit: shrink`; the renderer applies the font scale |
| **Commands** | `elements.transform` (a multi-selection drag is **one** step), `elements.align` (left, centre, right, top, middle, bottom), `elements.distribute` (horizontal or vertical, at least 3 elements), `deck.reproject` (re-project every bound value from data) |
| **UI** | Align/distribute toolbar when 2 or more elements are selected. A "Re-project from data" button appears whenever integrity fails |

## Two problems found and fixed

1. **opentype.js can't measure Inter 4.1.** Its text shaping throws on Inter's GSUB (chained-context substitution, lookup type 6, format 2: "not yet supported"). The renderer then silently fell back to estimated widths, and words ran together ("France'sdebtratiorose"). `core/fonts.ts` now wraps each font and sums glyph advances directly, with no substitution, which our Latin text doesn't need. **Measured error against the browser's own drawing: 0.59% regular, 0.81% bold** (browser check). The browser also applies GPOS kerning, so we measure very slightly wide; lines break marginally early rather than overflow.
2. **Older decks show the old number format.** That's correct integrity behaviour, since text must equal data, not a bug. `deck.reproject` repairs a deck in one undoable, journalled step. Verified with a real click on the earlier test project: MISMATCH → OK.

## A decision to note

**Escape commits the text edit; it doesn't discard it.** That's GenOffice's deliberate PowerPoint behaviour ("Esc = commit the text and return to shape-selected state (input not lost)"). I kept it rather than patching it. Cancelling is **Cmd+Z**, which undoes the whole edit as one step (verified with real keys). This closes Phase 1's remaining defect 7 ("no cancel-edit shortcut") with the PowerPoint convention instead of a discard.

## Acceptance

| Criterion (PHASE3-PLAN M2) | Result |
|---|---|
| Rich text edit with real mouse (bold run, caret placement) | **Pass.** A real click put the caret where clicked (end of "111.4%"). A real double-click selected "rose" and real Cmd+B toggled it. A click outside committed **one** `text.set` step; the title is now three runs (bold, regular "rose", bold) and survived a reload |
| Resize and rotate | **Pass** with real handle drags in M1 and Experiment 1. The engine and canvas are unchanged in M2, so I didn't re-measure |
| Marquee | **Pass (real mouse).** A real drag across the bottom of the slide selected the source note. In Experiment 1 the tool's drag was too fast to register; it works now |
| Align | **Pass (real mouse).** Shift-click chart and bullets, then a real drag moved both as **one** step ("Move/resize 2 elements"). A real click on Align top set both tops to y = 179 in one step |
| Long titles shrink to fit | **Pass.** Unit test: a 183-character title gets `fontScale` < 1, more than one line, and content height ≤ frame height. Real browser: the same title typed with real keys shows as two lines inside its frame |
| France deck: no overlapping axis labels, no default table style | **Pass.** Table: theme-accent style, unit-tested. Axis labels: patch 0003 thins crowded labels (unit-tested in M1); the France charts' 4–6 year axes need no thinning and show none overlapping |
| Drag ≥ 50 fps with 30 elements | **Pass (scripted).** 30 elements on slide 1, a 60-frame drag: **59.9 fps**, p95 18.0 ms, max 21.2 ms, with the pane visible. A first attempt timed out while the page reported itself hidden, so animation frames were throttled; I re-ran it visible |
| Tests | **Vitest 23/23** (patches 6, store 9, M2 8). **Pytest 186** (including **22 headless browser checks**: Experiment 3's 16, M1's 4, and M2's `fonts_measure_like_the_browser_draws` and `rich_runs_and_combined_move`). Licence report **207/207** (now including the fonts). `tsc`: 0 errors in our sources |

## Size

The app bundle is 3.5 MB minified, **1.05 MB gzip** (M1: about 1.0 MB). The fonts add 3.2 MB as files: eight TTFs at about 410 KB each, loaded on project open. Converting to WOFF2 for drawing would shrink them, but opentype.js can't read WOFF2. Left as a later optimisation.

## Known limitations

- **Selecting a word with a double-click inside the editor works.** The very first double-click on unselected text opens the editor on the first click, as in PowerPoint. That's expected; it doesn't select a word.
- **Table cells keep M1's numeric input** for bound values. GenOffice's overlay is used for text boxes. Rich text in table cells isn't needed for data cells; label cells are generated.
- **Kerning:** measurement ignores GPOS kerning, so lines are measured up to about 1% wide (safe direction).
- **A group's frame still covers its bounding box** (from M1).

## Next: M3 (Evidence Core integration)

- Schema extensions: API provenance, derivations, claim bindings, working-layer records.
- Server endpoints for working-data patches, integrity on save, and the export policy.
- Data workspace grid and evidence inspector.
