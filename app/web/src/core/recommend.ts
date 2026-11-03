// Visual recommender (VIS V2): intent -> data profile -> candidates -> hard constraints -> scoring ->
// one recommendation (+ alternatives) with a one-line reason built from facts. Deterministic: the model
// only names the intent (or asks); code decides what is valid and what fits best. The same functions drive
// the change-visual menu, the agent's proposal cards and slide composition.
import { measureOf, profile, type Finding, type Profile } from './constraints'
import { assess, newVizId, project, VIZ_SCHEMA, VizError, type Family, type Projected, type Subtype, type Transform, type View, type VizSpec } from './viz'
import type { Project, TableSpec } from './types'

export type Intent = 'trend' | 'ranking' | 'change' | 'composition' | 'relationship' | 'spotlight' | 'ratings' | 'distribution' | 'curve' | 'maturity' | 'sensitivity'
export const INTENTS: Intent[] = ['trend', 'ranking', 'change', 'composition', 'relationship', 'spotlight', 'ratings', 'distribution', 'curve', 'maturity', 'sensitivity']

/** ratings: rating-action evidence ids instead of datasets */
export interface VisualRequest { intent: Intent; datasets: string[]; evidence?: string[]; title?: string; at?: string; between?: [string, string]; from?: string; to?: string; params?: View['params'] }
export interface Candidate {
  key: string; label: string
  /** a chart from a spec, or a compact table (new visuals only) */
  spec?: VizSpec; table?: TableSpec
  score: number; why: string
  /** valid: fits; warning: allowed after the user reads why ("Use anyway"); invalid: blocked (`refused` says why) */
  state: 'valid' | 'warning' | 'invalid'
  refused: string | null; invalid: Finding | null; warnings: Finding[]
}
export interface Recommendation { intent: Intent; candidates: Candidate[]; recommended: Candidate | null; profile?: Profile; error?: string }

type Option = { family: Family | 'table'; subtype?: Subtype; transform: Transform; label: string }
const OPTIONS: Record<Intent, Option[]> = {
  trend: [{ family: 'line', transform: 'none', label: 'Line' }, { family: 'column', transform: 'none', label: 'Columns' }, { family: 'multiples', transform: 'none', label: 'Small multiples (same scale)' },
    { family: 'area', transform: 'none', label: 'Area' }, { family: 'step', transform: 'none', label: 'Step line' },
    { family: 'combo', transform: 'none', label: 'Columns + line (two units)' }, { family: 'column', subtype: 'stacked', transform: 'none', label: 'Stacked columns' }],
  ranking: [{ family: 'bar', transform: 'rank', label: 'Ranked horizontal bar' }, { family: 'lollipop', transform: 'rank', label: 'Lollipop' }, { family: 'dot', transform: 'rank', label: 'Dot plot' },
    { family: 'column', transform: 'rank', label: 'Ranked columns' }, { family: 'table', transform: 'rank', label: 'Compact table' }, { family: 'pie', transform: 'latest', label: 'Pie' }],
  change: [{ family: 'bar', transform: 'diff', label: 'Change as horizontal bars (from zero)' }, { family: 'dumbbell', transform: 'pair', label: 'Dumbbell (both periods)' },
    { family: 'waterfall', transform: 'bridge', label: 'Bridge of yearly changes' }, { family: 'slope', transform: 'pair', label: 'Slope chart' },
    { family: 'lollipop', transform: 'diff', label: 'Change as lollipops' }, { family: 'column', transform: 'diff', label: 'Change as columns' }, { family: 'table', transform: 'diff', label: 'Table of both periods' }],
  composition: [{ family: 'doughnut', transform: 'latest', label: 'Doughnut' }, { family: 'pie', transform: 'latest', label: 'Pie' }, { family: 'column', subtype: 'stacked', transform: 'none', label: 'Stacked columns' },
    { family: 'column', subtype: 'percent', transform: 'none', label: '100% stacked columns' }, { family: 'bar', transform: 'rank', label: 'Ranked horizontal bar' }],
  relationship: [{ family: 'scatter', transform: 'none', label: 'Scatter' }],
  spotlight: [{ family: 'kpi', transform: 'pair', label: 'KPI spotlight' }],
  ratings: [{ family: 'rating_timeline', transform: 'ratings', label: 'Rating timeline' }],
  distribution: [{ family: 'box', transform: 'distribution', label: 'Box plot (with every value)' }, { family: 'histogram', transform: 'histogram', label: 'Histogram' },
    { family: 'range', transform: 'range', label: 'Range (lowest to highest, latest marked)' }],
  curve: [{ family: 'yield_curve', transform: 'curve', label: 'Yield curve' }],
  maturity: [{ family: 'column', transform: 'buckets', label: 'Maturity ladder (columns)' }, { family: 'bar', transform: 'buckets', label: 'Maturity ladder (horizontal bars)' },
    { family: 'doughnut', transform: 'buckets', label: 'Doughnut of debt by maturity' }],
  sensitivity: [{ family: 'heatmap', transform: 'sensitivity', label: 'Sensitivity table (shaded)' }],
}

