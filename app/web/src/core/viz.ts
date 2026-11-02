// Renderer-independent visualization spec (frr-viz/1, VIS V1).
//
//   Evidence (immutable) -> working dataset (manual edits, M3) -> VIEW (typed: time series, one period,
//   rank, change) -> VizSpec (authoritative) -> realization (GenOffice native chart, regenerated)
//
// The spec says what is shown (datasets, view, family, units); the GenOffice chart XML is only a
// realization, rebuilt from project(spec) whenever data or the spec changes, and integrity compares the
// realization with project(spec) (the same check M1-M5 did for chart bindings). Every projected value
// carries its provenance: the evidence id behind a working value, or the formula and inputs of a derived
// value (diff, pct_change). Missing values are gaps, never zeros.
import { chartColors, decimalsOf, effectiveObs } from './evidence'
import type { Dataset, Project } from './types'
import { notch } from './ratings'
import { findings, type Finding } from './constraints'

export const VIZ_SCHEMA = 'frr-viz/1'
export type NativeFamily = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'combo'
/** drawn as grouped shapes by the composite adapter (VIS V3): editable as shapes, not as PowerPoint charts */
export type CompositeFamily = 'dumbbell' | 'slope' | 'dot' | 'lollipop' | 'waterfall' | 'step' | 'multiples' | 'kpi' | 'rating_timeline'
export type Family = NativeFamily | CompositeFamily
export type Subtype = 'clustered' | 'stacked' | 'percent'
export type Transform = 'none' | 'latest' | 'at' | 'rank' | 'diff' | 'pct_change' | 'pair' | 'bridge' | 'ratings'
export const NATIVE: NativeFamily[] = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'combo']
export const COMPOSITE: CompositeFamily[] = ['dumbbell', 'slope', 'dot', 'lollipop', 'waterfall', 'step', 'multiples', 'kpi', 'rating_timeline']
export const FAMILIES: Family[] = [...NATIVE, ...COMPOSITE]
export const isComposite = (f: Family): f is CompositeFamily => (COMPOSITE as string[]).includes(f)

export interface View {
  datasets: string[]
  transform: Transform
  /** time series: period range (inclusive) */
  from?: string; to?: string
  /** 'at': the period of a cross-section ('latest' picks the latest period every dataset has) */
  at?: string
  /** diff / pct_change: [from, to]; default the earliest and latest periods every dataset has */
  between?: [string, string]
  /** rank: largest first by default */
  order?: 'desc' | 'asc'
  /** pair: the two periods per entity [start, end]; bridge: the level at start, each period's change, the level at end
   *  (both use `between`). ratings: rating-action evidence ids (no datasets) */
  evidence?: string[]
}

export interface VizSpec {
  schema: typeof VIZ_SCHEMA
  id: string
  title: string
  family: Family
  subtype?: Subtype
  view: View
  missing: 'gap'
  legend?: 'b' | 'r' | 'none'
  /** warning codes the user chose to keep ("Use anyway", VIS V2); never covers an invalid visual */
  accepted_warnings?: string[]
}

/** Where one projected value comes from. */
export type Cell =
  | null
  | { evidence: string | null; dataset: string; period: string; edited: boolean }
  | { derived: { formula: string; inputs: Record<string, { evidence: string | null; dataset: string; period: string; value: number | null }> } }

export interface RatingPoint { evidence: string; agency: string; date: string; rating: string; outlook: string | null; action: string; notch: number }
export interface Projected {
  shape: 'time' | 'cross' | 'pairs' | 'ratings'
  categories: string[]
  series: { name: string; dataset?: string; values: (number | null)[]; cells: Cell[] }[]
  unit: string
  /** for 'pairs' (scatter): x values per point, and the x dataset */
  x?: { dataset: string; values: number[]; cells: Cell[] }
  label: string
  /** cross-sections: the period shown ([at]) or compared ([start, end]) */
  periods?: string[]
  /** bridge: which values are levels and which are changes (same order as categories) */
  kinds?: ('total' | 'delta')[]
  /** ratings: dated actions (drawn), and actions without a verified date (listed, not placed) */
  ratings?: RatingPoint[]; undated?: string[]
}

