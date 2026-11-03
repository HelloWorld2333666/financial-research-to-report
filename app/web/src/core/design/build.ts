// Design → editable elements (PD1). A SlideDesign is laid out (layout.ts) and realized as native GenOffice objects:
// text boxes, shapes with text (takeaway band, KPI cards), native or composite charts bound to frr-viz/1 specs, and
// tables bound to datasets. Nothing is rasterized. Applying to a slide that already has a design is a redesign:
// elements are matched by design object id and kept where the user owns them (position, text or chart choice).
import { elementDurableId, materializeSlide, slideDurableId } from '@genoffice/pptx-engine'
import type { Op } from '@genoffice/pptx-ops'
import type { FontMetricsProvider } from '@genoffice/pptx-render'
import { EMU, realizeAt, TABLE_STYLE, tableFill, txn, type Ctx, type Outcome } from '../commands'
import { findEl, slideIndex } from '../deck'
import { isComposite, realize } from '../viz'
import type { Binding, ElementStyle } from '../types'
import { chartStylePatch, profileColors } from './style'
import { layoutDesign, type Box, type Laid } from './layout'
import { PROFILES, type DesignProfile } from './profiles'
import { validateDesign, type AppliedDesign, type DesignObject, type DesignText, type SlideDesign } from './spec'

const off = (b: Box) => ({ x: Math.round(b.x * EMU), y: Math.round(b.y * EMU), cx: Math.round(b.w * EMU), cy: Math.round(b.h * EMU) })
const ins = (px: number) => ({ l: px * EMU, t: px * EMU, r: px * EMU, b: px * EMU })

interface ElPlan {
  key: string
  kind: 'text' | 'shape' | 'chart' | 'composite' | 'table' | 'decor'
  box: Box
  create: Op
  /** the text content, for an in-place text update when the user owns the position */
  paragraphs?: any[]
  bind: (slide: string) => Binding
  fill?: (el: string, index: number) => Op[]
  obj?: DesignObject
}

/** Runs for text with its figures emphasised (bold, in the structure colour). */
function richRuns(t: DesignText, pt: number, color: string, font: string, figColor: string, bold = false) {
  const runs: any[] = [], text = t.text
  let at = 0
  for (const r of t.numbers ?? []) {
    const i = text.indexOf(r.text, at)
    if (i < 0) continue
    if (i > at) runs.push({ text: text.slice(at, i), fontSize: pt, color, bold, fontFamily: font })
    runs.push({ text: r.text, fontSize: pt, color: figColor, bold: true, fontFamily: font })
    at = i + r.text.length
  }
  if (at < text.length) runs.push({ text: text.slice(at), fontSize: pt, color, bold, fontFamily: font })
  return runs
}

