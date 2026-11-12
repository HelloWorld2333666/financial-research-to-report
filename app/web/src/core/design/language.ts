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
    rule?: string // exhibit, matrix and conclusion rules (default: ink)
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
  frame: { margin: number; top: number; bottom: number; masthead: { height: number; rule: number } | null; chrome?: 'band' | 'rule'
    /** rule chrome: a small tracker above the title (default yes); a rule under the title block (default yes); a tinted last
     *  column as a full-height panel bleeding to the edges, the title kept clear of it, a chevron marker on its border */
    tracker?: boolean; titleRule?: boolean; panel?: 'full' | 'inset'; panelMarker?: 'chevron' | 'line' }
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
// Burgundy institutional (Gate E, revision 3): white pages and warm-ivory fields; deep burgundy only for France's data,
// key figures and highlights; muted antique gold for hairlines, dividers and borders; near-black in small amounts (titles,
// figures); warm taupe for peer data (not grey-heavy). Large, deliberate type; no band. Provisional colour values.
const wine = '#7B1F35', ink = '#1E1A18', antique = '#B09766'
LANGUAGES.burgundy = {
  id: 'burgundy',
  name: 'Burgundy institutional',
  fonts: { display: 'Source Serif 4', displayStrong: 'Source Serif 4', text: 'Inter' },
  color: { paper: '#FFFFFF', ink, navy: wine, navyDeep: '#561327', gold: antique, goldSoft: '#D8C9A6', muted: '#6E655D', hair: '#E6DDCF',
    grid: '#EEE8DE', peer: '#B9AEA2', peerSoft: '#DCD3C7', surface: '#F7F2E9', surfaceDeep: '#F4E6E7', onDark: '#FFFFFF', onDarkMuted: '#E6D2D6', rule: antique },
  type: {
    section: { font: 'Inter', pt: 8.5, color: wine, bold: true, caps: true, tracking: 160 },
    kicker: { font: 'Inter', pt: 8.5, color: wine, bold: true, caps: true, tracking: 160 },
    headline: { font: 'Source Serif 4', pt: 30, color: ink, bold: true, lineSpacing: 93 },
    headlineSmall: { font: 'Source Serif 4', pt: 26, color: ink, bold: true, lineSpacing: 93 },
    standfirst: { font: 'Inter', pt: 14, color: '#4A433E', lineSpacing: 118 },
    label: { font: 'Inter', pt: 8.5, color: '#6E655D', bold: true, caps: true, tracking: 120 },
    body: { font: 'Inter', pt: 12.5, color: ink, lineSpacing: 122 },
    bodySmall: { font: 'Inter', pt: 11, color: '#3B3532', lineSpacing: 122 },
    hero: { font: 'Source Serif 4', pt: 48, color: wine, bold: true, lineSpacing: 88 },
    heroMid: { font: 'Source Serif 4', pt: 36, color: wine, bold: true, lineSpacing: 88 },
    heroSmall: { font: 'Source Serif 4', pt: 28, color: ink, bold: true, lineSpacing: 90 },
    caption: { font: 'Inter', pt: 11, color: '#4A433E', lineSpacing: 120 },
    footnote: { font: 'Inter', pt: 8.5, color: '#6E655D', lineSpacing: 115 },
    axis: { font: 'Inter', pt: 10.5, color: '#6E655D' },
    dataLabel: { font: 'Inter', pt: 11.5, color: ink, bold: true },
    chartHeading: { font: 'Inter', pt: 13.5, color: ink, bold: true, lineSpacing: 112 },
    navNumber: { font: 'Source Serif 4', pt: 30, color: wine, bold: true, lineSpacing: 90 },
    navItem: { font: 'Inter', pt: 16, color: ink, bold: true, lineSpacing: 115 },
    tracker: { font: 'Inter', pt: 8.5, color: wine, bold: true, caps: true, tracking: 170 },
    exhibit: { font: 'Inter', pt: 14, color: ink, bold: true, lineSpacing: 112 },
    unit: { font: 'Inter', pt: 11.5, color: '#6E655D', lineSpacing: 115 },
    lead: { font: 'Inter', pt: 12.5, color: ink, lineSpacing: 124 },
    conclusion: { font: 'Source Serif 4', pt: 15, color: ink, bold: true, lineSpacing: 115 },
    cell: { font: 'Inter', pt: 12, color: ink, lineSpacing: 120 },
    cellHead: { font: 'Inter', pt: 10.5, color: '#6E655D', bold: true, lineSpacing: 112 },
    cellFigure: { font: 'Source Serif 4', pt: 24, color: wine, bold: true, lineSpacing: 92 },
  },
  frame: { margin: 56, top: 0, bottom: 26, masthead: null, chrome: 'rule', tracker: true, titleRule: false, panel: 'full', panelMarker: 'line' },
  chart: { focusWidth: 2.75, peerWidth: 1.5, gridWidth: 0.75, focusDot: 4, peerDot: 2.5, barHeight: 0.6, legend: 'direct' },
}

export const DEFAULT_LANGUAGE = 'institutional'
export const languageOf = (id?: string) => LANGUAGES[id ?? ''] ?? LANGUAGES[DEFAULT_LANGUAGE]!

/** A run for a role (caps applied to the text; tracking given in 1/100 pt, written as letterSpacing in pt). */
export function runFor(L: Language, role: keyof Language['type'], text: string, o: { color?: string; bold?: boolean } = {}) {
  const t = L.type[role]
  return { text: t.caps ? text.toUpperCase() : text, fontSize: t.pt, color: o.color ?? t.color, bold: o.bold ?? !!t.bold, fontFamily: t.font, ...(t.tracking ? { letterSpacing: t.tracking / 100 } : {}) }
}
