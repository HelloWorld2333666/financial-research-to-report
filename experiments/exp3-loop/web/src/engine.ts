// Experiment 3 engine: one session (GenOffice deck + our Evidence Core project + bindings sidecar),
// every change is a validated pptx-ops transaction with one undo snapshot. AI proposals are compiled
// here from our semantic vocabulary; numbers always come from the project's working layer.
import { createBlankPptx, openPptx, materializeSlide, slideDurableId, elementDurableId, type OpenedPptx } from '@genoffice/pptx-engine'
import { runTxn, type Op } from '@genoffice/pptx-ops'
import { buildRenderSlide, HeuristicMetrics, OpentypeMetrics, type RenderSlide } from '@genoffice/pptx-render'
import * as opentype from 'opentype.js'
import { effectiveObs, fmtValue } from '@ws/model.js'

export const EMU = 9525
export const FIT = 760
const off = (x: number, y: number, w: number, h: number) => ({ x: x * EMU, y: y * EMU, cx: w * EMU, cy: h * EMU })

export interface ChartSpec { type: 'line' | 'bar'; title: string; series: string[] }
export interface TableSpec { title: string; datasets: string[]; dates: string[] }
export type Binding =
  | { kind: 'text'; slide: string; role: string; refs?: string[] }
  | { kind: 'chart'; slide: string; chart: ChartSpec }
  | { kind: 'table'; slide: string; table: TableSpec }
  | { kind: 'placeholder'; slide: string; label: string; request: any }
  | { kind: 'decor'; slide: string }

export const S: { opened: OpenedPptx; project: any; bindings: Record<string, Binding>; undo: any[]; redo: any[]; journal: any[]; preview: boolean } =
  { opened: null as any, project: null, bindings: {}, undo: [], redo: [], journal: [], preview: false }

let metrics: any = new HeuristicMetrics()
export async function init() {
  S.project = await (await fetch('/api/project')).json()
  const [reg, bold] = await Promise.all(['/fonts/LiberationSans-Regular.ttf', '/fonts/LiberationSans-Bold.ttf'].map(async (u) => opentype.parse(await (await fetch(u)).arrayBuffer())))
  metrics = new OpentypeMetrics((st: any) => (st.bold ? bold : reg), new HeuristicMetrics())
  for (const [w, u] of [['400', '/fonts/LiberationSans-Regular.ttf'], ['700', '/fonts/LiberationSans-Bold.ttf']]) { const ff = new FontFace('Liberation Sans', `url(${u})`, { weight: w }); await ff.load(); (document as any).fonts.add(ff) }
  S.opened = await openPptx(await createBlankPptx())
}

// ---------------------------------------------------------------- history
const snap = () => ({ slides: structuredClone(S.opened.deck.slides), entries: new Map(S.opened.archive.entries), size: { ...S.opened.deck.size }, project: structuredClone(S.project), bindings: structuredClone(S.bindings) })
function restore(s: any) {
  const f = structuredClone({ slides: s.slides, project: s.project, bindings: s.bindings })
  S.opened.deck.slides = f.slides; S.opened.deck.size = { ...s.size }
  const e = S.opened.archive.entries; e.clear(); for (const [k, v] of s.entries) e.set(k, v)
  S.project = f.project; S.bindings = f.bindings
}
export function undo() { const s = S.undo.pop(); if (!s) return false; S.redo.push(snap()); restore(s); return true }
export function redo() { const s = S.redo.pop(); if (!s) return false; S.undo.push(snap()); restore(s); return true }
/** Run fn as one user-visible step: one snapshot, all-or-nothing. */
export function step(label: string, fn: () => void): { ok: boolean; error?: string } {
  const before = snap()
  try { fn(); S.undo.push(before); S.redo = []; S.journal.push({ label, at: Date.now() }); return { ok: true } }
  catch (e: any) { restore(before); return { ok: false, error: String(e.message || e) } }
}
/** Apply fn, render the affected slides, then restore: a visual dry run that never touches the live deck. */
export function preview(fn: () => string[] | void, slideIds?: string[]): { slides: { id: string; render: RenderSlide }[]; error?: string } {
  const before = snap()
  try { const ids = fn() || slideIds; return { slides: slides().filter((s) => !ids || ids.includes(s.id)).map((s) => ({ id: s.id, render: render(s.index, 300) })) } }
  catch (e: any) { return { slides: [], error: String(e.message || e) } }
  finally { restore(before) }
}
function txn(ops: Op[]) { if (!ops.length) return; const r = runTxn(S.opened, { ops }); if (!r.applied) throw new Error(r.failures?.map((f) => f.error.split('\n')[0]).join(' | ') || 'transaction failed') }

