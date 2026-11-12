# VIS V4 Evaluation: maps, Sankey and network diagrams (intent H)

**Status:** evaluation and recommendation for your decision. Nothing in this note is built yet.
**Date:** 2026-11-03. Context: `VIS-01-…ARCHITECTURE.md` §3 row H ("separate diagram model; evaluate later") and §5 (adapters: native, composite shapes, picture as a last resort).

## The question

Spatial, flow and network visuals are not statistical charts of a series. They need a **diagram model**: geography codes, flows (source → target → value) or a graph. Evidence binds to regions, flows or edges rather than to points on an axis. Each also needs a decision on how it is drawn:

- with the **composite adapter** (V3: editable shapes, rebuilt from data, integrity on every mark);
- or with a **picture adapter** (a chart library renders SVG or PNG: low editability, harder integrity);
- or not at all.

## Options

| Visual | Typical question here | Data we have or can get | Drawing | Licensing | Assessment |
|---|---|---|---|---|---|
| **Tile map** (one equal square per country, arranged roughly geographically) | Where are the EU's largest deficits? | Any per-country dataset already in the project (e.g. the EU-27 balances fetched in V4) | **Composite**: rectangles + text; a fixed 27-tile layout written by us | None (no boundary data) | **Recommended.** Equal tiles avoid the area bias of real maps, where large countries dominate. It fits the composite adapter as is, with integrity per tile and the same colour scale rules as the heatmap |
| **Choropleth** (real country shapes) | Same, with true geography | Same data; **boundaries** needed | Composite with custom-geometry paths (heavy: hundreds of points per country) or picture | Eurostat GISCO boundaries: **non-commercial only**, copyright notice required, commercial use needs a EuroGeographics licence. Natural Earth: public domain | **Not recommended for slides.** Area bias, heavy geometry, and GISCO's commercial restriction. If needed later, use generalised Natural Earth shapes (public domain) as editable paths |
| **Sankey** (flows between nodes) | Who holds French government debt? Where does revenue go? | Not yet: needs flow tables (e.g. Eurostat financial accounts, debt by holder sector; budget revenue → expenditure) | **Composite**: rectangles for nodes, cubic-Bézier bands (custom geometry, which the engine already supports) | Our own drawing; if a layout library is wanted, d3-sankey is BSD-3-Clause | **Possible, with a new data model and its own constraints:** flows conserve at each node; one unit; no negative flows; small flows grouped and stated. First use case to be chosen by you |
| **Network / ownership diagram** | Group structure of an issuer; counterparties | Not in Eurostat. GLEIF relationship records (parent/child of legal entities) are open (CC0) | Composite boxes + connectors; layout by a layered algorithm (dagre: MIT) | Avoid Graphviz (EPL) and ELK (EPL-2.0) unless a licensing review accepts them | **Defer.** No current use case in the sovereign-credit workflow; revisit for corporate credit |
| **Picture adapter** (any of the above rendered by a chart library) | — | — | SVG/PNG image | Depends on library (ECharts: Apache-2.0; Vega-Lite: BSD-3-Clause) | **Not recommended.** It breaks the V3 guarantees: shapes aren't editable, integrity can only check the image's metadata, and it isn't rebuilt from data |

## Recommendation

1. **Build a tile map next** (small, about 1 day). It's a composite family over a per-country cross-section (`at`), with a fixed EU-27 tile layout. Its rules: one value per country, missing values shown as hatched "n/a" tiles, never zero, and a diverging scale for signed measures.
2. **Sankey only with a named use case and a flow data model** (about 2–3 days). It needs `view.transform: 'flows'` over a flow dataset, with conservation checked as a hard rule (invalid when inflows ≠ outflows at a node beyond rounding).
3. **No choropleth, no picture adapter, no network diagrams for now.**

## Decisions for you

- **D-H1:** build the EU tile map as a composite (recommended).
- **D-H2:** pick a first Sankey use case (debt by holder sector, or budget flows), or defer Sankey.
- **D-H3:** confirm that real-geography maps and the picture adapter stay out of scope. If a real map is required later: Natural Earth (public domain), not GISCO (non-commercial).

## Sources

- [Eurostat GISCO: administrative units](https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units): non-commercial use, required copyright notice "© EuroGeographics for the administrative boundaries", EuroGeographics licence for commercial use.
- Natural Earth terms of use (public domain), d3-sankey (BSD-3-Clause), dagre (MIT), ECharts (Apache-2.0), Vega-Lite (BSD-3-Clause), Graphviz (EPL), ELK (EPL-2.0): as stated in each project's licence file; to be re-checked in the licensing review before any of them is vendored.
