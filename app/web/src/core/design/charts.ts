// Designed charts (PD2): charts drawn by the design engine from a frr-viz/1 spec and its projection, in the slide's
// visual language: focus series emphasised, peers quiet, direct labels instead of legends, light horizontal grid only,
// controlled margins and label sizes, and annotations computed from the data. They follow the composite contract
// (composite.ts): every value is a mark named "frr-mark <series> <category> <value>", every value label
// "frr-label …", every category "frr-cat …", so the server checks the values and the client re-runs this layout to
// check positions and label texts. The spec (the chart's meaning) is unchanged; only the drawing is designed.
import { domain, dot, fmt, markName, niceTicks, path, rect, scale, spread, text, tw, type Mark, type Size } from '../composite'
import type { Projected, VizSpec } from '../viz'
import type { ElementStyle, Project } from '../types'
import { languageOf, type Language } from './language'

/** Families the design engine draws itself; anything else stays a native chart or a standard composite. */
// (a column chart is not redrawn as a line: that would override the user's choice of encoding)
export const DESIGNED = new Set(['line', 'bar', 'dumbbell'])
export const drawsDesigned = (spec: VizSpec, style?: ElementStyle) => style?.render === 'designed' && DESIGNED.has(spec.family)

interface G { p: Project; spec: VizSpec; pr: Projected; W: number; H: number; L: Language; style: ElementStyle }
const PX = (pt: number) => (pt * 96) / 72
const lw = (t: string, pt: number, bold = false) => Math.ceil(tw(t, pt) * (bold ? 1.06 : 1))
const deltaUnit = (unit: string) => (/%/.test(unit) ? 'pp' : unit)
const unitShort = (unit: string) => (unit === '% of GDP' ? '%' : unit === '%' ? '%' : ` ${unit}`)

function axisText(g: G, name: string, box: { x: number; y: number; w: number; h: number }, t: string, align: 'l' | 'ctr' | 'r' = 'l') {
  const a = g.L.type.axis
  return text(name, box, t, a.pt, a.color, { align, font: a.font })
}

