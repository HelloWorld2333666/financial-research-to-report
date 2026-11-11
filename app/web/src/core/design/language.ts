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
    surfaceDeep: string // a focus row on a tinted panel
    onDark: string // text on navy
    onDarkMuted: string
  }
  type: Record<'section' | 'kicker' | 'headline' | 'headlineSmall' | 'standfirst' | 'label' | 'body' | 'bodySmall' | 'hero' | 'heroMid' | 'heroSmall' | 'caption' | 'footnote' | 'axis' | 'dataLabel' | 'chartHeading'
    | 'navNumber' | 'navItem'
    // Gate E (reference-derived): tracker above the title, exhibit titles that state a finding, their unit line,
    // commentary with bold lead-ins, the closing "so what", matrix cells, header cells and cell figures
    | 'tracker' | 'exhibit' | 'unit' | 'lead' | 'conclusion' | 'cell' | 'cellHead' | 'cellFigure', TypeRole>
  /** slide frame. chrome 'band': a masthead band (navy institutional); 'rule': no band, a small tracker over the title,
   *  a hairline under the title block and the source line at the foot (the reference reports' frame) */
  frame: { margin: number; top: number; bottom: number; masthead: { height: number; rule: number } | null; chrome?: 'band' | 'rule' }
  chart: { focusWidth: number; peerWidth: number; gridWidth: number; focusDot: number; peerDot: number; barHeight: number; legend: 'direct' | 'legend' }
}

