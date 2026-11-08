// Visual language (PD2): a complete design system for a profile, not a palette. It fixes how every role looks
// (typography pairing and scale, header treatment, motifs, chart/table/KPI treatments, footnotes, grid), so
// compositions and charts draw from one coherent source. Values are presentation only; no data lives here.
//
// Institutional: written from the description of the earlier France sovereign-debt deck (dark navy header, restrained
// gold accents, ivory paper, serif titles). The reference images themselves were not available to this build.

export interface TypeRole { font: string; pt: number; color: string; bold?: boolean; caps?: boolean; tracking?: number; lineSpacing?: number }
export interface Language {
  id: string
  name: string
  fonts: { display: string; displayStrong: string; text: string }
  color: {
    paper: string // slide background
    ink: string // body text
    navy: string // structure: masthead, focus series, headlines
    navyDeep: string // dark panels
    gold: string // accent: kicker, rules, annotations (sparingly)
    goldSoft: string // second accent tone (peer emphasis, panel rules)
    muted: string // standfirst, captions, axis text
    hair: string // hairlines and table rules
    grid: string // chart gridlines (lighter than hairlines)
    peer: string // non-focus series and bars
    peerSoft: string // second peer tone
    surface: string // tinted band behind a focus row or note
    onDark: string // text on navy
    onDarkMuted: string
  }
  type: Record<'section' | 'kicker' | 'headline' | 'headlineSmall' | 'standfirst' | 'label' | 'body' | 'bodySmall' | 'hero' | 'heroMid' | 'heroSmall' | 'caption' | 'footnote' | 'axis' | 'dataLabel' | 'chartHeading', TypeRole>
  /** slide frame */
  frame: { margin: number; top: number; bottom: number; masthead: { height: number; rule: number } | null }
  chart: { focusWidth: number; peerWidth: number; gridWidth: number; focusDot: number; peerDot: number; barHeight: number; legend: 'direct' | 'legend' }
}

const navy = '#14284B', gold = '#A8822E'
export const LANGUAGES: Record<string, Language> = {
  institutional: {
    id: 'institutional',
    name: 'Institutional report',
    fonts: { display: 'Source Serif 4', displayStrong: 'Source Serif 4 Semibold', text: 'Inter' },
    color: { paper: '#FBF8F1', ink: '#1E2533', navy, navyDeep: '#0F1F3B', gold, goldSoft: '#CDB37A', muted: '#5F6675', hair: '#D9D0BC',
      grid: '#E7E0CF', peer: '#9AA3B2', peerSoft: '#C3B48F', surface: '#F2ECDF', onDark: '#F5F0E4', onDarkMuted: '#B9C2D3' },
    type: {
      section: { font: 'Inter', pt: 8, color: '#E9DDBF', bold: true, caps: true, tracking: 160 },
      kicker: { font: 'Inter', pt: 8.5, color: gold, bold: true, caps: true, tracking: 140 },
      headline: { font: 'Source Serif 4 Semibold', pt: 30, color: navy, lineSpacing: 92 },
      headlineSmall: { font: 'Source Serif 4 Semibold', pt: 24, color: navy, lineSpacing: 95 },
      standfirst: { font: 'Inter', pt: 12, color: '#4E5666', lineSpacing: 120 },
      label: { font: 'Inter', pt: 8.5, color: '#5F6675', bold: true, caps: true, tracking: 110 },
      body: { font: 'Inter', pt: 11, color: '#1E2533', lineSpacing: 125 },
      bodySmall: { font: 'Inter', pt: 9.5, color: '#3D4554', lineSpacing: 125 },
      hero: { font: 'Source Serif 4 Semibold', pt: 54, color: navy, lineSpacing: 90 },
      heroMid: { font: 'Source Serif 4 Semibold', pt: 38, color: navy, lineSpacing: 90 },
      heroSmall: { font: 'Source Serif 4 Semibold', pt: 26, color: navy, lineSpacing: 90 },
      caption: { font: 'Inter', pt: 9, color: '#5F6675', lineSpacing: 120 },
      footnote: { font: 'Inter', pt: 8, color: '#7A8190', lineSpacing: 115 },
      axis: { font: 'Inter', pt: 8.5, color: '#7A8190' },
      dataLabel: { font: 'Inter', pt: 9.5, color: '#1E2533', bold: true },
      chartHeading: { font: 'Inter', pt: 9, color: '#5F6675', bold: true, caps: true, tracking: 110 },
    },
    frame: { margin: 64, top: 0, bottom: 28, masthead: { height: 40, rule: 2 } },
    chart: { focusWidth: 3, peerWidth: 1.6, gridWidth: 0.75, focusDot: 4, peerDot: 2.5, barHeight: 0.58, legend: 'direct' },
  },
}
export const DEFAULT_LANGUAGE = 'institutional'
export const languageOf = (id?: string) => LANGUAGES[id ?? ''] ?? LANGUAGES[DEFAULT_LANGUAGE]!

/** A run for a role (caps applied to the text; tracking given in 1/100 pt, written as letterSpacing in pt). */
export function runFor(L: Language, role: keyof Language['type'], text: string, o: { color?: string; bold?: boolean } = {}) {
  const t = L.type[role]
  return { text: t.caps ? text.toUpperCase() : text, fontSize: t.pt, color: o.color ?? t.color, bold: o.bold ?? !!t.bold, fontFamily: t.font, ...(t.tracking ? { letterSpacing: t.tracking / 100 } : {}) }
}
