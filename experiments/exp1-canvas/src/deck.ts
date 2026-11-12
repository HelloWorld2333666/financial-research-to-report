// Experiment 1 adapter: our project JSON (Evidence Core) -> GenOffice deck via pptx-ops, plus an
// evidence-binding sidecar keyed by GenOffice durable element ids ("e_<guid8>" from a16:creationId).
// Numbers are never typed into the canvas: tables and charts are compiled from the working layer.
import { createBlankPptx, openPptx, savePptx, materializeSlide, type OpenedPptx } from '@genoffice/pptx-engine'
import { runTxn, elementDurableId, type Op, type TxnResult } from '@genoffice/pptx-ops'
import { chartSeries, effectiveObs, fmtValue } from '@ws/model.js'

export const EMU_PER_PX = 9525 // 1280 px slide = 12192000 EMU
const emu = (px: number) => Math.round(px * EMU_PER_PX)
export const offset = (e: { x: number; y: number; w: number; h: number }) => ({ x: emu(e.x), y: emu(e.y), cx: emu(e.w), cy: emu(e.h) })

export type Binding =
  | { kind: 'text'; element: string }
  | { kind: 'chart'; element: string; chart_id: string }
  | { kind: 'datatable'; element: string; cells: Record<string, { dataset: string; date: string }> }
  | { kind: 'decor'; element: string }

export interface Built { opened: OpenedPptx; bindings: Record<string, Binding> }

const ROLE: Record<string, { pt: number; bold?: boolean; color: (d: any) => string }> = {
  kicker: { pt: 8.5, bold: true, color: (d) => d.accent },
  title: { pt: 18, bold: true, color: (d) => d.ink },
  subtitle: { pt: 9.5, color: (d) => d.muted },
  body: { pt: 10.5, color: (d) => d.ink },
}

export function chartPayload(p: any, chartId: string) {
  const spec = p.charts[chartId], s = chartSeries(p, chartId), dna = p.design_dna
  const kind = spec.type === 'line' ? 'line' : 'bar'
  // values keep null for missing observations: the engine omits those points (dispBlanksAs=gap)
  const series = s.series.map((x: any) => ({ name: x.label, values: x.values }))
  const colors = s.snapshot ? undefined : s.series.map((x: any) => dna.series[x.role ?? 0])
  return { kind, title: spec.title, categories: s.x.map(String), series, colorScheme: colors ?? [dna.series[0]] }
}

export function tableCellText(p: any, dataset: string, date: string, fmt: any) {
  const o = effectiveObs(p.datasets[dataset]).find((x: any) => x.date === date)
  return o?.value == null ? '—' : fmtValue(o.value, fmt) + (o.edited ? ' ✎' : '')
}

function txn(opened: OpenedPptx, ops: Op[]): TxnResult {
  const r = runTxn(opened, { ops })
  if (!r.applied) throw new Error('txn failed: ' + JSON.stringify(r.failures))
  return r
}

