# Gate E (first step): reference-led redesign of three France slides, burgundy and gold

**Branch:** `feature/workspace-v2`, local commit only. **Date:** 2026-11-11.
**Status:** three proposals for your visual review. Nothing in the France deck or the chat flow was changed.

## Files
- **Full-resolution renders** (1280×720, through the app renderer, on an in-memory copy of the Gate D test project):
  - `gate-e/v2-debt-0.png`
  - `gate-e/v2-balance-0.png`
  - `gate-e/v2-risk-0.png`
  - the same palette on navigation: `gate-e/v2-divider-0.png` and `gate-e/v2-agenda-0.png`
- **The Gate D versions they replace:**
  - `gated/slide-16.png` (debt)
  - `gated/slide-18.png` (balance)
  - `gated/slide-21.png` (risk)
- **Palette specimen:** `gate-e/palette.png`.
- **Side-by-side sheets** (Gate D, redesign, two reference slides each): **private**, in `frr-design-library/renders/gate-e-compare/{debt,balance,risk}.png`. The reference slides are licensed material and stay out of the repository.

## What the references do that Gate D did not

From 9 reference slides rendered at full size and chosen through the catalog (chart with commentary, table and bar exhibits, scenario matrix, executive summary). The 1,555-slide library was not reloaded.

| Aspect | References | Gate D |
|---|---|---|
| **Frame** | No band. A tiny tracker, a large serif title, one hairline. Content starts high | A navy masthead band on every slide; the content starts lower |
| **Type scale** | Text about 12 pt, axis labels about 10 pt, exhibit titles bold 12 pt | Text 9.5–11 pt, axis labels 8.5 pt; small type in a lot of empty space |
| **Exhibit titles** | Each exhibit is titled with its **finding**, plus a unit line and a rule | Charts labelled with the metric ("GOVERNMENT BALANCE, % OF GDP") |
| **Evidence and argument** | Chart and commentary side by side. Bold lead-ins, one fact per block, hairlines, a "so what" at the foot | One large figure plus a note; the argument was implicit |
| **Comparisons** | Row-based tables carrying bars, earlier values and changes; the focus row tinted | Bars alone; the change sat in a separate figure |
| **Assessments** | Matrices: numbered rows, several dimensions per row, a summary row | Three bands of figure, sentence and chart |
| **Variety** | Different compositions slide to slide in one frame | Every content slide was "chart plus rail" or a variant of it |
| **Colour** | One dark structure colour, one accent for data; greys for context | Navy everywhere (band, titles, focus, panels) |

## The three proposals

### 1. Sovereign debt trend
- **Gate D:** an R1 tinted rail, a navy band, the hero figure 115.7%, and a small chart in the left two-thirds.
- **Principles used:** chart with a commentary column and a "so what"; gap brackets labelled on the chart; an exhibit titled with its finding.
- **Redesign:**
  - **Title and exhibit:** "France's debt kept rising while Germany's and Italy's fell". The exhibit is titled "France is the only one of the three whose debt ratio rose", with the gap to Germany bracketed in 2022 (47.3 pp) and 2025 (52.9 pp, gold).
  - **Commentary column:**
    - "France rose." Debt went from 111.4% to 115.7% of GDP, +4.3 pp.
    - "Peers fell." Germany −1.3 pp to 62.8%; Italy −1.7 pp to 136.7%.
    - "The gap widened." From 47.3 pp to 52.9 pp.
  - **Conclusion:** "France has the second-highest debt ratio of the three and the only one still rising".
- **Why:** the argument is now on the slide, in the order a reader needs it. Burgundy marks only France; peer figures are charcoal.

### 2. Fiscal balance comparison
- **Gate D:** R2, ranked bars on a panel with rank numerals, beside a figures rail.
- **Principles used:** a row-based table and bar exhibit with hairline rows and a tinted focus row; a tinted figures rail bleeding to the edge.
- **Redesign:**
  - **Title:** "France ran the second-largest deficit of the seven in 2025".
  - **Exhibit:** titled "Only Belgium ran a larger deficit than France". Each row holds the rank, the country, a bar of the 2025 balance with its value, the 2024 value, and the change (▼ in wine marks a wider deficit).
  - **Figures column:** −5.1% in wine serif; +0.7 pp since 2024; "Four of seven narrowed" with the countries named.
  - **Conclusion:** "Five of the seven ran smaller deficits than France".