export class VizError extends Error {}

const ds = (p: Project, id: string): Dataset => {
  const d = p.datasets[id]
  if (!d) throw new VizError(`dataset ${id} is not in the project`)
  return d
}
const obsAt = (d: Dataset, period: string) => effectiveObs(d).find((o) => o.date === period)
const valueCell = (dsId: string, d: Dataset, period: string): { value: number | null; cell: Cell } => {
  const o = obsAt(d, period)
  return o?.value == null ? { value: null, cell: null } : { value: o.value, cell: { evidence: o.evidence_id ?? null, dataset: dsId, period, edited: o.edited } }
}
/** Periods (non-missing) every dataset has, sorted. */
const commonPeriods = (p: Project, ids: string[]) => {
  const sets = ids.map((id) => new Set(effectiveObs(ds(p, id)).filter((o) => o.value != null).map((o) => o.date)))
  return [...sets[0] ?? []].filter((x) => sets.every((s) => s.has(x))).sort()
}
/** Series names: the entity, unless two datasets share an entity (then the metric). */
const names = (p: Project, ids: string[]) => {
  const ents = ids.map((id) => ds(p, id).entity)
  return ids.map((id, i) => (ents.indexOf(ents[i]!) !== ents.lastIndexOf(ents[i]!) ? `${ds(p, id).entity} · ${ds(p, id).metric}` : ents[i]!))
}

