// Evidence Core projections: the working value of every observation, and the chart/table data
// compiled from it. Source observations are never modified; manual edits live in `working`.
import type { ChartSpec, Dataset, Project } from './types'

export interface EffectiveObs { date: string; value: number | null; source: number | null; edited: boolean; status: string; evidence_id?: string }

export function effectiveObs(ds: Dataset | undefined): EffectiveObs[] {
  const out = new Map<string, EffectiveObs>()
  for (const o of ds?.observations ?? []) out.set(o.date, { date: o.date, value: o.value, source: o.value, edited: false, status: o.status ?? 'source', evidence_id: o.evidence_id })
  for (const [date, w] of Object.entries(ds?.working ?? {})) {
    const base = out.get(date) ?? { date, value: null, source: null, edited: false, status: 'manual' }
    out.set(date, { ...base, value: w.deleted ? null : (w.value ?? null), edited: true, status: w.deleted ? 'removed' : w.status })
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export const valueAt = (p: Project, dsId: string, date: string) => effectiveObs(p.datasets[dsId]).find((o) => o.date === date)?.value ?? null

export function chartData(p: Project, spec: ChartSpec) {
  const dates = [...new Set(spec.series.flatMap((d) => effectiveObs(p.datasets[d]).map((o) => o.date)))].sort()
  return {
    categories: dates,
    series: spec.series.map((d) => {
      const m = new Map(effectiveObs(p.datasets[d]).map((o) => [o.date, o.value]))
      return { name: p.datasets[d]?.entity ?? d, values: dates.map((x) => m.get(x) ?? null) }
    }),
  }
}

export function chartColors(p: Project, spec: ChartSpec) {
  return spec.series.map((d, i) => { const k = ['fr', 'de', 'it', 'es'].indexOf(p.datasets[d]?.geo.toLowerCase() ?? ''); return p.design_dna.series[k < 0 ? i % 4 : k]! })
}

/** Decimals for a dataset: as many as its source values carry (at least 1, at most 2), so a column reads evenly. */
export function decimalsOf(ds: Dataset | undefined) {
  const d = (ds?.observations ?? []).reduce((m, o) => (o.value == null ? m : Math.max(m, (String(o.value).split('.')[1] ?? '').length)), 1)
  return Math.min(d, 2)
}

export function cellText(p: Project, dsId: string, date: string) {
  const ds = p.datasets[dsId], o = effectiveObs(ds).find((x) => x.date === date)
  return o?.value == null ? '—' : o.value.toFixed(decimalsOf(ds)) + (o.edited ? ' ✎' : '')
}

/** Write a working value (or a deliberate gap) next to the source. Typing the source value back clears the edit. */
export function setWorking(p: Project, dsId: string, date: string, value: number | null, by = 'you') {
  const d = p.datasets[dsId]
  if (!d) throw new Error(`unknown dataset ${dsId}`)
  const src = d.observations.find((o) => o.date === date)
  const at = new Date().toISOString()
  if (value === null) d.working[date] = { deleted: true, by, at, status: 'manual_unverified' }
  else if (src && src.value === value) delete d.working[date]
  else d.working[date] = { value, by, at, status: 'manual_unverified' }
}

export const unverifiedEdits = (p: Project) => Object.values(p.datasets).reduce((n, d) => n + Object.values(d.working).filter((w) => w.status !== 'verified').length, 0)