/** The editable elements for a laid-out design. */
function planElements(ctx: Ctx, d: SlideDesign, pr: DesignProfile, L: Laid): ElPlan[] {
  const c = pr.color, f = pr.font, out: ElPlan[] = []
  const para = (runs: any[], extra: Record<string, unknown> = {}) => ({ runs, ...extra })
  const plain = (text: string, pt: number, color: string, bold = false) => [{ text, fontSize: pt, color, bold, fontFamily: f }]
  const textBind = (role: string, ts: DesignText[]) => (slide: string): Binding => {
    const numbers = ts.flatMap((t) => t.numbers ?? [])
    return { kind: 'text', slide, role, ...(numbers.length ? { numbers: structuredClone(numbers) } : {}) }
  }
  // decoration first (painted underneath): header rule, takeaway line
  for (const x of L.decor) if (x.kind === 'rule') out.push({ key: `decor:${x.id}`, kind: 'decor', box: x.box,
    create: { op: 'addElement', kind: 'rect', offset: off(x.box), fill: x.id === 'rule' ? c.structure : c.accent }, bind: (slide) => ({ kind: 'decor', slide }) })
  for (const o of d.objects) {
    const b = L.boxes[o.id], pt = L.sizes[o.id]
    if (!b) continue
    if (o.kind === 'text') {
      const role = o.role, items = o.items?.length ? o.items : [o.text]
      let paragraphs: any[]
      if (role === 'observations' || role === 'narrative') paragraphs = items.map((t, i) => para([{ text: '•  ', fontSize: pt!, color: c.accent, bold: true, fontFamily: f }, ...richRuns(t, pt!, c.ink, f, c.structure)], i < items.length - 1 ? { spaceAfterPt: 6 } : {}))
      else if (role === 'kicker') paragraphs = [para(plain(pr.treatment.kickerUpper ? o.text.text.toUpperCase() : o.text.text, pt!, c.accent, true))]
      else if (role === 'title') paragraphs = [para(richRuns(o.text, pt!, c.structure, f, c.structure, true))]
      else if (role === 'subtitle' || role === 'source') paragraphs = [para(plain(o.text.text, pt!, c.muted))]
      else if (role === 'caption') paragraphs = [para(plain(o.text.text, pt!, c.structure, true))]
      else paragraphs = [para(richRuns(o.text, pt!, c.structure, f, c.structure, d.layout.family === 'executive_insight'))] // takeaway
      const band = role === 'takeaway' && pr.treatment.takeaway === 'band'
      out.push({ key: o.id, kind: band ? 'shape' : 'text', box: b, obj: o, paragraphs,
        create: band
          ? { op: 'addElement', kind: 'rect', offset: off(b), fill: c.surface, paragraphs, bodyPr: { wrap: 'square', insetsEmu: ins(12), anchor: 'ctr' } }
          : { op: 'addElement', kind: 'textbox', offset: off(b), paragraphs, bodyPr: { wrap: 'square', insetsEmu: ins(0), anchor: 't' } },
        bind: textBind(role, items) })
    } else if (o.kind === 'kpi') {
      const lp = pr.type.kpiLabel
      const paragraphs = [para(richRuns(o.value, pt!, c.structure, f, c.structure, true), { spaceAfterPt: 2 }), para(plain(o.label, lp, c.muted)),
        ...(o.context ? [para(richRuns(o.context, lp, c.ink, f, c.ink), { spaceBeforePt: 4 })] : [])]
      const card = pr.treatment.kpiCard === 'fill' ? { fill: c.surface } : { stroke: { color: c.rule, widthEmu: 12700 } }
      out.push({ key: o.id, kind: 'shape', box: b, obj: o, paragraphs,
        create: { op: 'addElement', kind: 'rect', offset: off(b), ...card, paragraphs, bodyPr: { wrap: 'square', insetsEmu: ins(14), anchor: 't' } },
        bind: textBind('kpi', [o.value, ...(o.context ? [o.context] : [])]) })
    } else if (o.kind === 'viz') {
      const spec = o.viz, native = !isComposite(spec.family)
      const style: ElementStyle = { gridlines: true, gapWidthPct: 70, ...(native ? { colors: profileColors(ctx.project, spec, realize(ctx.project, spec), pr) } : {}), ...(o.emphasis ? { emphasis: o.emphasis, peer: c.peer } : {}) }
      if (isComposite(spec.family)) out.push({ key: o.id, kind: 'composite', box: b, obj: o, create: { op: 'addElement', kind: 'rect', offset: off(b) }, bind: (slide) => ({ kind: 'viz', slide, spec, style }) })
      else {
        const r = realize(ctx.project, spec)
        out.push({ key: o.id, kind: 'chart', box: b, obj: o, bind: (slide) => ({ kind: 'viz', slide, spec, style }),
          create: { op: 'addChart', kind: r.kind, ...(r.barDir === 'bar' ? { barDir: 'bar' } : {}), offset: off(b), title: r.title, categories: r.categories, series: r.series, colorScheme: r.colorScheme },
          fill: (el, i) => [{ op: 'setChart', target: { slide: i, el }, patch: chartStylePatch(ctx.project, r, style) }] })
      }
    } else if (o.kind === 'table') {
      const t = structuredClone(o.table), style: ElementStyle = { pt: pr.type.label }
      out.push({ key: o.id, kind: 'table', box: b, obj: o, bind: (slide) => ({ kind: 'table', slide, table: t, style }),
        create: { op: 'addTable', rows: t.datasets.length + 1, cols: t.dates.length + 1, offset: off(b) },
        fill: (el, i) => [{ op: 'setTableStyle', target: { slide: i, el }, ...TABLE_STYLE }, ...tableFill(ctx, el, i, t, pr.type.label)] })
    }
  }
  return out
}