- **Why:** rank, level and change read across one row, so no second chart is needed, and the rail adds only what the table can't say.

### 3. Executive credit risk assessment
- **Gate D:** three figure bands (debt, deficit, funding cost), each with a figure, a sentence and a France-against-Germany line.
- **Principles used:** a scenario matrix with numbered rows and a summary row; numbered executive points.
- **Redesign:**
  - **Title:** "France is weaker than Germany on all four credit measures". Interest spending is added as the fourth measure.
  - **Exhibit title:** "Every measure moved against France since 2022".
  - **Matrix:** each numbered row holds France 2025 (wine serif), Germany 2025, the gap, France's change since 2022, a 2022–2025 sparkline, and a computed reading ("Rose since 2022; Germany's fell").
  - **Conclusion row:** "France carries more debt, a wider deficit, a higher yield and a heavier interest bill than Germany; the debt gap alone is 52.9 pp of GDP".
- **Why:** an executive reads the whole credit picture in one structure, with the direction stated rather than left for the reader to infer.

## The palette (provisional; your HKMC image was not found in the session folders)

| Colour | Value | Role |
|---|---|---|
| Wine | `#6B1E2E` | Focus series, row and bar; lead figures; badges |
| Deep wine | `#4B1520` | Section dividers and the agenda panel |
| Wine tint | `#EFE0DC` | The focus row |
| Antique gold | `#A3854F` | Rules, brackets, leaders, one highlight |
| Soft gold | `#CDBB93` | Secondary rules; numerals on dark |
| Ivory | `#FAF7F1` | Paper |
| Warm surface | `#F1EBE1` | The figures column and panels |
| Charcoal | `#2A2A2D` | Titles, text, peer figures |
| Warm grey | `#6A655E` | Units, axes, captions |
| Peer greys | `#A8A29A`, `#C9C3BA` | Peer data |
| Hairline | `#D8D1C4` | Row separators |

Titles stay charcoal. Burgundy is not a recoloured navy: it marks only the focal data and the dividers. The values are tokens in one place (`LANGUAGES.burgundy` in `core/design/language.ts`), so re-sampling them from the image changes every slide at once.

## What changed in the design system (reusable, not France-specific)

**The restriction:** compositions were five hard-coded arrangements with a few parameters, and recipes could only choose among them. That is why every slide came out as "chart plus rail".

| Change | Where |
|---|---|
| **`columns` composition:** a layout is data (column spans and the slots stacked in each); objects name their slot. Text blocks are measured in their real typefaces; charts and matrices share the remaining height | `core/design/compose.ts`, `spec.ts` |
| **New block types:** exhibit title and unit line (with the exhibit rule), commentary with bold lead-ins (validated to carry no figures), conclusion under a heavier rule, matrix (header, rows, badges, centred cells, sparklines), tinted figures column bleeding to the edge | `compose.ts`, `build.ts` |
| **Ranked table:** a two-period spec drawn as rows (rank, name, bar, earlier value, change). Both periods' values are named marks, so integrity checks every figure | `charts.ts` (`form: 'rankTable'`) |
| **Sparkline option:** no end labels, a fixed window | `charts.ts` (`spark`) |
| **The `burgundy` language:** colour roles, a larger type scale, the title-rule frame. `institutional` is unchanged and still selectable | `language.ts` |
| **Recipes R4–R6:** declared as `columns` layouts. Retrieval scores them, including the `table` flag | `recipes.json`, `design_library/retrieve.py` |
| **Skill rules:** the seven reference principles and the colour roles | `.claude/skills/financial-slide-design/references/rules.md`, `SKILL.md` |

**Unchanged:** the Evidence Core, the bindings, the integrity checks and the editor.

**Verified:**
- The three proposals apply as native objects with **client integrity OK and 0 unsourced figures**; QA finds no errors.
- The server agrees on the debt and risk proposals (browser check).
- vitest 167 and pytest 260 pass.

## Not done yet (on purpose)
- The proposals are not wired into the chat planner, and the other five Gate D slides are not redesigned. Both wait for your verdict on these three.
- The palette is not yet sampled from the HKMC image.
