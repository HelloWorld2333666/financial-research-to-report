---
id: S1
type: asset
layer: L4c (primary definition; used by L2 as data labels)
name: Identity markers (flags, logos, icons, product images)
aliases: [T67, T68, T69, T70, T71, T72, CH10, BG5]
refs: [u02, u09, u11, u16, u04, u01, u08, u14]
---

**Purpose:** recognition without reading. Markers identify countries, companies, products and topics, and reduce the need for a legend.

**Marker types:**
- **Flags (T67);**
- **company logos (T68);**
- **category and product icons from one set (T70);**
- **real product images (T71).**

**Placement roles:**

| Role | Example | Rule |
|---|---|---|
| Data label (T67) | flag beside a country in a ranking or table | Must match the data entity |
| Page context (T69) | a flag or topic icon beside the title | One per slide |
| Module topic (T72) | an icon along a module edge | Same style as other icons |
| Inside a mark or node | a white icon in a treemap tile, area band or diagram node | Sized to the container (R9) |
| Column header | an icon heading a table column | Consistent size |
| Annotation | a trend arrow in a circle on a map callout | One meaning per icon |
| Row identifier | logos in a detail table (u16) | Consistent height and quality |

**Hard constraints:**
- **Usage rights:**
  - logos from the company's own press materials or from Wikimedia Commons files whose licence the asset library accepts (public domain or CC), used **only to identify** the company or agency (trademark: no endorsement implied, no alteration beyond trimming and scaling);
  - icons from one open-licensed set (Lucide, ISC);
  - flags from flag-icons (MIT; the designs are public domain);
  - product images with a recorded licence.
- Assets are cached outside git (`app/server/assets_cache/`); the manifest records source, licence, author and hash. Nothing licensed is committed to the public repository.

**Use them proactively:**
- a country named in a table row, ranking, scorecard or KPI gets its flag (`draw.flags`, `cell.flag`, `mark: "flag:xx"`);
- a company or agency column gets its logo (`cell.logo`, header row);
- numbered findings, watchlists, process nodes and commentary lead-ins get icons from the one set (`cell.icon`, `node.icon`, `mark: "icon:name"`);
- one marker per row or block; never a flag for a non-country category.

**Risks:**
- **Works when** one style is used per deck, at consistent sizes and quality.
- **Fails when:**
  - icon styles are mixed;
  - logos are of uneven quality;
  - flags are used for non-country categories.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders shapes, custom geometry and pictures |
| Builder | **Exposed:** asset library (`assets.py`, `/api/assets`) with flags (any ISO country), Lucide icons, Commons logos; icons in cells, nodes and lead-ins; flags in ranked tables, matrices and beside KPIs; logos in header cells (trimmed, equal visual area) |
| Editability | Icons: native vector shapes (stroked paths). Flags and logos: pictures with provenance in the description |
| Readiness | Designed (tested) on the Middle East deck; product images not started |
| Visual gap | Low |
