# Design rules (our own wording; aggregate observations, no reference content)

## Principles from the reference reports (Gate E)
These are why professional research slides read as designed and Gate D's did not. Apply them before choosing colours.
1. **Light frame:**
   - no masthead band;
   - a small tracker above a large serif action title;
   - one charcoal hairline under the title block;
   - the source at the foot.
   The content gets the space.
2. **Exhibits carry their own findings.** Each exhibit has a bold title stating what it shows ("Only Belgium ran a larger deficit than France"), a unit line (measure, unit, period), and a hairline before the evidence.
3. **Evidence and commentary sit side by side:**
   - a chart or table in the wider column;
   - commentary blocks with bold lead-ins (two to four words) in the narrower one;
   - a "so what" under a heavier rule at the foot, level with the exhibit's baseline.
4. **Rows are the unit of comparison:**
   - tables carry bars, earlier values and changes in the same row;
   - the focus row is tinted;
   - hairlines separate rows;
   - a charcoal rule sits under the header;
   - a summary row closes the exhibit.
5. **Multi-measure assessments use matrices:**
   - numbered badges on rows;
   - focus and reference side by side;
   - the gap, the change, a sparkline and a computed reading.
6. **Larger, fewer elements:** title 28 pt, text 11.5–12 pt, axis labels 9.5–10 pt, sources 8 pt. Density comes from more information per element, not more elements.
7. **Variety inside one frame:** consecutive slides use different compositions (commentary, ranked table, matrix) while the frame, type and colour roles stay constant.

## Colour roles (any language)
- **Text:** titles and body in the ink colour (charcoal), never the primary.
- **Primary colour** (wine in `burgundy`, navy in `institutional`): only the focal data. That is:
  - the focus series, row and bar;
  - the lead figures;
  - badges;
  - divider fields.
- **Accent** (antique gold): rules, brackets, callout leaders, and at most one highlight per slide.
- **Context:** peers and secondary data in warm greys; peers' figures in charcoal.
- **Styles:** `burgundy` (title-rule frame) and `institutional` (masthead band) are switchable languages in `core/design/language.ts`. A new style is a new language entry, not new code.

## Titles and text
- **Action title:**
  - a full sentence stating the conclusion, 16 words or fewer;
  - at most two lines in the display serif;
  - it moves to the smaller headline size before a third line.
- **Standfirst:** one or two lines saying what the chart shows (measure, unit, period, who), and nothing the title already says.
- **Footnote:** sources and definitions, 8 pt, on the paper side under a hairline. A footnote or source line appears on about 70% of reference content slides.
- **Type scale:** keep the steps clear (30 / 24 headline, 54 / 38 / 26 figures, 12 standfirst, 11 body, 9.5 small, 8 footnote). Nothing on a slide is below 8 pt.

## Colour
- **Accents:**
  - one structural colour (navy) carries the focus;
  - one accent (gold) carries annotations and rules, sparingly;
  - everything else is quiet grey.
- **Tints:** a tinted rail or panel groups evidence. Use at most two tinted areas per slide, and never a tinted panel beside a tinted rail.
- **Dark:** dark panels for contrast (a supporting rail, navigation). Text on dark uses the language's on-dark tones.

## Charts
- **Labels:**
  - direct labels at series ends (name and latest value) instead of legends;
  - values at bar ends;
  - no axis on ranked bars.
- **Emphasis:** the focus series heavy, with every point marked; peers thin.
- **Annotation:**
  - at most one callout, and it must be computed (an extreme, a change, a gap);
  - a shaded band marks the period the title is about, labelled with the period only.
- **Ranking direction:** runs in the message's direction. If the title says "second-largest deficit", rank 1 is the largest deficit and the focus numeral reads 2.

## Composition
- **Figures rail (R1):**
  - one hero figure, then at most two supporting figures, then one note at the rail's foot;
  - the rail heading says what the figures mean;
  - rail figures add a level, a change or a gap; the hero may restate the latest level as the focal figure.
- **Grid:** 12 columns; the chart takes 8 columns, the rail 4.
- **Navigation (R9):**
  - an agenda before the first section, and a divider at each section of a deck of eight slides or more;
  - section names of five words or fewer;
  - no figures.