/** Time series: one line per series, the focus series heavy with every point marked and labelled at its end. */
function line(g: G): Mark[] {
  const { pr, p, W, H, L, style } = g, out: Mark[] = [], n = pr.categories.length, mini = !!style.mini
  const focus = Math.max(0, pr.series.findIndex((s) => s.dataset === style.emphasis))
  const last = (si: number) => { const v = pr.series[si]!.values; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1 }
  const endText = (si: number) => { const s = pr.series[si]!, i = last(si); return i < 0 ? '' : `${s.name}  ${fmt(p, s.values[i]!, s.cells[i]!)}${unitShort(pr.unit)}` }
  const lp = L.type.dataLabel.pt * (mini ? 0.95 : 1)
  const labelW = Math.max(...pr.series.map((_, si) => lw(endText(si), lp, true))) + 12
  const tickW = mini ? 0 : Math.max(...niceTicks(...domain(pr.series.flatMap((s) => s.values), false, 0.1)).map((t) => lw(String(t), L.type.axis.pt))) + 10
  const x0 = tickW, x1 = W - labelW, y0 = mini ? 6 : 10, y1 = H - (mini ? 18 : 24)
  const d = domain(pr.series.flatMap((s) => s.values), false, mini ? 0.18 : 0.1)
  const ticks = niceTicks(d[0], d[1], mini ? 2 : 4), lo = Math.min(d[0], ticks[0]!), hi = Math.max(d[1], ticks[ticks.length - 1]!)
  const sy = scale(lo, hi, y1, y0), sx = (i: number) => (n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1))
  if (!mini) {
    for (const t of ticks) {
      out.push(path(`frr-grid y${t}`, [[[x0, sy(t)], [x1, sy(t)]]], L.color.grid, L.chart.gridWidth))
      out.push(axisText(g, `frr-tick y${t}`, { x: 0, y: sy(t) - 7, w: x0 - 8, h: 14 }, String(t).replace('-', '−'), 'r'))
    }
  }
  out.push(path('frr-baseline', [[[x0, y1], [x1, y1]]], L.color.hair, 1))
  pr.categories.forEach((c, i) => { if (!mini || i === 0 || i === n - 1) out.push(axisText(g, `frr-cat ${i}`, { x: sx(i) - 30, y: y1 + 5, w: 60, h: 14 }, c, 'ctr')) })
  const order = pr.series.map((_, i) => i).filter((i) => i !== focus).concat(focus)
  const peerCol = (k: number) => [L.color.peer, L.color.peerSoft, '#B8BEC9', '#D6C9A8'][k % 4]!
  const colOf = new Map(order.map((si, k) => [si, si === focus ? L.color.navy : peerCol(k)]))
  for (const si of order) {
    const s = pr.series[si]!, col = colOf.get(si)!, isF = si === focus
    const runs: [number, number][][] = []; let cur: [number, number][] = []
    s.values.forEach((v, i) => { if (v == null) { if (cur.length) runs.push(cur); cur = [] } else cur.push([sx(i), sy(v)]) })
    if (cur.length) runs.push(cur)
    if (runs.some((r) => r.length > 1)) out.push(path(`frr-line ${si}`, runs.filter((r) => r.length > 1), col, isF ? L.chart.focusWidth : L.chart.peerWidth))
    s.values.forEach((v, i) => { if (v != null) out.push(dot(markName(si, i, v), sx(i), sy(v), isF ? L.chart.focusDot : L.chart.peerDot, col, `${s.name}, ${pr.categories[i]}: ${fmt(p, v, s.cells[i]!)} ${pr.unit}`)) })
  }
  // end labels, pushed apart vertically; the focus label bold in the structure colour
  const ends = pr.series.map((_, si) => last(si)), ys = spread(ends.map((i, si) => (i < 0 ? -1e6 : sy(pr.series[si]!.values[i]!))), PX(lp) * 1.25, y0, y1)
  pr.series.forEach((s, si) => {
    const i = ends[si]!; if (i < 0) return
    const t = endText(si), isF = si === focus
    out.push(text(`frr-label ${si} ${i}`, { x: x1 + 10, y: ys[si]! - 8, w: lw(t, lp, isF) + 4, h: 16 }, t, lp, isF ? L.color.navy : L.color.muted, { bold: isF, font: L.type.dataLabel.font }))
  })
  // annotation: the focus series' start value, and its change over the period
  if (style.annotate === 'change' && !mini) {
    const s = pr.series[focus]!, i0 = s.values.findIndex((v) => v != null), i1 = ends[focus]!
    if (i0 >= 0 && i1 > i0) {
      const a = s.values[i0]!, b = s.values[i1]!, t0 = `${fmt(p, a, s.cells[i0]!)}${unitShort(pr.unit)}`
      const above = sy(a) - 26 > y0
      out.push(text(`frr-label ${focus} start`, { x: sx(i0) - 4, y: above ? sy(a) - 24 : sy(a) + 8, w: lw(t0, L.type.dataLabel.pt) + 4, h: 16 }, t0, L.type.dataLabel.pt, L.color.navy, { font: L.type.dataLabel.font }))
      const dlt = `${b - a > 0 ? '+' : ''}${fmt(p, b - a, s.cells[i1]!)} ${deltaUnit(pr.unit)} since ${pr.categories[i0]}`.replace('+−', '−')
      const dw = lw(dlt, L.type.caption.pt, true) + 4
      out.push(text(`frr-label ${focus} delta`, { x: x1 + 10, y: Math.max(y0 - 16, ys[focus]! - 26), w: dw, h: 14 }, dlt, L.type.caption.pt, L.color.gold, { bold: true, font: L.type.caption.font }))
    }
  }
  // annotation: the gap between the focus series and a reference series, bracketed at the first and last period
  const ri = style.reference ? pr.series.findIndex((x) => x.dataset === style.reference) : -1
  if (style.annotate === 'gap' && ri >= 0 && !mini) {
    const F = pr.series[focus]!, R = pr.series[ri]!
    const both = pr.categories.map((_, i) => i).filter((i) => F.values[i] != null && R.values[i] != null)
    for (const [k, i] of [[0, both[0]], [1, both[both.length - 1]]] as [number, number | undefined][]) {
      if (i == null || (k === 1 && i === both[0])) continue
      const yf = sy(F.values[i]!), yr = sy(R.values[i]!), x = sx(i) + (k === 0 ? 14 : -14), strong = k === 1
      out.push(path(`frr-bracket ${k}`, [[[x - 4, yf + 6], [x, yf + 6], [x, yr - 6], [x - 4, yr - 6]].map(([a, b]) => [k === 0 ? 2 * x - a : a, b] as [number, number])], strong ? L.color.gold : L.color.goldSoft, strong ? 1.5 : 1))
      const t = `${fmt(p, F.values[i]! - R.values[i]!, F.cells[i]!)} ${deltaUnit(pr.unit)}`, tw0 = lw(t, L.type.dataLabel.pt, strong) + 4
      out.push(text(`frr-label gap ${k}`, { x: k === 0 ? x + 8 : x - 8 - tw0, y: (yf + yr) / 2 - 8, w: tw0, h: 16 }, t, L.type.dataLabel.pt, strong ? L.color.gold : L.color.muted, { bold: strong, align: k === 0 ? 'l' : 'r', font: L.type.dataLabel.font }))
    }
  }
  const gaps = pr.series.flatMap((s) => pr.categories.filter((_, i) => s.values[i] == null).map((c) => `${s.name} ${c}`))
  if (gaps.length && !mini) out.push(axisText(g, 'frr-gap note', { x: x0, y: H - 12, w: W - x0, h: 12 }, `No value: ${gaps.join(', ')}`))
  return out
}

