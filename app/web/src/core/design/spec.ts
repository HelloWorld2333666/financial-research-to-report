// frr-design/1 (PD1): a renderer-independent description of one slide's design. It sits between the research
// (Evidence Core, frr-viz/1 specs) and the editable deck:
//   findings → storyline → slide objective → layout plan (this) → editable GenOffice elements.
// It references evidence and datasets; it never holds dataset values. Every figure in its text carries a NumberRef
// to the evidence item or derivation it came from, and the validator below refuses a design that breaks that.
import type { Derivation, NumberRef, Project, TableSpec } from '../types'
import { assess, vizDatasets, type VizSpec } from '../viz'
import { figures, textNumbers } from '../evidence'
import { PROFILES } from './profiles'

export const DESIGN_SCHEMA = 'frr-design/1'
export type LayoutFamily = 'analytical_hero' | 'comparative' | 'executive_insight' | 'composed'
export const FAMILIES: LayoutFamily[] = ['analytical_hero', 'comparative', 'executive_insight', 'composed']

/** PD2: a composition arranges the slide's semantic objects in a visual language (compose.ts). */
export type CompositionKind = 'rail' | 'statement' | 'wide' | 'bands' | 'lead_panel'
  // Gate E: a declarative layout. The composition's params give the columns (12-column grid spans) and the slots
  // stacked in each; objects name their slot. New layouts are data (recipes.json), not code
  | 'columns'
  // Gate C (recipe R9): deck navigation, no evidence
  | 'agenda' | 'divider'
export const NAVIGATION: CompositionKind[] = ['agenda', 'divider']
export interface Composition {
  kind: CompositionKind
  params?: {
    side?: 'left' | 'right'; chartCols?: number; emphasis?: 'first' | 'even'
    /** rail (recipe R1): plain hairline, tinted full-height panel, or dark full-height panel (its objects onDark) */
    rail?: 'plain' | 'tinted' | 'dark'
    /** agenda/divider: the 0-based section being opened */
    current?: number
    /** columns: left to right, each a span of the 12-column grid and the slots stacked in it, top to bottom */
    columns?: { span: number; slots: string[]; tint?: boolean }[]
    /** columns: a matrix slot's column widths (relative) and whether row 0 is a header */
    matrix?: { widths: number[]; header?: boolean }
    /** columns: the first column is a full-height colour field holding the title (split background) */
    split?: boolean
    /** columns: hairline dividers between analytical modules */
    dividers?: boolean
    /** columns: a diagram slot's grid and its edges (node ids); 'back' routes a feedback edge under the row */
    diagram?: { cols: number; rows: number; edges: { from: string; to: string; label?: string; back?: boolean }[] }
  }
  /** the recipe (recipes.json) this composition was built from, for the rationale and for retrieval feedback */
  recipe?: string
}
export type Density = 'low' | 'medium' | 'high'
export type Audience = 'executive' | 'analyst' | 'committee'

/** Knobs within a family. Ranges are checked by `validateDesign`; the layout engine reads them. */
export interface LayoutParams {
  /** analytical_hero: share of the content width given to the primary visual (0.55 to 1) */
  heroShare?: number
  /** analytical_hero: where the supporting observations go */
  support?: 'side' | 'below' | 'none'
  /** comparative: two visuals side by side, a chart with a table, or two visuals stacked */
  arrangement?: 'side_by_side' | 'chart_table' | 'stacked'
  /** comparative: share of the content width for the first object (0.4 to 0.7) */
  split?: number
  /** executive_insight: KPI cards in a row under the claim, or a column beside the narrative */
  kpiPlacement?: 'row' | 'column'
  /** where the takeaway sits: a band above the content, a line under it, or none */
  takeaway?: 'top' | 'bottom' | 'none'
}

/** Text with the evidence behind each figure in it. */
export interface DesignText { text: string; numbers?: NumberRef[]
  /** Gate E: a bold lead-in set before the text ("France rose." …); words only, never a figure */
  lead?: string }

