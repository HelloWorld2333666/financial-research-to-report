// Meaning constraints for visuals (VIS V2). V1's shape rules say what a family CAN draw; these say what
// it must not MEAN (invalid: never overridable) and what it may mean only with care (warning: the user can
// keep it after reading why). Deterministic, run on every create/change. They read dataset metadata (measure kind,
// additivity) instead of guessing from names.
import type { Dataset, Project } from './types'
import type { Projected, VizSpec } from './viz'

export interface Measure { kind: string; of?: string | null; signed: boolean; additive_parts_of: string | null; scale: 'interval' | 'ordinal' }

/** Mirrors app/server/evidence.py MEASURES, for datasets created before V2 recorded `measure`. */
const FALLBACK: Record<string, Measure> = {
  debt: { kind: 'ratio', of: 'GDP', signed: false, additive_parts_of: null, scale: 'interval' },
  deficit: { kind: 'balance_ratio', of: 'GDP', signed: true, additive_parts_of: null, scale: 'interval' },
  interest: { kind: 'ratio', of: 'GDP', signed: false, additive_parts_of: null, scale: 'interval' },
  growth: { kind: 'rate', of: null, signed: true, additive_parts_of: null, scale: 'interval' },
  yield: { kind: 'rate', of: null, signed: false, additive_parts_of: null, scale: 'interval' },
}
/** Unknown measures are treated as NOT additive: a wrong "additive" flag would defeat the rules. */
export function measureOf(d: Dataset | undefined): Measure {
  return (d as any)?.measure ?? FALLBACK[d?.metric ?? ''] ?? { kind: 'unknown', signed: true, additive_parts_of: null, scale: 'interval' }
}

export interface Profile {
  shape: Projected['shape']
  series: number; categories: number; periods: number
  negatives: number; missing: number
  /** every dataset is a part of the same named total */
  additive: boolean
  ordinal: boolean
  measure: string
  units: string[]
}

export function profile(p: Project, spec: Pick<VizSpec, 'view'>, pr: Projected): Profile {
  const ms = spec.view.datasets.map((id) => measureOf(p.datasets[id]))
  const vals = pr.series.flatMap((s) => s.values)
  const total = ms[0]?.additive_parts_of
  return {
    shape: pr.shape, series: pr.series.length, categories: pr.categories.length, periods: pr.shape === 'time' ? pr.categories.length : 1,
    negatives: vals.filter((v) => v != null && v < 0).length, missing: vals.filter((v) => v == null).length,
    additive: !!total && ms.every((m) => m.additive_parts_of === total), ordinal: ms.some((m) => m.scale === 'ordinal'),
    measure: ms[0]?.kind ?? 'unknown', units: [...new Set(spec.view.datasets.map((id) => p.datasets[id]?.unit ?? ''))],
  }
}

const MEASURE_WORDS: Record<string, string> = { ratio: 'ratios', balance_ratio: 'balances as a share of GDP', rate: 'rates', unknown: 'these values' }

/**
 * A finding about a visual for this data (VIS V2, three states):
 *  - invalid: it would misstate the data (fabricated or lost values, wrong units, a false part-to-whole).
 *    Blocked; no acknowledgement unlocks it.
 *  - warning: it draws the data faithfully but is less suitable or easy to misread. The user may keep it
 *    ("Use anyway"); the acknowledged code is stored on the spec so later edits don't ask again.
 * Codes are stable: they are what an acknowledgement refers to.
 */
export interface Finding { code: string; level: 'invalid' | 'warning'; reason: string }