/** Ranking: one bar per entity in the view's order, values written at the bar ends, the focus entity in navy on a tinted row. */
function rankBar(g: G): Mark[] {
  const { pr, p, W, H, L, style } = g, out: Mark[] = [], s = pr.series[0]!, n = pr.categories.length
  const focusName = style.emphasis ? p.datasets[style.emphasis]?.entity : undefined
  const np = 10.5, vp = L.type.dataLabel.pt
  const nameW = Math.max(...pr.categories.map((c) => lw(c, np, c === focusName))) + 18
  const vals = s.values.map((v, i) => (v == null ? 'n/a' : `${fmt(p, v, s.cells[i]!)}${unitShort(pr.unit)}`))
  const valW = Math.max(...vals.map((v) => lw(v, vp, true))) + 14
  const neg = s.values.some((v) => v != null && v < 0), pos = s.values.some((v) => v != null && v > 0)
  const top = 6, bot = H - 6, rowH = (bot - top) / n, barH = rowH * L.chart.barHeight
  const x0 = nameW + (neg ? valW : 0), x1 = W - (pos ? valW : 4)
  const d = domain(s.values, true, 0.02), sx = scale(d[0], d[1], x0, x1), z = sx(0)
  pr.categories.forEach((c, i) => {
    const v = s.values[i], yc = top + rowH * (i + 0.5), isF = c === focusName
    if (isF) out.push(rect('frr-band focus', { x: 0, y: top + rowH * i + 1, w: W, h: rowH - 2 }, L.color.surface))
    out.push(text(`frr-cat ${i}`, { x: 0, y: yc - 9, w: nameW - 12, h: 18 }, c, np, isF ? L.color.navy : L.color.ink, { align: 'r', bold: isF, font: L.type.body.font }))
    if (v == null) { out.push(axisText(g, `frr-gap ${i}`, { x: x0, y: yc - 7, w: 80, h: 14 }, 'no value')); return }
    const a = Math.min(z, sx(v)), b = Math.max(z, sx(v))
    out.push(rect(markName(0, i, v), { x: a, y: yc - barH / 2, w: Math.max(1, b - a), h: barH }, isF ? L.color.navy : L.color.peer, `${c}: ${vals[i]}`))
    const t = vals[i]!, w = lw(t, vp, isF) + 2
    out.push(text(`frr-label 0 ${i}`, v < 0 ? { x: a - 8 - w, y: yc - 8, w, h: 16 } : { x: b + 8, y: yc - 8, w, h: 16 }, t, vp, isF ? L.color.navy : L.color.muted, { align: v < 0 ? 'r' : 'l', bold: isF, font: L.type.dataLabel.font }))
  })
  out.push(path('frr-zero', [[[z, top - 2], [z, bot]]], L.color.muted, 1))
  return out
}

