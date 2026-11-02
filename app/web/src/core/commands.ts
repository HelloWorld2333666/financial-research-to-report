// Commands: every change to the document — by the user, the AI or research — is one of these.
// A handler turns a command into validated pptx-ops transactions plus Evidence Core edits; the Store
// wraps it in one undo snapshot and one journal entry. Numbers always come from the project.
import { materializeSlide, slideDurableId, elementDurableId, type OpenedPptx } from '@genoffice/pptx-engine'
import { runTxn, type Op } from '@genoffice/pptx-ops'
import { cellText, chartColors, chartData, setWorking } from './evidence'
import { findEl, slideIndex, walk } from './deck'
import type { Binding, ChartSpec, Dataset, Project, Sidecar, TableSpec } from './types'

export const EMU = 9525 // EMU per slide px; slides are 1280 x 720 px
/** Built-in table style driven by the theme's accent1 (Design DNA navy) instead of PowerPoint's default orange. */
export const TABLE_STYLE = { styleId: 'Light Style 2 - Accent 1', firstRow: true, bandRow: true }

/** Theme ops for a new deck from Design DNA: colours and the shipped heading/body font. */
export function themeOps(d: Project['design_dna']): Op[] {
  return [{ op: 'applyTheme', name: 'Research-to-Report', majorFont: d.font, minorFont: d.font, colors: {
    dk1: d.ink, lt1: '#FFFFFF', dk2: d.ink, lt2: '#F3F5F8', accent1: d.series[0], accent2: d.series[1], accent3: d.series[2], accent4: d.series[3],
    accent5: d.muted, accent6: d.rule, hlink: d.series[0], folHlink: d.muted } }]
}

export type Box = { x: number; y: number; w: number; h: number }
export interface ClipItem { item: any; binding?: Binding }
export type Command =
  | { kind: 'slide.compose'; proposal: any }
  | { kind: 'element.transform'; id: string; box: Box; rotDeg?: number }
  | { kind: 'elements.transform'; items: { id: string; box: Box; rotDeg?: number }[] }
  | { kind: 'elements.align'; ids: string[]; mode: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' }
  | { kind: 'elements.distribute'; ids: string[]; axis: 'horizontal' | 'vertical' }
  | { kind: 'text.set'; id: string; text?: string; paragraphs?: any[] }
  | { kind: 'data.set'; dataset: string; date: string; value: number | null }
  | { kind: 'chart.addSeries'; id: string; dataset: Dataset; evidence?: Record<string, any> }
  | { kind: 'element.group'; ids: string[] }
  | { kind: 'element.ungroup'; id: string }
  | { kind: 'element.delete'; ids: string[] }
  | { kind: 'clipboard.paste'; slide: string; items: ClipItem[]; offset?: number }
  | { kind: 'placeholder.add'; slide: string; label: string; request: any }
  | { kind: 'ops.raw'; ops: Op[]; summary?: string }
  | { kind: 'deck.reproject' }

export interface Ctx { deck: OpenedPptx; project: Project; sidecar: Sidecar }
export interface Outcome { summary: string; slides: string[]; created?: string[] }

const off = (x: number, y: number, w: number, h: number) => ({ x: Math.round(x * EMU), y: Math.round(y * EMU), cx: Math.round(w * EMU), cy: Math.round(h * EMU) })

export function txn(ctx: Ctx, ops: Op[]) {
  if (!ops.length) return
  const r = runTxn(ctx.deck, { ops })
  if (!r.applied) throw new Error(r.failures?.map((f) => f.error.split('\n')[0]).join(' | ') || 'transaction failed')
}
const sid = (ctx: Ctx, index: number) => slideDurableId(ctx.deck.deck.slides[index]!)
const must = (ctx: Ctx, id: string) => { const f = findEl(ctx.deck, id); if (!f) throw new Error(`element ${id} not found`); return f }

// ------------------------------------------------------------------ projections of bound elements
export function tableFill(ctx: Ctx, el: string, index: number, t: TableSpec): Op[] {
  const tg = { slide: index, el }, ops: Op[] = []
  ;['', ...t.dates].forEach((h, c) => ops.push({ op: 'setTableCell', target: tg, row: 0, col: c, paragraphs: [{ runs: [{ text: h, bold: true, fontSize: 9 }] }] }))
  t.datasets.forEach((d, r) => {
    ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: 0, paragraphs: [{ runs: [{ text: ctx.project.datasets[d]?.entity ?? d, bold: true, fontSize: 9 }] }] })
    t.dates.forEach((x, c) => ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: c + 1, paragraphs: [{ runs: [{ text: cellText(ctx.project, d, x), fontSize: 9 }], align: 'right' }] }))
  })
  return ops
}

