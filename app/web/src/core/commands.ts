// Commands: every change to the document — by the user, the AI or research — is one of these.
// A handler turns a command into validated pptx-ops transactions plus Evidence Core edits; the Store
// wraps it in one undo snapshot and one journal entry. Numbers always come from the project.
import { appendRawElements, materializeSlide, slideDurableId, elementDurableId, type OpenedPptx } from '@genoffice/pptx-engine'
import { runTxn, type Op } from '@genoffice/pptx-ops'
import { cellText, RATING_COLUMNS, ratingCells, setWorking, verifyWorking } from './evidence'
import { check, fromChartSpec, gate, isComposite, newVizId, realize, vizDatasets, VizError, type Family, type Subtype, type Transform, type VizSpec } from './viz'
import { groupName, groupXml, layout, readGroup } from './composite'
import { headingFor, isGeneratedSubtitle, kickerFor, legacyKicker, recommend, subtitleFor } from './recommend'
import { findEl, slideIndex, textOf, walk, type Found } from './deck'
import { chartKindRefusal } from './vocabulary'
import type { Binding, Dataset, ElementStyle, NumberRef, Project, Sidecar, TableSpec } from './types'
import { chartStylePatch } from './design/style'
import { applyDesign } from './design/build'
import { dnaFor, PROFILES } from './design/profiles'
import type { SlideDesign } from './design/spec'

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
  | { kind: 'slide.compose'; proposal: any; accept?: string[] }
  | { kind: 'element.transform'; id: string; box: Box; rotDeg?: number }
  | { kind: 'elements.transform'; items: { id: string; box: Box; rotDeg?: number }[] }
  | { kind: 'elements.align'; ids: string[]; mode: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' }
  | { kind: 'elements.distribute'; ids: string[]; axis: 'horizontal' | 'vertical' }
  | { kind: 'text.set'; id: string; text?: string; paragraphs?: any[]; numbers?: NumberRef[] }
  | { kind: 'data.set'; dataset: string; date: string; value: number | null }
  | { kind: 'data.verify'; dataset: string; date: string }
  | { kind: 'data.restore'; dataset: string; date: string }
  | { kind: 'chart.addSeries'; id: string; dataset: Dataset; evidence?: Record<string, any>; accept?: string[] }
  | { kind: 'element.group'; ids: string[] }
  | { kind: 'element.ungroup'; id: string }
  | { kind: 'element.delete'; ids: string[] }
  | { kind: 'clipboard.paste'; slide: string; items: ClipItem[]; offset?: number }
  | { kind: 'placeholder.add'; slide: string; label: string; request: any }
  | { kind: 'ops.raw'; ops: Op[]; summary?: string }
  | { kind: 'deck.reproject' }
  | { kind: 'batch'; commands: Command[]; summary?: string }
  | { kind: 'data.addDatasets'; datasets: Dataset[]; evidence: Record<string, any> }
  | { kind: 'placeholder.fill'; id: string; evidence: any[]; title?: string; subtitle?: string; source_note: string }
  | { kind: 'viz.update'; id: string; spec: VizSpec; accept?: string[] }
  | { kind: 'viz.change'; id: string; family: Family; subtype?: Subtype; transform?: Transform; at?: string; between?: [string, string]; from?: string; to?: string; accept?: string[] }
  /** PD1: apply a slide design to a new slide, or redesign `slide` (keeping what the user owns) */
  | { kind: 'design.apply'; design: SlideDesign; slide?: string }
  /** PD1: change the project's design profile; designed slides are restyled, data untouched */
  | { kind: 'design.profile'; profile: string }
  /** remove a slide with its bindings, design record and ownership entries */
  | { kind: 'slide.delete'; slide: string }

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
export function tableFill(ctx: Ctx, el: string, index: number, t: TableSpec, pt = 9): Op[] {
  const tg = { slide: index, el }, ops: Op[] = []
  ;['', ...t.dates].forEach((h, c) => ops.push({ op: 'setTableCell', target: tg, row: 0, col: c, paragraphs: [{ runs: [{ text: h, bold: true, fontSize: pt }], ...(c ? { align: 'right' } : {}) }] }))
  t.datasets.forEach((d, r) => {
    ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: 0, paragraphs: [{ runs: [{ text: ctx.project.datasets[d]?.entity ?? d, bold: true, fontSize: pt }] }] })
    t.dates.forEach((x, c) => ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: c + 1, paragraphs: [{ runs: [{ text: cellText(ctx.project, d, x), fontSize: pt }], align: 'right' }] }))
  })
  return ops
}