// ---------------------------------------------------------------- deck queries
export const slides = () => S.opened.deck.slides.map((s: any, index: number) => ({ id: slideDurableId(s), index }))
export const slideIndex = (id: string) => slides().find((s) => s.id === id)?.index ?? -1
export function render(index: number, width = FIT): RenderSlide { return buildRenderSlide(S.opened.deck.slides[index], S.opened.deck.size, { fitWidthPx: width, metrics, slideNo: index + 1 }) }
export function findEl(durable: string) {
  for (const [i, s] of S.opened.deck.slides.entries()) for (const e of (s as any).elements) { if (elementDurableId(e) === durable) return { el: e, index: i }; for (const c of e.children || []) if (elementDurableId(c) === durable) return { el: c, index: i, group: e.id } }
  return null
}
export const durableOf = (index: number, sourceId: string) => { const e = (S.opened.deck.slides[index] as any)?.elements.find((x: any) => x.id === sourceId); return e ? elementDurableId(e) : null }
export const textOf = (el: any) => (el?.paragraphs || el?.text?.paragraphs || []).map((p: any) => (p.runs || []).map((r: any) => r.text ?? '').join('')).join('\n')

// ---------------------------------------------------------------- Evidence Core projections
const ds = (id: string) => S.project.datasets[id]
export function chartData(spec: ChartSpec) {
  const dates = [...new Set(spec.series.flatMap((d) => effectiveObs(ds(d)).map((o: any) => o.date)))].sort()
  return { categories: dates, series: spec.series.map((d) => { const m = new Map(effectiveObs(ds(d)).map((o: any) => [o.date, o.value])); return { name: ds(d).entity, values: dates.map((x) => (m.has(x) ? m.get(x) : null)) } }) }
}
export function cellText(dsId: string, date: string) { const o = effectiveObs(ds(dsId)).find((x: any) => x.date === date); return o?.value == null ? '—' : fmtValue(o.value, { decimals: o.value % 1 && Math.abs(o.value) < 10 ? 2 : 1 }) + (o.edited ? ' ✎' : '') }
const colors = (spec: ChartSpec) => spec.series.map((d, i) => { const k = ['fr', 'de', 'it', 'es'].indexOf(ds(d).geo.toLowerCase()); return S.project.design_dna.series[k < 0 ? i % 4 : k] })

// ---------------------------------------------------------------- proposals -> transactions
const dna = () => S.project.design_dna
const para = (t: string, pt: number, color: string, bold = false) => ({ runs: [{ text: t, fontSize: pt, bold, color, fontFamily: dna().font }] })
interface Planned { op: Op; bind: (sl: string) => Binding; fill?: (el: string, slideIndex: number) => Op[] }

