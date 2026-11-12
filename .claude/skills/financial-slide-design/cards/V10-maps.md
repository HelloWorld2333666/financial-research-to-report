---
id: V10
type: family
layer: L2
name: Maps
aliases: [T22, T23, T24, T25, CH11]
refs: [u13, u03, u10, "lib:3ba4dd80ba:9 (low resolution)"]
---

**Purpose:** geographic pattern, when **where** is part of the argument.

**Applies when:** geo-coded values, and location matters: regional clusters, contagion, exposure by region; **or the mechanism is geographic**: shipping routes, chokepoints, pipelines, transit income.

**Not when:** the message is a trend (V07) or a ranking (V05) that merely involves countries.

**Hard constraints:**
- Selected only when location matters.
- Symbol **area** encodes value.
- Fill classes have a stepped, explained legend.

**Encodings:**
- **T22 choropleth (fill):** rates and intensities.
- **T23 proportional symbols:** counts and amounts. "Now (then)" labels (M5) compress two periods.

**Modifiers:**
- **T24:** callout boxes with leaders and trend icons.
- **T25:** category tags on regions.

**Roles:** main exhibit; full-bleed statement (P6); one module of a zoom chain (P3).

**Combines with:**
- V05 ranking beside it (place plus order);
- M4 callouts;
- S1 flags;
- P5 / T59 title placed in the map's empty space;
- C1 caveat tag ("Not exhaustive").

**Risks:**
- **Works when** place and number are read together.
- **Fails when** chosen for looks; small countries vanish; large areas dominate by size rather than value.

**Execution:**
- Muted base geography; data in the palette ramp (R2).
- Callouts as flat fields without outlines, with thin leaders (R3, R5).

**How to plan one** (map object, `assets.ts` MapSpec):
- `view` [west, south, east, north]: frame the mechanism with a little sea around it; the map covers its slot and crops the view to the slot's proportion, so give the slot height (drop exhibit lines if needed) and check that every chokepoint and pinned point is inside.
- `regions`: countries by tone (`focus`, `strong`, `mid`, `soft`): one grouping, explained in the `legend`.
- `routes`: waypoints in degrees; `disrupted` (dashed, alert colour) for blocked lanes, `diverted` for bypasses, `main` otherwise.
- `points`: chokepoints (ringed alert marker) and places; `labels`: country and sea names (words only).
- Figures: KPI or text objects with `anchor: {map, lon, lat, w, side}`, set on paper cards beside their point. Put cards and the legend (`legendAt`) over open sea or empty land.

**Alternatives:** V05 with flags; V09.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders and writes custom geometry (filled freeform paths in a group) |
| Builder | **Exposed:** `map` object: Natural Earth 1:50m countries (public domain) via the asset library, tones, routes, chokepoints, names, legend; figures anchored as bound KPIs/text |
| Editability | Native shapes: one editable freeform per country, routes and markers as shapes; figures native text bound to evidence |
| Readiness | Designed (tested) on the Middle East deck (geography slide); proportional symbols (T23) and leaders (T24) not started |
| Visual gap | Medium (no leaders, no symbol encoding, no relief) |