const navy = '#14284B', gold = '#A8822E'
export const LANGUAGES: Record<string, Language> = {
  institutional: {
    id: 'institutional',
    name: 'Institutional report',
    fonts: { display: 'Source Serif 4', displayStrong: 'Source Serif 4 Semibold', text: 'Inter' },
    color: { paper: '#FBF8F1', ink: '#1E2533', navy, navyDeep: '#0F1F3B', gold, goldSoft: '#CDB37A', muted: '#5F6675', hair: '#D9D0BC',
      grid: '#E7E0CF', peer: '#9AA3B2', peerSoft: '#C3B48F', surface: '#F2ECDF', surfaceDeep: '#E6DCC6', onDark: '#F5F0E4', onDarkMuted: '#B9C2D3' },
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
      navNumber: { font: 'Source Serif 4 Semibold', pt: 28, color: '#CDB37A', lineSpacing: 90 },
      navItem: { font: 'Inter', pt: 15, color: '#F5F0E4', lineSpacing: 115 },
      tracker: { font: 'Inter', pt: 8, color: '#5F6675', bold: true, caps: true, tracking: 140 },
      exhibit: { font: 'Inter', pt: 11.5, color: '#1E2533', bold: true, lineSpacing: 115 },
      unit: { font: 'Inter', pt: 9.5, color: '#5F6675', lineSpacing: 115 },
      lead: { font: 'Inter', pt: 11, color: '#1E2533', lineSpacing: 125 },
      conclusion: { font: 'Inter', pt: 11.5, color: '#1E2533', bold: true, lineSpacing: 120 },
      cell: { font: 'Inter', pt: 10.5, color: '#1E2533', lineSpacing: 120 },
      cellHead: { font: 'Inter', pt: 9.5, color: '#1E2533', bold: true, lineSpacing: 115 },
      cellFigure: { font: 'Source Serif 4 Semibold', pt: 19, color: navy, lineSpacing: 95 },
    },
    frame: { margin: 64, top: 0, bottom: 28, masthead: { height: 40, rule: 2 } },
    chart: { focusWidth: 3, peerWidth: 1.6, gridWidth: 0.75, focusDot: 4, peerDot: 2.5, barHeight: 0.58, legend: 'direct' },
  },
}
// Burgundy and gold (Gate E). Colour roles, not a recolour of navy: charcoal carries text and titles; burgundy is kept
// for the focal data (the focus series, the focus row, the lead figures) and the section dividers; antique gold for rules,
// dividers, callout leaders and one selective highlight; warm greys for peers and secondary data; ivory paper.
// The type scale follows the reference reports: a 28 pt serif title, 11-12 pt text, 10 pt axis labels, 8 pt sources.
// Provisional values from the written description; replace with values sampled from the reference image when it is supplied.
const wine = '#6B1E2E', antique = '#A3854F', charcoal = '#2A2A2D'
LANGUAGES.burgundy = {
  id: 'burgundy',
  name: 'Burgundy and gold institutional',
  fonts: { display: 'Source Serif 4', displayStrong: 'Source Serif 4 Semibold', text: 'Inter' },
  color: { paper: '#FAF7F1', ink: charcoal, navy: wine, navyDeep: '#4B1520', gold: antique, goldSoft: '#CDBB93', muted: '#6A655E', hair: '#D8D1C4',
    grid: '#E7E1D6', peer: '#A8A29A', peerSoft: '#C9C3BA', surface: '#F1EBE1', surfaceDeep: '#EFE0DC', onDark: '#F7F1E7', onDarkMuted: '#CDB8B4' },
  type: {
    section: { font: 'Inter', pt: 8, color: '#6A655E', bold: true, caps: true, tracking: 140 },
    kicker: { font: 'Inter', pt: 8.5, color: antique, bold: true, caps: true, tracking: 140 },
    headline: { font: 'Source Serif 4 Semibold', pt: 28, color: charcoal, lineSpacing: 94 },
    headlineSmall: { font: 'Source Serif 4 Semibold', pt: 24, color: charcoal, lineSpacing: 95 },
    standfirst: { font: 'Inter', pt: 12.5, color: '#55514B', lineSpacing: 120 },
    label: { font: 'Inter', pt: 8.5, color: '#6A655E', bold: true, caps: true, tracking: 110 },
    body: { font: 'Inter', pt: 11.5, color: charcoal, lineSpacing: 125 },
    bodySmall: { font: 'Inter', pt: 10, color: '#3E3B37', lineSpacing: 125 },
    hero: { font: 'Source Serif 4 Semibold', pt: 46, color: wine, lineSpacing: 90 },
    heroMid: { font: 'Source Serif 4 Semibold', pt: 34, color: wine, lineSpacing: 90 },
    heroSmall: { font: 'Source Serif 4 Semibold', pt: 24, color: charcoal, lineSpacing: 92 },
    caption: { font: 'Inter', pt: 10, color: '#6A655E', lineSpacing: 120 },
    footnote: { font: 'Inter', pt: 8, color: '#7C776F', lineSpacing: 115 },
    axis: { font: 'Inter', pt: 9.5, color: '#6A655E' },
    dataLabel: { font: 'Inter', pt: 10.5, color: charcoal, bold: true },
    chartHeading: { font: 'Inter', pt: 11.5, color: charcoal, bold: true, lineSpacing: 115 },
    navNumber: { font: 'Source Serif 4 Semibold', pt: 28, color: '#CDBB93', lineSpacing: 90 },
    navItem: { font: 'Inter', pt: 15, color: '#F7F1E7', lineSpacing: 115 },
    tracker: { font: 'Inter', pt: 8, color: '#6A655E', bold: true, caps: true, tracking: 140 },
    exhibit: { font: 'Inter', pt: 12, color: charcoal, bold: true, lineSpacing: 115 },
    unit: { font: 'Inter', pt: 10, color: '#6A655E', lineSpacing: 115 },
    lead: { font: 'Inter', pt: 11.5, color: charcoal, lineSpacing: 125 },
    conclusion: { font: 'Inter', pt: 12, color: charcoal, bold: true, lineSpacing: 120 },
    cell: { font: 'Inter', pt: 10.5, color: charcoal, lineSpacing: 120 },
    cellHead: { font: 'Inter', pt: 9.5, color: '#55514B', bold: true, lineSpacing: 115 },
    cellFigure: { font: 'Source Serif 4 Semibold', pt: 20, color: wine, lineSpacing: 95 },
  },
  frame: { margin: 56, top: 0, bottom: 28, masthead: null, chrome: 'rule' },
  chart: { focusWidth: 2.75, peerWidth: 1.6, gridWidth: 0.75, focusDot: 4, peerDot: 2.5, barHeight: 0.62, legend: 'direct' },
}

export const DEFAULT_LANGUAGE = 'institutional'
export const languageOf = (id?: string) => LANGUAGES[id ?? ''] ?? LANGUAGES[DEFAULT_LANGUAGE]!

/** A run for a role (caps applied to the text; tracking given in 1/100 pt, written as letterSpacing in pt). */
export function runFor(L: Language, role: keyof Language['type'], text: string, o: { color?: string; bold?: boolean } = {}) {
  const t = L.type[role]
  return { text: t.caps ? text.toUpperCase() : text, fontSize: t.pt, color: o.color ?? t.color, bold: o.bold ?? !!t.bold, fontFamily: t.font, ...(t.tracking ? { letterSpacing: t.tracking / 100 } : {}) }
}