/** Re-project every bound chart and table that reads one of the datasets. */
export function reproject(ctx: Ctx, dsIds: Set<string>, only?: string): string[] {
  const touched = new Set<number>()
  for (const [durable, b] of Object.entries(ctx.sidecar.bindings)) {
    if (only && durable !== only) continue
    const f = findEl(ctx.deck, durable); if (!f) continue
    if (b.kind === 'chart' && b.chart.series.some((d) => dsIds.has(d))) {
      txn(ctx, [{ op: 'setChart', target: { slide: f.index, el: f.el.id }, patch: { ...chartData(ctx.project, b.chart), colorScheme: chartColors(ctx.project, b.chart) } }]); touched.add(f.index)
    }
    if (b.kind === 'table' && b.table.datasets.some((d) => dsIds.has(d))) { txn(ctx, tableFill(ctx, f.el.id, f.index, b.table)); touched.add(f.index) }
  }
  touched.forEach((i) => materializeSlide(ctx.deck, i))
  return [...touched].map((i) => sid(ctx, i))
}

// ------------------------------------------------------------------ slide composition (from proposals)
interface Planned { op: Op; bind: (slide: string) => Binding; fill?: (el: string, index: number) => Op[] }

function planSlide(ctx: Ctx, p: any): Planned[] {
  const d = ctx.project.design_dna, out: Planned[] = []
  const para = (t: string, pt: number, color: string, bold = false) => ({ runs: [{ text: t, fontSize: pt, bold, color, fontFamily: d.font }] })
  // Titles and bullets shrink to fit their frame (bodyPr autoFit) instead of spilling into the next element
  const text = (role: string, t: string, box: [number, number, number, number], pt: number, color: string, bold = false) =>
    out.push({ op: { op: 'addElement', kind: 'textbox', offset: off(...box), paragraphs: t.split('\n').map((l) => para(l, pt, color, bold)), bodyPr: { wrap: 'square', insetsEmu: { l: 0, t: 0, r: 0, b: 0 }, ...(role === 'title' || role === 'body' ? { autoFit: 'shrink' } : {}) } }, bind: (slide) => ({ kind: 'text', slide, role }) })
  text('kicker', p.kicker, [40, 26, 900, 16], 8.5, d.accent, true)
  text('title', p.title, [40, 44, 1200, 44], 17, d.ink, true)
  text('subtitle', p.subtitle, [40, 92, 1200, 18], 9, d.muted)
  out.push({ op: { op: 'addElement', kind: 'rect', offset: off(40, 116, 1200, 2), fill: d.rule }, bind: (slide) => ({ kind: 'decor', slide }) })
  if (p.chart) {
    const spec: ChartSpec = { type: p.chart.type, title: p.chart.title, series: [...p.chart.series] }
    out.push({ op: { op: 'addChart', kind: spec.type, offset: off(40, 136, p.table || p.bullets ? 720 : 1200, 400), title: spec.title, ...chartData(ctx.project, spec), colorScheme: chartColors(ctx.project, spec) }, bind: (slide) => ({ kind: 'chart', slide, chart: spec }) })
  }
  if (p.table) {
    const t: TableSpec = { title: p.table.title, datasets: [...p.table.datasets], dates: [...p.table.dates] }
    out.push({ op: { op: 'addTable', rows: t.datasets.length + 1, cols: t.dates.length + 1, offset: off(784, 160, 456, 34 * (t.datasets.length + 1)) }, bind: (slide) => ({ kind: 'table', slide, table: t }),
      fill: (el, i) => [{ op: 'setTableStyle', target: { slide: i, el }, ...TABLE_STYLE }, ...tableFill(ctx, el, i, t)] })
    text('label', t.title, [784, 136, 456, 18], 9, d.muted, true)
  }
  const bullets = [...(p.bullets || []), ...(p.derived ? [`10-year spread over Germany: ${p.derived.spread_bp} bp (derived: ${p.derived.inputs.join(' − ')})`] : [])]
  if (bullets.length) text('body', bullets.map((b: string) => '• ' + b).join('\n'), [784, p.table ? 320 : 160, 456, 200], 10.5, d.ink)
  if (p.placeholder) out.push({ op: { op: 'addElement', kind: 'roundRect', offset: off(40, 160, 1200, 300), fill: '#F3F5F8', stroke: { color: '#B8C2CF', widthEmu: 9525 }, paragraphs: [para(p.placeholder.label, 14, d.muted, true), para('Research request: ' + p.placeholder.request.reason, 9, d.muted)] },
    bind: (slide) => ({ kind: 'placeholder', slide, label: p.placeholder.label, request: p.placeholder.request }) })
  const srcs = [...new Set([...(p.chart?.series || []), ...(p.table?.datasets || [])].map((x: string) => ctx.project.datasets[x]?.source_note).filter(Boolean))]
  text('source', 'Source: ' + (srcs.join('; ') || 'pending') + '. Values verified by independent re-fetch.', [40, 668, 1200, 24], 7, d.muted)
  return out
}