/** Re-project every bound chart and table that reads one of the datasets. */
export function reproject(ctx: Ctx, dsIds: Set<string>, only?: string, everything = false): string[] {
  const touched = new Set<number>()
  for (const [durable, b] of Object.entries(ctx.sidecar.bindings)) {
    if (only && durable !== only) continue
    const f = findEl(ctx.deck, durable); if (!f) continue
    if (b.kind === 'viz' && (everything || vizDatasets(b.spec).some((d) => dsIds.has(d)))) { realizeAt(ctx, f, b.spec); touched.add(f.index) }
    if (b.kind === 'table' && b.table.datasets.some((d) => dsIds.has(d))) { txn(ctx, tableFill(ctx, f.el.id, f.index, b.table, b.style?.pt)); touched.add(f.index) }
  }
  touched.forEach((i) => materializeSlide(ctx.deck, i))
  return [...touched].map((i) => sid(ctx, i))
}

/** Header and one row per rating-action evidence item. */
export function ratingFill(ctx: Ctx, el: string, index: number, rows: string[]): Op[] {
  const tg = { slide: index, el }, ops: Op[] = []
  RATING_COLUMNS.forEach((h, c) => ops.push({ op: 'setTableCell', target: tg, row: 0, col: c, paragraphs: [{ runs: [{ text: h, bold: true, fontSize: 9 }] }] }))
  rows.forEach((id, r) => ratingCells(ctx.project.evidence[id]).forEach((t, c) => ops.push({ op: 'setTableCell', target: tg, row: r + 1, col: c, paragraphs: [{ runs: [{ text: t, fontSize: 9, bold: c === 3 }] }] })))
  return ops
}

/** Journal note for warnings newly kept by "Use anyway" (the spec records them; the journal says who and when). */
const keptNote = (before: VizSpec | undefined, after: VizSpec) => {
  const added = (after.accepted_warnings ?? []).filter((c) => !(before?.accepted_warnings ?? []).includes(c))
  return added.length ? ` (used anyway despite: ${added.join(', ')})` : ''
}