export function project(p: Project, view: View, opts: { mixedUnits?: boolean; scatter?: boolean } = {}): Projected {
  const ids = view.datasets
  if (view.transform === 'ratings') return projectRatings(p, view)
  if (!ids.length) throw new VizError('a view needs at least one dataset')
  const units = [...new Set(ids.map((id) => ds(p, id).unit))]
  if (units.length > 1 && !opts.mixedUnits && !opts.scatter) throw new VizError(`datasets have different units (${units.join(', ')}); one axis shows one unit`)
  const unit = units[0]!
  const metricLabel = ds(p, ids[0]!).title.split(' · ').slice(1).join(' · ') || ds(p, ids[0]!).metric

  if (opts.scatter) {
    if (ids.length !== 2 || view.transform !== 'none') throw new VizError('a scatter pairs exactly two datasets over time (x, y)')
    const [xi, yi] = ids as [string, string]
    const pts = commonPeriods(p, ids).filter((t) => (!view.from || t >= view.from) && (!view.to || t <= view.to))
    const X = pts.map((t) => valueCell(xi, ds(p, xi), t)), Y = pts.map((t) => valueCell(yi, ds(p, yi), t))
    const order = pts.map((_, i) => i).sort((a, b) => X[a]!.value! - X[b]!.value!)
    return {
      shape: 'pairs', unit: ds(p, yi).unit, label: `${ds(p, yi).title} vs ${ds(p, xi).title}`,
      categories: order.map((i) => String(X[i]!.value)),
      series: [{ name: names(p, [yi])[0]!, dataset: yi, values: order.map((i) => Y[i]!.value), cells: order.map((i) => Y[i]!.cell) }],
      x: { dataset: xi, values: order.map((i) => X[i]!.value!), cells: order.map((i) => X[i]!.cell) },
    }
  }

  if (view.transform === 'none') {
    const dates = [...new Set(ids.flatMap((id) => effectiveObs(ds(p, id)).map((o) => o.date)))].filter((t) => (!view.from || t >= view.from) && (!view.to || t <= view.to)).sort()
    const nm = names(p, ids)
    return {
      shape: 'time', unit, label: metricLabel, categories: dates,
      series: ids.map((id, i) => { const vc = dates.map((t) => valueCell(id, ds(p, id), t)); return { name: nm[i]!, dataset: id, values: vc.map((x) => x.value), cells: vc.map((x) => x.cell) } }),
    }
  }

  const entities = ids.map((id) => ds(p, id).entity)
  if (view.transform === 'latest' || view.transform === 'at' || view.transform === 'rank') {
    const period = view.transform === 'at' ? view.at : view.at ?? commonPeriods(p, ids).at(-1)
    if (!period) throw new VizError('the datasets share no period with data; pick one (at)')
    let rows = ids.map((id, i) => ({ id, entity: entities[i]!, ...valueCell(id, ds(p, id), period) }))
    if (view.transform === 'rank') {
      const dir = view.order === 'asc' ? 1 : -1
      rows = [...rows].sort((a, b) => (a.value == null ? 1 : b.value == null ? -1 : dir * (a.value - b.value)))
    }
    return { shape: 'cross', unit, label: `${metricLabel}, ${period}`, periods: [period], categories: rows.map((r) => r.entity), series: [{ name: `${metricLabel} ${period}`, values: rows.map((r) => r.value), cells: rows.map((r) => r.cell) }] }
  }

  if (view.transform === 'pair') {
    // two periods per entity, each value with its own evidence (dumbbell, slope, KPI)
    const common = commonPeriods(p, ids)
    const [a, b] = view.between ?? [common[0], common.at(-1)]
    if (!a || !b || a === b) throw new VizError('a two-period comparison needs two different periods (between)')
    const at = (t: string) => ids.map((id) => valueCell(id, ds(p, id), t))
    const A = at(a), B = at(b)
    return { shape: 'cross', unit, label: `${metricLabel}, ${a} and ${b}`, periods: [a, b], categories: entities,
      series: [{ name: a, values: A.map((x) => x.value), cells: A.map((x) => x.cell) }, { name: b, values: B.map((x) => x.value), cells: B.map((x) => x.cell) }] }
  }

  if (view.transform === 'bridge') {
    // one dataset: the level at the start, each period's change (derived, telescoping), the level at the end
    if (ids.length !== 1) throw new VizError('a bridge follows one dataset from one period to another')
    const id = ids[0]!, d = ds(p, id)
    const have = effectiveObs(d).filter((o) => o.value != null).map((o) => o.date).sort()
    const [a, b] = view.between ?? [have[0], have.at(-1)]
    if (!a || !b || a >= b) throw new VizError('a bridge needs a start period before its end period (between)')
    const dates = [...new Set(effectiveObs(d).map((o) => o.date))].filter((t) => t >= a && t <= b).sort()
    const vc = dates.map((t) => valueCell(id, d, t))
    const input = (i: number) => ({ evidence: vc[i]!.cell && 'evidence' in vc[i]!.cell! ? (vc[i]!.cell as any).evidence : null, dataset: id, period: dates[i]!, value: vc[i]!.value })
    const deltas = dates.slice(1).map((_, k) => {
      const s0 = vc[k]!.value, s1 = vc[k + 1]!.value
      const value = s0 == null || s1 == null ? null : Number((s1 - s0).toFixed(6))
      return { value, cell: (value == null ? null : { derived: { formula: 'end - start', inputs: { start: input(k), end: input(k + 1) } } }) as Cell }
    })
    const first = vc[0]!, last = vc.at(-1)!
    return { shape: 'cross', unit, label: `${metricLabel}, ${a} to ${b}`, periods: [a, b], kinds: ['total', ...deltas.map(() => 'delta' as const), 'total'],
      categories: [a, ...dates.slice(1).map((t) => `${t} change`), b],
      series: [{ name: metricLabel, dataset: id, values: [first.value, ...deltas.map((x) => x.value), last.value], cells: [first.cell, ...deltas.map((x) => x.cell), last.cell] }] }
  }

  // diff / pct_change between two periods, per entity (derived values: formula + inputs)
  const common = commonPeriods(p, ids)
  const [a, b] = view.between ?? [common[0], common.at(-1)]
  if (!a || !b || a === b) throw new VizError('a change needs two different periods (between)')
  const pct = view.transform === 'pct_change'
  const rows = ids.map((id) => {
    const va = valueCell(id, ds(p, id), a), vb = valueCell(id, ds(p, id), b)
    const value = va.value == null || vb.value == null || (pct && va.value === 0) ? null : pct ? (vb.value / va.value - 1) * 100 : vb.value - va.value
    const input = (vc: typeof va, t: string) => ({ evidence: vc.cell && 'evidence' in vc.cell ? vc.cell.evidence : null, dataset: id, period: t, value: vc.value })
    return { value: value == null ? null : Number(value.toFixed(6)), cell: (value == null ? null : { derived: { formula: pct ? '(end / start - 1) * 100' : 'end - start', inputs: { start: input(va, a), end: input(vb, b) } } }) as Cell }
  })
  return {
    shape: 'cross', unit: pct ? '%' : /%/.test(unit) ? 'pp' : unit, label: `${pct ? 'Change, %' : 'Change'}: ${metricLabel}, ${a}–${b}`, periods: [a, b],
    categories: entities, series: [{ name: `${a}–${b}`, values: rows.map((r) => r.value), cells: rows.map((r) => r.cell) }],
  }
}

