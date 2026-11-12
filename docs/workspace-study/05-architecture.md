# D. Architecture recommendation

## 1. Options compared

| | Option 1: Extend the current editor | Option 2: Integrate a mature editor SDK | **Option 3: Selective migration (recommended)** |
|---|---|---|---|
| What it means | Keep vanilla JS, keep growing `editor.js` | Rebuild on Polotno, tldraw, Konva/Fabric or a Presenton fork | Keep the Python authority layer, DOM rendering and Moveable/Selecto. Move the frontend shell to React + TypeScript with a normalised store and patch-based history, one module at a time |
| Time to first new capability | Fastest for the next 2–3 features | Slow (adapting the data model), then fast for generic editing | Medium. About 2–3 weeks for the shell and store before new features |
| Long-term maintainability | Poor: the 929-line closure, global `S`, full `innerHTML` re-render (03-audit) | Depends on the vendor. Commercial SDKs bring license cost and lock-in; frameworks still need the editor built | Good: components, typed model, tests at both layers |
| Fit with financial data and provenance | Good (it's ours) | **Weak.** No SDK models evidence, datasets or verification; every exhibit becomes a custom element anyway | Good (model preserved and extended) |
| Performance | Measured problem: whole-deck re-render on every edit | Konva/Polotno are canvas-based; our benchmark found DOM faster at our scale. Text, tables and export must be re-solved | DOM rendering kept (measured adequate); fix the re-render architecture |
| Licensing | Clean | Polotno: paid for commercial use. tldraw: paid for production. PPTist: AGPL (excluded). Konva, Fabric, Presenton: permissive | Clean (MIT/Apache stack) |
| Export | DOM → PNG works | Canvas → PNG easy; PPTX and PDF need a second model | DOM → PNG/PDF (same render); ChartSpec → native PPTX |
| Main risk | Rewrite pressure later, at higher cost | Vendor dependence; mismatch with evidence binding; dual rendering paths (Presenton already has one) | Migration discipline: the two frontends must not run in parallel for long |

**Recommendation: Option 3.** No SDK gives us the part that's hard and valuable: evidence binding, integrity, research and transfer contracts. Our benchmark shows the canvas rewrite those SDKs imply buys no performance at this scale. The current frontend's structure is the real limit, so replace the shell, not the foundations.

## 2. Target architecture

```
                         ┌──────────────── Browser (React + TypeScript, Vite) ───────────────┐
 user ── pointer/keys ──▶│ Interaction adapter (Moveable/Selecto)   Rich text (TipTap)       │
                         │        │ intents                            │                     │
                         │        ▼                                    ▼                     │
                         │  Command layer ── produces Immer patches ──▶ Project store        │
                         │        ▲                     (normalised: slides, elements,       │
                         │        │ proposals (patches)  datasets, charts, threads, tasks)    │
                         │  AI panel / Data panel / Design panel ◀── selectors ──┘           │
                         │        │                                                          │
                         │  Renderers: SlideView (DOM, memo per element) · ChartView         │
                         │  (ChartSpec → ECharts SVG, cached) · Thumbnail cache (per slide rev)│
                         └────────┼──────────────────────────────────────────────────────────┘
                                  │ patches + base revision (not whole projects)
                         ┌────────▼────────────── Python authority service ──────────────────┐
                         │ validate_patch (scope, evidence, numbers) · integrity · research   │
                         │ & transfer contracts · dataset/revision store · versions/autosave  │
                         │ export jobs (Chromium PDF/PNG, PptxGenJS via Node worker)          │
                         │ AI orchestration (later): builds context packs, returns proposals  │
                         └────────────────────────────────────────────────────────────────────┘
```

### Principles

1. **One change format.** Every edit is a patch with a base revision: drag, AI proposal, research insertion or transfer. Undo is the inverse patches. A proposal is a pending patch set with a scope. Validation runs the same rules on a user edit as on an AI edit, with stricter rules for AI.
2. **Data is authoritative; visuals are derived.** Elements reference `evidence_id`, `dataset_id` and `chart_id`. Renderers compute what you see, and AI can change only the visual fields of a ChartSpec.
3. **Per-slide isolation.** Slides, threads, versions and tasks are keyed by slide. Rendering subscribes per slide. Thumbnails re-render only when their slide's revision changes.
4. **The server stays the authority for safety**; the client stays the authority for interaction. The client validates optimistically, and the server re-validates before persisting or applying AI proposals.

## 3. Data model extensions (on top of `frr-slide/0.2`)

```jsonc
{
  "datasets": {                         // time series and tables, shared by every slide
    "ds.fr.debt_gdp": {
      "title": "General government gross debt, France", "unit": "% of GDP",
      "frequency": "annual",            // annual | quarterly | monthly | daily | point
      "observation_type": "end_of_period", // annual_average | end_of_period | point_in_time
      "definition": "…", "source_ids": ["src.…"], "verification": "verified",
      "observations": [ {"date": "2002", "value": 60.3, "evidence_id": "ev.…", "status": "verified"},
                        {"date": "2005", "value": null, "status": "missing"} ],   // null = gap, never interpolated
      "revisions": [ {"date": "2024", "value": 113.1, "by": "user:…", "at": "…",
                      "reason": "…", "status": "pending_verification", "supersedes": "ev.…"} ] // layered, not overwriting
    }
  },
  "charts": {                           // ChartSpec: references, never values
    "ch.debt3": {"type": "line", "series": [{"dataset": "ds.fr.debt_gdp", "label": "France", "style_role": "series.1"}, …],
                 "x": {"from": "2002", "to": "2026"}, "y": {"unit": "% of GDP", "zero": false},
                 "annotations": [ … ], "missing": "gap", "sampling": null,
                 "notes": "auto: source line + method notes", "style": {"token_set": "dna.default"}}
  },
  "elements": [ {"id": "el.chart1", "type": "chart", "chart_id": "ch.debt3", "slide_id": "s2", "x": …, "rotation": 0,
                 "locked": false, "name": "Debt/GDP chart", "style_ref": "exhibit"} ],
  "design_dna": { "type": {"title": {"font": "…", "size": 22, "weight": 700}, …},
                  "palette": {"ink": "#0f2742", "accent": "#c8102e", "series": ["…"]},
                  "chart": {"gridlines": "y-only", "line_width": 1.6, "labels": "end-of-line"},
                  "spacing": {"grid": 8, "margin": 32}, "footnote": {"source_prefix": "Source:", "size": 8.5} },
  "threads": { "deck": {"messages": […]}, "s2": {"messages": […]} },
  "proposals": [ {"id": "pr.…", "thread": "s2", "scope": {"kind": "selection", "ids": ["el.chart1"]},
                  "base_rev": 41, "patches": […], "summary": "Enlarge chart; narrow table",
                  "invariants": {"evidence_ids_unchanged": true, "numbers_unchanged": true},
                  "status": "pending"} ],        // pending | applied | rejected | stale
  "tasks": [ {"id": "tk.…", "slide_id": "s1", "kind": "research", "status": "running",
              "scope": {"datasets": ["ds.fr.cds_5y"]}, "result": {"proposal": "pr.…"}} ],
  "versions": { "s2": [ {"rev": 40, "at": "…", "label": "before AI layout"} ] }
}
```

## 4. Deterministic chart pipeline

`datasets` → (select series, align dates and frequency, mark gaps) → **ChartSpec** → compiler →

- **ECharts SVG** in the editor (`animation:false`, pinned version, cached by `hash(spec, data rev, size)`)
- **PptxGenJS native chart** for editable PPTX export
- *(optional)* **Matplotlib** for print-grade PNG/PDF and as a parity test

Guards:
- **Compatibility check before charting:** same unit (or an explicit dual axis); same frequency, or an explicit, labelled aggregation method; observation types must not be silently mixed.
- **Missing observations render as gaps** and are listed in the chart notes. Interpolation is allowed only through an explicit `method` field, which is printed in the notes.
- **Point-in-time snapshots carry their dates**; the date shows in the label or note.
- **AI can edit only these ChartSpec paths:** `type` (within compatible types), `style.*`, `annotations[].text` (number-checked like any text), axis formatting, the element's size and position. `series[].dataset`, `x.from/to` and anything that changes plotted values need explicit user confirmation through the Data panel.
- **Parity test in CI:** for every chart, the plotted points equal the dataset's non-null observations in range.

**AI-generated imagery** (backgrounds, illustrations) lives in `image` elements with `origin: "generated"`. They can never be bound to evidence, and integrity flags any number recognised in them (OCR check, later). Screenshot reconstruction is a P3 research item: OCR → structure → **re-bind numbers to evidence or flag them as unsourced**, never paste them as truth.

## 5. AI context packs and scope

For each AI request the client builds a **context pack** and the server validates it:
- the active slide (element outline, the full content of selected elements)
- selection chips, plus linked evidence and dataset metadata (not entire datasets unless needed)
- recent patches on this slide (the last N), the slide's thread summary, and the deck brief (storyline plus DNA)

The response must be **proposals only**. The server rejects any patch outside the declared scope. That is the existing `validate_patch` rule, generalised from regions to scopes. A proposal whose `base_rev` is older than the current revision of an affected object becomes **stale** and must be regenerated or re-checked. This handles concurrent tasks and user edits without silent overwrites.

## 6. Performance design and budgets

| Concern | Design | Budget (to verify with `editor/static/bench`) |
|---|---|---|
| Drag / resize | Transform via the adapter; commit on end only; no store writes per frame | Move handler < 4 ms; 60 fps with 400 objects |
| Edit commit | Patch apply plus per-element memoised render; no whole-deck render | < 4 ms at 30 slides |
| Thumbnails | Cache per slide revision; re-render debounced (300 ms idle) and lazily for off-screen slides | No effect on the interaction frame |
| Charts | Cache by spec hash; LTTB above 2,000 points per series, noted | Mount < 10 ms per chart |
| Chat | Virtualised transcript; streaming appends to one message node | 1,000 messages scroll at 60 fps |
| Tasks | Store records; per-slide subscriptions; batched status updates (≤ 4 per second) | No commit-path cost |
| Autosave | Debounced patch log per slide (2 s idle) plus periodic snapshot; server re-validates | Save request < 50 ms local |
| Export | Background task; server Chromium for PDF; PptxGenJS worker | No UI freeze; progress shown |

## 7. Migration plan and risks

**Order of migration** (each step shippable, with the old editor kept until parity):

1. Set up Vite + React + TypeScript, and a shared TS model generated from Python schemas, so `bound_evidence_ids` and friends don't drift.
2. Build the store with Immer patches; port render functions to components (`SlideView`, element components); thumbnail cache.
3. Port the interaction adapter (Moveable/Selecto via their React wrappers, or a thin custom wrapper) and the inspector.
4. Add the new capabilities, in order: Context panel modes → chat and proposals (simulated AI) → Data panel with datasets → ChartSpec/ECharts → Design DNA.

**Risks**

| Risk | Mitigation |
|---|---|
| Two editors in parallel too long | Time-box parity (target 4 weeks) and freeze features in the old editor |
| Node toolchain added to a Python-only repo; there's **no Node on this machine today** | Keep the server in Python; build static assets in CI; keep the toolchain documented and minimal |
| Moveable/Selecto unmaintained | The adapter boundary allows replacement with custom handles later |
| ECharts output differs by version and font | Pin versions, bundle fonts, snapshot-test chart SVG |
| TipTap content vs. evidence binding | Model evidence spans as marks validated by the existing number check |
| Scope creep toward a full PowerPoint clone | The roadmap tiers features (06), each with acceptance criteria |
