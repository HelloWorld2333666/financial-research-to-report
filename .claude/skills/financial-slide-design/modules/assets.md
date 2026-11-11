# Backgrounds and visual assets

**Principles:** BG1–BG5, LY8.

**Colour roles (`burgundy` language):**
- **Backgrounds:** white pages with warm-ivory panels and fields (`#F7F2E9`).
- **Burgundy `#7B1F35`:** only for France's data, key figures and highlights.
- **Antique gold `#B09766`:** hairlines, panel edges, dividers and connectors.
- **Near-black `#1E1A18`:** titles and figures.
- **Warm taupe:** peers.
- Never grey-heavy, never mostly dark.

`institutional` (navy) stays available, and a new style is a new entry in `language.ts`.

**Backgrounds vary within one identity:**
- white;
- white with an ivory panel;
- an ivory split field;
- a deep-wine divider.

**Thematic assets:**
- **Motifs (BG2):** self-authored line art in `core/design/motifs.ts` (paris, finance, infrastructure, insurance, macro, technology). `motifFor(words)` maps a slide's subject to one.
- **Placement:** at most one per slide, anchored to the foot of a panel or field.
- **Decorative only:** a motif is a picture bound as decor, never data.

**Web imagery (BG3):** only with the user's approval of the source and licence.
- **Licences:** public domain or CC0 first; CC-BY credited in the picture description and the source line.
- **Storage:** kept in the private library.
- **Use:** as a duotone or cutout cropped to a field edge. Never as a rectangle across content.
- **Status:** the mechanism (`addPicture` with provenance) exists; sourcing waits for approval.