function planSlide(p: any): Planned[] {
  const d = dna(), out: Planned[] = []
  const text = (role: string, t: string, box: number[], pt: number, color: string, bold = false, refs?: string[]) =>
    out.push({ op: { op: 'addElement', kind: 'textbox', offset: off(...(box as [number, number, number, number])), paragraphs: t.split('\n').map((l) => para(l, pt, color, bold)), bodyPr: { wrap: 'square', insetsEmu: { l: 0, t: 0, r: 0, b: 0 } } }, bind: (slide) => ({ kind: 'text', slide, role, refs }) })
  text('kicker', p.kicker, [40, 26, 900, 16], 8.5, d.accent, true)
  text('title', p.title, [40, 44, 1200, 44], 17, d.ink, true, p.refs)
  text('subtitle', p.subtitle, [40, 92, 1200, 18], 9, d.muted)
  out.push({ op: { op: 'addElement', kind: 'rect', offset: off(40, 116, 1200, 2), fill: d.rule }, bind: (slide) => ({ kind: 'decor', slide }) })
  if (p.chart) {
    const spec: ChartSpec = { type: p.chart.type, title: p.chart.title, series: p.chart.series }
    out.push({ op: { op: 'addChart', kind: spec.type, offset: off(40, 136, p.table || p.bullets ? 720 : 1200, 400), title: spec.title, ...chartData(spec), colorScheme: colors(spec) }, bind: (slide) => ({ kind: 'chart', slide, chart: spec }) })
  }
  if (p.table) {
    const t: TableSpec = p.table
    out.push({ op: { op: 'addTable', rows: t.datasets.length + 1, cols: t.dates.length + 1, offset: off(784, 160, 456, 34 * (t.datasets.length + 1)) }, bind: (slide) => ({ kind: 'table', slide, table: t }),
      fill: (el, si) => tableFill(el, si, t) })
    text('label', t.title, [784, 136, 456, 18], 9, d.muted, true)
  }
  const bullets = [...(p.bullets || []), ...(p.derived ? [`10-year spread over Germany: ${p.derived.spread_bp} bp (derived: ${p.derived.inputs.join(' − ')})`] : [])]
  if (bullets.length) text('body', bullets.map((b: string) => '• ' + b).join('\n'), [784, p.table ? 320 : 160, 456, 200], 10.5, d.ink, false)
  if (p.placeholder) out.push({ op: { op: 'addElement', kind: 'roundRect', offset: off(40, 160, 1200, 300), fill: '#F3F5F8', stroke: { color: '#B8C2CF', widthEmu: 9525 }, paragraphs: [para(p.placeholder.label, 14, d.muted, true), para('Research request: ' + p.placeholder.request.reason, 9, d.muted)] },
    bind: (slide) => ({ kind: 'placeholder', slide, label: p.placeholder.label, request: p.placeholder.request }) })
  const srcs = [...new Set([...(p.chart?.series || []), ...(p.table?.datasets || [])].map((x: string) => ds(x)?.source_note).filter(Boolean))]
  text('source', 'Source: ' + (srcs.join('; ') || 'pending') + '. Values verified by independent re-fetch.', [40, 668, 1200, 24], 7, d.muted)
  return out
}
function tableFill(el: string, si: number, t: TableSpec): Op[] {
  const tg = { slide: si, el }, ops: Op[] = []
  ;['', ...t.dates].forEach((h, c) => ops.push({ op: 'setTableCell', target: tg, row: 0, col: c, paragraphs: [{ runs: [{ text: h, bold: true, fontSize: 9 }] }] }))
  t.datasets.forEach((d, r) => {
    ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: 0, paragraphs: [{ runs: [{ text: ds(d).entity, bold: true, fontSize: 9 }] }] })
    t.dates.forEach((x, c) => ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: c + 1, paragraphs: [{ runs: [{ text: cellText(d, x), fontSize: 9 }], align: 'right' }] }))
  })
  return ops
}

/** Add one proposed slide (at the end, or into the first empty slide) as a sequence of transactions. */
export function applySlide(p: any) {
  let si = S.opened.deck.slides.findIndex((s: any) => s.elements.length === 0)
  if (si < 0) { txn([{ op: 'addBlankSlide', target: { slide: S.opened.deck.slides.length - 1 } }]); si = S.opened.deck.slides.length - 1 }
  const plan = planSlide(p)
  txn(plan.map((x) => ({ ...x.op, target: { slide: si } })))
  materializeSlide(S.opened, si) // new elements get their creationId (durable id) on reparse
  const added = (S.opened.deck.slides[si] as any).elements.slice(-plan.length)
  const sid = slideDurableId(S.opened.deck.slides[si])
  const fills: Op[] = []
  added.forEach((el: any, i: number) => { const id = elementDurableId(el)!; S.bindings[id] = plan[i].bind(sid); if (plan[i].fill) fills.push(...plan[i].fill!(el.id, si)) })
  txn(fills); materializeSlide(S.opened, si)
  return sid
}