/** setChart that rebuilds the chart from the spec: type, direction and the FULL data (never old values). */
export function realizeOp(ctx: Ctx, index: number, el: string, spec: VizSpec, style?: ElementStyle): Op {
  const r = realize(ctx.project, spec)
  return { op: 'setChart', target: { slide: index, el }, patch: { kind: r.kind, ...(r.barDir ? { barDir: r.barDir } : {}), title: r.title, categories: r.categories, series: r.series, colorScheme: r.colorScheme, ...chartStylePatch(ctx.project, r, style) } }
}
const CREATION_ID_RE = /(<a16:creationId[^>]*\bid=")\{?([0-9A-Fa-f-]{36})\}?(")/
/** The element's own creationId GUID (the first cNvPr is the element's; a group embeds its children's after it). */
const guidOf = (el: any): string | null => CREATION_ID_RE.exec(el.anchor?.originalXml ?? '')?.[2]?.toUpperCase() ?? null
/** The next free <p:cNvPr id> on the slide (ids are unique per slide part, children of groups included). */
function nextShapeId(slide: any): number {
  let max = 1
  for (const e of slide.elements) for (const m of String(e.anchor?.originalXml ?? '').matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return max + 1
}
/** Put the element appended last at position `idx` (z-order) and give it `guid` (durable identity). */
function settle(ctx: Ctx, index: number, idx: number, guid: string | null) {
  const slide = ctx.deck.deck.slides[index]! as any, el = slide.elements.pop()
  if (guid) el.anchor.originalXml = String(el.anchor.originalXml).replace(CREATION_ID_RE, `$1{${guid}}$3`)
  slide.elements.splice(Math.min(idx, slide.elements.length), 0, el)
  slide.structureDirty = true
  materializeSlide(ctx.deck, index)
}

/**
 * Realize a bound visual where it stands (VIS V3). A native chart updates in place (setChart); otherwise the
 * element is replaced by the new realization (composite group <-> chart, or a rebuilt group), keeping its
 * creationId, so the durable id (binding key, selection, chat references) and its z-order and placement stay.
 */
export function realizeAt(ctx: Ctx, f: Found, spec: VizSpec, designSize?: { w: number; h: number }) {
  const native = !isComposite(spec.family)
  const durable = (f as any).durable as string | undefined, style = durable ? (ctx.sidecar.bindings[durable] as any)?.style as ElementStyle | undefined : undefined
  if (native && f.el.type === 'chart') { txn(ctx, [realizeOp(ctx, f.index, f.el.id, spec, style)]); return }
  const slide = ctx.deck.deck.slides[f.index]! as any, idx = slide.elements.indexOf(f.el), guid = guidOf(f.el), o = f.el.transform.offset
  if (idx < 0) throw new Error('a visual inside a group cannot be rebuilt; ungroup it first')
  let xml: string | null = null
  if (!native) {
    const pr = check(ctx.project, spec)
    // a rebuilt group keeps its design space (the user may have resized it); a chart turned composite lays out at its own size
    const size = designSize || (f.el.type === 'group' && readGroup(f.el).size) || { w: Math.round(o.cx / EMU), h: Math.round(o.cy / EMU) }
    xml = groupXml(layout(ctx.project, spec, pr, size), { guid: guid ?? crypto.randomUUID().toUpperCase(), id: nextShapeId(slide), name: groupName(spec.id), place: o, size, font: ctx.project.design_dna.font })
  }
  txn(ctx, [{ op: 'deleteElement', target: { slide: f.index, el: f.el.id } }])
  if (xml) { if (!appendRawElements(ctx.deck, f.index, [xml])) throw new Error('the visual could not be drawn') }
  else { const r = realize(ctx.project, spec); txn(ctx, [{ op: 'addChart', target: { slide: f.index }, kind: r.kind, ...(r.barDir === 'bar' ? { barDir: 'bar' } : {}), offset: o, title: r.title, categories: r.categories, series: r.series, colorScheme: r.colorScheme }]) }
  settle(ctx, f.index, idx, guid)
  if (!xml && style && durable) { const g = findEl(ctx.deck, durable); if (g?.el.type === 'chart') txn(ctx, [{ op: 'setChart', target: { slide: g.index, el: g.el.id }, patch: chartStylePatch(ctx.project, realize(ctx.project, spec), style) }]) }
}

/**
 * Keep a visual's slide headings in step with it. Only text that still says what the app wrote is changed: a
 * title equal to the visual's previous title, a kicker equal to the one written for it (or the metric id earlier
 * versions wrote), a subtitle in the "unit · Eurostat · intent" form. A heading the author edited is left alone. Returns the updated spec (its title follows).
 */
function followHeadings(ctx: Ctx, slide: string, before: VizSpec, after: VizSpec): VizSpec {
  let out = after
  for (const [id, b] of Object.entries(ctx.sidecar.bindings)) {
    if (b.kind !== 'text' || b.slide !== slide || !['title', 'kicker', 'subtitle'].includes((b as any).role)) continue
    const f = findEl(ctx.deck, id); if (!f) continue
    const now = textOf(f.el).trim(), role = (b as any).role
    let next: string | null = null
    if (role === 'title' && now === before.title.trim() && !(b as any).numbers?.length) { next = headingFor(ctx.project, after); out = { ...out, title: next } }
    if (role === 'kicker' && (now === kickerFor(ctx.project, before) || now === legacyKicker(ctx.project, before))) next = kickerFor(ctx.project, after)
    if (role === 'subtitle' && (now === subtitleFor(ctx.project, before) || isGeneratedSubtitle(now))) next = subtitleFor(ctx.project, after)
    if (next && next !== now) txn(ctx, [{ op: 'setText', target: { slide: f.index, el: f.el.id }, paragraphs: [{ runs: [{ text: next }] }] }])
  }
  return out
}

/** A spec from a proposal: frr-viz/1 ('viz') or the M1-M5 shape ('chart': {type, title, series}). */
function proposalSpec(ctx: Ctx, p: any): VizSpec | null {
  // a request by intent ({intent, datasets, title}): the recommender picks the visual (VIS V2)
  if (p.viz?.intent && !p.viz.family) {
    const r = recommend(ctx.project, { intent: p.viz.intent, datasets: p.viz.datasets, ...(p.viz.title ? { title: p.viz.title } : {}), ...(p.viz.at ? { at: p.viz.at } : {}), ...(p.viz.between ? { between: p.viz.between } : {}) })
    if (!r.recommended?.spec) throw new Error(r.error ?? `no valid visual for this data (${r.candidates.map((c) => `${c.label}: ${c.refused}`).join('; ')})`)
    return r.recommended.spec
  }
  if (p.viz) return { schema: 'frr-viz/1', missing: 'gap', ...structuredClone(p.viz), id: newVizId() }
  if (p.chart) return fromChartSpec(p.chart)
  return null
}

// ------------------------------------------------------------------ slide composition (from proposals)
interface Planned { op: Op; bind: (slide: string) => Binding; fill?: (el: string, index: number) => Op[] }

function planSlide(ctx: Ctx, p: any, accept: string[] = []): Planned[] {
  const d = ctx.project.design_dna, out: Planned[] = []
  const para = (t: string, pt: number, color: string, bold = false) => ({ runs: [{ text: t, fontSize: pt, bold, color, fontFamily: d.font }] })
  // Titles and bullets shrink to fit their frame (bodyPr autoFit) instead of spilling into the next element
  const text = (role: string, t: string, box: [number, number, number, number], pt: number, color: string, bold = false) =>
    out.push({ op: { op: 'addElement', kind: 'textbox', offset: off(...box), paragraphs: t.split('\n').map((l) => para(l, pt, color, bold)), bodyPr: { wrap: 'square', insetsEmu: { l: 0, t: 0, r: 0, b: 0 }, ...(role === 'title' || role === 'body' ? { autoFit: 'shrink' } : {}) } },
      bind: (slide) => ({ kind: 'text', slide, role, ...(p.numbers?.[role]?.length ? { numbers: structuredClone(p.numbers[role]) } : {}) }) })
  text('kicker', p.kicker, [40, 26, 900, 16], 8.5, d.accent, true)
  text('title', p.title, [40, 44, 1200, 44], 17, d.ink, true)
  text('subtitle', p.subtitle, [40, 92, 1200, 18], 9, d.muted)
  out.push({ op: { op: 'addElement', kind: 'rect', offset: off(40, 116, 1200, 2), fill: d.rule }, bind: (slide) => ({ kind: 'decor', slide }) })
  const raw = proposalSpec(ctx, p)
  const spec = raw && gate(ctx.project, raw, accept) // invalid: refused; a warning: needs "Use anyway" (accept)
  if (spec) {
    const refusal = chartKindRefusal(p.chart?.type)
    if (refusal) throw new Error(refusal)
    const box = off(40, 136, p.table || p.bullets ? 720 : 1200, 400)
    if (isComposite(spec.family)) {
      check(ctx.project, spec)
      out.push({ op: { op: 'addElement', kind: 'rect', offset: box }, bind: (slide) => ({ kind: 'viz', slide, spec }) }) // replaced by the composite once bound
    } else {
      const r = realize(ctx.project, spec) // validates the spec against the data (VizError with the reason)
      out.push({ op: { op: 'addChart', kind: r.kind, ...(r.barDir === 'bar' ? { barDir: 'bar' } : {}), offset: box, title: r.title, categories: r.categories, series: r.series, colorScheme: r.colorScheme },
        bind: (slide) => ({ kind: 'viz', slide, spec }) })
    }
  }
  if (p.table) {
    const t: TableSpec = { title: p.table.title, datasets: [...p.table.datasets], dates: [...p.table.dates] }
    const [tx, tw] = spec ? [784, 456] : [40, 720] // beside a chart, or alone (a compact-table visual)
    out.push({ op: { op: 'addTable', rows: t.datasets.length + 1, cols: t.dates.length + 1, offset: off(tx, 160, tw, 34 * (t.datasets.length + 1)) }, bind: (slide) => ({ kind: 'table', slide, table: t }),
      fill: (el, i) => [{ op: 'setTableStyle', target: { slide: i, el }, ...TABLE_STYLE }, ...tableFill(ctx, el, i, t)] })
    text('label', t.title, [tx, 136, tw, 18], 9, d.muted, true)
  }
  const bullets: string[] = p.bullets || []
  if (bullets.length) text('body', bullets.map((b: string) => '• ' + b).join('\n'), [784, p.table ? 320 : 160, 456, 200], 10.5, d.ink)
  if (p.placeholder) out.push({ op: { op: 'addElement', kind: 'roundRect', offset: off(40, 160, 1200, 300), fill: '#F3F5F8', stroke: { color: '#B8C2CF', widthEmu: 9525 }, paragraphs: [para(p.placeholder.label, 14, d.muted, true), para('Research request: ' + p.placeholder.request.reason, 9, d.muted)] },
    bind: (slide) => ({ kind: 'placeholder', slide, label: p.placeholder.label, request: p.placeholder.request }) })
  const srcs = [...new Set([...(p.chart?.series || []), ...(p.table?.datasets || [])].map((x: string) => ctx.project.datasets[x]?.source_note).filter(Boolean))]
  text('source', 'Source: ' + (srcs.join('; ') || 'pending') + '. Values verified by independent re-fetch.', [40, 668, 1200, 24], 7, d.muted)
  return out
}

function composeSlide(ctx: Ctx, p: any, accept?: string[]): Outcome {
  let si = ctx.deck.deck.slides.findIndex((s: any) => s.elements.length === 0)
  if (si < 0) { txn(ctx, [{ op: 'addBlankSlide', target: { slide: ctx.deck.deck.slides.length - 1 } }]); si = ctx.deck.deck.slides.length - 1 }
  const plan = planSlide(ctx, p, accept)
  txn(ctx, plan.map((x) => ({ ...x.op, target: { slide: si } })))
  for (const d of p.derivations ?? []) (ctx.project.derivations ??= {})[d.id] = structuredClone(d)
  materializeSlide(ctx.deck, si) // new elements receive their creationId (durable id) on reparse
  const added = (ctx.deck.deck.slides[si] as any).elements.slice(-plan.length)
  const slide = sid(ctx, si), fills: Op[] = [], created: string[] = []
  added.forEach((el: any, i: number) => { const id = elementDurableId(el)!; created.push(id); ctx.sidecar.bindings[id] = plan[i]!.bind(slide); if (plan[i]!.fill) fills.push(...plan[i]!.fill!(el.id, si)) })
  txn(ctx, fills); materializeSlide(ctx.deck, si)
  for (const id of created) { const b = ctx.sidecar.bindings[id]; if (b?.kind === 'viz' && isComposite(b.spec.family)) realizeAt(ctx, must(ctx, id), b.spec) }
  const viz = plan.map((x) => x.bind(slide)).find((b) => b.kind === 'viz') as { spec: VizSpec } | undefined
  return { summary: `Add slide “${p.key ?? p.title}”${viz ? keptNote(undefined, viz.spec) : ''}`, slides: [slide], created }
}

// ------------------------------------------------------------------ handlers
const GROUPABLE = new Set(['text', 'shape', 'picture'])

export function run(ctx: Ctx, cmd: Command): Outcome {
  switch (cmd.kind) {
    case 'slide.compose': return composeSlide(ctx, cmd.proposal, cmd.accept)
    case 'design.apply': return applyDesign(ctx, cmd.design, cmd.slide)
    case 'slide.delete': {
      const si = slideIndex(ctx.deck, cmd.slide)
      if (si < 0) throw new Error('that slide is no longer in the deck')
      if (ctx.deck.deck.slides.length < 2) throw new Error('a deck keeps at least one slide')
      for (const [id, b] of Object.entries(ctx.sidecar.bindings)) if (b.slide === cmd.slide) { delete ctx.sidecar.bindings[id]; delete ctx.sidecar.owned?.[id] }
      delete ctx.sidecar.designs?.[cmd.slide]
      txn(ctx, [{ op: 'deleteSlide', target: { slide: si } }])
      return { summary: `Delete slide ${si + 1}`, slides: [] }
    }
    case 'design.profile': {
      const pr = PROFILES[cmd.profile]
      if (!pr) throw new Error(`unknown design profile "${cmd.profile}"`)
      ;(ctx.project as any).design_profile = pr.id
      ctx.project.design_dna = dnaFor(pr)
      txn(ctx, themeOps(ctx.project.design_dna))
      const touched = reproject(ctx, new Set(), undefined, true) // chart colours follow the profile; values are unchanged
      const outs = Object.entries(ctx.sidecar.designs ?? {}).filter(([s]) => slideIndex(ctx.deck, s) >= 0).map(([s, a]) => applyDesign(ctx, { ...a.design, profile: pr.id }, s))
      return { summary: `Design profile: ${pr.name} (${outs.length} designed slide${outs.length === 1 ? '' : 's'} restyled; data unchanged)`, slides: [...new Set([...touched, ...outs.flatMap((o) => o.slides)])] }
    }
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
      // generated wording (AI rewrite) brings the evidence reference of every figure it writes
      const b = ctx.sidecar.bindings[cmd.id]
      if (cmd.numbers && b?.kind === 'text') b.numbers = structuredClone(cmd.numbers)
      return { summary: cmd.numbers ? `Rewrite text (${cmd.numbers.length} figures bound to evidence)` : 'Edit text', slides: [sid(ctx, f.index)] }
    }
    case 'data.set': {
      setWorking(ctx.project, cmd.dataset, cmd.date, cmd.value)
      return { summary: `Edit ${cmd.dataset} ${cmd.date} = ${cmd.value ?? 'gap'}`, slides: reproject(ctx, new Set([cmd.dataset])) }
    }
    case 'batch': {
      const outs = cmd.commands.map((c) => run(ctx, c))
      return { summary: cmd.summary ?? outs.map((o) => o.summary).join('; '), slides: [...new Set(outs.flatMap((o) => o.slides))], created: outs.flatMap((o) => o.created ?? []) }
    }
    case 'data.verify': {
      verifyWorking(ctx.project, cmd.dataset, cmd.date)
      return { summary: `Verify ${cmd.dataset} ${cmd.date}`, slides: [] }
    }
    case 'data.restore': {
      const d = ctx.project.datasets[cmd.dataset]
      if (!d?.working[cmd.date]) throw new Error(`${cmd.dataset} ${cmd.date} has no manual edit`)
      delete d.working[cmd.date]
      return { summary: `Restore source value ${cmd.dataset} ${cmd.date}`, slides: reproject(ctx, new Set([cmd.dataset])) }
    }
    case 'chart.addSeries': {
      const b = ctx.sidecar.bindings[cmd.id]
      if (!b || b.kind !== 'viz') throw new Error('selected element is not a bound chart')
      ctx.project.datasets[cmd.dataset.id] ??= structuredClone(cmd.dataset)
      Object.assign(ctx.project.evidence, cmd.evidence ?? {})
      if (b.spec.view.datasets.includes(cmd.dataset.id)) throw new Error(`${cmd.dataset.entity} is already on this chart`)
      if (b.spec.family === 'scatter') throw new Error('a scatter pairs two datasets; it does not take another series')
      const before = b.spec
      b.spec = gate(ctx.project, { ...b.spec, view: { ...b.spec.view, datasets: [...b.spec.view.datasets, cmd.dataset.id] } }, cmd.accept)
      return { summary: `Add ${cmd.dataset.entity} to “${b.spec.title}”${keptNote(before, b.spec)}`, slides: reproject(ctx, new Set([cmd.dataset.id]), cmd.id) }
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
      if (ctx.sidecar.bindings[cmd.id]?.kind === 'viz') throw new Error('This visual is bound to data: ungrouping would leave loose shapes that no longer update or check against the data. Change the visual or edit its data instead.')
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
      fresh.forEach((d, i) => {
        const b = cmd.items[i]?.binding
        if (!b) return
        const copy: Binding = { ...structuredClone(b), slide: cmd.slide }
        if (copy.kind === 'viz') copy.spec = { ...copy.spec, id: newVizId() } // a pasted chart is a new visual
        ctx.sidecar.bindings[d] = copy
      })
      return { summary: `Paste ${fresh.length}`, slides: [cmd.slide], created: fresh }
    }
    case 'placeholder.add': {
      const si = slideIndex(ctx.deck, cmd.slide), d = ctx.project.design_dna
      const para = (t: string, pt: number, color: string, bold = false) => ({ runs: [{ text: t, fontSize: pt, bold, color, fontFamily: d.font }] })
      const note = cmd.request.options?.length ? 'Options: ' + cmd.request.options.join('; ') : cmd.request.reason ?? ''
      txn(ctx, [{ op: 'addElement', target: { slide: si }, kind: 'roundRect', offset: off(40, 470, 720, 150), fill: '#FFF6D6', stroke: { color: '#D9B44A', widthEmu: 9525 }, paragraphs: [para(cmd.label, 12, d.ink, true), para(note, 9, d.muted)] }])
      materializeSlide(ctx.deck, si)
      const id = elementDurableId((ctx.deck.deck.slides[si] as any).elements.at(-1))!
      ctx.sidecar.bindings[id] = { kind: 'placeholder', slide: cmd.slide, label: cmd.label, request: cmd.request }
      return { summary: 'Add research request', slides: [cmd.slide], created: [id] }
    }
    case 'data.addDatasets': {
      const added = cmd.datasets.filter((d) => !ctx.project.datasets[d.id])
      if (!added.length) throw new Error('every dataset is already in the project')
      for (const d of added) ctx.project.datasets[d.id] = structuredClone(d)
      for (const d of added) for (const o of d.observations) if (o.evidence_id && cmd.evidence[o.evidence_id]) ctx.project.evidence[o.evidence_id] = structuredClone(cmd.evidence[o.evidence_id])
      return { summary: `Add ${added.length} verified dataset${added.length === 1 ? '' : 's'} (${added.map((d) => d.entity + ' ' + d.metric).join(', ')})`, slides: [] }
    }
    case 'placeholder.fill': {
      // a research request completed: the placeholder becomes a ratings table whose rows ARE verified evidence
      const f = must(ctx, cmd.id), b = ctx.sidecar.bindings[cmd.id]
      if (b?.kind !== 'placeholder') throw new Error('that element is not a research placeholder')
      if (!cmd.evidence.length) throw new Error('no verified evidence to place')
      const si = f.index, slide = b.slide, o = f.el.transform.offset, d = ctx.project.design_dna
      for (const e of cmd.evidence) ctx.project.evidence[e.id] = structuredClone(e)
      const rows = cmd.evidence.map((e) => e.id)
      txn(ctx, [{ op: 'deleteElement', target: { slide: si, el: f.el.id } }])
      delete ctx.sidecar.bindings[cmd.id]
      txn(ctx, [{ op: 'addTable', target: { slide: si }, rows: rows.length + 1, cols: RATING_COLUMNS.length, offset: off(o.x / EMU, o.y / EMU, Math.max(o.cx / EMU, 720), 32 * (rows.length + 1)) }])
      materializeSlide(ctx.deck, si)
      const tbl = (ctx.deck.deck.slides[si] as any).elements.at(-1), tid = elementDurableId(tbl)!
      ctx.sidecar.bindings[tid] = { kind: 'ratings', slide, rows }
      const role = (r: string) => Object.entries(ctx.sidecar.bindings).find(([, x]) => x.kind === 'text' && (x as any).role === r && x.slide === slide)?.[0]
      const setText = (id: string | undefined, text?: string) => { if (!id || !text) return []; const e = must(ctx, id); return [{ op: 'setText', target: { slide: e.index, el: e.el.id }, paragraphs: [{ runs: [{ text }] }] } as Op] }
      txn(ctx, [{ op: 'setTableStyle', target: { slide: si, el: tbl.id }, ...TABLE_STYLE }, ...ratingFill(ctx, tbl.id, si, rows),
        ...setText(role('title'), cmd.title), ...setText(role('subtitle'), cmd.subtitle), ...setText(role('source'), cmd.source_note)])
      if (!role('source')) {
        txn(ctx, [{ op: 'addElement', target: { slide: si }, kind: 'textbox', offset: off(40, 668, 1200, 24), paragraphs: [{ runs: [{ text: cmd.source_note, fontSize: 7, color: d.muted, fontFamily: d.font }] }] }])
        materializeSlide(ctx.deck, si)
        ctx.sidecar.bindings[elementDurableId((ctx.deck.deck.slides[si] as any).elements.at(-1))!] = { kind: 'text', slide, role: 'source' }
      }
      materializeSlide(ctx.deck, si)
      return { summary: `Replace the placeholder with ${rows.length} verified rating action${rows.length === 1 ? '' : 's'}`, slides: [slide], created: [tid] }
    }
    case 'viz.update': {
      const f = must(ctx, cmd.id), b = ctx.sidecar.bindings[cmd.id]
      if (b?.kind !== 'viz') throw new Error('that element is not a bound chart')
      // acknowledgements come from the existing spec or this command, never from the replacement spec itself
      const spec = gate(ctx.project, { ...structuredClone(cmd.spec), id: b.spec.id, accepted_warnings: b.spec.accepted_warnings }, cmd.accept)
      realizeAt(ctx, f, spec)
      const before = b.spec
      b.spec = followHeadings(ctx, b.slide, before, spec)
      materializeSlide(ctx.deck, f.index)
      return { summary: `Update visual “${spec.title}”${keptNote(before, spec)}`, slides: [sid(ctx, f.index)] }
    }
    case 'viz.change': {
      // change the visual, keep the data: same datasets, units, title and provenance; only the view shape may change
      const f = must(ctx, cmd.id), b = ctx.sidecar.bindings[cmd.id]
      if (b?.kind !== 'viz') throw new Error('that element is not a bound chart')
      const view = { ...b.spec.view, ...(cmd.transform ? { transform: cmd.transform } : {}), ...(cmd.at ? { at: cmd.at } : {}), ...(cmd.between ? { between: cmd.between } : {}),
        ...(cmd.from ? { from: cmd.from } : {}), ...(cmd.to ? { to: cmd.to } : {}) }
      const spec = gate(ctx.project, { ...b.spec, family: cmd.family, ...(cmd.subtype ? { subtype: cmd.subtype } : { subtype: undefined }), view }, cmd.accept)
      // a single-period or change view is titled by its period ("…, 2025"); back over time, title it by the series and unit
      if (b.spec.view.transform !== 'none' && view.transform === 'none') { const pr = check(ctx.project, spec); spec.title = `${pr.label.charAt(0).toUpperCase()}${pr.label.slice(1)}, ${pr.unit}` }
      realizeAt(ctx, f, spec)
      const before = b.spec
      b.spec = followHeadings(ctx, b.slide, before, spec)
      materializeSlide(ctx.deck, f.index)
      return { summary: `Change “${spec.title}” to ${cmd.family}${cmd.subtype && cmd.subtype !== 'clustered' ? ` (${cmd.subtype})` : ''}${cmd.transform && cmd.transform !== 'none' ? `, ${cmd.transform}` : ''}${keptNote(before, spec)}`, slides: [sid(ctx, f.index)] }
    }
    case 'deck.reproject': {
      // Re-project every bound chart and table from the working layer (e.g. after a formatting change)
      const all = new Set(Object.keys(ctx.project.datasets))
      const slides = reproject(ctx, all, undefined, true)
      // generated headings written by earlier versions (a metric id as kicker, a count in a title) follow the visual too
      for (const b of Object.values(ctx.sidecar.bindings)) if (b.kind === 'viz') { try { b.spec = followHeadings(ctx, b.slide, b.spec, b.spec) } catch { /* a visual its data no longer fits: integrity reports it */ } }
      ctx.deck.deck.slides.forEach((_, i) => materializeSlide(ctx.deck, i))
      return { summary: 'Re-project all bound values from data', slides }
    }
    case 'ops.raw': {
      for (const op of cmd.ops as any[]) {
        const refusal = (op.op === 'addChart' && chartKindRefusal(op.kind)) || (op.op === 'setChart' && chartKindRefusal(op.patch?.kind))
        if (refusal) throw new Error(refusal)
      }
      txn(ctx, cmd.ops)
      return { summary: cmd.summary ?? `${cmd.ops.length} operation(s)`, slides: [] }
    }
  }
}