/** Rating actions (evidence) on an ordinal scale: one series per agency, in date order. */
function projectRatings(p: Project, view: View): Projected {
  const ids = view.evidence ?? []
  if (!ids.length) throw new VizError('a rating timeline needs rating actions (evidence)')
  const points: RatingPoint[] = [], undated: string[] = []
  for (const id of ids) {
    const r = (p.evidence[id] as any)?.rating
    if (!r) throw new VizError(`evidence ${id} is not a rating action`)
    const n = notch(r.rating)
    if (n == null) throw new VizError(`“${r.rating}” is not a symbol on the long-term rating scale`)
    if (!r.date) { undated.push(id); continue }
    points.push({ evidence: id, agency: r.agency, date: r.date, rating: r.rating, outlook: r.outlook ?? null, action: r.action, notch: n })
  }
  points.sort((x, y) => x.date.localeCompare(y.date) || x.agency.localeCompare(y.agency))
  const agencies = [...new Set(points.map((x) => x.agency))], dates = [...new Set(points.map((x) => x.date))]
  return {
    shape: 'ratings', unit: 'rating', label: `Credit ratings${points[0] ? `, ${(p.evidence[points[0].evidence] as any).subject ?? ''}` : ''}`.replace(/, $/, ''), categories: dates, ratings: points, undated,
    series: agencies.map((a) => ({ name: a, values: dates.map((t) => points.find((x) => x.agency === a && x.date === t)?.notch ?? null),
      cells: dates.map((t) => { const x = points.find((y) => y.agency === a && y.date === t); return x ? { evidence: x.evidence, dataset: 'ratings', period: t, edited: false } : null }) })),
  }
}

