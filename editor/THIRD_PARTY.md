# Third-party code and design references

## Vendored code (shipped in `editor/static/vendor/`)

| Library | Version | License | Source | File | SHA-256 |
|---|---|---|---|---|---|
| Moveable | 0.53.0 | MIT, © 2019 Daybrush | npm `moveable` (github.com/daybrush/moveable) | `moveable.min.js` | `6c6c78751303afd6212398c148dd767d83f1d6bc1858569c140a8f0dafe22f41` |
| Selecto | 1.26.3 | MIT, © 2020 Daybrush | npm `selecto` (github.com/daybrush/selecto) | `selecto.min.js` | `2ec017a727576abb0660ef0fbde29fa7b194bdbfe172406b4069b93e0fade45f` |
| html-to-image | 1.11.13 | MIT, © 2017-2025 W.Y. | npm `html-to-image` (github.com/bubkoo/html-to-image) | `html-to-image.js` | `a90b42909d80964269ef6d5f3d1e4a5a7e2a4c263a5d2a76a9e7151901343262` |

- The files are the unmodified UMD builds from the npm registry tarballs, downloaded on 2026-10-27.
- The full license texts are in `editor/static/vendor/licenses/`.
- Moveable and Selecto were last pushed in mid-2024, so they are stable but not actively developed.

## Design patterns studied (no code copied)

| Project | License | What informed this spike |
|---|---|---|
| [Syndicats/estradeck](https://github.com/Syndicats/estradeck) | MIT | **Magic Frame** (`client/src/lib/regionPick.ts`): a region in 1280×720 slide space, the elements intersecting it, and that context sent with the prompt. Re-implemented in Python (`slidemodel.scope_of`) on our JSON model, not on DOM markup. Its agent runner uses `claude -p --permission-mode bypassPermissions`; we deliberately did **not** adopt that. |
| [open-slide/open-slide](https://github.com/open-slide/open-slide) | MIT | Comment mode (click or drag a region, then attach a note) and the "apply comments" loop with a coding agent (`src/editing/comments.ts`, `src/agent/`). It uses the Claude Agent SDK with a permission callback limited to writable roots. We kept the idea of a request file plus a constrained agent, but our agent returns a patch instead of editing files. |
| [archlizheng/frontend-slides-editable](https://github.com/archlizheng/frontend-slides-editable) | MIT | A lightweight editable DOM slide with drag, resize, contentEditable text, undo, save and clean export. It is hand-rolled pointer code in a 3,600-line single HTML file. We used Moveable instead of re-writing gesture code. |
| [presenton/presenton](https://github.com/presenton/presenton) | Apache-2.0 | **Editor interface reference.** Studied `components/slide-editor/` (its README; `selection/SelectionToolbar.tsx`, `MultiSelectionToolbar.tsx`, `toolbarPosition.ts`), `presentation/components/PresentationHeader.tsx` and `InsertPalettePreview.tsx`. Patterns adopted and re-implemented in vanilla JS:<br>• 1280×720 editor units<br>• a toolbar anchored to the selection that flips below when there is no room and stays clamped to the viewport<br>• a compact multi-selection toolbar (align and group)<br>• an insert palette (text, chart, table)<br>• a slim header with undo/redo and export<br>• a single commit path into undo history<br>**No Presenton code was copied.** Its editor (about 48k lines of React, Konva, Redux and TipTap, inside a Next.js/FastAPI app) is too coupled to reuse, and we don't need its templates, themes, fonts, assets or generation features. |
| [pipipi-pikachu/PPTist](https://github.com/pipipi-pikachu/PPTist) | **AGPL-3.0** | The closest feature match (DOM elements, JSON slide model, html-to-image export). **Not read for implementation and no code copied**, to keep this private repository clear of AGPL obligations. |