function composeSlide(ctx: Ctx, p: any): Outcome {
  let si = ctx.deck.deck.slides.findIndex((s: any) => s.elements.length === 0)
  if (si < 0) { txn(ctx, [{ op: 'addBlankSlide', target: { slide: ctx.deck.deck.slides.length - 1 } }]); si = ctx.deck.deck.slides.length - 1 }
  const plan = planSlide(ctx, p)
  txn(ctx, plan.map((x) => ({ ...x.op, target: { slide: si } })))
  materializeSlide(ctx.deck, si) // new elements receive their creationId (durable id) on reparse
  const added = (ctx.deck.deck.slides[si] as any).elements.slice(-plan.length)
  const slide = sid(ctx, si), fills: Op[] = [], created: string[] = []
  added.forEach((el: any, i: number) => { const id = elementDurableId(el)!; created.push(id); ctx.sidecar.bindings[id] = plan[i]!.bind(slide); if (plan[i]!.fill) fills.push(...plan[i]!.fill!(el.id, si)) })
  txn(ctx, fills); materializeSlide(ctx.deck, si)
  return { summary: `Add slide “${p.key ?? p.title}”`, slides: [slide], created }
}

// ------------------------------------------------------------------ handlers
const GROUPABLE = new Set(['text', 'shape', 'picture'])

