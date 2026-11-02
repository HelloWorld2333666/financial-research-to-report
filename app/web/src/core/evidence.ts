// Evidence Core projections: the working value of every observation, and the chart/table data
// compiled from it. Source observations are never modified; manual edits live in `working`.
import type { ChartSpec, Dataset, NumberRef, Project } from './types'

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

/** Sign off a manual value: it stays next to the source, now attributed as verified. */
export function verifyWorking(p: Project, dsId: string, date: string, by = 'you') {
  const w = p.datasets[dsId]?.working[date]
  if (!w) throw new Error(`${dsId} ${date} has no manual edit to verify`)
  if (w.status === 'verified') throw new Error(`${dsId} ${date} is already verified`)
  Object.assign(w, { status: 'verified', verified_by: by, verified_at: new Date().toISOString() })
}

// ------------------------------------------------------------------ provenance of written numbers (mirrors app/server/integrity.py)
/** evidence id -> where it sits in the working layer */
export function evidenceIndex(p: Project) {
  const out = new Map<string, { ds: string; date: string }>()
  for (const [id, d] of Object.entries(p.datasets)) for (const o of d.observations) if (o.evidence_id) out.set(o.evidence_id, { ds: id, date: o.date })
  return out
}

/** Safe arithmetic for derivation formulas (same grammar as src/frr/derive.py): numbers, names, + - * /, unary -, (), abs(), round(). */
export function evaluate(formula: string, env: Record<string, number>): number {
  const toks = formula.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/()]|\S/g) ?? []
  let i = 0
  const peek = () => toks[i], next = () => toks[i++]
  const expr = (): number => { let v = term(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term(); return v }
  const term = (): number => { let v = unary(); while (peek() === '*' || peek() === '/') v = next() === '*' ? v * unary() : v / unary(); return v }
  const unary = (): number => (peek() === '-' ? (next(), -unary()) : peek() === '+' ? (next(), unary()) : atom())
  const atom = (): number => {
    const t = next()
    if (t === undefined) throw new Error('formula ends early')
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('missing )'); return v }
    if (/^\d/.test(t)) return parseFloat(t)
    if (t === 'abs' || t === 'round') { if (next() !== '(') throw new Error(`${t} needs (`); const v = expr(); if (next() !== ')') throw new Error('missing )'); return t === 'abs' ? Math.abs(v) : Math.round(v) }
    if (/^[A-Za-z_]/.test(t)) { if (!(t in env)) throw new Error(`unknown input '${t}'`); return env[t]! }
    throw new Error(`not allowed in a formula: ${t}`)
  }
  const v = expr()
  if (i !== toks.length) throw new Error(`unexpected '${peek()}'`)
  if (!Number.isFinite(v)) throw new Error('formula result is not a finite number')
  return v
}

export interface Resolved { value: number | null; source: number | null; edited: boolean; status: string; ds?: string; date?: string }

/** Current working value behind an evidence id (manual edits applied). */
export function evidenceValue(p: Project, id: string, idx = evidenceIndex(p)): Resolved {
  const at = idx.get(id)
  if (!at) { const e = p.evidence[id]; return { value: e?.value ?? null, source: e?.value ?? null, edited: false, status: e ? 'source' : 'missing' } }
  const o = effectiveObs(p.datasets[at.ds]).find((x) => x.date === at.date)
  return { value: o?.value ?? null, source: o?.source ?? null, edited: !!o?.edited, status: o?.status ?? 'missing', ds: at.ds, date: at.date }
}

/** A derivation recomputed from the CURRENT working values of its inputs. */
export function derivationValue(p: Project, id: string, idx = evidenceIndex(p), stack: string[] = []): number | null {
  const d = p.derivations?.[id]
  if (!d || stack.includes(id)) return null
  const env: Record<string, number> = {}
  for (const [name, ref] of Object.entries(d.inputs)) {
    const v = p.derivations?.[ref] ? derivationValue(p, ref, idx, [...stack, id]) : evidenceValue(p, ref, idx).value
    if (v == null) return null
    env[name] = v
  }
  try { const v = evaluate(d.formula, env); return d.rounding != null ? Number(v.toFixed(d.rounding)) : v } catch { return null }
}

// Figures in prose: not years, tenors ("10-year") or parts of identifiers ("gov_10dd").
const FIGURE_RE = /(?<![\w.])[+\-−]?\d+(?:\.\d+)?(?![\w.]|-year|-month|-day| ?years?\b)/g
export function figures(text: string) {
  return [...text.replace(/,/g, '').matchAll(FIGURE_RE)].map((m) => {
    const raw = m[0].replace('−', '-'), v = parseFloat(raw)
    return { text: m[0], value: v, decimals: raw.includes('.') ? raw.split('.')[1]!.length : 0 }
  }).filter((f) => f.decimals > 0 || Math.abs(f.value) < 1900 || Math.abs(f.value) > 2100)
}
const roundsTo = (want: number, v: number, dec: number) => Math.abs(want - v) <= 0.5 * 10 ** -dec + 1e-9

export interface TextNumber { text: string; status: 'ok' | 'stale' | 'unsourced'; ref?: NumberRef; data?: number | null }
/** Each figure in `text` with the reference it resolves to, and whether the data still says so. */
export function textNumbers(text: string, refs: NumberRef[] = [], p: Project): TextNumber[] {
  const idx = evidenceIndex(p), used = new Set<number>()
  return figures(text).map((f) => {
    const k = refs.findIndex((r, i) => !used.has(i) && figures(r.text)[0]?.text === f.text)
    if (k < 0) return { text: f.text, status: 'unsourced' }
    used.add(k)
    const ref = refs[k]!, data = ref.evidence ? evidenceValue(p, ref.evidence, idx).value : derivationValue(p, ref.derivation!, idx)
    return { text: f.text, status: data != null && roundsTo(data, f.value, f.decimals) ? 'ok' : 'stale', ref, data }
  })
}
