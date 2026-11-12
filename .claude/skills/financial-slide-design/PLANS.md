# Plan format (one JSON file per slide in `<project>/plans/`)

A plan is a frr-design/1 slide design with two differences: **text never contains a typed figure**, only tokens the
evidence writer resolves, and **a chart is a request** the recommender turns into a valid frr-viz spec. The result goes
through `validateDesign` (no unsourced figures, valid charts, words only on maps and edges). Every field below is an
option, not a default: choose what the slide needs.

```json
{ "id": "m04-…", "objective": "what the slide must achieve", "claim": "the action title",
  "density": "low|medium|high", "composition": { … }, "objects": [ … ], "rationale": ["cards used; alternatives rejected and why"] }
```
`language` is omitted: the project identity (`deck.py identity`) applies to every slide.

## Figure tokens (in any text)
| Token | Writes |
|---|---|
| `{{num ds.xx.metric 2026 [long] [signed] [abs]}}` | a dataset value (`long`: "162.8% of GDP") |
| `{{change ds.xx.metric 2023 2026}}` | end − start (pp for percentages) |
| `{{gap ds.a ds.b 2026}}` / `{{spread ds.a ds.b 2026}}` | a − b / (a − b) × 100 bp |
| `{{ev ev.some.id}}` | a sourced fact's value (`deck.py fact`) |

Facts without a value (a rating action, an event) are written as words, and the source line names the source.

## Compositions
| kind | params | Use for |
|---|---|---|
| `columns` | `columns: [{span (of 12), slots: [...], tint?}]`; `split` (first column a full-height title field); `dividers`; `matrix: {widths, header}`; `diagram: {cols, rows, edges: [{from, to, label?, back?}]}` | most analytical pages: one exhibit, two or three modules, chart + commentary, matrix pages, diagrams |
| `cover` | `art: right|full`, `artCols`, `matrix` | covers, section openers, closing pages over a photograph or a map |
| `agenda`, `divider` | `current` | navigation |
| `rail`, `statement`, `wide`, `bands`, `lead_panel` | `side`, `chartCols`, `rail`, `emphasis` | earlier arrangements; still valid |

A last column with `tint` is a full-height commentary panel. It is one option among many; the deck checks flag a deck
where it dominates.

## Objects (each has `id`, `kind`; slotted objects name their `slot`)
| kind | fields | Notes |
|---|---|---|
| `text` | `role`: `headline` (required), `standfirst`, `exhibit`, `unit`, `lead` (`{lead, text}`: bold lead-in), `conclusion`, `label`, `note`, `body`, `cell`, `source`; `items`; `accent: focus|muted|ink`; `tone: onDark` | the source line is required on evidence pages |
| `kpi` | `value` (one token), `label`, `context`, `variant: hero|stat|band` | one figure per KPI |
| `viz` | `request: {intent, family, datasets, at?, between?, from?, to?, title?}`; `emphasis` (focus dataset); `draw` | intents: trend, ranking, change, composition, relationship, distribution, curve, maturity, sensitivity, spotlight, ratings. families: line, column, bar, area, scatter, pie, doughnut, combo, dumbbell, slope, dot, lollipop, waterfall, step, multiples, yield_curve, histogram, box, range, heatmap |
| `image` | `role: photo|logo|flag`, `asset`, `fit`, `focus: [x, y]`, `treatment: [duotone|tint|darken|fade-left|fade-right|fade-bottom|edge-left]` | photographs fill their slot (cover crop) |
| `map` | `map: {view: [W, S, E, N], theme, regions: [{geo, tone}], routes, points, labels, legend, legendAt}` | tones: focus, strong, mid, soft, context; names only |

`draw` (designed charts): `form: rankTable|delta|benchList`, `flags`, `order: desc`, `band: {from, to}`, `callout: max|min`,
`annotate: change|gap` + `reference`, `panel`, `ranks`, `spark`.

## Placement
| field | on | meaning |
|---|---|---|
| `slot` | any | the composition slot |
| `cell: {r, c, badge?, flag?, icon?, logo?, chip?}` | text, kpi, viz | a matrix cell; `flag` ISO alpha-2, `icon` Lucide name, `logo` asset key (header row), `chip` 1–4 intensity tier |
| `node: {r, c, icon?}` | kpi, text | a diagram node |
| `anchor: {map, lon, lat, w?, side?}` | kpi, text | pinned to a map point on a card |
| `mark: "flag:xx" \| "icon:name"` | text, kpi | an identifier at the object's left |

## Asset keys
`flag:<iso2>` (any country), `icon:<lucide-name>` (https://lucide.dev/icons), `commons:<File name on Wikimedia Commons>`
(photographs, logos; licence-checked), maps load their geometry themselves.
