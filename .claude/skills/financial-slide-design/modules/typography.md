# Typography and visual hierarchy

**Principles:** TY1–TY8 (`knowledge/principles.json`).

**Hierarchy, top down:**
1. **Action title:** heavy serif, 30 pt, near-black.
2. **Exhibit header:** bold sans, 14 pt, stating a finding.
3. **Unit line:** regular sans, 11.5 pt, muted.
4. **Body and commentary:** 12.5 pt, with bold lead-ins.
5. **Data labels:** 11.5 pt bold.
6. **Axis labels:** 10.5 pt.
7. **Sources:** 8.5 pt.

**Figures:**
- The one figure the slide is about: large serif in the primary colour (48 pt in a panel, 24 pt in a matrix cell).
- Supporting figures: serif in near-black.
- Numbers inside sentences: bold and emphasised by the renderer.

**Decision rules:**
- **Title length:** if the title needs three lines, shorten the sentence before shrinking the type.
- **Lead-ins:** two to four words, a verdict ("Debt is still rising."), never a figure (validated).
- **Numbering:** outlined numbered circles on light pages, filled on dark (TY6).
- **Caveats and definitions:** go in the unit line until TY7 and TY8 are implemented.

**Implemented in:** `core/design/language.ts` (type roles per language), `compose.ts` (measured in the real typefaces).
