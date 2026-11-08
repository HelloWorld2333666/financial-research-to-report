// Visual quality checks (PD1), deterministic, on the slide as the renderer lays it out (the same render tree the
// canvas draws). GenOffice's own layout audit (vendored, Apache-2.0) finds elements off the slide, text overflowing
// its box and overlapping objects; the checks below add what made the earlier France slides weak: small charts in
// large empty slides, tiny type, near-miss alignment, crowded or colliding chart labels, legends over data, a broken
// hierarchy, and styles that drift between slides. A finding is evidence for a person or the model, not a score.
import { auditSlideFindings } from '@genoffice/pipelines/slides/layout-audit'
import type { FontMetricsProvider, RenderNode, RenderSlide } from '@genoffice/pptx-render'
import type { OpenedPptx } from '@genoffice/pptx-engine'
import { durableOfSource, render, slideList } from '../deck'
import type { Project, Sidecar } from '../types'
import { profileOf, PROFILES } from './profiles'

export interface QaFinding { code: string; level: 'error' | 'warning'; message: string; el?: string }
interface Ctx { deck: OpenedPptx; project: Project; sidecar: Sidecar }
type R = { x: number; y: number; w: number; h: number }

const PT = (px: number) => Math.round(((px * 72) / 96) * 10) / 10
const area = (b: R) => Math.max(0, b.w) * Math.max(0, b.h)
const inter = (a: R, b: R) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

