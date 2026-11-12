// Data-derived wording for slide designs (PD1). Every figure written through a Writer is formatted from the current
// working value and recorded with its evidence id (or a derivation over evidence ids), so a design's text can be
// validated and later checked by integrity like any other slide text. No figure is typed in by hand.
import type { Derivation, NumberRef, Project } from '../types'
import { decimalsOf, effectiveObs } from '../evidence'
import type { DesignText } from './spec'

const MINUS = '−'
const o = (x: { long?: boolean }) => ({ long: x.long })
export const entityOf = (p: Project, ds: string) => p.datasets[ds]?.entity ?? ds
export const geoOf = (p: Project, ds: string) => (p.datasets[ds]?.geo ?? ds.split('.')[1] ?? '').toUpperCase()

/** The latest period with a value, or null. */
export function latestDate(p: Project, ds: string): string | null {
  const o = effectiveObs(p.datasets[ds]).filter((x) => x.value != null)
  return o.length ? o[o.length - 1]!.date : null
}
/** The latest period every dataset has a value for. */
export function commonLatest(p: Project, dss: string[]): string | null {
  const sets = dss.map((d) => new Set(effectiveObs(p.datasets[d]).filter((x) => x.value != null).map((x) => x.date)))
  const all = [...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))).sort()
  return all.length ? all[all.length - 1]! : null
}
export function firstCommon(p: Project, dss: string[]): string | null {
  const sets = dss.map((d) => new Set(effectiveObs(p.datasets[d]).filter((x) => x.value != null).map((x) => x.date)))
  const all = [...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))).sort()
  return all[0] ?? null
}
export function value(p: Project, ds: string, date: string): number | null {
  return effectiveObs(p.datasets[ds]).find((o) => o.date === date)?.value ?? null
}
const evidenceAt = (p: Project, ds: string, date: string) => effectiveObs(p.datasets[ds]).find((o) => o.date === date)?.evidence_id

function fmt(v: number, dec: number, signed = false) {
  // thousands grouped (13,676.7): the figure parsers on both sides strip commas before matching
  const s = Math.abs(v) >= 10000 ? Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : Math.abs(v).toFixed(dec)
  return (v < 0 ? MINUS : signed && v > 0 ? '+' : '') + s
}
/** "% of GDP" is written "115.7% of GDP" on first use and "115.7%" after; "%" stays; "pp"/"bp" are spaced. */
function unitSuffix(unit: string, long: boolean) {
  if (unit.startsWith('% of ')) return long ? unit : '%' // % of GDP, % of revenue
  if (unit === '%') return '%'
  return unit ? ' ' + unit : ''
}

/**
 * Accumulates the evidence behind the figures of one piece of text. Use it inside a template literal, then call
 * `text()` to package the string with its references:
 *   w.text(`Debt rose to ${w.num('ds.fr.debt', '2025')}`)
 */
export class Writer {
  private refs: NumberRef[] = []
  readonly derivations: Derivation[] = []
  constructor(readonly p: Project) {}