export function findings(p: Project, spec: VizSpec, pr: Projected): Finding[] {
  const f = spec.family, pf = profile(p, spec, pr), out: Finding[] = []
  const no = (code: string, reason: string) => out.push({ code, level: 'invalid', reason })
  const warn = (code: string, reason: string) => out.push({ code, level: 'warning', reason })
  const pie = f === 'pie' || f === 'doughnut', stack = spec.subtype === 'stacked' || spec.subtype === 'percent'
  const name = pie ? `a ${f}` : spec.subtype === 'percent' ? 'a 100% stack' : 'a stack'
  if (pie || stack) {
    if (!pf.additive) no('not_parts', `${name} shows parts of one total, but ${MEASURE_WORDS[pf.measure] ?? pf.measure} of different series are not parts of a total`)
    else if (pf.missing) no('missing_parts', `${name} with missing parts would show a wrong total`)
    else if (pf.negatives && spec.subtype === 'percent') no('negative_parts', 'a 100% stack cannot show negative parts')
    else if (pf.negatives && spec.subtype === 'stacked') warn('negative_stack', 'with negative parts, a stacked bar no longer reads as the total; the parts are drawn on both sides of zero')
  }
  if (f === 'combo' && pf.units.length > 2) no('combo_units', `columns + line has two axes, but these series have ${pf.units.length} units`)
  if (f === 'combo' && pf.units.length === 1) warn('combo_one_unit', 'columns + line puts the last series on its own axis; with one shared unit, two scales can make the series look closer or further apart than they are')
  if (pf.ordinal && f !== 'bar' && f !== 'column') no('ordinal', 'an ordinal scale (e.g. ratings) is not a numeric quantity')
  if (pie && pf.categories > 6) warn('many_slices', `${pf.categories} slices are hard to compare; a ranked bar shows the same parts in order`)
  if ((f === 'line' || f === 'area' || f === 'step') && pf.periods < 3) warn('few_periods', `${pf.periods === 1 ? 'one period shows' : 'two periods show'} no trend; columns or a change view compare them more directly`)
  if (f === 'line' && pf.series > 7) warn('many_lines', `${pf.series} lines are hard to tell apart; consider fewer series or a table`)
  if (f === 'area' && pf.series > 1 && !pf.additive) warn('overlapping_areas', 'overlapping areas can read as a total; lines show series that do not add up more plainly')
  if ((f === 'column' || f === 'bar') && pf.categories * pf.series > 60) warn('many_bars', `${pf.categories * pf.series} bars are hard to read at slide size`)
  if (f === 'scatter' && pr.categories.length < 6) warn('few_points', `${pr.categories.length} paired observations are too few to suggest a relationship`)
  // composites (VIS V3)
  if (f === 'waterfall' && pf.missing) no('bridge_gap', 'a bridge with a missing period would not add up from the first level to the last')
  else if (f === 'waterfall') {
    const v = pr.series[0]!.values, k = pr.kinds ?? [], level = Math.max(...v.filter((x, i) => k[i] === 'total' && x != null).map((x) => Math.abs(x!)))
    const step = Math.max(...v.filter((x, i) => k[i] === 'delta' && x != null).map((x) => Math.abs(x!)))
    if (level > 0 && step / level < 0.03) warn('small_steps', 'the changes are small next to the level, so the steps are barely visible; a change view (bars from zero) shows them more clearly')
  }
  if (f === 'step' && !pf.ordinal && !['policy_rate', 'held_level'].includes(pf.measure))
    warn('step_continuous', 'a step says each value holds until the next period; these are period figures that change continuously, so a line or columns describe them better')
  if ((f === 'dot' || f === 'lollipop') && pf.categories > 25) warn('many_rows', `${pf.categories} rows are hard to read at slide size`)
  if (f === 'dumbbell' && pf.categories > 15) warn('many_rows', `${pf.categories} rows are hard to read at slide size`)
  if (f === 'slope' && pf.categories > 10) warn('many_lines', `${pf.categories} crossing lines are hard to tell apart; a dumbbell keeps one row per entity`)
  if (f === 'multiples' && pf.series > 12) warn('many_panels', `${pf.series} panels are too small to read at slide size`)
  return out
}

/** The first reason this visual would misrepresent the data, or null (warnings don't count). */
export function meaningRefusal(p: Project, spec: VizSpec, pr: Projected): string | null {
  return findings(p, spec, pr).find((x) => x.level === 'invalid')?.reason ?? null
}
