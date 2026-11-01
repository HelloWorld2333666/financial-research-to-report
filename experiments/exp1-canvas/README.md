# Experiment 1: GenOffice canvas behind our Evidence Core

This is a throwaway harness. It loads GenOffice's `pptx-engine`, `pptx-ops`, `pptx-render`, `SlideCanvas` and `konva-adapter` (Apache-2.0, commit in `GENOFFICE_COMMIT`) into a plain browser page. It builds our France slide from `editor/projects/workspace_demo.json` through `pptx-ops` only, and keeps evidence bindings in a sidecar keyed by GenOffice durable element ids. Results are in `docs/workspace-prototype/PHASE2C-EXPERIMENTS.md`.

The GenOffice source and `node_modules` are not committed. To reproduce:

1. Download the GenOffice tarball at the pinned commit into `../src-genoffice` (relative to the harness folder), and apply `genoffice-gap-patch.diff`. The patch makes line charts break at missing values, as the chart's own `dispBlanksAs="gap"` asks.
2. Copy `editor/static/workspace/model.js` to `src/ws/model.js`, and `editor/projects/workspace_demo.json` to `public/project.json`.
3. Optional: copy `LiberationSans-{Regular,Bold}.ttf` (SIL OFL 1.1) from GenOffice's `apps/docs/src/renderer/fonts` to `public/fonts`, then open the page with `?fonts=1`.
4. Run `npm install --ignore-scripts` (Node 22), then `npx vite --port 5181`.

The browser shims are small: `buffer` for Node's `Buffer`, `src/shims/crypto.ts` for sha256 and `randomUUID`, and `src/shims/zlib.ts` (fflate) for `deflateSync`.
