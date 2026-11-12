// Design profiles (PD1): a project-level visual style, kept apart from the evidence and the visual specs. A profile
// is a set of tokens: colours, type scale, spacing, and a few treatments. Changing the profile restyles slides;
// it never changes a number, a dataset or a chart's meaning.
import type { DesignDNA, Project } from '../types'

export interface DesignProfile {
  id: string
  name: string
  description: string
  color: {
    background: string // slide background
    surface: string // cards, takeaway band
    structure: string // headings, rules, the focus series
    ink: string // body text
    muted: string // labels, source notes
    rule: string // hairlines and table rules
    accent: string // restrained emphasis (kicker, one highlight per slide)
    series: string[] // chart series by country order (FR, DE, IT, ES), then peers
    peer: string // non-focus bars in a ranked comparison
  }
  font: string
  /** points; `min` is the smallest size any slide text may use (source notes included) */
  type: { kicker: number; title: number; titleMin: number; subtitle: number; takeaway: number; body: number; label: number; kpi: number; kpiLabel: number; source: number; min: number }
  /** px on the 1280 x 720 slide */
  space: { margin: number; top: number; gutter: number; gap: number }
  treatment: { headerRule: boolean; takeaway: 'band' | 'line'; kpiCard: 'fill' | 'outline'; kickerUpper: boolean }
}

export const PROFILES: Record<string, DesignProfile> = {
  institutional: {
    id: 'institutional',
    name: 'Institutional report',
    description: 'Dark navy structure, restrained gold accents, ivory background, clear financial charts and consistent source notes.',
    color: { background: '#FBF8F1', surface: '#F1ECE0', structure: '#14284B', ink: '#1C2433', muted: '#5D6676', rule: '#C9C2B2', accent: '#A8822E',
      series: ['#14284B', '#A8822E', '#6F7F96', '#3E7C8C', '#8C5A3C', '#4B6B3A', '#7A5C8E'], peer: '#9AA5B5' },
    font: 'Inter',
    type: { kicker: 9, title: 22, titleMin: 17, subtitle: 10.5, takeaway: 13, body: 11.5, label: 10, kpi: 30, kpiLabel: 9.5, source: 8, min: 8 },
    space: { margin: 56, top: 36, gutter: 32, gap: 16 },
    treatment: { headerRule: true, takeaway: 'band', kpiCard: 'fill', kickerUpper: true },
  },
  editorial: {
    id: 'editorial',
    name: 'Editorial minimal',
    description: 'White page, black type, one red accent, more white space and lighter structure.',
    color: { background: '#FFFFFF', surface: '#F4F4F2', structure: '#111111', ink: '#1A1A1A', muted: '#6B6B6B', rule: '#D9D9D6', accent: '#C8102E',
      series: ['#111111', '#C8102E', '#8A8A8A', '#4F6D7A', '#B58B5A', '#5B7F4F', '#7D6A96'], peer: '#B5B5B5' },
    font: 'Inter',
    type: { kicker: 9, title: 24, titleMin: 18, subtitle: 10.5, takeaway: 14, body: 11.5, label: 10, kpi: 32, kpiLabel: 9.5, source: 8, min: 8 },
    space: { margin: 64, top: 40, gutter: 40, gap: 18 },
    treatment: { headerRule: false, takeaway: 'line', kpiCard: 'outline', kickerUpper: true },
  },
}
export const DEFAULT_PROFILE = 'institutional'

/** The project's profile (stored on the project as `design_profile`; older projects use the default). */
export function profileOf(p: Project): DesignProfile {
  return PROFILES[(p as any).design_profile] ?? PROFILES[DEFAULT_PROFILE]!
}

/** The Design DNA a profile implies (theme colours, chart series, font), so native charts and the theme follow the profile. */
export function dnaFor(pr: DesignProfile): DesignDNA {
  return { font: pr.font, ink: pr.color.structure, accent: pr.color.accent, muted: pr.color.muted, rule: pr.color.structure, series: pr.color.series.slice(0, 4) }
}

/** Every colour and size a profile allows, for the deck consistency check. */
export function profileTokens(pr: DesignProfile) {
  return { colors: new Set([...Object.values(pr.color).flat()].map((c) => String(c).toUpperCase())), fonts: new Set([pr.font]) }
}
