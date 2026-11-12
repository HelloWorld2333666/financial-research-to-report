# Design library tooling

Builds a searchable catalog of slide layouts from **private** reference decks (purchased consulting and financial
templates). This folder holds only the tooling. The decks, the extraction cache, the renders and the catalog live
**outside the repository** in a private library folder, for example `../frr-design-library/`, named by the
`FRR_DESIGN_LIBRARY` environment variable.

## Private library layout

```
<lib>/manifest.tsv            <sha256>\t<original file name>; the decks in the library
<lib>/sources/<sha256>.pptx   the decks, by content hash; duplicates collapse
<lib>/cache/<sha256>.json     extraction (extract.py), versioned by EXTRACTOR_VERSION
<lib>/renders/sheets/         contact sheets (PNG), with per-slide pixel statistics (*-stats.json)
<lib>/catalog/slides.jsonl    per-slide features (features.py)
<lib>/catalog/tagged.jsonl    per-slide tags on five dimensions (classify.py)
<lib>/catalog/layouts.jsonl   layout clusters, with inferred slots (classify.py)
<lib>/catalog/index.tsv       the compact runtime index: one line per layout, no slide text
```

## Pipeline

All steps are deterministic, run once per deck, and are skipped when nothing has changed:

1. **Add decks:** `cp deck.pptx <lib>/sources/$(shasum -a 256 deck.pptx | cut -c1-64).pptx`, then add the hash and name to `manifest.tsv`.
2. **Extract:** `python -m design_library.extract --out <lib>/cache <lib>/sources/*.pptx`
   - Standard library only; about 0.2 s per deck.
   - Cached by content hash and extractor version.
3. **Features:** `python -m design_library.features --cache <lib>/cache --manifest <lib>/manifest.tsv --out <lib>/catalog`
4. **Render:**
   - Start the app server with `FRR_DESIGN_LIBRARY=<lib>` (it serves `/api/design-library/deck/<sha>` only then).
   - Run `python render_slides.py --base http://127.0.0.1:<port> --out <lib>/renders/sheets sheet:<sha>:1:24 stats:<sha>:1:24`.
   - It draws through the app's own renderer, so a sheet also shows how faithfully our editor reproduces the deck.
5. **Classify:** `python -m design_library.classify --lib <lib>`
   - Incremental: existing layouts keep their ids and members, new slides join them or found new ones.
6. **Retrieve:**
   - `python -m design_library.retrieve --lib <lib> search '<request json>'` returns a shortlist of 3;
   - `python -m design_library.retrieve --lib <lib> load <id>` returns one layout in detail.
   - `python -m design_library.retrieve suggest '<request json>'` returns the recipes that fit (from `app/web/src/core/design/recipes.json`), plus references when a library is configured. The Skill (`.claude/skills/financial-slide-design/`) and the app agent's `find_layout_references` both use it.

## What may enter the public repository

| May be committed | Stays private (outside the repository) |
|---|---|
| This tooling and its tests | The decks, their media, fonts and logos |
| The catalog **schema** and taxonomy | Contact sheets, renders and screenshots of the decks |
| Generic design rules written in our own words (e.g. "action title of 12–16 words; source line at 8 pt; at most one accent colour per chart") | Slide text, titles and figures extracted from the decks |
| Layout recipes we author ourselves, inspired by recurring patterns, without copying any deck's text, artwork, brand marks or exact composition | Per-deck catalog records: `slides.jsonl`, `tagged.jsonl`, `layouts.jsonl`, `index.tsv` (they carry titles, file names and publisher names) |
| Aggregate statistics with no content (counts, type-size distributions) | Anything identifying a publisher's proprietary template |

Nothing in this pipeline sends deck content to an external service.
