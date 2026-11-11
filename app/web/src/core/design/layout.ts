// Layout engine (PD1): turns a SlideDesign and a profile into boxes on the 1280 x 720 slide. Three families, each a
// composition with parameters (shares, placement, density), not a fixed slide. Text is measured with the same font
// metrics the canvas draws with, so titles and notes are sized to fit instead of being shrunk afterwards.
import type { FontMetricsProvider } from '@genoffice/pptx-render'
import type { DesignObject, DesignText, SlideDesign } from './spec'
import type { DesignProfile } from './profiles'

export const W = 1280, H = 720
export interface Box { x: number; y: number; w: number; h: number }
export interface Laid {
  boxes: Record<string, Box>
  /** font size (pt) chosen for each text object and KPI value */
  sizes: Record<string, number>
  zones: { header: Box; content: Box; footer: Box }
  /** the takeaway band/line and header rule, drawn as decoration */
  decor: { id: string; box: Box; kind: 'rule' | 'band' | 'card' | 'badge'; fill?: string; text?: string; pt?: number }[]
  notes: string[]
}

const px = (pt: number) => (pt * 96) / 72
const LINE = 1.25 // line height factor used for sizing boxes

/** Word-wrapped line count of `text` at `pt` within `width` px. */
export function lineCount(m: FontMetricsProvider, font: string, text: string, pt: number, width: number, bold = false): number {
  let lines = 0
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { lines++; continue }
    let cur = '', n = 1
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w
      if (m.measure(next, { fontFamily: font, fontSizePx: px(pt), bold, italic: false }) > width && cur) { n++; cur = w } else cur = next
    }
    lines += n
  }
  return lines
}
export const textHeight = (lines: number, pt: number, paraGapPt = 0, paras = 1) => Math.ceil(lines * px(pt) * LINE + Math.max(0, paras - 1) * px(paraGapPt))

/** Density scales body text and how much goes on a slide. */
const DENSITY = { low: { scale: 1.08, items: 2 }, medium: { scale: 1, items: 3 }, high: { scale: 0.92, items: 5 } }
export const maxItems = (d: SlideDesign) => DENSITY[d.density].items

const textOf = (o: DesignObject) => (o.kind === 'text' ? [o.text, ...(o.items ?? [])].filter((t) => t.text).map((t) => t.text).join('\n') : '')
const itemsOf = (o: DesignObject): DesignText[] => (o.kind === 'text' ? (o.items?.length ? o.items : [o.text]) : [])

/** Largest size between `max` and `min` (0.5 pt steps) at which `text` fits `box`; returns min if nothing fits. */
function fitSize(m: FontMetricsProvider, font: string, text: string, box: Box, max: number, min: number, paras = 1, paraGap = 4): number {
  for (let pt = max; pt >= min; pt -= 0.5) if (textHeight(lineCount(m, font, text, pt, box.w), pt, paraGap, paras) <= box.h) return pt
  return min
}