/** Why this family cannot show this view, or null. Shape rules only; meaning rules (additivity, etc.) are V2. */
export function refusal(spec: VizSpec, pr: Projected): string | null {
  const f = spec.family, n = pr.series.length, t = spec.view.transform
  // the views that only composites draw, and what each composite needs
  if ((t === 'pair' || t === 'bridge' || t === 'ratings') && !isComposite(f)) return `a ${f} chart does not draw a ${t === 'pair' ? 'two-period comparison' : t === 'bridge' ? 'bridge' : 'rating timeline'}`
  if ((f === 'dumbbell' || f === 'slope') && t !== 'pair') return `a ${f} compares two periods per entity`
  if (f === 'kpi' && (t !== 'pair' || n !== 2 || pr.categories.length !== 1)) return 'a KPI spotlight shows one dataset: its latest value and the change since an earlier period'
  if (f === 'waterfall' && t !== 'bridge') return 'a waterfall bridges one dataset from one period to another'
  if (f === 'rating_timeline' && t !== 'ratings') return 'a rating timeline draws rating actions'
  if (t === 'ratings' && f !== 'rating_timeline') return 'rating actions are drawn as a rating timeline'
  if ((f === 'dot' || f === 'lollipop') && (pr.shape !== 'cross' || n !== 1 || t === 'bridge')) return `a ${f} plot shows one value per entity at one period (or one change)`
  if ((f === 'step' || f === 'multiples') && pr.shape !== 'time') return `a ${f === 'step' ? 'step' : 'small-multiples'} chart needs a time axis`
  if (f === 'multiples' && n < 2) return 'small multiples need at least two series'
  if (f === 'rating_timeline' && !pr.ratings?.length) return `no rating action has a verified date${pr.undated?.length ? ` (${pr.undated.length} undated; the ratings table lists them)` : ''}`
  if (f === 'scatter' && pr.shape !== 'pairs') return 'a scatter needs two datasets paired over time'
  if (f !== 'scatter' && pr.shape === 'pairs') return 'paired x/y data needs a scatter'
  if ((f === 'line' || f === 'area') && pr.shape !== 'time') return `a ${f} chart needs a time axis; this view is a single period or a change`
  if (f === 'area' && spec.subtype && spec.subtype !== 'clustered') return 'stacked areas are not available in the chart engine'
  if ((f === 'pie' || f === 'doughnut') && (pr.shape !== 'cross' || n !== 1)) return `a ${f} shows one series at one period`
  if ((f === 'pie' || f === 'doughnut') && pr.series[0]!.values.some((v) => v == null || v < 0)) return `a ${f} cannot show missing or negative values`
  if (f === 'combo' && (pr.shape !== 'time' || n < 2)) return 'a combo needs at least two series over time'
  if ((spec.subtype === 'stacked' || spec.subtype === 'percent') && n < 2) return 'stacking needs at least two series'
  if ((spec.subtype === 'stacked' || spec.subtype === 'percent') && f !== 'column' && f !== 'bar') return `${spec.subtype} applies to columns and bars`
  if (f !== 'rating_timeline' && pr.series.every((s) => s.values.every((v) => v == null))) return 'the view has no data'
  return null
}

const projectFor = (p: Project, spec: VizSpec) => project(p, spec.view, { mixedUnits: spec.family === 'combo', scatter: spec.family === 'scatter' })

export interface Assessment { pr: Projected | null; invalid: Finding | null; warnings: Finding[] }
/** Every finding for the spec: the first invalid one (shape rules, then meaning rules) and all warnings. */
export function assess(p: Project, spec: VizSpec): Assessment {
  if (spec.schema !== VIZ_SCHEMA || !FAMILIES.includes(spec.family)) return { pr: null, invalid: { code: 'spec', level: 'invalid', reason: `not a ${VIZ_SCHEMA} spec or unknown family` }, warnings: [] }
  let pr: Projected
  try { pr = projectFor(p, spec) } catch (e: any) { if (!(e instanceof VizError)) throw e; return { pr: null, invalid: { code: 'view', level: 'invalid', reason: e.message }, warnings: [] } }
  const shape = refusal(spec, pr)
  const fs = findings(p, spec, pr)
  return { pr, invalid: shape ? { code: 'shape', level: 'invalid', reason: shape } : fs.find((x) => x.level === 'invalid') ?? null, warnings: fs.filter((x) => x.level === 'warning') }
}

/** Validates the spec against the data and returns its projection; throws VizError for an invalid visual.
 *  Warnings don't block here: re-realizing after a data edit must never be stopped by a design choice. */
export function check(p: Project, spec: VizSpec): Projected {
  const a = assess(p, spec)
  if (a.invalid) throw new VizError(a.invalid.reason)
  return a.pr!
}

/** A visual that needs the user's acknowledgement first; carries the warnings so the UI can offer "Use anyway". */
export class VizWarning extends VizError {
  constructor(readonly warnings: Finding[]) { super(`Needs confirmation: ${warnings.map((w) => w.reason).join('; ')}`) }
}