/** Build one slide of our project into a fresh deck through pptx-ops only. */
export async function buildDeck(p: any, slideId: string): Promise<Built> {
  const opened = await openPptx(await createBlankPptx())
  const dna = p.design_dna, els = p.elements.filter((e: any) => e.slide_id === slideId)
  const target = { slide: 0 }
  const adds: Op[] = [], meta: any[] = []
  for (const e of els) {
    if (e.type === 'text') {
      const r = ROLE[e.role] || ROLE.body
      const paragraphs = String(e.text).split('\n').map((t: string) => ({ runs: [{ text: t, fontSize: r.pt, bold: !!r.bold, color: r.color(dna), fontFamily: dna.font }] }))
      adds.push({ op: 'addElement', target, kind: 'textbox', offset: offset(e), paragraphs, bodyPr: { wrap: 'square', insetsEmu: { l: 0, t: 0, r: 0, b: 0 } } }); meta.push({ kind: 'text', e })
    } else if (e.type === 'panel') {
      adds.push({ op: 'addElement', target, kind: 'rect', offset: offset(e), fill: dna.rule }); meta.push({ kind: 'decor', e })
    } else if (e.type === 'sources') {
      const notes = [...new Set(els.filter((x: any) => x.type === 'chart').flatMap((x: any) => p.charts[x.chart_id].series.map((s: any) => p.datasets[s.dataset].source_note)))]
      adds.push({ op: 'addElement', target, kind: 'textbox', offset: offset(e), paragraphs: [{ runs: [{ text: `${e.prefix} ${notes.join(' · ')}`, fontSize: 7, color: dna.muted, fontFamily: dna.font }] }] }); meta.push({ kind: 'text', e })
    } else if (e.type === 'chart') {
      adds.push({ op: 'addChart', target, offset: offset(e), ...chartPayload(p, e.chart_id) }); meta.push({ kind: 'chart', e })
    } else if (e.type === 'datatable') {
      adds.push({ op: 'addTable', target, rows: e.dataset_ids.length + 1, cols: e.dates.length + 1, offset: offset(e) }); meta.push({ kind: 'datatable', e })
    }
  }
  txn(opened, adds)
  // New elements get their creationId bytes (durable id) when the slide is re-parsed; adds append in order.
  materializeSlide(opened, 0)
  const added = opened.deck.slides[0]!.elements.slice(-meta.length)
  const bindings: Record<string, Binding> = {}
  const fill: Op[] = []
  added.forEach((live: any, i: number) => {
    const id = live.id; const { kind, e } = meta[i]
    const key = elementDurableId(live)
    if (!key) throw new Error('no durable id for ' + e.id)
    if (kind === 'datatable') {
      const cells: Record<string, { dataset: string; date: string }> = {}
      const head = ['', ...e.dates]
      head.forEach((t: string, c: number) => fill.push({ op: 'setTableCell', target: { slide: 0, el: id }, row: 0, col: c, paragraphs: [{ runs: [{ text: t, bold: true, fontSize: 9 }] }] }))
      e.dataset_ids.forEach((ds: string, ri: number) => {
        fill.push({ op: 'setTableCell', target: { slide: 0, el: id }, row: ri + 1, col: 0, paragraphs: [{ runs: [{ text: p.datasets[ds].entity, bold: true, fontSize: 9 }] }] })
        e.dates.forEach((d: string, ci: number) => {
          cells[`${ri + 1}:${ci + 1}`] = { dataset: ds, date: d }
          fill.push({ op: 'setTableCell', target: { slide: 0, el: id }, row: ri + 1, col: ci + 1, paragraphs: [{ runs: [{ text: tableCellText(p, ds, d, e.fmt), fontSize: 9 }], align: 'right' }] })
        })
      })
      bindings[key] = { kind, element: e.id, cells }
    } else if (kind === 'chart') bindings[key] = { kind, element: e.id, chart_id: e.chart_id }
    else bindings[key] = { kind, element: e.id }
  })
  txn(opened, fill)
  materializeSlide(opened, 0)
  return { opened, bindings }
}

/** Re-key bindings by the durable id stored in the file (parse-time ids are not stable across reopen). */
async function durableBindings(opened: OpenedPptx, b: Record<string, Binding>) {
  const slide = opened.deck.slides[0]!, out: Record<string, Binding> = {}
  for (const [id, v] of Object.entries(b)) {
    const el = slide.elements.find((e: any) => e.id === id || elementDurableId(e) === id)
    out[el ? elementDurableId(el) : id] = v
  }
  return out
}

/** Map a durable id to the element's current parse-time id (what the render tree uses as sourceId). */
export function findByDurable(opened: OpenedPptx, durable: string, slideIndex = 0) {
  const walk = (els: any[]): any => { for (const e of els) { if (elementDurableId(e) === durable) return e; if (e.children) { const c = walk(e.children); if (c) return c } } }
  return walk(opened.deck.slides[slideIndex]!.elements)
}
export function durableOf(opened: OpenedPptx, sourceId: string, slideIndex = 0) {
  const walk = (els: any[]): any => { for (const e of els) { if (e.id === sourceId) return e; if (e.children) { const c = walk(e.children); if (c) return c } } }
  const el = walk(opened.deck.slides[slideIndex]!.elements)
  return el ? elementDurableId(el) : null
}

export async function saveAndReopen(opened: OpenedPptx) {
  const bytes = await savePptx(opened)
  return { bytes, reopened: await openPptx(bytes) }
}