export function layoutDesign(d: SlideDesign, pr: DesignProfile, m: FontMetricsProvider): Laid {
  const { margin: M, top: T, gutter: G, gap } = pr.space, f = pr.font, sc = DENSITY[d.density].scale
  const boxes: Record<string, Box> = {}, sizes: Record<string, number> = {}, decor: Laid['decor'] = [], notes: string[] = []
  const obj = (role: string) => d.objects.find((o) => (o.kind === 'text' && o.role === role))
  const cw = W - 2 * M
  // ---- header: kicker, title (up to two lines, sized to fit), subtitle, rule
  let y = T
  const kicker = obj('kicker'), title = obj('title'), subtitle = obj('subtitle'), source = obj('source')
  if (kicker) { sizes[kicker.id] = pr.type.kicker; boxes[kicker.id] = { x: M, y, w: cw, h: textHeight(1, pr.type.kicker) }; y += boxes[kicker.id]!.h + 6 }
  if (title) {
    let pt = pr.type.title, lines = lineCount(m, f, textOf(title), pt, cw, true)
    while (lines > 2 && pt > pr.type.titleMin) { pt -= 0.5; lines = lineCount(m, f, textOf(title), pt, cw, true) }
    if (lines > 2) notes.push(`the title needs ${lines} lines at ${pt} pt; shorten it`)
    sizes[title.id] = pt; boxes[title.id] = { x: M, y, w: cw, h: textHeight(lines, pt) }; y += boxes[title.id]!.h + 6
  }
  if (subtitle) {
    const lines = lineCount(m, f, textOf(subtitle), pr.type.subtitle, cw)
    sizes[subtitle.id] = pr.type.subtitle; boxes[subtitle.id] = { x: M, y, w: cw, h: textHeight(lines, pr.type.subtitle) }; y += boxes[subtitle.id]!.h + 8
  }
  if (pr.treatment.headerRule) { decor.push({ id: 'rule', kind: 'rule', box: { x: M, y, w: cw, h: 1.5 } }); y += 2 }
  const header: Box = { x: M, y: T, w: cw, h: y - T }
  // ---- footer: source note (one or two lines at the source size)
  let footerTop = H - 26
  if (source) {
    const lines = Math.min(2, lineCount(m, f, textOf(source), pr.type.source, cw))
    const h = textHeight(lines, pr.type.source)
    sizes[source.id] = pr.type.source; boxes[source.id] = { x: M, y: H - 22 - h, w: cw, h }; footerTop = H - 22 - h
  }
  const footer: Box = { x: M, y: footerTop, w: cw, h: H - footerTop }
  let C: Box = { x: M, y: y + gap * 1.25, w: cw, h: footerTop - gap - (y + gap * 1.25) }
  // ---- takeaway: a band above the content, or a line under it
  const take = obj('takeaway'), where = d.layout.params.takeaway ?? (d.layout.family === 'executive_insight' ? 'top' : 'top')
  if (take && where !== 'none') {
    const big = d.layout.family === 'executive_insight', pt = (big ? pr.type.takeaway * 1.3 : pr.type.takeaway) * (big ? 1 : sc)
    const band = pr.treatment.takeaway === 'band', pad = band ? 12 : 0, inner = cw - 2 * pad - (band ? 6 : 0)
    const lines = lineCount(m, f, textOf(take), pt, inner, big)
    const h = textHeight(lines, pt) + 2 * pad
    const by = where === 'top' ? C.y : C.y + C.h - h
    sizes[take.id] = pt; boxes[take.id] = { x: M, y: by, w: cw, h }
    if (band) decor.push({ id: 'band', kind: 'band', box: boxes[take.id]! })
    else decor.push({ id: 'band', kind: 'rule', box: { x: M, y: where === 'top' ? by + h + 4 : by - 6, w: 48, h: 2 } })
    C = where === 'top' ? { x: C.x, y: by + h + gap * 1.25, w: C.w, h: C.h - h - gap * 1.25 } : { x: C.x, y: C.y, w: C.w, h: C.h - h - gap * 1.25 }
  }
  const content = { ...C }
  const visuals = d.objects.filter((o) => o.kind === 'viz' || o.kind === 'table')
  const primary = visuals.find((o) => o.role === 'primary') ?? visuals[0]
  const secondary = visuals.filter((o) => o !== primary)
  const captions = d.objects.filter((o) => o.kind === 'text' && o.role === 'caption')
  const supports = d.objects.filter((o) => o.kind === 'text' && (o.role === 'observations' || o.role === 'narrative'))
  const support = supports[0]
  const kpis = d.objects.filter((o) => o.kind === 'kpi')
  const bodyPt = pr.type.body * sc
  // supporting text may grow a little to fill its column (up to 15% over the body size), and shrinks before it overflows
  const placeText = (o: DesignObject, b: Box, max = bodyPt * 1.15) => {
    const items = itemsOf(o)
    boxes[o.id] = b; sizes[o.id] = fitSize(m, f, items.map((t) => '• ' + t.text).join('\n'), { ...b, w: b.w - 14 }, max, Math.max(pr.type.min + 1, bodyPt * 0.85), items.length, 6)
  }
  const needFor = (o: DesignObject, w: number, pt = bodyPt) => textHeight(lineCount(m, f, itemsOf(o).map((t) => '• ' + t.text).join('\n'), pt, w - 14), pt, 6, itemsOf(o).length) + 4
  /** the caption written for a visual: caption1 belongs to the primary visual, caption2 to the secondary */
  const captionFor = (o: DesignObject | undefined) => o && captions.find((c) => c.id === (o === primary ? 'caption1' : 'caption2'))
  /** a visual with its caption above it (if the design gives one) */
  const placeVisual = (o: DesignObject, b: Box, caption?: DesignObject) => {
    if (caption) {
      const h = textHeight(lineCount(m, f, textOf(caption), pr.type.label, b.w, true), pr.type.label)
      boxes[caption.id] = { x: b.x, y: b.y, w: b.w, h }; sizes[caption.id] = pr.type.label
      b = { x: b.x, y: b.y + h + 6, w: b.w, h: b.h - h - 6 }
    }
    if (o.kind === 'table') {
      const rows = o.table.datasets.length + 1, rowH = Math.min(40, Math.max(28, Math.floor(b.h / rows)))
      boxes[o.id] = { x: b.x, y: b.y, w: b.w, h: Math.min(b.h, rows * rowH) }
    } else boxes[o.id] = b
    return boxes[o.id]!
  }
  const kpiH = Math.ceil(px(pr.type.kpi) * 1.15 + textHeight(2, pr.type.kpiLabel) + textHeight(1, pr.type.kpiLabel) + 28)
  const placeKpis = (area: Box, dir: 'row' | 'column') => {
    const n = kpis.length
    kpis.forEach((k, i) => {
      const b = dir === 'row'
        ? { x: area.x + i * ((area.w - (n - 1) * gap) / n + gap), y: area.y, w: (area.w - (n - 1) * gap) / n, h: Math.min(area.h, kpiH) }
        : { x: area.x, y: area.y + i * (Math.min(kpiH, (area.h - (n - 1) * gap) / n) + gap), w: area.w, h: Math.min(kpiH, (area.h - (n - 1) * gap) / n) }
      boxes[k.id] = b; sizes[k.id] = pr.type.kpi
      decor.push({ id: `card-${k.id}`, kind: 'card', box: b })
    })
  }

  const P = d.layout.params
  if (d.layout.family === 'analytical_hero') {
    const share = P.heroShare ?? 0.68, mode = support ? P.support ?? 'side' : 'none'
    if (mode === 'side' && share < 1) {
      const hw = Math.round(C.w * share - G / 2), sx = C.x + hw + G, sw = C.w - hw - G
      if (primary) placeVisual(primary, { x: C.x, y: C.y, w: hw, h: C.h }, captionFor(primary))
      let sy = C.y
      if (kpis.length) { placeKpis({ x: sx, y: sy, w: sw, h: C.h / 2 }, 'column'); sy = Math.max(...kpis.map((k) => boxes[k.id]!.y + boxes[k.id]!.h)) + gap }
      if (support) placeText(support, { x: sx, y: sy, w: sw, h: C.y + C.h - sy })
    } else if (mode === 'below') {
      // one text object per column (the planner splits observations for this placement)
      const cols = supports.length, colW = (C.w - (cols - 1) * G) / cols
      const need = Math.max(...supports.map((o) => textHeight(lineCount(m, f, textOf(o), bodyPt, colW - 14), bodyPt, 6, itemsOf(o).length))) + 6
      if (primary) placeVisual(primary, { x: C.x, y: C.y, w: C.w, h: C.h - need - gap * 1.5 }, captionFor(primary))
      supports.forEach((o, i) => placeText(o, { x: C.x + i * (colW + G), y: C.y + C.h - need, w: colW, h: need }))
    } else if (primary) placeVisual(primary, C, captionFor(primary))
  } else if (d.layout.family === 'comparative') {
    const arr = P.arrangement ?? (secondary[0]?.kind === 'table' ? 'chart_table' : 'side_by_side'), s = P.split ?? 0.58
    const [a, b] = [primary, secondary[0]]
    let area = C
    // notes go under the table in a chart-and-table layout (when it leaves room), otherwise in a strip under the pair
    const underTable = support && arr === 'chart_table' && b?.kind === 'table'
    if (support && !underTable) {
      const need = needFor(support, C.w)
      placeText(support, { x: C.x, y: C.y + C.h - need, w: C.w, h: need }); area = { ...C, h: C.h - need - gap * 1.5 }
    }
    if (arr === 'stacked') {
      const h = (area.h - gap * 1.5) / 2
      if (a) placeVisual(a, { x: area.x, y: area.y, w: area.w, h }, captionFor(a))
      if (b) placeVisual(b, { x: area.x, y: area.y + h + gap * 1.5, w: area.w, h }, captionFor(b))
    } else {
      const lw = Math.round(area.w * s - G / 2), rx = area.x + lw + G, rw = area.w - lw - G
      if (a) placeVisual(a, { x: area.x, y: area.y, w: lw, h: area.h }, captionFor(a))
      if (b) {
        const tb = placeVisual(b, { x: rx, y: area.y, w: rw, h: area.h }, captionFor(b))
        if (underTable && support) {
          const y0 = tb.y + tb.h + gap * 1.5, room = area.y + area.h - y0
          if (room >= 60) placeText(support, { x: rx, y: y0, w: rw, h: room })
          else { const need = needFor(support, area.w); placeText(support, { x: area.x, y: area.y + area.h - need, w: area.w, h: need }) }
        }
      }
    }
  } else { // executive_insight
    const dir = P.kpiPlacement ?? 'row'
    if (dir === 'row') {
      placeKpis({ x: C.x, y: C.y, w: C.w, h: kpiH }, 'row')
      const ry = C.y + kpiH + gap * 1.5, rh = C.y + C.h - ry
      const evidence = secondary[0] ?? primary
      if (evidence && support) {
        const nw = Math.round(C.w * 0.56 - G / 2)
        placeText(support, { x: C.x, y: ry, w: nw, h: rh })
        placeVisual(evidence, { x: C.x + nw + G, y: ry, w: C.w - nw - G, h: rh }, captionFor(evidence))
      } else if (support) placeText(support, { x: C.x, y: ry, w: C.w, h: rh })
      else if (evidence) placeVisual(evidence, { x: C.x, y: ry, w: C.w, h: rh }, captionFor(evidence))
    } else {
      const kw = Math.round(C.w * 0.3)
      placeKpis({ x: C.x, y: C.y, w: kw, h: C.h }, 'column')
      const rx = C.x + kw + G, rw = C.w - kw - G
      const evidence = secondary[0] ?? primary
      if (evidence && support) {
        // the explanation takes the height it needs (at most half the column); the evidence chart keeps the rest
        const th = Math.min(Math.round(C.h * 0.5), needFor(support, rw))
        placeText(support, { x: rx, y: C.y, w: rw, h: th }, bodyPt)
        placeVisual(evidence, { x: rx, y: C.y + th + gap * 1.5, w: rw, h: C.h - th - gap * 1.5 }, captionFor(evidence))
      } else if (support) placeText(support, { x: rx, y: C.y, w: rw, h: C.h })
    }
  }
  for (const o of d.objects) if (!boxes[o.id] && o.kind !== 'text') notes.push(`${o.id} has no place in a ${d.layout.family} layout`)
  return { boxes, sizes, zones: { header, content, footer }, decor, notes }
}