/** Re-project every bound chart and table that reads the given datasets (after a working-layer edit). */
export function reproject(dsIds: Set<string>) {
  const touched = new Set<number>()
  for (const [durable, b] of Object.entries(S.bindings)) {
    const f = findEl(durable); if (!f) continue
    if (b.kind === 'chart' && b.chart.series.some((d) => dsIds.has(d))) { txn([{ op: 'setChart', target: { slide: f.index, el: f.el.id }, patch: { ...chartData(b.chart), colorScheme: colors(b.chart) } }]); touched.add(f.index) }
    if (b.kind === 'table' && b.table.datasets.some((d) => dsIds.has(d))) { txn(tableFill(f.el.id, f.index, b.table)); touched.add(f.index) }
  }
  touched.forEach((i) => materializeSlide(S.opened, i))
}
export function addSeries(elementDurable: string, dataset: any, evidence: Record<string, any>) {
  const b = S.bindings[elementDurable]; if (!b || b.kind !== 'chart') throw new Error('selected element is not a bound chart')
  S.project.datasets[dataset.id] ||= dataset; Object.assign(S.project.evidence, evidence)
  b.chart.series = [...b.chart.series, dataset.id]
  reproject(new Set([dataset.id]))
}
export function setWorking(dsId: string, date: string, value: number | null) {
  const d = ds(dsId), src = d.observations.find((o: any) => o.date === date)
  if (value === null) d.working[date] = { deleted: true, by: 'you', at: new Date().toISOString(), status: 'manual_unverified' }
  else if (src && src.value === value) delete d.working[date]
  else d.working[date] = { value, by: 'you', at: new Date().toISOString(), status: 'manual_unverified' }
  reproject(new Set([dsId]))
}
export function addPlaceholder(slideId: string, label: string, request: any) {
  const si = slideIndex(slideId)
  txn([{ op: 'addElement', target: { slide: si }, kind: 'roundRect', offset: off(40, 470, 720, 150), fill: '#FFF6D6', stroke: { color: '#D9B44A', widthEmu: 9525 }, paragraphs: [para(label, 12, dna().ink, true), para('Options: ' + request.options.join('; '), 9, dna().muted)] }])
  materializeSlide(S.opened, si)
  const el = (S.opened.deck.slides[si] as any).elements.at(-1)
  S.bindings[elementDurableId(el)!] = { kind: 'placeholder', slide: slideId, label, request }
}
export function setText(durable: string, text: string) {
  const f = findEl(durable)!; txn([{ op: 'setText', target: { slide: f.index, el: f.el.id }, ...(f.group ? { group: f.group } : {}), paragraphs: text.split('\n').map((t) => ({ runs: [{ text: t }] })) }])
}
export function transform(index: number, sourceId: string, b: { x: number; y: number; w: number; h: number; rotationDeg: number }) {
  const k = 1280 / FIT, e = (v: number) => Math.round(v * k * EMU)
  txn([{ op: 'setTransform', target: { slide: index, el: sourceId }, rotDeg: b.rotationDeg, resizeTableGrid: true, box: { x: e(b.x), y: e(b.y), cx: e(b.w), cy: e(b.h) } }])
}
export function txnPublic(ops: Op[]) { txn(ops) }

// ---------------------------------------------------------------- integrity: canvas == working layer, everywhere
export function integrity() {
  const out = { bindings: 0, resolved: 0, points: 0, cells: 0, mismatch: [] as string[], unverified: 0 }
  for (const [durable, b] of Object.entries(S.bindings)) {
    out.bindings++; const f = findEl(durable); if (!f) { out.mismatch.push(`binding ${durable} does not resolve`); continue }
    out.resolved++
    if (b.kind === 'chart') { const want = chartData(b.chart); want.series.forEach((s, si) => s.values.forEach((v, i) => { out.points++; const g = f.el.chart?.series?.[si]?.values?.[i]; if (!((v == null && g == null) || v === g)) out.mismatch.push(`${s.name} ${want.categories[i]}: ${v} vs ${g}`) })) }
    if (b.kind === 'table') b.table.datasets.forEach((d, r) => b.table.dates.forEach((x, c) => { out.cells++; const got = textOf(f.el.rows?.[r + 1]?.[c + 1]?.text); if (got !== cellText(d, x)) out.mismatch.push(`${d} ${x}: "${cellText(d, x)}" vs "${got}"`) }))
  }
  out.unverified = Object.values(S.project.datasets).reduce((n: number, d: any) => n + Object.values(d.working || {}).filter((w: any) => w.status !== 'verified').length, 0) as number
  return { ...out, ok: out.resolved === out.bindings && !out.mismatch.length }
}