export type TextRole = 'kicker' | 'title' | 'subtitle' | 'takeaway' | 'observations' | 'narrative' | 'caption' | 'source'
  // PD2 roles, styled by the visual language
  | 'section' | 'headline' | 'standfirst' | 'label' | 'note' | 'body'
  // Gate E: an exhibit title stating a finding, its unit line, commentary with bold lead-ins, the closing "so what", a matrix cell
  | 'exhibit' | 'unit' | 'lead' | 'conclusion' | 'cell'
export type DesignObject =
  | { id: string; kind: 'text'; role: TextRole; text: DesignText; items?: DesignText[]; group?: string; tone?: 'onDark'; accent?: 'gold' | 'muted' | 'focus' | 'ink' } & Placed
  /** a chart; `viz` is a frr-viz/1 spec (the visual's meaning); `emphasis` is styling only (the dataset drawn in the focus colour) */
  | { id: string; kind: 'viz'; role: 'primary' | 'secondary'; viz: VizSpec; emphasis?: string; group?: string; draw?: ChartDraw } & Placed
  | { id: string; kind: 'table'; role: 'primary' | 'secondary'; table: TableSpec }
  /** a KPI callout: one bound figure, what it measures (with its unit), and optional bound context */
  | { id: string; kind: 'kpi'; role: 'kpi'; value: DesignText; label: string; context?: DesignText; variant?: 'hero' | 'stat' | 'band'; group?: string; tone?: 'onDark' } & Placed
  /** PD2: structural shapes of a composition (masthead band, dark panel, rules); native shapes, not data */
  | { id: string; kind: 'shape'; role: 'masthead' | 'panel' | 'rule' }
  /** a decorative visual asset (never data): a self-authored motif from motifs.ts, or a licensed image with provenance */
  | { id: string; kind: 'shape'; role: 'asset'; motif: string; slot?: string; place?: 'bottom' | 'top' | 'fill'; opacity?: number }

/** Where an object sits in a 'columns' composition: its slot, and for a matrix slot its cell (row, column); a cell in
 *  column 0 may carry a badge (a numeral in a filled circle, a position, not a figure). */
export interface Placed { slot?: string; cell?: { r: number; c: number; badge?: string }; node?: { r: number; c: number } }

/** How a designed chart is drawn (presentation only; the spec is the meaning). Recipes R2 and R3 add the last four. */
export interface ChartDraw {
  annotate?: 'change' | 'gap'; mini?: boolean; reference?: string
  /** R2: a light panel behind the bars; rank numerals at the left */
  panel?: boolean; ranks?: boolean
  /** R3: a shaded band over a period (categories, inclusive), labelled with the period; one callout on the focus series */
  band?: { from: string; to: string }; callout?: 'max' | 'min'
  /** Gate E: a two-period spec drawn as a ranked table (rank, name, bar of the latest value, earlier value, change) */
  form?: 'rankTable' | 'delta' | 'benchList'
  /** category flags beside entity names (national flags drawn as native shapes) */
  flags?: boolean
  /** a sparkline in a matrix cell: no end labels (the cell's figures carry the values) */
  spark?: boolean
}

export interface SlideDesign {
  schema: typeof DESIGN_SCHEMA
  id: string
  /** what the slide must achieve, in one sentence */
  objective: string
  /** the single most important message (the takeaway) */
  claim: DesignText
  audience: Audience
  density: Density
  layout: { family: LayoutFamily; params: LayoutParams; composition?: Composition }
  /** PD2: the visual language (language.ts); compositions require one */
  language?: string
  /** design profile id (project-level style) */
  profile: string
  objects: DesignObject[]
  /** the planner's answers: message, evidence, visual, emphasis, amount, layout, form, fit with the deck */
  rationale: string[]
  /** figures computed from evidence that the text cites (a change in pp, a spread); added to the project on apply */
  derivations?: Derivation[]
}

/** The project as the design sees it: its own derivations included (they are formulas over evidence, not data). */
export function withDerivations(p: Project, d: SlideDesign): Project {
  if (!d.derivations?.length) return p
  return { ...p, derivations: { ...(p.derivations ?? {}), ...Object.fromEntries(d.derivations.map((x) => [x.id, x])) } }
}

