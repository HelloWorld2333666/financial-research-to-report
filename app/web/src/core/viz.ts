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

export const VIZ_SCHEMA = 'frr-viz/1'
export type Family = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'combo'
export type Subtype = 'clustered' | 'stacked' | 'percent'
export type Transform = 'none' | 'latest' | 'at' | 'rank' | 'diff' | 'pct_change'
export const FAMILIES: Family[] = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'combo']

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
}

/** Where one projected value comes from. */
export type Cell =
  | null
  | { evidence: string | null; dataset: string; period: string; edited: boolean }
  | { derived: { formula: string; inputs: Record<string, { evidence: string | null; dataset: string; period: string; value: number | null }> } }

export interface Projected {
  shape: 'time' | 'cross' | 'pairs'
  categories: string[]
  series: { name: string; dataset?: string; values: (number | null)[]; cells: Cell[] }[]
  unit: string
  /** for 'pairs' (scatter): x values per point, and the x dataset */
  x?: { dataset: string; values: number[]; cells: Cell[] }
  label: string
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
    return { shape: 'cross', unit, label: `${metricLabel}, ${period}`, categories: rows.map((r) => r.entity), series: [{ name: `${metricLabel} ${period}`, values: rows.map((r) => r.value), cells: rows.map((r) => r.cell) }] }
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
    shape: 'cross', unit: pct ? '%' : /%/.test(unit) ? 'pp' : unit, label: `${pct ? 'Change, %' : 'Change'}: ${metricLabel}, ${a}–${b}`,
    categories: entities, series: [{ name: `${a}–${b}`, values: rows.map((r) => r.value), cells: rows.map((r) => r.cell) }],
  }
}

/** Why this family cannot show this view, or null. Shape rules only; meaning rules (additivity, etc.) are V2. */
export function refusal(spec: VizSpec, pr: Projected): string | null {
  const f = spec.family, n = pr.series.length
  if (f === 'scatter' && pr.shape !== 'pairs') return 'a scatter needs two datasets paired over time'
  if (f !== 'scatter' && pr.shape === 'pairs') return 'paired x/y data needs a scatter'
  if ((f === 'line' || f === 'area') && pr.shape !== 'time') return `a ${f} chart needs a time axis; this view is a single period or a change`
  if (f === 'area' && spec.subtype && spec.subtype !== 'clustered') return 'stacked areas are not available in the chart engine'
  if ((f === 'pie' || f === 'doughnut') && (pr.shape !== 'cross' || n !== 1)) return `a ${f} shows one series at one period`
  if ((f === 'pie' || f === 'doughnut') && pr.series[0]!.values.some((v) => v == null || v < 0)) return `a ${f} cannot show missing or negative values`
  if (f === 'combo' && (pr.shape !== 'time' || n < 2)) return 'a combo needs at least two series over time'
  if ((spec.subtype === 'stacked' || spec.subtype === 'percent') && n < 2) return 'stacking needs at least two series'
  if ((spec.subtype === 'stacked' || spec.subtype === 'percent') && f !== 'column' && f !== 'bar') return `${spec.subtype} applies to columns and bars`
  if (pr.series.every((s) => s.values.every((v) => v == null))) return 'the view has no data'
  return null
}

const projectFor = (p: Project, spec: VizSpec) => project(p, spec.view, { mixedUnits: spec.family === 'combo', scatter: spec.family === 'scatter' })

/** Validates the spec against the data and returns its projection; throws VizError with the reason. */
export function check(p: Project, spec: VizSpec): Projected {
  if (spec.schema !== VIZ_SCHEMA || !FAMILIES.includes(spec.family)) throw new VizError(`not a ${VIZ_SCHEMA} spec or unknown family`)
  const pr = projectFor(p, spec)
  const r = refusal(spec, pr)
  if (r) throw new VizError(r)
  return pr
}

export interface Realization { kind: string; barDir?: 'bar' | 'col'; title: string; categories: string[]; series: { name: string; values: (number | null)[] }[]; colorScheme: string[] }

/** GenOffice native chart for the spec (always the full data: a rebuild never relies on old values). */
export function realize(p: Project, spec: VizSpec, pr: Projected = check(p, spec)): Realization {
  const sub = spec.subtype ?? 'clustered'
  const kind = { column: { clustered: 'bar', stacked: 'barStacked', percent: 'barPercentStacked' }[sub], bar: { clustered: 'bar', stacked: 'barStacked', percent: 'barPercentStacked' }[sub],
    line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', scatter: 'scatter', combo: 'comboBarLine' }[spec.family]!
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
