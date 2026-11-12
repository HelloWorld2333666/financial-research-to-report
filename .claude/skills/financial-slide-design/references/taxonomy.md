# Request vocabulary (the catalog's five dimensions)

Retrieval requests use these values. The private catalog tags every reference slide with them.

| Dimension | Values |
|---|---|
| **purpose** (what the slide argues) | `summary`, `trend`, `comparison`, `kpi`, `survey`, `framework`, `process`, `matrix`, `case`, `recommendation`, `detail_table`, `statement`, `section`, `about` |
| **structure** (how it is arranged) | `chart_led`, `table`, `kpi_row`, `panels_N`, `flow`, `matrix_2x2`, `text_list`, `image_text`, `full_picture`, `title_only` |
| **design** | `tone` (dark, light), `title` (headline, label), `density` (light under 450 characters, medium, dense over 1,100), smallest type, accents |
| **compat** | `rebuild` (geometry readable: rebuilt natively), `reference` (look only). Nothing is reused as a template |
| **capacity** | characters, text boxes, parallel panels, smallest type size |

**Archetypes** (the retrieval level) are `<primary structure>/<single|two|three|many panels>` for content slides (e.g. `chart_led/single`, `text_list/three`), or the slide kind: `cover`, `agenda`, `divider`, `legal`, `image`.

**Tag accuracy** (hand-labelled sample of 80 slides; the detectors were tuned on the same sample, so these figures are optimistic):

| Tag | Accuracy | Precision | Recall |
|---|---|---|---|
| Slide kind | 90% | | |
| Tone | 91% | | |
| Chart present | 80% | 67% | 61% |
| Table present | 86% | 42% | 56% |

Always check a reference's preview before relying on its tags.
