// Shipped fonts (public/fonts, SIL OFL 1.1). The renderer MEASURES text with these files and Konva
// DRAWS with the same faces registered through FontFace, so line breaks and glyph positions agree
// (Experiment 1: estimated metrics made words collide).
import * as opentype from 'opentype.js'
import { HeuristicMetrics, OpentypeMetrics, type FontMetricsProvider, type RunStyle } from '@genoffice/pptx-render'

const FACES = [
  ['Inter', 'Inter', '400', 'normal', 'Regular'], ['Inter', 'Inter', '700', 'normal', 'Bold'],
  ['Inter', 'Inter', '400', 'italic', 'Italic'], ['Inter', 'Inter', '700', 'italic', 'BoldItalic'],
  ['Liberation Sans', 'LiberationSans', '400', 'normal', 'Regular'], ['Liberation Sans', 'LiberationSans', '700', 'normal', 'Bold'],
  ['Liberation Sans', 'LiberationSans', '400', 'italic', 'Italic'], ['Liberation Sans', 'LiberationSans', '700', 'italic', 'BoldItalic'],
  // report serif for titles and figures (design profiles); Semibold is its own family name, as PowerPoint lists it
  ['Source Serif 4', 'SourceSerif4', '400', 'normal', 'Regular'], ['Source Serif 4', 'SourceSerif4', '700', 'normal', 'Bold'],
  ['Source Serif 4', 'SourceSerif4', '400', 'italic', 'It'], ['Source Serif 4', 'SourceSerif4', '700', 'italic', 'Bold'],
  ['Source Serif 4 Semibold', 'SourceSerif4', '400', 'normal', 'Semibold'], ['Source Serif 4 Semibold', 'SourceSerif4', '700', 'normal', 'Semibold'],
] as const

// Families we measure with Liberation Sans (metric-compatible with Arial/Helvetica) when a deck names them
const LIBERATION = /^(liberation sans|arial|helvetica|helvetica neue|calibri|carlito|sans-serif)$/i

let loaded: Promise<FontMetricsProvider> | null = null

/**
 * opentype.js 2.0 cannot run Inter 4.1's GSUB (chained-context substitution, format 2) and throws
 * from getAdvanceWidth — which made the renderer silently fall back to estimated widths. Advances
 * are summed per glyph instead (no substitution; Latin text in our decks needs none). Within 1% of
 * the browser's own measurement; the browser also applies GPOS kerning, so we measure slightly wide,
 * which breaks lines a little early rather than overflowing.
 */
function adapt(font: any) {
  return {
    unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, lineGap: font.tables?.hhea?.lineGap ?? 0,
    charToGlyphIndex: (ch: string) => font.charToGlyphIndex(ch),
    getAdvanceWidth(text: string, fontSize: number) {
      let units = 0
      for (const ch of text) units += font.charToGlyph(ch).advanceWidth ?? 0
      return (units * fontSize) / font.unitsPerEm
    },
  }
}

export function loadFonts(base = '/fonts/'): Promise<FontMetricsProvider> {
  loaded ??= (async () => {
    const parsed = new Map<string, any>()
    await Promise.all(FACES.map(async ([family, file, weight, style, variant]) => {
      const url = `${base}${file}-${variant}.ttf`
      const buf = await (await fetch(url)).arrayBuffer()
      parsed.set(`${family}|${weight}|${style}`, adapt(opentype.parse(buf)))
      const face = new FontFace(family, buf, { weight, style })
      await face.load()
      ;(document as any).fonts.add(face)
    }))
    const pick = (s: RunStyle) => {
      const family = /^inter$/i.test(s.fontFamily) ? 'Inter' : LIBERATION.test(s.fontFamily) ? 'Liberation Sans' : /^source serif 4( semibold)?$/i.test(s.fontFamily) ? (/semibold/i.test(s.fontFamily) ? 'Source Serif 4 Semibold' : 'Source Serif 4') : null
      return family ? parsed.get(`${family}|${s.bold ? '700' : '400'}|${s.italic ? 'italic' : 'normal'}`) : undefined
    }
    return new OpentypeMetrics(pick, new HeuristicMetrics())
  })()
  return loaded
}
