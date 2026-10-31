# Performance benchmark (measured)

## How to reproduce

```bash
python3 editor/server.py
```

- **Rendering suites:** open http://127.0.0.1:8765/bench/index.html and click **Run all suites**. In the console, `await __bench.run()` returns JSON.
- **Current editor:** open http://127.0.0.1:8765/?project=china_re_deck, then in the console run `await (await import('/bench/editor-bench.js')).run()`. It duplicates slides in memory only and restores the project afterwards.

Source: `editor/static/bench/{bench.js, editor-bench.js, svgchart.js}`. ECharts 6.1.0 and Konva 10.8.0 are vendored **for the benchmark only**, with licences in `bench/vendor/licenses/`.

**The France / Germany / Italy series are SYNTHETIC** (seeded random walks): an annual debt/GDP-shaped dataset (3 × 25, with one missing observation) and a daily 10Y-yield-shaped dataset (3 × 6,391 business days, 2002–2026). They test rendering cost only.

## Environment (measured 2026-11-01)

- Claude desktop built-in browser (Chromium 152), macOS, 1024×768 viewport, DPR 2.
- Tab visible: the pane was shown while measuring; hidden tabs throttle animation frames.
- `performance.now()` resolution is about 0.1 ms without cross-origin isolation, so values under 0.3 ms are at noise level.
- Numbers are medians: 7 runs per chart case, 9 per table and editor case, 5 per scene case. Each suite was repeated 3 times; the ranges below cover those 3 repetitions.
- **One machine, one browser.** Re-run on target hardware before treating these as budgets.

## Results

### Current editor (China Re deck; slides duplicated to 10 and 30)

| Deck | Elements | Full `render()` | Commit (nudge → snapshot → full re-render) | Notes |
|---|---|---|---|---|
| 3 slides | 29 | 2.2–2.8 ms | 2.9–3.4 ms | Drag move handler: median 1.6 ms, max 2.7–4 ms. Drag end commit 1.5–2.3 ms |
| 10 slides | 204 | 7.6–8.1 ms | 6.5–7.5 ms | — |
| 30 slides | 704 | 18.4–18.8 ms | **19.3–20.0 ms** | **Exceeds the 16.7 ms frame budget.** Cost is dominated by re-rendering every thumbnail (3,978 thumbnail DOM nodes) |

- **PNG export** (html-to-image, 2560×1440): 75–106 ms.
- **JS heap** (`performance.memory`): 19–54 MB across runs. GC timing makes this noisy, so it isn't usable as a comparison.

### Charts (760×380 box, then resized to 560×300)

| Dataset | Renderer | Mount | Resize / re-render |
|---|---|---|---|
| annual 3×25 | hand SVG | 0.4–0.8 ms | 0.2–0.5 ms |
| annual 3×25 | ECharts SVG | 1.4–2.6 ms | 0.5–1.2 ms |
| annual 3×25 | ECharts canvas | 1.6–2.1 ms | 0.7–1.3 ms |
| daily 3×6,391 | hand SVG (all 19,173 points) | 3.1–4.2 ms | 2.9–4.1 ms |
| daily 3×6,391 | ECharts SVG | 6.8–8.5 ms | 0.9–1.1 ms* |
| daily 3×6,391 | ECharts SVG + LTTB | 5.1–5.5 ms | 0.7–0.9 ms* |
| daily 3×6,391 | ECharts canvas | 5.8–6.4 ms | 1.3–1.5 ms* |
| daily 3×6,391 | ECharts canvas + LTTB | 4.9–5.3 ms | 0.9–1.1 ms* |

\* ECharts may defer part of its painting after `resize()`, so treat these as lower bounds.

The hand SVG renderer plotted exactly 74 annual points (75 minus the one missing observation, which breaks the line) and all 19,173 daily points, with no interpolation.

### Dense table (DOM, 60 rows × 8 columns, including forced layout)

1.3–2.1 ms.

### Scene: DOM vs Konva (N objects of rectangle + text on a 1280×720 slide)

| Objects | Engine | Mount | Move one object (synchronous)† |
|---|---|---|---|
| 25 | DOM | 0.2–0.3 ms | ≈0 ms |
| 25 | Konva | 1.4–1.6 ms | 0.1–0.2 ms |
| 400 | DOM | 0.9–1.5 ms | 0.1–0.2 ms |
| 400 | Konva | 7.8–8.5 ms | 1.7 ms |

† DOM: style write plus forced layout, without paint. Konva: `layer.draw()` including rasterisation.

To include paint, the frame-interval test moved one object every frame for 120 frames with 400 objects:

| Engine | Frame interval, median | p95 |
|---|---|---|
| DOM | 16.7 ms | 16.8–17.4 ms |
| Konva | 16.7 ms | 16.8 ms |

Both held 60 fps.

## What the measurements show

1. **DOM rendering isn't our bottleneck at realistic slide complexity.** It was faster than Konva for mounting and moving, and both held 60 fps with 400 objects. There's **no measured performance case** for moving to canvas.
2. **The bottleneck is architectural:** every edit re-renders the whole deck (stage, all thumbnails, side panel). Cost grows linearly with slide count and crosses the frame budget at about 30 slides. Fixes:
   - re-render only the active slide's changed elements
   - cache each thumbnail by slide revision and re-render it only when that slide changes, debounced and off the interaction path
   - lazily mount off-screen thumbnails
3. **Charts are cheap**, even at 19k points (≤8.5 ms to mount). Cost only matters when many charts re-render together, such as during a deck restyle. So: cache rendered charts by `(chartSpec hash, data revision, size)`, and use LTTB only above a threshold, with a visible note.
4. **Export is about 100 ms per slide** in the browser. A 30-slide deck is about 3 s, so it belongs in a background task with progress, or in server-side Chromium.

## Not measured yet (planned)

- Rich-text editing latency (TipTap) and font-loading effects on first paint.
- Chat transcripts with more than 500 messages (virtualised list vs. naive).
- Concurrent task-status updates (expect a store-subscription problem rather than a rendering one).
- Autosave cost with patch-based persistence.
- A real-mouse drag on a low-end laptop.

The proposed acceptance budgets for the future workspace are in 05-architecture.md §6.