/** What a slide's design looks like once applied: the design, and which element realizes each object. */
export interface AppliedDesign { design: SlideDesign; elements: Record<string, string> }
/** Who last set an element's position, text or chart choice by hand. AI redesigns keep what the user owns. */
export interface Owned { box?: true; text?: true; content?: true }

export function designDatasets(d: SlideDesign): string[] {
  const out = new Set<string>()
  for (const o of d.objects) {
    if (o.kind === 'viz') vizDatasets(o.viz).forEach((x) => out.add(x))
    if (o.kind === 'table') o.table.datasets.forEach((x) => out.add(x))
  }
  return [...out]
}

/** A section numeral on an agenda or divider: one or two digits and nothing else. Bound with role "nav". */
export const navNumeral = (d: SlideDesign, o: DesignObject) => o.kind === 'text' && o.role === 'label' && NAVIGATION.includes(d.layout?.composition?.kind as CompositionKind) && /^\s*\d{1,2}\s*$/.test(o.text.text)

export function designTexts(d: SlideDesign): { where: string; t: DesignText }[] {
  const out: { where: string; t: DesignText }[] = [{ where: 'claim', t: d.claim }]
  for (const o of d.objects) {
    // source notes cite dataset codes and retrieval dates, not figures (integrity skips them too); so are navigation numerals
    if (o.kind === 'text' && o.role !== 'source' && !navNumeral(d, o)) { out.push({ where: o.id, t: o.text }); (o.items ?? []).forEach((t, i) => out.push({ where: `${o.id}[${i}]`, t })) }
    if (o.kind === 'kpi') { out.push({ where: o.id, t: o.value }); if (o.context) out.push({ where: `${o.id}.context`, t: o.context }) }
  }
  return out
}

const FORBIDDEN_KEYS = ['values', 'observations', 'working', 'series_values']
const inRange = (v: number | undefined, a: number, b: number) => v == null || (Number.isFinite(v) && v >= a && v <= b)

/**
 * Deterministic checks a design must pass before it can reach the deck: schema, layout parameters, the objects
 * the family needs, valid visuals for the data, and every figure bound to evidence that still says so.
 * Returns the problems (empty: valid). A creative proposal from the model goes through the same checks.
 */