/** Change between two periods per entity: a quiet start point, a solid end point, the focus row emphasised. */
function dumbbell(g: G): Mark[] {
  const { pr, p, W, H, L, style } = g, out: Mark[] = [], [A, B] = pr.series as [Projected['series'][0], Projected['series'][0]]
  const focusName = style.emphasis ? p.datasets[style.emphasis]?.entity : undefined
  const order = pr.categories.map((_, i) => i).sort((a, b) => (A.values[a] == null || B.values[a] == null ? 1 : 0) - (A.values[b] == null || B.values[b] == null ? 1 : 0) || (B.values[a] ?? 0) - (B.values[b] ?? 0))
  const np = 10.5, nameW = Math.max(...pr.categories.map((c) => lw(c, np, c === focusName))) + 18
  // few rows get taller rows (up to 96 px), and the block sits centred with its key directly above it
  const cap = pr.categories.length <= 4 ? 96 : 64, rowH = Math.min(cap, (H - 66) / pr.categories.length), top = 40 + Math.max(0, (H - 66 - rowH * pr.categories.length) / 2), bot = top + rowH * pr.categories.length
  const d = domain([...A.values, ...B.values], false, 0.12), ticks = niceTicks(d[0], d[1], 4), lo = Math.min(d[0], ticks[0]!), hi = Math.max(d[1], ticks[ticks.length - 1]!)
  const x0 = nameW + 50, x1 = W - 60, sx = scale(lo, hi, x0, x1)
  for (const t of ticks) {
    out.push(path(`frr-grid x${t}`, [[[sx(t), top - 4], [sx(t), bot]]], t === 0 ? L.color.muted : L.color.grid, t === 0 ? 1 : L.chart.gridWidth))
    out.push(axisText(g, `frr-tick x${t}`, { x: sx(t) - 24, y: bot + 6, w: 48, h: 14 }, String(t).replace('-', '−'), 'ctr'))
  }
  // key, written once at the top
  const ky = top - 26
  out.push({ ...dot('frr-key a', x0, ky + 7, 4.5, L.color.paper), stroke: L.color.muted, strokeW: 1.25 } as Mark)
  out.push(axisText(g, 'frr-key a text', { x: x0 + 10, y: ky, w: 60, h: 14 }, A.name), dot('frr-key b', x0 + 80, ky + 7, 4.5, L.color.navy), axisText(g, 'frr-key b text', { x: x0 + 90, y: ky, w: 60, h: 14 }, B.name))
  order.forEach((i, row) => {
    const yc = top + rowH * (row + 0.5), c = pr.categories[i]!, isF = c === focusName, a = A.values[i], b = B.values[i]
    if (isF) out.push(rect('frr-band focus', { x: 0, y: top + rowH * row + 1, w: W, h: rowH - 2 }, L.color.surface))
    out.push(text(`frr-cat ${i}`, { x: 0, y: yc - 9, w: nameW - 12, h: 18 }, c, np, isF ? L.color.navy : L.color.ink, { align: 'r', bold: isF, font: L.type.body.font }))
    if (a != null && b != null) out.push(path(`frr-link ${i}`, [[[sx(a), yc], [sx(b), yc]]], isF ? L.color.navy : L.color.peer, isF ? 2.5 : 1.75))
    const col = isF ? L.color.navy : L.color.ink
    if (a != null) out.push({ ...dot(markName(0, i, a), sx(a), yc, 5, L.color.paper, `${c}, ${A.name}: ${fmt(p, a, A.cells[i]!)} ${pr.unit}`), stroke: isF ? L.color.navy : L.color.muted, strokeW: 1.5 } as Mark)
    if (b != null) out.push(dot(markName(1, i, b), sx(b), yc, 5.5, isF ? L.color.navy : L.color.muted, `${c}, ${B.name}: ${fmt(p, b, B.cells[i]!)} ${pr.unit}`))
    if (b != null) {
      const t = `${fmt(p, b, B.cells[i]!)}${unitShort(pr.unit)}`, right = a == null || b >= a, w = lw(t, L.type.dataLabel.pt, isF) + 2
      const xa = a == null ? sx(b) : sx(Math.min(a, b)), xb = a == null ? sx(b) : sx(Math.max(a, b))
      out.push(text(`frr-label 1 ${i}`, right ? { x: xb + 10, y: yc - 8, w, h: 16 } : { x: xa - 10 - w, y: yc - 8, w, h: 16 }, t, L.type.dataLabel.pt, col, { align: right ? 'l' : 'r', bold: isF, font: L.type.dataLabel.font }))
    } else out.push(axisText(g, `frr-gap 1 ${i}`, { x: x1 + 4, y: yc - 7, w: 56, h: 14 }, `${B.name} n/a`))
  })
  return out
}

const DRAW: Record<string, (g: G) => Mark[]> = { line, bar: rankBar, dumbbell }

/** The designed drawing of a spec, or null when the design engine doesn't draw this family. */
export function designedLayout(p: Project, spec: VizSpec, pr: Projected, size: Size, style: ElementStyle): Mark[] | null {
  if (!drawsDesigned(spec, style)) return null
  if (spec.family === 'line' && pr.shape !== 'time') return null
  if (spec.family === 'bar' && (pr.shape !== 'cross' || pr.series.length !== 1)) return null
  if (spec.family === 'dumbbell' && pr.series.length !== 2) return null
  const g: G = { p, spec, pr, W: size.w, H: size.h, L: languageOf(style.lang), style }
  const round = (b: Mark['box']) => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 })
  return DRAW[spec.family]!(g).map((m) => ({ ...m, box: round(m.box) }))
}