/** Elements of a slide composed before PD1, matched to design object ids by what they are bound to. */
function adoptLegacy(ctx: Ctx, slide: string): Record<string, string> {
  const out: Record<string, string> = {}, n: Record<string, number> = {}
  for (const [id, b] of Object.entries(ctx.sidecar.bindings)) {
    if (b.slide !== slide || !findEl(ctx.deck, id)) continue
    const k = b.kind === 'text' ? ({ body: 'observations', label: 'caption1' } as Record<string, string>)[b.role] ?? b.role
      : b.kind === 'viz' ? 'primary' : b.kind === 'table' ? 'secondary' : b.kind === 'decor' ? 'decor:rule' : null
    if (!k) continue
    n[k] = (n[k] ?? 0) + 1
    out[n[k]! > 1 ? `${k}${n[k]}` : k] = id
  }
  return out
}

export interface DesignApplyOptions { metrics: FontMetricsProvider }
let METRICS: FontMetricsProvider | null = null
/** The font metrics layout measures with (the store sets its own, the same the canvas draws with). */
export const setDesignMetrics = (m: FontMetricsProvider) => { METRICS = m }

/**
 * Apply a design: to a new slide (no `slide`), or as a redesign of `slide`. One command, so one undo step.
 * The summary is the diff: what moved, was rewritten, added, removed, or kept because the user owns it.
 */