export function validateDesign(project: Project, d: SlideDesign): string[] {
  const errs: string[] = [], p = withDerivations(project, d)
  if (d.schema !== DESIGN_SCHEMA) errs.push(`schema must be ${DESIGN_SCHEMA}`)
  if (!d.objective?.trim()) errs.push('a slide needs a communication objective')
  if (!d.claim?.text?.trim()) errs.push('a slide needs one main takeaway')
  if (!FAMILIES.includes(d.layout?.family)) errs.push(`unknown layout family "${d.layout?.family}"`)
  if (!PROFILES[d.profile]) errs.push(`unknown design profile "${d.profile}"`)
  const pr = d.layout?.params ?? {}
  if (!inRange(pr.heroShare, 0.55, 1)) errs.push('heroShare must be between 0.55 and 1')
  if (!inRange(pr.split, 0.4, 0.7)) errs.push('split must be between 0.4 and 0.7')
  const ids = new Set<string>()
  for (const o of d.objects ?? []) { if (ids.has(o.id)) errs.push(`duplicate object id "${o.id}"`); ids.add(o.id) }
  // the design layer refers to data; it must not carry a copy of it
  const scan = (x: any, path: string) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (FORBIDDEN_KEYS.includes(k) && !path.includes('.viz')) errs.push(`${path}.${k}: datasets are referenced, not copied into the design`); scan(v, `${path}.${k}`) } }
  scan(d.objects, 'objects')
  const visuals = (d.objects ?? []).filter((o) => o.kind === 'viz' || o.kind === 'table')
  const kpis = (d.objects ?? []).filter((o) => o.kind === 'kpi')
  if (d.layout?.family === 'analytical_hero' && !(d.objects ?? []).some((o) => o.kind === 'viz' && o.role === 'primary')) errs.push('an analytical hero needs one primary chart')
  if (d.layout?.family === 'comparative' && visuals.length < 2) errs.push('a comparative layout needs two visual objects (charts or a chart and a table)')
  if (d.layout?.family === 'executive_insight' && (kpis.length < 2 || kpis.length > 4)) errs.push('an executive insight needs 2 to 4 KPIs')
  const nav = d.layout?.family === 'composed' && NAVIGATION.includes(d.layout.composition?.kind as CompositionKind)
  if (nav) {
    if (!(d.objects ?? []).some((o) => o.kind === 'text' && o.role === 'headline')) errs.push('a navigation slide needs a title')
    if ((d.objects ?? []).some((o) => o.kind === 'viz' || o.kind === 'table' || o.kind === 'kpi')) errs.push('navigation slides carry no charts, tables or figures')
  } else if (d.layout?.family === 'composed') {
    if (!d.layout.composition) errs.push('a composed slide needs a composition')
    if (!(d.objects ?? []).some((o) => o.kind === 'text' && o.role === 'headline')) errs.push('a composed slide needs a headline')
    if (!(d.objects ?? []).some((o) => (o.kind === 'kpi' && o.variant === 'hero') || (o.kind === 'viz' && o.role === 'primary') || (o.kind === 'kpi' && o.variant === 'band') || !!(o as any).cell || !!(o as any).node)) errs.push('a composed slide needs a focal point: a hero figure, a primary chart, figure bands, a matrix or a diagram')
    if (d.layout.composition?.kind === 'columns') {
      const slots = new Set((d.layout.composition.params?.columns ?? []).flatMap((c) => c.slots))
      const span = (d.layout.composition.params?.columns ?? []).reduce((a, c) => a + c.span, 0)
      if (!slots.size || span > 12) errs.push('a columns composition needs columns whose spans add up to 12 at most')
      for (const o of d.objects ?? []) if ((o as any).slot && !slots.has((o as any).slot)) errs.push(`${o.id}: slot "${(o as any).slot}" is not in the composition`)
    }
  }
  for (const o of d.objects ?? []) {
    if (o.kind === 'viz') {
      for (const ds of vizDatasets(o.viz)) if (!p.datasets[ds]) errs.push(`${o.id}: dataset ${ds} is not in the project`)
      const a = assess(p, o.viz)
      if (a.invalid) errs.push(`${o.id}: ${a.invalid.reason}`)
      const unaccepted = a.warnings.filter((w) => !(o.viz.accepted_warnings ?? []).includes(w.code))
      if (unaccepted.length) errs.push(`${o.id}: ${unaccepted.map((w) => w.reason).join('; ')} (needs "Use anyway")`)
      if (o.viz.family === 'multiples' && vizDatasets(o.viz).length > 4 && o.role !== 'primary') errs.push(`${o.id}: small multiples of more than four panels must be the primary visual, or the panels become unreadable`)
    }
    if (o.kind === 'table') for (const ds of o.table.datasets) if (!p.datasets[ds]) errs.push(`${o.id}: dataset ${ds} is not in the project`)
    if (o.kind === 'kpi') {
      if (figures(o.value.text).length !== 1) errs.push(`${o.id}: a KPI shows exactly one figure`)
      if (!o.label?.trim()) errs.push(`${o.id}: a KPI needs a label saying what it measures`)
    }
  }
  for (const e of d.layout?.composition?.params?.diagram?.edges ?? []) if (e.label && figures(e.label).length) errs.push(`edge ${e.from}→${e.to}: an edge label carries words only`)
  for (const { where, t } of designTexts(d)) if (t.lead && figures(t.lead).length) errs.push(`${where}: a lead-in carries words only, not figures`)
  for (const { where, t } of designTexts(d)) for (const n of textNumbers(t.text, t.numbers, p)) {
    if (n.status === 'unsourced') errs.push(`${where}: "${n.text}" has no evidence behind it`)
    if (n.status === 'stale') errs.push(`${where}: "${n.text}" no longer matches the data (${n.data})`)
  }
  return errs
}

/** Ids from a counter: stable inside one design, readable in diffs. */
export const objectId = (kind: string, n: number) => `${kind}${n}`
export const newDesignId = () => 'design-' + crypto.randomUUID().slice(0, 8)
