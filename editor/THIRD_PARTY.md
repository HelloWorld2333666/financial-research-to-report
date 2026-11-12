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

## Workspace prototype libraries (`editor/static/workspace/vendor/`)

| Library | Version | License | File | SHA-256 |
|---|---|---|---|---|
| Preact (+ hooks) | 10.29.8 | MIT | `preact.module.js`, `hooks.module.js` | `c30e721ebfdc6e2ad4c18c14d2dfb82667829c8aec27de1207774e3fc16858a8`, `a6ee626f2d01570592dd569a792e3f050154aa02890eead8c223fa3ed5aa3d5a` |
| htm | 3.1.1 | Apache-2.0 | `htm.module.js` | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |
| Immer | 11.1.21 | MIT | `immer.production.mjs` | `25b6f977bce9f776b18fa555a1e4fb5b9589f1ea0de06c45d63efed2875394d2` |
| Apache ECharts | 6.1.0 | Apache-2.0 | `echarts.min.js` | `b66b25aeb4df84e33199dc21694014d336d222cbd9deb0e5a7c14bd6aa0d0fd0` |

These are unmodified ESM/UMD builds from the npm registry tarballs, downloaded on 2026-11-01. License and NOTICE files are in `workspace/vendor/licenses/`. The prototype also uses the Moveable build listed above.

## Benchmark-only libraries (`editor/static/bench/vendor/`, not used by the editor)

| Library | Version | License | File | SHA-256 |
|---|---|---|---|---|
| Apache ECharts | 6.1.0 | Apache-2.0 (LICENSE and NOTICE in `bench/vendor/licenses/`) | `echarts.min.js` | `b66b25aeb4df84e33199dc21694014d336d222cbd9deb0e5a7c14bd6aa0d0fd0` |
| Konva | 10.8.0 | MIT | `konva.min.js` | `dc77264b77311f161cc459656b7f4e70f2f787164f0449cdb162638c524f7b9d` |

These are unmodified builds from the npm registry tarballs, downloaded on 2026-11-01, and used only by the rendering benchmark (`docs/workspace-study/07-benchmark.md`).

## Design patterns studied (no code copied)

| Project | License | What informed this spike |
|---|---|---|
| [Syndicats/estradeck](https://github.com/Syndicats/estradeck) | MIT | **Magic Frame** (`client/src/lib/regionPick.ts`): a region in 1280×720 slide space, the elements intersecting it, and that context sent with the prompt. Re-implemented in Python (`slidemodel.scope_of`) on our JSON model, not on DOM markup. Its agent runner uses `claude -p --permission-mode bypassPermissions`; we deliberately did **not** adopt that. |
| [open-slide/open-slide](https://github.com/open-slide/open-slide) | MIT | Comment mode (click or drag a region, then attach a note) and the "apply comments" loop with a coding agent (`src/editing/comments.ts`, `src/agent/`). It uses the Claude Agent SDK with a permission callback limited to writable roots. We kept the idea of a request file plus a constrained agent, but our agent returns a patch instead of editing files. |
| [archlizheng/frontend-slides-editable](https://github.com/archlizheng/frontend-slides-editable) | MIT | A lightweight editable DOM slide with drag, resize, contentEditable text, undo, save and clean export. It is hand-rolled pointer code in a 3,600-line single HTML file. We used Moveable instead of re-writing gesture code. |
| [presenton/presenton](https://github.com/presenton/presenton) | Apache-2.0 | **Editor interface reference.** Studied `components/slide-editor/` (its README; `selection/SelectionToolbar.tsx`, `MultiSelectionToolbar.tsx`, `toolbarPosition.ts`), `presentation/components/PresentationHeader.tsx` and `InsertPalettePreview.tsx`. Patterns adopted and re-implemented in vanilla JS:<br>• 1280×720 editor units<br>• a toolbar anchored to the selection that flips below when there is no room and stays clamped to the viewport<br>• a compact multi-selection toolbar (align and group)<br>• an insert palette (text, chart, table)<br>• a slim header with undo/redo and export<br>• a single commit path into undo history<br>**No Presenton code was copied.** Its editor (about 48k lines of React, Konva, Redux and TipTap, inside a Next.js/FastAPI app) is too coupled to reuse, and we don't need its templates, themes, fonts, assets or generation features. |
| [pipipi-pikachu/PPTist](https://github.com/pipipi-pikachu/PPTist) | **AGPL-3.0** | The closest feature match (DOM elements, JSON slide model, html-to-image export). **Not read for implementation and no code copied**, to keep this private repository clear of AGPL obligations. |