export function applyDesign(ctx: Ctx, design: SlideDesign, slide?: string): Outcome {
  const problems = validateDesign(ctx.project, design)
  if (problems.length) throw new Error('design not valid: ' + problems.join('; '))
  const pr = PROFILES[design.profile]!
  const L = layoutDesign(design, pr, METRICS ?? (() => { throw new Error('design metrics not set') })())
  for (const x of design.derivations ?? []) if (!ctx.project.derivations?.[x.id]) (ctx.project.derivations ??= {})[x.id] = structuredClone(x)
  let si: number
  if (slide) { si = slideIndex(ctx.deck, slide); if (si < 0) throw new Error('that slide is no longer in the deck') }
  else {
    si = ctx.deck.deck.slides.findIndex((s: any) => s.elements.length === 0)
    if (si < 0) { txn(ctx, [{ op: 'addBlankSlide', target: { slide: ctx.deck.deck.slides.length - 1 } }]); si = ctx.deck.deck.slides.length - 1 }
  }
  const sId = slideDurableId(ctx.deck.deck.slides[si]!)
  const prev = (ctx.sidecar.designs ??= {})[sId]
  const elements: Record<string, string> = prev ? { ...prev.elements } : slide ? adoptLegacy(ctx, sId) : {}
  const owned = (ctx.sidecar.owned ??= {})
  const plans = planElements(ctx, design, pr, L)
  const diff: string[] = [], keep: Record<string, string> = {}, redrawn = new Set<string>()
  const live = (id?: string) => (id ? findEl(ctx.deck, id) : null)
  txn(ctx, [{ op: 'setBackground', target: { slide: si }, kind: 'solid', color: pr.color.background }])
  // 1. existing elements: keep what the user owns, update in place what is compatible, remove the rest
  const toCreate: ElPlan[] = []
  for (const p of plans) {
    const id = elements[p.key], f = live(id), mine = (id && owned[id]) || {}
    if (!f || !id) { toCreate.push(p); continue }
    const isData = p.kind === 'chart' || p.kind === 'composite' || p.kind === 'table'
    const bound = ctx.sidecar.bindings[id]
    if (isData && bound && (bound.kind === 'viz' || bound.kind === 'table')) {
      // charts and tables keep their element (and so their provenance, and any chart choice the user made)
      if (bound.kind === 'viz' && p.obj?.kind === 'viz') {
        const userChart = !!mine.content
        if (!userChart) bound.spec = structuredClone(p.obj.viz)
        ;(bound as any).style = (p.bind(sId) as any).style
        if (!mine.box) txn(ctx, [{ op: 'setTransform', target: { slide: si, el: f.el.id }, box: off(p.box) }])
        const g = findEl(ctx.deck, id)!
        realizeAt(ctx, g, bound.spec, !mine.box && isComposite(bound.spec.family) ? { w: Math.round(p.box.w), h: Math.round(p.box.h) } : undefined)
        diff.push(`${p.key}: ${userChart ? 'your chart choice kept' : 'chart redrawn'}${mine.box ? ', your position kept' : ''}`)
        keep[p.key] = id; continue
      }
      if (bound.kind === 'table' && p.obj?.kind === 'table' && JSON.stringify(bound.table) === JSON.stringify(p.obj.table)) {
        ;(bound as any).style = (p.bind(sId) as any).style
        if (!mine.box) txn(ctx, [{ op: 'setTransform', target: { slide: si, el: f.el.id }, box: off(p.box) }])
        const g = findEl(ctx.deck, id)!; txn(ctx, tableFill(ctx, g.el.id, g.index, bound.table, (bound as any).style?.pt))
        diff.push(`${p.key}: table restyled${mine.box ? ', your position kept' : ''}`); keep[p.key] = id; continue
      }
      if (mine.content || mine.box) { diff.push(`${p.key}: kept as you set it`); keep[p.key] = id; continue }
      txn(ctx, [{ op: 'deleteElement', target: { slide: si, el: f.el.id } }]); delete ctx.sidecar.bindings[id]; toCreate.push(p); redrawn.add(p.key); continue
    }
    if (mine.text && mine.box) { diff.push(`${p.key}: kept as you set it`); keep[p.key] = id; continue }
    // a shape's fill and outline follow the design unless the user restyled it (style ownership is not tracked yet)
    const restyle = (el: string): Op[] => p.kind !== 'shape' ? [] : [{ op: 'setFill', target: { slide: si, el }, fill: (p.create as any).fill ?? 'none' }, { op: 'setStroke', target: { slide: si, el }, stroke: (p.create as any).stroke ?? null }]
    if (mine.text) { // the user's wording stays; the element moves to its new place
      txn(ctx, [{ op: 'setTransform', target: { slide: si, el: f.el.id }, box: off(p.box) }, ...restyle(f.el.id)]); diff.push(`${p.key}: your text kept, moved`); keep[p.key] = id; continue
    }
    if (mine.box && p.paragraphs) { // the user's position stays; the text and style follow the design
      txn(ctx, [{ op: 'setText', target: { slide: si, el: f.el.id }, paragraphs: p.paragraphs }, ...restyle(f.el.id)])
      const nb = p.bind(sId) as any, ob = ctx.sidecar.bindings[id] as any
      if (ob?.kind === 'text') { if (nb.numbers) ob.numbers = nb.numbers; else delete ob.numbers }
      diff.push(`${p.key}: rewritten, your position kept`); keep[p.key] = id; continue
    }
    txn(ctx, [{ op: 'deleteElement', target: { slide: si, el: f.el.id } }]); delete ctx.sidecar.bindings[id]; toCreate.push(p); redrawn.add(p.key)
  }
  for (const [key, id] of Object.entries(elements)) {
    if (keep[key] || plans.some((p) => p.key === key && toCreate.includes(p))) continue
    const f = live(id); if (!f) continue
    if (owned[id]) { diff.push(`${key}: not in the new design, kept because you edited it`); keep[key] = id; continue }
    txn(ctx, [{ op: 'deleteElement', target: { slide: si, el: f.el.id } }]); delete ctx.sidecar.bindings[id]
    if (!key.startsWith('decor:')) diff.push(`${key}: removed`)
  }
  // 2. new elements, then bindings, fills and composite drawings
  if (toCreate.length) {
    txn(ctx, toCreate.map((p) => ({ ...p.create, target: { slide: si } })))
    materializeSlide(ctx.deck, si)
    const added = (ctx.deck.deck.slides[si] as any).elements.slice(-toCreate.length), fills: Op[] = [], composites: [string, ElPlan][] = []
    added.forEach((el: any, i: number) => {
      const p = toCreate[i]!, id = elementDurableId(el)!
      keep[p.key] = id; ctx.sidecar.bindings[id] = p.bind(sId)
      if (p.fill) fills.push(...p.fill(el.id, si))
      if (p.kind === 'composite') composites.push([id, p])
      if ((prev || slide) && !p.key.startsWith('decor:')) diff.push(`${p.key}: ${redrawn.has(p.key) ? 'redrawn' : 'added'}`)
    })
    txn(ctx, fills); materializeSlide(ctx.deck, si)
    for (const [id, p] of composites) { const b = ctx.sidecar.bindings[id] as any; realizeAt(ctx, findEl(ctx.deck, id)!, b.spec, { w: Math.round(p.box.w), h: Math.round(p.box.h) }) }
  }
  materializeSlide(ctx.deck, si)
  ctx.sidecar.designs[sId] = { design: structuredClone(design), elements: keep } satisfies AppliedDesign
  const what = `${design.layout.family.replace('_', ' ')} layout`
  return { summary: prev || slide ? `Redesign slide as ${what}${diff.length ? ': ' + diff.join('; ') : ''}` : `Add slide “${design.objective}” (${what})`, slides: [sId], created: Object.values(keep) }
}