function flat(nodes: RenderNode[], out: RenderNode[] = []): RenderNode[] {
  for (const n of nodes) { out.push(n); if ((n as any).children) flat((n as any).children, out) }
  return out
}
/** The part of a node that carries ink: laid-out text height for text, the whole box otherwise. */
function inkBox(n: RenderNode): R {
  const b = n.box, t = (n as any).text
  if (t && (n.type === 'shape' || n.type === 'text') && !(n as any).fill?.color) {
    const h = Math.min(b.h, (t.inkBottom ?? t.contentHeight ?? b.h) + (t.insets?.t ?? 0))
    return { x: b.x, y: b.y, w: b.w, h: Math.max(h, 1) }
  }
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

/** QA of one slide. `fit` 1280 keeps render px equal to slide px. */
export function qaSlide(ctx: Ctx, index: number, metrics: FontMetricsProvider): QaFinding[] {
  const slide: RenderSlide = render(ctx.deck, index, 1280, metrics)
  const sId = slideList(ctx.deck)[index]!.id
  const applied = ctx.sidecar.designs?.[sId]
  const pr = PROFILES[applied?.design.profile ?? ''] ?? profileOf(ctx.project)
  const idOf = (sourceId: string) => durableOfSource(ctx.deck, index, sourceId) ?? sourceId
  const roleOf = (n: RenderNode) => { const d = idOf(n.sourceId), b: any = ctx.sidecar.bindings[d]; return b ? (b.kind === 'text' ? b.role : b.kind) : null }
  const out: QaFinding[] = []
  // 1. GenOffice's geometry audit: off the slide, out of bounds, text overflow (height and width), overlaps
  for (const f of auditSlideFindings(slide, idOf)) out.push({ code: f.code, level: f.level, message: f.message, el: f.el })
  const all = flat(slide.nodes)
  const top = slide.nodes.filter((n) => !(n as any).decoration)
  // 2. type size: no text (slide text or chart labels) below the profile's minimum
  const minPx = (pr.type.min * 96) / 72 - 0.05
  for (const n of all) {
    const t = (n as any).text
    if (t) for (const l of t.lines) for (const r of l.runs) if (r.text.trim() && r.fontSizePx * (t.fontScale ?? 1) < minPx) {
      out.push({ code: 'small_text', level: 'error', message: `"${r.text.trim().slice(0, 24)}" is ${PT(r.fontSizePx * (t.fontScale ?? 1))} pt; the minimum is ${pr.type.min} pt`, el: idOf(n.sourceId) }); break
    }
    if (n.type === 'chart') {
      const small = ((n as any).labels ?? []).filter((l: any) => l.text.trim() && l.fontSizePx < minPx)
      if (small.length) out.push({ code: 'small_chart_labels', level: 'warning', message: `${small.length} chart label(s) at ${PT(small[0].fontSizePx)} pt, below ${pr.type.min} pt`, el: idOf(n.sourceId) })
    }
  }
  // 3. chart internals: colliding labels, legends over data, crowded plots
  for (const n of all.filter((x) => x.type === 'chart')) {
    const c: any = n, el = idOf(n.sourceId)
    const boxes: (R & { t: string })[] = (c.labels ?? []).filter((l: any) => l.text.trim() && !l.rotationDeg).map((l: any) => ({ t: l.text, x: l.x, y: l.y, w: metrics.measure(l.text, { fontFamily: l.fontFamily ?? pr.font, fontSizePx: l.fontSizePx, bold: !!l.bold, italic: false }), h: l.fontSizePx * 1.1 }))
    let clashes = 0
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (inter(boxes[i]!, boxes[j]!) > 0.25 * Math.min(area(boxes[i]!), area(boxes[j]!))) clashes++
    if (clashes) out.push({ code: 'chart_labels_overlap', level: 'warning', message: `${clashes} pair(s) of chart labels overlap`, el })
    const plot: R | undefined = c.plotRect
    if (plot && (c.swatches ?? []).some((s: R) => inter(s, plot) > 0 && [...(c.bars ?? []), ...(c.markers ?? []).map((m: any) => ({ x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r }))].some((d: R) => inter(s, d) > 0)))
      out.push({ code: 'legend_over_data', level: 'error', message: 'the legend covers data in the plot', el })
    const thin = (c.bars ?? []).filter((b: R) => Math.min(b.w, b.h) > 0 && Math.min(b.w, b.h) < 3).length
    if (thin > 3) out.push({ code: 'crowded_plot', level: 'warning', message: `${thin} bars are under 3 px thick; the plot is too crowded for its size`, el })
    if (plot && (plot.w < 160 || plot.h < 90)) out.push({ code: 'crowded_plot', level: 'warning', message: `the plot area is only ${Math.round(plot.w)} × ${Math.round(plot.h)} px`, el })
    // a flattened plot hides the trend it is meant to show
    const pw = plot?.w ?? n.box.w, ph = plot?.h ?? n.box.h * 0.7
    if (ph > 0 && pw / ph > 4.5) out.push({ code: 'flat_chart', level: 'warning', message: `the chart is flattened (plot ${Math.round(pw)} × ${Math.round(ph)} px, ${(pw / ph).toFixed(1)}:1)`, el })
  }
  // small multiples drawn as composites: each panel needs room
  for (const [id, b] of Object.entries(ctx.sidecar.bindings)) if (b.kind === 'viz' && b.slide === sId && b.spec.family === 'multiples') {
    const n = all.find((x) => idOf(x.sourceId) === id), panels = b.spec.view.datasets.length
    if (n && n.box.w / Math.ceil(panels / (panels > 4 ? 2 : 1)) < 170) out.push({ code: 'tiny_multiples', level: 'error', message: `${panels} small multiples share ${Math.round(n.box.w)} px; each panel is too small to read`, el: id })
  }
  // 4. composition: the primary visual's share of the content area, and large empty regions
  const zone: R = contentZone(top, roleOf)
  // an executive insight leads with its claim and KPIs; its chart is supporting evidence, so its size is not judged here
  // PD2: likewise a composed slide without a primary chart (figure bands): its small charts are evidence for figures
  const noPrimary = applied?.design.layout.family === 'composed' && !applied.design.objects.some((o) => o.kind === 'viz' && o.role === 'primary')
  const visuals = applied?.design.layout.family === 'executive_insight' || noPrimary ? [] : top.filter((n) => n.type === 'chart' || n.type === 'table' || roleOf(n) === 'viz')
  if (visuals.length) {
    const biggest = Math.max(...visuals.map((v) => inter(v.box, zone)))
    const share = biggest / area(zone)
    if (share < 0.3) out.push({ code: 'small_primary_visual', level: 'warning', message: `the main visual uses ${Math.round(share * 100)}% of the content area; the slide reads as mostly empty` })
  }
  // filled shapes (a dark panel, a masthead) are deliberate composition, not empty space; thin rules count too
  const empty = emptiness(top.map(inkBox), zone)
  if (empty.largest > 0.2) out.push({ code: 'unused_space', level: 'warning', message: `an empty region covers ${Math.round(empty.largest * 100)}% of the content area (${Math.round(empty.empty * 100)}% unused overall)` })
  // 5. alignment: edges that almost line up (2 to 10 px apart) read as mistakes
  const edges = top.filter((n) => roleOf(n) !== 'decor').map((n) => ({ id: idOf(n.sourceId), l: n.box.x, r: n.box.x + n.box.w, t: n.box.y }))
  const near: string[] = []
  for (const k of ['l', 'r'] as const) for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const d = Math.abs(edges[i]![k] - edges[j]![k])
    if (d > 2 && d <= 10) near.push(`${k === 'l' ? 'left' : 'right'} edges ${Math.round(d)} px apart`)
  }
  if (near.length) out.push({ code: 'near_miss_alignment', level: 'warning', message: `${near.length} near-miss alignment(s): ${[...new Set(near)].slice(0, 3).join('; ')}` })
  // 6. hierarchy: title above takeaway and body, source smallest
  const size: Record<string, number> = {}
  for (const n of top) { const r = roleOf(n), t = (n as any).text; if (!r || !t) continue; for (const l of t.lines) for (const g of l.runs) if (g.text.trim()) size[r] = Math.max(size[r] ?? 0, g.fontSizePx * (t.fontScale ?? 1)) }
  if (size.title && Object.entries(size).some(([r, s]) => !['title', 'kpi'].includes(r) && s > size.title! + 0.5)) out.push({ code: 'hierarchy', level: 'warning', message: 'some text is larger than the title' })
  if (size.source && Object.entries(size).some(([r, s]) => r !== 'source' && s < size.source! - 0.5)) out.push({ code: 'hierarchy', level: 'warning', message: 'some text is smaller than the source note' })
  return out
}