/** Fit of a family for an intent, adjusted by the data profile (higher is better; 0-1). */
function score(intent: Intent, o: Option, pf: Profile, datasets: number): number {
  let s = ({ trend: { line: 0.85, column: 0.75, area: 0.55, combo: 0.6, multiples: 0.6, step: 0.45 }, ranking: { bar: 0.9, lollipop: 0.82, dot: 0.8, column: 0.7, table: 0.6, pie: 0.4 },
    change: { bar: 0.9, dumbbell: 0.85, waterfall: 0.6, slope: 0.75, lollipop: 0.8, column: 0.7, table: 0.55 },
    composition: { doughnut: 0.7, pie: 0.65, column: 0.75, bar: 0.5 }, relationship: { scatter: 0.95 }, spotlight: { kpi: 0.9 }, ratings: { rating_timeline: 0.95 },
    distribution: { box: 0.85, histogram: 0.75, range: 0.7 }, curve: { yield_curve: 0.95 }, maturity: { column: 0.9, bar: 0.8, doughnut: 0.6 }, sensitivity: { heatmap: 0.95 } } as any)[intent]?.[o.family] ?? 0.3
  if (intent === 'trend') {
    if (o.family === 'column' && !o.subtype) s += pf.periods <= 6 ? 0.2 : pf.periods <= 10 && pf.negatives ? 0.15 : pf.periods >= 12 ? -0.25 : 0
    if (o.family === 'line') s += pf.periods >= 12 ? 0.1 : pf.periods <= 6 ? -0.1 : 0
    if (o.family === 'column' && pf.series > 3) s -= 0.2
    if (o.family === 'combo') s += pf.units.length === 2 ? 0.3 : -1
    if (o.family === 'multiples') s += pf.series >= 5 ? 0.35 : pf.series >= 3 ? 0.1 : -0.3 // many entities: one panel each
  }
  if (intent === 'change') {
    // one dataset: its bridge through each year; several: one row per entity
    if (datasets === 1 && (o.family === 'bar' || o.family === 'column' || o.family === 'lollipop' || o.family === 'dumbbell' || o.family === 'slope')) s -= 0.4
    if (o.family === 'waterfall') s += datasets === 1 ? 0.35 : -1
    if (o.family === 'slope' && pf.categories > 8) s -= 0.3
  }
  if (intent === 'ranking' || intent === 'change') {
    if (o.family === 'column') s += pf.categories <= 6 ? 0.05 : -0.25
    if (o.family === 'table') s += pf.categories > 12 ? 0.25 : 0
  }
  if (intent === 'distribution') {
    if (o.family === 'histogram') s += datasets >= 40 ? 0.15 : datasets >= 15 ? 0 : -0.1 // a histogram needs many values; up to dozens of named entities, a box with every dot shows more
    if (o.family === 'range') s += datasets <= 12 ? 0.1 : -0.2 // one row per entity
  }
  if (intent === 'composition' && (o.family === 'pie' || o.family === 'doughnut')) s += pf.categories <= 5 ? 0.05 : -0.1
  return Math.round(Math.min(1, Math.max(0, s)) * 100) / 100
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** One line from facts: why this candidate fits (or what it is, for alternatives). */
function why(intent: Intent, o: Option, pf: Profile, pr: Projected): string {
  const ents = pr.shape === 'cross' ? `${pf.categories} ${pf.categories === 1 ? 'entity' : 'entities'}` : plural(pf.periods, 'period')
  const neg = pf.negatives ? `; bars diverge from zero because ${plural(pf.negatives, 'value')} ${pf.negatives === 1 ? 'is' : 'are'} negative` : ''
  if (o.family === 'table') return `Exact values, compact: useful when readers need the numbers more than the pattern.`
  if (intent === 'ranking' && o.family === 'bar') return `It compares ${ents} at one point in time (${pr.periods?.[0]}), sorted${neg || ', largest first'}.`
  if (intent === 'change' && o.family === 'bar') return `It shows each entity's change (${pr.unit}) from a common zero line, so rises and falls read at a glance.`
  if (intent === 'trend' && o.family === 'column') return `${plural(pf.periods, 'discrete period')} compare better as columns than as a line${pf.negatives ? '; negative values diverge from zero' : ''}.`
  if (intent === 'trend' && o.family === 'line') return `${plural(pf.periods, 'period')} show the trend; gaps stay visible as breaks.`
  if (o.family === 'multiples') return `${pf.series} series over ${plural(pf.periods, 'period')}: one panel each on the same scale reads more clearly than ${pf.series} overlapping lines.`
  if (o.family === 'step') return `Each value holds until the next period.`
  if (o.family === 'dumbbell') return `Both periods per entity on one scale (${pr.periods?.join(' and ')}); the gap between the dots is the change.`
  if (o.family === 'slope') return `Each entity's line from ${pr.periods?.[0]} to ${pr.periods?.[1]}; the slope is the change.`
  if (o.family === 'waterfall') return `From the ${pr.periods?.[0]} level through each period's change to ${pr.periods?.[1]}; the changes add up exactly to the difference.`
  if (o.family === 'lollipop' || o.family === 'dot') return intent === 'change' ? `Each entity's change from zero, as a dot on a stem.` : `It compares ${ents} at one point in time (${pr.periods?.[0]}), sorted${neg ? '; values left of zero are negative' : ''}.`
  if (o.family === 'kpi') return `The ${pr.periods?.[1]} value, large, with the change since ${pr.periods?.[0]}.`
  if (o.family === 'box') return pr.categories.length > 1 ? `The spread of ${pr.series.length - (pr.stats ?? 5)} values in each period, ${pr.categories[0]}–${pr.categories.at(-1)}: box for the middle half, line for the median, every value as a dot.`
    : `The spread of ${pr.series.length - (pr.stats ?? 5)} values in ${pr.categories[0]}: box for the middle half, line for the median, every value as a dot.`
  if (o.family === 'histogram') return `${pr.series[0]!.values.reduce<number>((a, v) => a + (v ?? 0), 0)} values counted in ${pr.bins!.length} equal bins (${pr.periods?.[0]}).`
  if (o.family === 'range') return `Each entity's lowest and highest value over ${pr.periods?.[0]}–${pr.periods?.[1]}, with ${pr.periods?.[1]} marked.`
  if (o.family === 'yield_curve') return `Spot yields by maturity on a proportional tenor axis (${pr.tenors!.length} maturities, ${pr.periods!.join(' and ')}).`
  if (intent === 'maturity' && o.family !== 'doughnut') return `Debt by remaining maturity in ${pr.periods?.[0]}, shortest first: what falls due when.`
  if (o.family === 'heatmap') return `Debt ratio after ${pr.grid!.years} years for ${pr.grid!.rates.length} interest × ${pr.grid!.growth.length} growth assumptions, from verified ${pr.grid!.at} inputs: scenario arithmetic, not a forecast.`
  if (o.family === 'rating_timeline') return `${plural(pr.ratings?.length ?? 0, 'dated agency action')} on the ordinal rating scale; each rating holds until that agency's next action.`
  if (intent === 'relationship') return `Each point pairs the two measures for one period (${plural(pf.categories, 'point')}); correlation is not causation.`
  if (o.family === 'pie' || o.family === 'doughnut') return `Parts of one total at one period (${plural(pf.categories, 'part')}).`
  return `${o.label} of ${pr.label}.`
}

function viewFor(p: Project, req: VisualRequest, o: Option): View {
  const base = { datasets: req.datasets, transform: o.transform }
  // a KPI compares the latest value with the period before it, unless asked otherwise
  if (o.family === 'kpi' && !req.between) {
    const have = (p.datasets[req.datasets[0]!]?.observations ?? []).filter((x) => x.value != null).map((x) => x.date).sort()
    return have.length >= 2 ? { ...base, between: [have.at(-2)!, have.at(-1)!] } : base
  }
  if (o.transform === 'none') return { ...base, ...(req.from ? { from: req.from } : {}), ...(req.to ? { to: req.to } : {}) }
  if (o.transform === 'ratings') return { datasets: [], transform: 'ratings', evidence: req.evidence ?? [] }
  if (o.transform === 'sensitivity') return { ...base, ...(req.at ? { at: req.at } : {}), ...(req.params ? { params: req.params } : {}) }
  if (o.transform === 'range' || (o.transform === 'distribution' && req.between)) return { ...base, ...(req.between ? { between: req.between } : {}) }
  if (o.transform === 'curve' && req.between) return { ...base, between: req.between }
  if (o.transform === 'diff' || o.transform === 'pct_change' || o.transform === 'pair' || o.transform === 'bridge') return { ...base, ...(req.between ? { between: req.between } : {}) }
  return { ...base, ...(req.at ? { at: req.at } : {}) }
}

const RANK = { valid: 0, warning: 1, invalid: 2 }

/** Candidates for a request, scored; refused ones keep their reason and sort last. */
export function recommend(p: Project, req: VisualRequest): Recommendation {
  const missing = req.datasets.filter((d) => !p.datasets[d])
  if (req.intent === 'ratings') {
    const bad = (req.evidence ?? []).filter((e) => !(p.evidence[e] as any)?.rating)
    if (!req.evidence?.length || bad.length) return { intent: req.intent, candidates: [], recommended: null, error: bad.length ? `not rating actions: ${bad.join(', ')}` : 'no rating actions' }
  } else if (!req.datasets.length || missing.length) return { intent: req.intent, candidates: [], recommended: null, error: missing.length ? `not in the project: ${missing.join(', ')}` : 'no datasets' }
  let pf: Profile | undefined
  const candidates: Candidate[] = OPTIONS[req.intent].map((o) => {
    const key = `${o.family}${o.subtype ? ':' + o.subtype : ''}:${o.transform}`
    const view = viewFor(p, req, o)
    const family = o.family === 'table' ? 'column' : o.family // a table is checked like the columns it replaces
    const spec: VizSpec = { schema: VIZ_SCHEMA, id: newVizId(), title: req.title ?? '', family, ...(o.subtype ? { subtype: o.subtype } : {}), view, missing: 'gap' }
    const a = assess(p, spec)
    if (!a.pr) return { key, label: o.label, score: 0, refused: a.invalid!.reason, invalid: a.invalid, warnings: [], state: 'invalid' as const, why: '' }
    const pr = a.pr, prof = profile(p, spec, pr)
    pf ??= prof
    if (!spec.title) spec.title = pr.label.charAt(0).toUpperCase() + pr.label.slice(1) + (pr.shape === 'time' ? `, ${pr.unit}` : '')
    const state = a.invalid ? 'invalid' as const : a.warnings.length ? 'warning' as const : 'valid' as const
    const out: Candidate = { key, label: o.label, score: a.invalid ? 0 : score(req.intent, o, prof, req.datasets.length) * (a.warnings.length ? 0.5 : 1), refused: a.invalid?.reason ?? null, invalid: a.invalid,
      warnings: a.warnings, state, why: a.invalid ? '' : why(req.intent, o, prof, pr) }
    if (o.family === 'table') {
      const order = pr.shape === 'cross' && o.transform === 'rank' ? pr.categories.map((ent) => req.datasets.find((d) => p.datasets[d]!.entity === ent)!) : req.datasets
      out.table = { title: spec.title, datasets: order, dates: [...(pr.periods ?? [])] }
    } else out.spec = spec
    return out
  }).sort((a, b) => RANK[a.state] - RANK[b.state] || b.score - a.score)
  // only a visual without warnings is recommended; warned ones stay available as the user's choice
  return { intent: req.intent, candidates, recommended: candidates.find((c) => c.state === 'valid') ?? null, ...(pf ? { profile: pf } : {}) }
}

/** The intent a spec currently expresses. */
export function intentOf(spec: VizSpec): Intent {
  if (spec.family === 'scatter') return 'relationship'
  if (spec.family === 'kpi') return 'spotlight'
  if (spec.family === 'yield_curve') return 'curve'
  if (spec.family === 'box' || spec.family === 'histogram' || spec.family === 'range') return 'distribution'
  if (spec.family === 'heatmap') return 'sensitivity'
  if (spec.view.transform === 'buckets') return 'maturity'
  if (spec.family === 'rating_timeline') return 'ratings'
  if (spec.family === 'dumbbell' || spec.family === 'slope' || spec.family === 'waterfall') return 'change'
  if (spec.family === 'pie' || spec.family === 'doughnut' || spec.subtype === 'stacked' || spec.subtype === 'percent') return 'composition'
  if (spec.view.transform === 'diff' || spec.view.transform === 'pct_change' || spec.view.transform === 'pair' || spec.view.transform === 'bridge') return 'change'
  if (spec.view.transform === 'none') return 'trend'
  return 'ranking'
}

export interface ChangeOption {
  label: string; intent: Intent; family: Family; subtype?: Subtype; transform: Transform; between?: [string, string]
  state: Candidate['state']; refused: string | null; warnings: Finding[]
  /** for an invalid option: a change of the data's view that makes it valid (never new or altered values) */
  fixes: Fix[]
  recommended: boolean; current: boolean
}
/** Every visual the selected chart's data allows, with the reason for those it does not (change-visual menu). */
export function changeOptions(p: Project, spec: VizSpec): ChangeOption[] {
  const req: VisualRequest = { intent: intentOf(spec), datasets: spec.view.datasets, ...(spec.view.evidence ? { evidence: spec.view.evidence } : {}), ...(spec.view.params ? { params: spec.view.params } : {}), ...(spec.view.at ? { at: spec.view.at } : {}), ...(spec.view.between ? { between: spec.view.between } : {}), ...(spec.view.from ? { from: spec.view.from } : {}) }
  const seen = new Set<string>(), out: ChangeOption[] = []
  const best = new Map<Intent, string>()
  for (const intent of INTENTS) {
    const r = recommend(p, { ...req, intent })
    if (r.recommended?.spec) best.set(intent, r.recommended.key)
    for (const c of r.candidates) {
      if (!c.spec || seen.has(c.key)) continue
      seen.add(c.key)
      const s = c.spec
      out.push({ label: c.label, intent, family: s.family, ...(s.subtype ? { subtype: s.subtype } : {}), transform: s.view.transform, ...(s.family === 'kpi' && s.view.between ? { between: s.view.between } : {}), state: c.state, refused: c.refused, warnings: c.warnings,
        fixes: c.invalid ? fixes(p, s, c.invalid) : [], recommended: best.get(intent) === c.key,
        current: s.family === spec.family && (s.subtype ?? 'clustered') === (spec.subtype ?? 'clustered') && s.view.transform === spec.view.transform })
    }
  }
  return out
}

export interface Fix { label: string; family: Family; subtype?: Subtype; transform: Transform; at?: string; from?: string; between?: [string, string] }
/** Ways to make an invalid visual valid by changing which data is shown, not the data: e.g. a pie with a
 *  missing part becomes valid at the latest period where every part is reported. */
export function fixes(p: Project, spec: VizSpec, f: Finding): Fix[] {
  const base = { family: spec.family, ...(spec.subtype ? { subtype: spec.subtype } : {}) }
  const complete = (view: View) => { try { const pr = project(p, view); return pr.series.every((x) => x.values.every((v) => v != null)) ? pr : null } catch { return null } }
  // a part-to-whole with a missing part (the V1 shape rule catches it first for pies and doughnuts)
  const gaps = () => { try { return project(p, spec.view).series.some((x) => x.values.some((v) => v == null)) } catch { return false } }
  if (f.code === 'bridge_gap') {
    const pr = project(p, spec.view), v = pr.series[0]!.values, last = v.map((x) => x == null).lastIndexOf(true)
    const ds = p.datasets[spec.view.datasets[0]!]!, have = ds.observations.map((o) => o.date).sort()
    const end = spec.view.between?.[1] ?? have.at(-1)!
    // the first period after the last gap: a missing level at t empties the changes into and out of t, so the
    // last empty value is the change into the next period, whose level is known
    const from = pr.categories[last]?.replace(/ change$/, '')
    return from && from < end && complete({ ...spec.view, between: [from, end] }) ? [{ ...base, transform: 'bridge', between: [from, end], label: `Bridge ${from}–${end}, the periods with no gap` }] : []
  }
  if (f.code !== 'missing_parts' && !(f.code === 'shape' && (spec.family === 'pie' || spec.family === 'doughnut') && gaps())) return []
  if (spec.view.transform === 'none') {
    const pr = project(p, spec.view), last = Math.max(...pr.series.map((x) => x.values.findLastIndex((v) => v == null)))
    const from = pr.categories[last + 1]
    return from && pr.categories.length - last - 1 >= 2 && complete({ ...spec.view, from }) ? [{ ...base, transform: 'none', from, label: `Show ${from}–${pr.categories.at(-1)}, the periods where every part is reported` }] : []
  }
  const dates = [...new Set(spec.view.datasets.flatMap((d) => p.datasets[d]?.observations.map((o) => o.date) ?? []))].sort().reverse()
  const transform: Transform = spec.view.transform === 'rank' ? 'rank' : 'at'
  for (const at of dates) if (at !== spec.view.at && complete({ ...spec.view, transform, at })) return [{ ...base, transform, at, label: `Show ${at}, the latest period where every part is reported` }]
  return []
}

export { measureOf, VizError }