  /** A dataset value at a period, formatted with the dataset's decimals. `long` adds the full unit ("% of GDP"). */
  num(ds: string, date: string, opts: { long?: boolean; signed?: boolean; abs?: boolean } = {}): string {
    const v = value(this.p, ds, date), ev = evidenceAt(this.p, ds, date)
    if (v == null || !ev) throw new Error(`no verified value for ${ds} ${date}`)
    const d = this.p.datasets[ds]!, dec = decimalsOf(d)
    if (opts.abs) return this.derived(`der.${geoOf(this.p, ds).toLowerCase()}.${d.metric}.size.${date}`, `size of ${d.title} ${date}`, 'abs(x)', { x: ev }, Math.abs(v), d.unit, dec, { long: opts.long })
    const t = fmt(v, dec, opts.signed) + unitSuffix(d.unit, !!opts.long)
    this.refs.push({ text: t, evidence: ev })
    return t
  }
  /** end − start of one dataset, in percentage points when the unit is a percentage. */
  change(ds: string, start: string, end: string): string {
    const a = value(this.p, ds, start), b = value(this.p, ds, end), ea = evidenceAt(this.p, ds, start), eb = evidenceAt(this.p, ds, end)
    if (a == null || b == null || !ea || !eb) throw new Error(`no verified values for ${ds} ${start}–${end}`)
    const d = this.p.datasets[ds]!, dec = decimalsOf(d), unit = d.unit.includes('%') ? 'pp' : d.unit
    return this.derived(`der.${geoOf(this.p, ds).toLowerCase()}.${d.metric}.change.${start}-${end}`, `change in ${d.title}, ${start}–${end}`, 'end - start', { start: ea, end: eb }, b - a, unit, dec, { signed: true })
  }
  /** own − peer at one period, in percentage points for percentages (the gap between two countries). */
  gap(own: string, peer: string, date: string, opts: { long?: boolean } = {}): string {
    const a = value(this.p, own, date), b = value(this.p, peer, date), ea = evidenceAt(this.p, own, date), eb = evidenceAt(this.p, peer, date)
    if (a == null || b == null || !ea || !eb) throw new Error(`no verified values for ${own}/${peer} ${date}`)
    const d = this.p.datasets[own]!, dec = decimalsOf(d), unit = d.unit.includes('%') ? 'pp' : d.unit
    const id = `der.${geoOf(this.p, own).toLowerCase()}${geoOf(this.p, peer).toLowerCase()}.${d.metric}.gap.${date}`
    return this.derived(id, `${entityOf(this.p, own)} − ${entityOf(this.p, peer)} ${d.title}, ${date}`, 'own - peer', { own: ea, peer: eb }, a - b, unit, dec, o(opts))
  }
  /** (own − peer) × 100 in basis points, for yields in percent. */
  spread(own: string, peer: string, date: string): string {
    const a = value(this.p, own, date), b = value(this.p, peer, date), ea = evidenceAt(this.p, own, date), eb = evidenceAt(this.p, peer, date)
    if (a == null || b == null || !ea || !eb) throw new Error(`no verified values for ${own}/${peer} ${date}`)
    const id = `der.${geoOf(this.p, own).toLowerCase()}${geoOf(this.p, peer).toLowerCase()}.spread.${date}`
    return this.derived(id, `${entityOf(this.p, own)} − ${entityOf(this.p, peer)} spread, ${date}`, '(own - peer) * 100', { own: ea, peer: eb }, (a - b) * 100, 'bp', 0)
  }
  private derived(id: string, statement: string, formula: string, inputs: Record<string, string>, v: number, unit: string, dec: number, o: { long?: boolean; signed?: boolean } = {}) {
    const existing = this.p.derivations?.[id]
    if (!existing && !this.derivations.some((x) => x.id === id)) this.derivations.push({ id, statement, formula, inputs, value: Number(v.toFixed(dec)), unit, rounding: dec })
    const t = fmt(Number(v.toFixed(dec)), dec, o.signed) + unitSuffix(unit, !!o.long)
    this.refs.push({ text: t, derivation: id })
    return t
  }
  /** A sourced fact that is not part of a dataset (e.g. a figure quoted from an agency or authority release). */
  ev(id: string): string {
    const e = this.p.evidence[id]
    if (!e || typeof e.value !== 'number') throw new Error(`no evidence value ${id}`)
    const t = String(e.value)
    this.refs.push({ text: t, evidence: id })
    return t
  }
  /** Package text with the references collected since the last call. */
  text(s: string): DesignText {
    const out: DesignText = { text: s, ...(this.refs.length ? { numbers: this.refs } : {}) }
    this.refs = []
    return out
  }
}

/** Ranks datasets by their value at a date (largest first, or smallest first). */
export function ranked(p: Project, dss: string[], date: string, order: 'desc' | 'asc' = 'desc') {
  return dss.map((d) => ({ ds: d, v: value(p, d, date) })).filter((x) => x.v != null)
    .sort((a, b) => (order === 'desc' ? b.v! - a.v! : a.v! - b.v!)) as { ds: string; v: number }[]
}

/** The Eurostat source notes behind a set of datasets, deduplicated, as one source line. */
export function sourceLine(p: Project, dss: string[], extra: string[] = []): string {
  const notes = [...new Set(dss.map((d) => p.datasets[d]?.source_note).filter(Boolean))]
  return 'Source: ' + [...notes, ...extra].join('; ') + '. Values verified by independent re-fetch.'
}