export function run(ctx: Ctx, cmd: Command): Outcome {
  switch (cmd.kind) {
    case 'slide.compose': return composeSlide(ctx, cmd.proposal)
    case 'element.transform': {
      const f = must(ctx, cmd.id), slide = sid(ctx, f.index)
      if (f.group) {
        const g = f.group, ch = g.childOffset, chX = ch?.x ?? g.transform.offset.x, chY = ch?.y ?? g.transform.offset.y
        const o = g.transform.offset, sx = ch?.cx ? o.cx / ch.cx : 1, sy = ch?.cy ? o.cy / ch.cy : 1
        txn(ctx, [{ op: 'setTransform', target: { slide: f.index, el: f.el.id }, group: g.id, rotDeg: cmd.rotDeg ?? 0, box: { x: Math.round((cmd.box.x / sx) * EMU) + chX, y: Math.round((cmd.box.y / sy) * EMU) + chY, cx: Math.round((cmd.box.w / sx) * EMU), cy: Math.round((cmd.box.h / sy) * EMU) } }])
      } else txn(ctx, [{ op: 'setTransform', target: { slide: f.index, el: f.el.id }, rotDeg: cmd.rotDeg ?? 0, resizeTableGrid: true, box: off(cmd.box.x, cmd.box.y, cmd.box.w, cmd.box.h) }])
      return { summary: 'Move/resize', slides: [slide] }
    }
    case 'elements.transform': {
      if (!cmd.items.length) throw new Error('nothing to move')
      const slides = new Set<string>()
      for (const it of cmd.items) slides.add(run(ctx, { kind: 'element.transform', ...it }).slides[0]!)
      return { summary: cmd.items.length > 1 ? `Move/resize ${cmd.items.length} elements` : 'Move/resize', slides: [...slides] }
    }
    case 'elements.align':
    case 'elements.distribute': {
      const found = cmd.ids.map((id) => must(ctx, id))
      if (found.some((f) => f.group) || new Set(found.map((f) => f.index)).size > 1) throw new Error('Select top-level elements on one slide')
      const min = cmd.kind === 'elements.align' ? 2 : 3
      if (found.length < min) throw new Error(`Select at least ${min} elements`)
      const index = found[0]!.index, els = found.map((f) => f.el.id)
      txn(ctx, [cmd.kind === 'elements.align' ? { op: 'alignElements', target: { slide: index }, els, mode: cmd.mode } : { op: 'distributeElements', target: { slide: index }, els, axis: cmd.axis }])
      return { summary: cmd.kind === 'elements.align' ? `Align ${cmd.mode}` : `Distribute ${cmd.axis}`, slides: [sid(ctx, index)] }
    }
    case 'text.set': {
      const f = must(ctx, cmd.id)
      // the rich-text editor sends EditParagraph[] (runs with bold/italic/size/colour); plain text keeps existing styles
      const paragraphs = cmd.paragraphs ?? (cmd.text ?? '').split('\n').map((t) => ({ runs: [{ text: t }] }))
      txn(ctx, [{ op: 'setText', target: { slide: f.index, el: f.el.id }, ...(f.group ? { group: f.group.id } : {}), paragraphs }])
      return { summary: 'Edit text', slides: [sid(ctx, f.index)] }
    }
    case 'data.set': {
      setWorking(ctx.project, cmd.dataset, cmd.date, cmd.value)
      return { summary: `Edit ${cmd.dataset} ${cmd.date} = ${cmd.value ?? 'gap'}`, slides: reproject(ctx, new Set([cmd.dataset])) }
    }
    case 'chart.addSeries': {
      const b = ctx.sidecar.bindings[cmd.id]
      if (!b || b.kind !== 'chart') throw new Error('selected element is not a bound chart')
      ctx.project.datasets[cmd.dataset.id] ??= structuredClone(cmd.dataset)
      Object.assign(ctx.project.evidence, cmd.evidence ?? {})
      if (b.chart.series.includes(cmd.dataset.id)) throw new Error(`${cmd.dataset.entity} is already on this chart`)
      b.chart.series = [...b.chart.series, cmd.dataset.id]
      return { summary: `Add ${cmd.dataset.entity} to “${b.chart.title}”`, slides: reproject(ctx, new Set([cmd.dataset.id]), cmd.id) }
    }
    case 'element.group': {
      const found = cmd.ids.map((id) => must(ctx, id))
      if (found.some((f) => f.group)) throw new Error('Elements inside a group cannot be grouped again')
      if (new Set(found.map((f) => f.index)).size > 1) throw new Error('Elements must be on the same slide')
      const bad = found.filter((f) => !GROUPABLE.has(f.el.type))
      if (bad.length) throw new Error(`Charts, tables and existing groups can't be grouped yet (selected: ${[...new Set(bad.map((f) => f.el.type))].join(', ')}). This is a limitation of the slide engine.`)
      txn(ctx, [{ op: 'groupElements', target: { slide: found[0]!.index }, els: found.map((f) => f.el.id) }])
      materializeSlide(ctx.deck, found[0]!.index)
      return { summary: `Group ${found.length} elements`, slides: [sid(ctx, found[0]!.index)] }
    }
    case 'element.ungroup': {
      const f = must(ctx, cmd.id)
      if (f.el.type !== 'group') throw new Error('not a group')
      txn(ctx, [{ op: 'ungroupElement', target: { slide: f.index, el: f.el.id } }])
      materializeSlide(ctx.deck, f.index)
      return { summary: 'Ungroup', slides: [sid(ctx, f.index)] }
    }
    case 'element.delete': {
      const found = cmd.ids.map((id) => ({ id, ...must(ctx, id) }))
      txn(ctx, found.map((f) => ({ op: 'deleteElement', target: { slide: f.index, el: f.el.id }, ...(f.group ? { group: f.group.id } : {}) })))
      for (const f of found) delete ctx.sidecar.bindings[f.id]
      return { summary: `Delete ${found.length}`, slides: [...new Set(found.map((f) => sid(ctx, f.index)))] }
    }
    case 'clipboard.paste': {
      const si = slideIndex(ctx.deck, cmd.slide)
      const before = new Set([...walk(ctx.deck)].map((f) => f.durable))
      const dx = (cmd.offset ?? 16) * EMU
      txn(ctx, [{ op: 'pasteElements', target: { slide: si }, items: cmd.items.map((c) => c.item), dx, dy: dx }])
      materializeSlide(ctx.deck, si)
      // created ids are transaction-local; the pasted elements are the new durable ids, in paste order
      const fresh = (ctx.deck.deck.slides[si] as any).elements.map((e: any) => elementDurableId(e)).filter((d: string) => d && !before.has(d)) as string[]
      fresh.forEach((d, i) => { const b = cmd.items[i]?.binding; if (b) ctx.sidecar.bindings[d] = { ...structuredClone(b), slide: cmd.slide } })
      return { summary: `Paste ${fresh.length}`, slides: [cmd.slide], created: fresh }
    }
    case 'placeholder.add': {
      const si = slideIndex(ctx.deck, cmd.slide), d = ctx.project.design_dna
      const para = (t: string, pt: number, color: string, bold = false) => ({ runs: [{ text: t, fontSize: pt, bold, color, fontFamily: d.font }] })
      txn(ctx, [{ op: 'addElement', target: { slide: si }, kind: 'roundRect', offset: off(40, 470, 720, 150), fill: '#FFF6D6', stroke: { color: '#D9B44A', widthEmu: 9525 }, paragraphs: [para(cmd.label, 12, d.ink, true), para('Options: ' + (cmd.request.options ?? []).join('; '), 9, d.muted)] }])
      materializeSlide(ctx.deck, si)
      const id = elementDurableId((ctx.deck.deck.slides[si] as any).elements.at(-1))!
      ctx.sidecar.bindings[id] = { kind: 'placeholder', slide: cmd.slide, label: cmd.label, request: cmd.request }
      return { summary: 'Add research request', slides: [cmd.slide], created: [id] }
    }
    case 'deck.reproject': {
      // Re-project every bound chart and table from the working layer (e.g. after a formatting change)
      const all = new Set(Object.keys(ctx.project.datasets))
      return { summary: 'Re-project all bound values from data', slides: reproject(ctx, all) }
    }
    case 'ops.raw': {
      txn(ctx, cmd.ops)
      return { summary: cmd.summary ?? `${cmd.ops.length} operation(s)`, slides: [] }
    }
  }
}