/** Below the header (kicker, title, subtitle, rule) and above the source note. */
function contentZone(nodes: RenderNode[], roleOf: (n: RenderNode) => string | null): R {
  const head = nodes.filter((n) => ['kicker', 'title', 'subtitle'].includes(roleOf(n) ?? ''))
  const foot = nodes.filter((n) => roleOf(n) === 'source')
  const y0 = head.length ? Math.max(...head.map((n) => inkBox(n).y + inkBox(n).h)) + 8 : 120
  const y1 = foot.length ? Math.min(...foot.map((n) => n.box.y)) - 8 : 660
  const xs = nodes.filter((n) => roleOf(n) === 'title').map((n) => n.box.x)
  const x0 = xs.length ? Math.min(...xs) : 40
  return { x: x0, y: y0, w: 1280 - 2 * x0, h: Math.max(1, y1 - y0) }
}

/** Share of the zone covered by no ink, and the largest connected empty region, on a 16 px grid. */
function emptiness(ink: R[], zone: R) {
  const S = 16, cols = Math.max(1, Math.floor(zone.w / S)), rows = Math.max(1, Math.floor(zone.h / S)), grid = new Uint8Array(cols * rows)
  for (const b of ink) {
    const x0 = Math.max(0, Math.floor((b.x - 8 - zone.x) / S)), x1 = Math.min(cols - 1, Math.floor((b.x + b.w + 8 - zone.x) / S))
    const y0 = Math.max(0, Math.floor((b.y - 8 - zone.y) / S)), y1 = Math.min(rows - 1, Math.floor((b.y + b.h + 8 - zone.y) / S))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 1
  }
  let empty = 0, largest = 0
  const seen = new Uint8Array(cols * rows)
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) continue
    empty++
    if (seen[i]) continue
    let n = 0; const stack = [i]; seen[i] = 1
    while (stack.length) {
      const k = stack.pop()!; n++
      const x = k % cols, y = (k - x) / cols
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx!, ny = y + dy!, j = ny * cols + nx
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !grid[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
      }
    }
    largest = Math.max(largest, n)
  }
  return { empty: empty / grid.length, largest: largest / grid.length }
}

/** Deck-wide consistency of the designed slides: one background, one title size per role, fonts and colours from the profile. */
export function qaDeck(ctx: Ctx, metrics: FontMetricsProvider): QaFinding[] {
  const out: QaFinding[] = [], slides = slideList(ctx.deck)
  const designed = slides.filter((s) => ctx.sidecar.designs?.[s.id])
  const seen: Record<string, Set<string>> = {}
  const add = (k: string, v: string) => (seen[k] ??= new Set()).add(v)
  for (const s of designed) {
    const a = ctx.sidecar.designs![s.id]!, pr = PROFILES[a.design.profile]!
    add('profile', a.design.profile)
    const slide = render(ctx.deck, s.index, 1280, metrics)
    add('background', JSON.stringify((slide.background as any)?.color ?? slide.background))
    for (const n of flat(slide.nodes)) {
      const d = durableOfSource(ctx.deck, s.index, n.sourceId), b: any = d && ctx.sidecar.bindings[d]
      const t = (n as any).text
      if (!t || !b || b.kind !== 'text' || ctx.sidecar.owned?.[d!]?.text) continue
      for (const l of t.lines) for (const g of l.runs) if (g.text.trim()) {
        add(`${b.role}:font`, g.fontFamily)
        if (b.role === 'kicker' || b.role === 'source' || b.role === 'subtitle') add(`${b.role}:size`, String(PT(g.fontSizePx * (t.fontScale ?? 1))))
        if (g.color && !Object.values(pr.color).flat().map((x) => String(x).toUpperCase()).includes(String(g.color).toUpperCase())) add('offprofile:color', `${b.role} ${g.color}`)
      }
    }
  }
  if ((seen.profile?.size ?? 0) > 1) out.push({ code: 'deck_profiles', level: 'warning', message: `designed slides use ${seen.profile!.size} different profiles` })
  if ((seen.background?.size ?? 0) > 1) out.push({ code: 'deck_background', level: 'warning', message: 'designed slides have different backgrounds' })
  for (const [k, v] of Object.entries(seen)) {
    if (k.endsWith(':size') && v.size > 1) out.push({ code: 'deck_type_drift', level: 'warning', message: `${k.split(':')[0]} text uses ${[...v].join(', ')} pt across slides` })
    if (k.endsWith(':font') && v.size > 1) out.push({ code: 'deck_font_drift', level: 'warning', message: `${k.split(':')[0]} text uses fonts ${[...v].join(', ')}` })
  }
  if (seen['offprofile:color']?.size) out.push({ code: 'deck_off_profile_color', level: 'warning', message: `colours outside the profile: ${[...seen['offprofile:color']!].slice(0, 4).join('; ')}` })
  return out
}