/** For a new or changed visual: invalid -> VizError; a warning not yet acknowledged -> VizWarning. Returns the
 *  spec with `accepted_warnings` reduced to the warnings that still apply (a later change asks again). */
export function gate(p: Project, spec: VizSpec, accept: string[] = []): VizSpec {
  const a = assess(p, spec)
  if (a.invalid) throw new VizError(a.invalid.reason)
  const ok = new Set([...(spec.accepted_warnings ?? []), ...accept])
  const pending = a.warnings.filter((w) => !ok.has(w.code))
  if (pending.length) throw new VizWarning(pending)
  const { accepted_warnings: _, ...rest } = spec
  const kept = a.warnings.map((w) => w.code)
  return kept.length ? { ...rest, accepted_warnings: kept } : rest
}

export interface Realization { kind: string; barDir?: 'bar' | 'col'; title: string; categories: string[]; series: { name: string; values: (number | null)[] }[]; colorScheme: string[] }

/** GenOffice native chart for the spec (always the full data: a rebuild never relies on old values). */
export function realize(p: Project, spec: VizSpec, pr: Projected = check(p, spec)): Realization {
  if (isComposite(spec.family)) throw new VizError(`a ${spec.family} is drawn as shapes, not as a native chart`)
  const sub = spec.subtype ?? 'clustered'
  const kind = { column: { clustered: 'bar', stacked: 'barStacked', percent: 'barPercentStacked' }[sub], bar: { clustered: 'bar', stacked: 'barStacked', percent: 'barPercentStacked' }[sub],
    line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', scatter: 'scatter', combo: 'comboBarLine' }[spec.family as NativeFamily]!
  let categories = pr.categories, series = pr.series.map((s) => ({ name: s.name, values: s.values }))
  // horizontal bars draw the first category at the bottom: reverse so a ranking reads top-down
  if (spec.family === 'bar' && pr.shape === 'cross') { categories = [...categories].reverse(); series = series.map((s) => ({ ...s, values: [...s.values].reverse() })) }
  const colorScheme = pr.shape === 'time' || pr.shape === 'pairs'
    ? chartColors(p, { type: 'line', title: '', series: pr.series.map((s) => s.dataset!).filter(Boolean) })
    : [p.design_dna.series[0]!, ...p.design_dna.series.slice(1)]
  // a chart's title states what it shows: a single period or a change gets the view's own label and unit
  // (keeping a time-series title like "Gross debt, % of GDP" over a change in pp would misstate the unit)
  const title = pr.shape === 'cross' ? `${pr.label.charAt(0).toUpperCase()}${pr.label.slice(1)}, ${pr.unit}` : spec.title
  return { kind, ...(spec.family === 'bar' ? { barDir: 'bar' as const } : spec.family === 'column' ? { barDir: 'col' as const } : {}), title, categories, series, colorScheme }
}

/** Display text of a projected value (same decimals rule as tables). */
export function fmtValue(p: Project, pr: Projected, si: number, i: number) {
  const v = pr.series[si]!.values[i]
  if (v == null) return '—'
  const d = pr.series[si]!.dataset ? decimalsOf(p.datasets[pr.series[si]!.dataset!]) : 2
  return `${v.toFixed(Math.min(2, Math.max(1, d)))} ${pr.unit}`
}

let seq = 0
export const newVizId = () => `viz_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** M1-M5 chart bindings ({type, title, series}) as specs: a time-series view of the same datasets. */
export function fromChartSpec(c: { type: string; title: string; series: string[] }, id = newVizId()): VizSpec {
  const family: Family = c.type === 'bar' ? 'column' : c.type === 'area' ? 'area' : 'line'
  return { schema: VIZ_SCHEMA, id, title: c.title, family, view: { datasets: [...c.series], transform: 'none' }, missing: 'gap' }
}

/** The datasets a spec reads (for re-projection on data edits). */
export const vizDatasets = (spec: VizSpec) => spec.view.datasets
/** The evidence a spec reads directly (rating timelines). */
export const vizEvidence = (spec: VizSpec) => spec.view.evidence ?? []
