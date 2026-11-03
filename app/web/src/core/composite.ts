// Composite adapter (VIS V3): visuals the chart engine can't draw natively, realized as a DrawingML group of
// ordinary shapes (rectangles, circles, paths, text). Editable as shapes in the app and in PowerPoint; never a
// picture. The layout is a deterministic function of (spec, projection, size), so the group is rebuilt from the
// data on every change, and integrity re-runs the layout and compares it with what the slide holds.
//
// Every data mark is named "frr-mark <series> <category> <value>" and every value label "frr-label <series>
// <category>"; rating actions are "frr-rating <evidence id> <notch>". The names carry the values the server
// checks; positions and label texts are checked on the client against a fresh layout.
import { decimalsOf } from './evidence'
import { NOTCHES } from './ratings'
import type { Cell, CompositeFamily, Projected, VizSpec } from './viz'
import type { Project } from './types'

export interface Box { x: number; y: number; w: number; h: number }
type Pt = [number, number]
export type Mark =
  | { name: string; kind: 'rect' | 'ellipse'; box: Box; fill: string; stroke?: string; descr?: string }
  | { name: string; kind: 'path'; paths: Pt[][]; box: Box; stroke: string; width: number; dash?: boolean; descr?: string }
  | { name: string; kind: 'text'; box: Box; text: string; size: number; color: string; bold?: boolean; align?: 'l' | 'ctr' | 'r'; descr?: string }

/** Bumped whenever a layout changes, so integrity can tell a stale drawing from wrong data (see integrity.ts). */
export const LAYOUT_VERSION = 2 // 2: V4 (distribution titles without counts)
export const groupName = (vizId: string) => `frr-viz ${vizId} L${LAYOUT_VERSION}`

/** Where a composite is laid out: its own design space, in slide px (the group scales it to its placement). */
export interface Size { w: number; h: number }

// ------------------------------------------------------------------ helpers
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const tw = (t: string, pt: number) => t.length * pt * 0.7 + 4 // approximate text width in px (Inter, pt at 96 dpi)
const decimalsFor = (p: Project, cell: Cell) => {
  if (!cell) return 1
  const ds = 'derived' in cell ? Object.values(cell.derived.inputs)[0]?.dataset : cell.dataset
  return Math.min(2, Math.max(1, decimalsOf(ds ? p.datasets[ds] : undefined)))
}
/** A value as the composite writes it (the same decimals rule as tables and chart labels). */
export const fmt = (p: Project, v: number | null, cell: Cell, signed = false) => (v == null ? 'n/a' : `${signed && v > 0 ? '+' : ''}${v.toFixed(decimalsFor(p, cell))}`.replace('-', '−'))
const deltaUnit = (unit: string) => (/%/.test(unit) ? 'pp' : unit)

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (hi === lo) { hi = lo + 1; lo = lo - 1 }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}
const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
const domain = (vals: (number | null)[], zero: boolean, pad = 0.08): [number, number] => {
  const v = vals.filter((x): x is number => x != null)
  let lo = Math.min(...v, ...(zero ? [0] : [])), hi = Math.max(...v, ...(zero ? [0] : []))
  if (!v.length) { lo = 0; hi = 1 }
  const r = hi - lo || Math.abs(hi) || 1
  return [zero && lo === 0 ? 0 : lo - r * pad, zero && hi === 0 ? 0 : hi + r * pad]
}
const bboxOf = (paths: Pt[][]): Box => {
  const xs = paths.flat().map((q) => q[0]), ys = paths.flat().map((q) => q[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) }
}
const path = (name: string, paths: Pt[][], stroke: string, width: number, dash = false, descr?: string): Mark => ({ name, kind: 'path', paths, box: bboxOf(paths), stroke, width, dash, ...(descr ? { descr } : {}) })
const text = (name: string, box: Box, t: string, size: number, color: string, o: { bold?: boolean; align?: 'l' | 'ctr' | 'r'; descr?: string } = {}): Mark => ({ name, kind: 'text', box, text: t, size, color, ...o })
const dot = (name: string, cx: number, cy: number, r: number, fill: string, descr?: string): Mark => ({ name, kind: 'ellipse', box: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, fill, ...(descr ? { descr } : {}) })
const rect = (name: string, box: Box, fill: string, descr?: string): Mark => ({ name, kind: 'rect', box, fill, ...(descr ? { descr } : {}) })
const markName = (s: number, c: number, v: number) => `frr-mark ${s} ${c} ${v}`

/** The title a composite carries (same rule as native charts: a view's own label and unit, or the spec's title over time). */
export function compositeTitle(spec: VizSpec, pr: Projected) {
  if (pr.shape === 'ratings') return pr.label
  if (spec.family === 'kpi') return cap(pr.label.replace(/, [^,]+ and [^,]+$/, ''))
  return pr.shape === 'time' || pr.shape === 'pairs' ? spec.title : `${cap(pr.label)}, ${pr.unit}`
}

// ------------------------------------------------------------------ layouts
type Ctx = { p: Project; spec: VizSpec; pr: Projected; W: number; H: number; c: ReturnType<typeof palette> }
const palette = (p: Project) => { const d = p.design_dna; return { ink: d.ink, muted: d.muted, rule: d.rule, accent: d.accent, series: d.series, grid: '#d8dee6', light: '#9aa7b6' } }
const TOP = 34

/** Value axis ticks and light gridlines (vertical for horizontal scales). */
function vGrid(out: Mark[], g: Ctx, sx: (v: number) => number, d: [number, number], y0: number, y1: number, unit: string) {
  for (const t of niceTicks(d[0], d[1])) {
    const x = sx(t)
    out.push(path(`frr-grid x${t}`, [[[x, y0], [x, y1]]], t === 0 ? g.c.muted : g.c.grid, t === 0 ? 1.25 : 0.75))
    out.push(text(`frr-tick x${t}`, { x: x - 30, y: y1 + 4, w: 60, h: 14 }, String(t), 8, g.c.muted, { align: 'ctr' }))
  }
  out.push(text('frr-unit', { x: g.W - 140, y: y1 + 4, w: 140, h: 14 }, unit, 8, g.c.muted, { align: 'r' }))
}
function hGrid(out: Mark[], g: Ctx, sy: (v: number) => number, d: [number, number], x0: number, x1: number) {
  for (const t of niceTicks(d[0], d[1])) {
    const y = sy(t)
    out.push(path(`frr-grid y${t}`, [[[x0, y], [x1, y]]], t === 0 ? g.c.muted : g.c.grid, t === 0 ? 1.25 : 0.75))
    out.push(text(`frr-tick y${t}`, { x: 0, y: y - 7, w: x0 - 8, h: 14 }, String(t), 8, g.c.muted, { align: 'r' }))
  }
}
const labelColumn = (names: string[]) => Math.min(220, Math.max(80, ...names.map((n) => tw(n, 9.5))))

/** Dot plot / lollipop: one value per entity, rows in the view's order (a ranking stays ranked). */
function dots(g: Ctx, lollipop: boolean): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], s = pr.series[0]!
  const lw = labelColumn(pr.categories), x0 = lw + 16, x1 = W - 76, y0 = TOP + 6, y1 = H - 22
  const d = domain(s.values, lollipop), sx = scale(d[0], d[1], x0, x1)
  vGrid(out, g, sx, d, y0, y1, pr.unit)
  const rh = (y1 - y0) / pr.categories.length
  pr.categories.forEach((ent, i) => {
    const y = y0 + rh * (i + 0.5), v = s.values[i]!, cell = s.cells[i]!
    out.push(text(`frr-cat ${i}`, { x: 0, y: y - 8, w: lw, h: 16 }, ent, 9.5, c.ink, { align: 'r' }))
    if (!lollipop) out.push(path(`frr-guide ${i}`, [[[x0, y], [x1, y]]], c.grid, 0.5, true))
    if (v == null) { out.push(text(`frr-gap 0 ${i}`, { x: x0 + 4, y: y - 8, w: 60, h: 16 }, 'n/a', 9, c.muted)); return }
    const x = sx(v), z = sx(Math.max(d[0], Math.min(0, d[1])))
    if (lollipop) out.push(path(`frr-stem ${i}`, [[[z, y], [x, y]]], c.series[0]!, 2))
    out.push(dot(markName(0, i, v), x, y, Math.min(7, rh / 3), c.series[0]!, `${ent}: ${fmt(p, v, cell)} ${pr.unit}`))
    const t = fmt(p, v, cell), w = tw(t, 9)
    out.push(text(`frr-label 0 ${i}`, v >= 0 || !lollipop ? { x: x + 10, y: y - 8, w, h: 16 } : { x: x - 10 - w, y: y - 8, w, h: 16 }, t, 9, c.ink, { align: v >= 0 || !lollipop ? 'l' : 'r' }))
  })
  return out
}

/** Dumbbell: start and end per entity on one scale, sorted by the end value. */
function dumbbell(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], [A, B] = pr.series as [Projected['series'][0], Projected['series'][0]]
  const order = pr.categories.map((_, i) => i).sort((a, b) => (B.values[b] ?? -Infinity) - (B.values[a] ?? -Infinity))
  const lw = labelColumn(pr.categories), x0 = lw + 56, x1 = W - 70, y0 = TOP + 22, y1 = H - 22
  const d = domain([...A.values, ...B.values], false), sx = scale(d[0], d[1], x0, x1)
  vGrid(out, g, sx, d, y0, y1, pr.unit)
  out.push(dot('frr-legend a', W - 190, TOP + 6, 5, c.light), text('frr-legend a text', { x: W - 180, y: TOP - 2, w: 60, h: 16 }, A.name, 9, c.ink))
  out.push(dot('frr-legend b', W - 110, TOP + 6, 5, c.series[0]!), text('frr-legend b text', { x: W - 100, y: TOP - 2, w: 60, h: 16 }, B.name, 9, c.ink))
  const rh = (y1 - y0) / pr.categories.length
  order.forEach((i, row) => {
    const y = y0 + rh * (row + 0.5), a = A.values[i]!, b = B.values[i]!
    out.push(text(`frr-cat ${i}`, { x: 0, y: y - 8, w: lw, h: 16 }, pr.categories[i]!, 9.5, c.ink, { align: 'r' }))
    if (a != null && b != null) out.push(path(`frr-link ${i}`, [[[sx(a), y], [sx(b), y]]], c.grid, 4))
    const r = Math.min(6.5, rh / 3), vals: [number, number | null, Cell, string][] = [[0, a, A.cells[i]!, c.light], [1, b, B.cells[i]!, c.series[0]!]]
    const xs = vals.filter((q) => q[1] != null).map((q) => sx(q[1]!))
    const left = Math.min(...xs), right = Math.max(...xs)
    for (const [si, v, cell, col] of vals) {
      if (v == null) { out.push(text(`frr-gap ${si} ${i}`, { x: si ? x1 + 6 : x0 - 52, y: y - 8, w: 46, h: 16 }, `${pr.series[si]!.name} n/a`, 8, c.muted)); continue }
      const x = sx(v), t = fmt(p, v, cell), w = tw(t, 8.5)
      out.push(dot(markName(si, i, v), x, y, r, col, `${pr.categories[i]}, ${pr.series[si]!.name}: ${t} ${pr.unit}`))
      const onLeft = xs.length === 2 ? x === left && (si === 0 ? a! <= b! : b! < a!) : si === 0
      out.push(text(`frr-label ${si} ${i}`, onLeft ? { x: left - 10 - w, y: y - 8, w, h: 16 } : { x: right + 10, y: y - 8, w, h: 16 }, t, 8.5, si ? c.ink : c.muted, { align: onLeft ? 'r' : 'l' }))
    }
  })
  return out
}

/** Labels at desired y positions, pushed apart so they don't overlap. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const idx = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]), out = new Array<number>(ys.length)
  let prev = -Infinity
  for (const [y, i] of idx) { const v = Math.max(y, prev + gap); out[i] = v; prev = v }
  const over = Math.max(0, prev - hi)
  if (over) for (const [, i] of idx) out[i] = Math.max(lo, out[i]! - over)
  return out
}

/** Slope: each entity's line from the first period to the second. */
function slope(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], [A, B] = pr.series as [Projected['series'][0], Projected['series'][0]]
  const xL = Math.round(W * 0.34), xR = Math.round(W * 0.66), y0 = TOP + 26, y1 = H - 22
  const d = domain([...A.values, ...B.values], false, 0.04), sy = scale(d[0], d[1], y1, y0)
  out.push(text('frr-period 0', { x: xL - 60, y: TOP, w: 120, h: 16 }, A.name, 10, c.ink, { bold: true, align: 'ctr' }))
  out.push(text('frr-period 1', { x: xR - 60, y: TOP, w: 120, h: 16 }, B.name, 10, c.ink, { bold: true, align: 'ctr' }))
  out.push(path('frr-axis 0', [[[xL, y0], [xL, y1]]], c.grid, 1), path('frr-axis 1', [[[xR, y0], [xR, y1]]], c.grid, 1))
  const n = pr.categories.length, col = (i: number) => c.series[i % c.series.length]!
  const ly = spread(A.values.map((v) => (v == null ? -1e6 : sy(v))), 15, y0, y1), ry = spread(B.values.map((v) => (v == null ? -1e6 : sy(v))), 15, y0, y1)
  for (let i = 0; i < n; i++) {
    const a = A.values[i]!, b = B.values[i]!, ent = pr.categories[i]!
    if (a != null && b != null) out.push(path(`frr-link ${i}`, [[[xL, sy(a)], [xR, sy(b)]]], col(i), 2))
    if (a != null) out.push(dot(markName(0, i, a), xL, sy(a), 4.5, col(i), `${ent}, ${A.name}: ${fmt(p, a, A.cells[i]!)} ${pr.unit}`))
    if (b != null) out.push(dot(markName(1, i, b), xR, sy(b), 4.5, col(i), `${ent}, ${B.name}: ${fmt(p, b, B.cells[i]!)} ${pr.unit}`))
    // a missing value gets no label on its axis (a label at the bottom would read as a low value): see the note
    const lt = `${ent}  ${fmt(p, a, A.cells[i]!)}`, rt = `${fmt(p, b, B.cells[i]!)}  ${ent}`
    if (a != null) out.push(text(`frr-label 0 ${i}`, { x: xL - 12 - tw(lt, 9), y: ly[i]! - 8, w: tw(lt, 9), h: 16 }, lt, 9, col(i), { align: 'r' }))
    if (b != null) out.push(text(`frr-label 1 ${i}`, { x: xR + 12, y: ry[i]! - 8, w: tw(rt, 9), h: 16 }, rt, 9, col(i)))
  }
  const gaps = [0, 1].flatMap((si) => pr.categories.filter((_, i) => pr.series[si]!.values[i] == null).map((e) => `${e} (${pr.series[si]!.name})`))
  if (gaps.length) out.push(text('frr-gap note', { x: 0, y: H - 14, w: W, h: 14 }, `No value: ${gaps.join(', ')}`, 8, c.muted))
  out.push(text('frr-unit', { x: 0, y: TOP, w: 200, h: 14 }, pr.unit, 8, c.muted))
  return out
}

/** Waterfall / bridge: the level at the start, each period's change floating from the running level, the level at the end. */
function waterfall(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], s = pr.series[0]!, kinds = pr.kinds!
  const x0 = 64, x1 = W - 12, y0 = TOP + 24, y1 = H - 34
  const levels: [number, number][] = []
  let run = 0
  s.values.forEach((v, i) => {
    if (kinds[i] === 'total') { run = v ?? run; levels.push([0, v ?? 0]) }
    else { const from = run; run = run + (v ?? 0); levels.push([from, run]) }
  })
  const d = domain(levels.flat(), true, 0.06), sy = scale(d[0], d[1], y1, y0)
  hGrid(out, g, sy, d, x0, x1)
  const n = s.values.length, band = (x1 - x0) / n, bw = Math.min(64, band * 0.62)
  const legend: [string, string][] = [['Level', c.series[0]!], ['Increase', c.accent], ['Decrease', c.series[2] ?? c.muted]]
  legend.forEach(([t, col], k) => { const x = W - 300 + k * 100; out.push(rect(`frr-legend ${k}`, { x, y: TOP + 2, w: 10, h: 10 }, col), text(`frr-legend ${k} text`, { x: x + 14, y: TOP - 1, w: 80, h: 16 }, t, 9, c.ink)) })
  for (let i = 0; i < n; i++) {
    const v = s.values[i]!, cell = s.cells[i]!, [a, b] = levels[i]!, cx = x0 + band * (i + 0.5), total = kinds[i] === 'total'
    const cat = total ? pr.categories[i]! : `Δ ${pr.categories[i]!.replace(/ change$/, '')}`
    out.push(text(`frr-cat ${i}`, { x: cx - band / 2, y: y1 + 6, w: band, h: 14 }, cat, 8.5, total ? c.ink : c.muted, { align: 'ctr', bold: total }))
    if (v == null) { out.push(text(`frr-gap 0 ${i}`, { x: cx - 30, y: sy(a) - 18, w: 60, h: 14 }, 'n/a', 8.5, c.muted, { align: 'ctr' })); continue }
    const top = Math.min(sy(a), sy(b)), h = Math.max(1, Math.abs(sy(a) - sy(b)))
    const col = total ? c.series[0]! : v >= 0 ? c.accent : c.series[2] ?? c.muted
    out.push(rect(markName(0, i, v), { x: cx - bw / 2, y: top, w: bw, h }, col, `${total ? cat : pr.categories[i]}: ${fmt(p, v, cell, !total)} ${total ? pr.unit : deltaUnit(pr.unit)}`))
    const t = fmt(p, v, cell, !total), up = total ? b >= 0 : v >= 0
    out.push(text(`frr-label 0 ${i}`, up ? { x: cx - band / 2, y: top - 16, w: band, h: 14 } : { x: cx - band / 2, y: top + h + 2, w: band, h: 14 }, t, 8.5, c.ink, { align: 'ctr' }))
    if (i < n - 1) out.push(path(`frr-link ${i}`, [[[cx + bw / 2, sy(b)], [cx + band - bw / 2, sy(b)]]], c.light, 0.75, true))
  }
  out.push(text('frr-unit', { x: x0, y: TOP, w: 400, h: 14 }, `Levels in ${pr.unit}; changes in ${deltaUnit(pr.unit)}`, 8, c.muted))
  return out
}

/** Step chart: each value holds until the next period; gaps break the line. */
function step(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = []
  const x0 = 60, x1 = W - 150, y0 = TOP + 10, y1 = H - 28
  const d = domain(pr.series.flatMap((s) => s.values), false), sy = scale(d[0], d[1], y1, y0)
  const n = pr.categories.length, sx = (i: number) => x0 + (n === 1 ? (x1 - x0) / 2 : ((x1 - x0) * i) / (n - 1))
  hGrid(out, g, sy, d, x0, x1)
  pr.categories.forEach((t, i) => out.push(text(`frr-cat ${i}`, { x: sx(i) - 30, y: y1 + 6, w: 60, h: 14 }, t, 8.5, c.muted, { align: 'ctr' })))
  const ends = pr.series.map((s) => s.values.map((v) => v != null).lastIndexOf(true))
  const endY = spread(pr.series.map((s, si) => (ends[si]! >= 0 ? sy(s.values[ends[si]!]!) : -1e6)), 15, y0, y1)
  pr.series.forEach((s, si) => {
    const col = c.series[si % c.series.length]!, runs: Pt[][] = []
    let cur: Pt[] | null = null
    s.values.forEach((v, i) => {
      if (v == null) { cur = null; return }
      if (!cur) { cur = [[sx(i), sy(v)]]; runs.push(cur) }
      else { const last = cur[cur.length - 1]!; cur.push([sx(i), last[1]], [sx(i), sy(v)]) }
    })
    const drawn = runs.filter((r) => r.length > 1)
    if (drawn.length) out.push(path(`frr-line ${si}`, drawn, col, 2.25))
    s.values.forEach((v, i) => { if (v != null) out.push(dot(markName(si, i, v), sx(i), sy(v), 3.5, col, `${s.name}, ${pr.categories[i]}: ${fmt(p, v, s.cells[i]!)} ${pr.unit}`)) })
    const li = s.values.map((v) => v != null).lastIndexOf(true)
    if (li >= 0) { const t = `${s.name} ${fmt(p, s.values[li]!, s.cells[li]!)}`; out.push(text(`frr-label ${si} ${li}`, { x: x1 + 10, y: endY[si]! - 8, w: tw(t, 9), h: 16 }, t, 9, col)) }
  })
  out.push(text('frr-unit', { x: 0, y: TOP - 4, w: 200, h: 14 }, pr.unit, 8, c.muted))
  return out
}

/** Small multiples: one panel per series, all on the SAME scale (stated on the visual). */
function multiples(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], n = pr.series.length
  const cols = Math.min(4, n), rows = Math.ceil(n / cols), gap = 18, top = TOP + 4, bottom = H - 18
  const pw = (W - gap * (cols - 1)) / cols, ph = (bottom - top - gap * (rows - 1)) / rows
  const d = domain(pr.series.flatMap((s) => s.values), false), m = pr.categories.length
  pr.series.forEach((s, si) => {
    const r = Math.floor(si / cols), k = si % cols, px = k * (pw + gap), py = top + r * (ph + gap)
    const x0 = px + (k === 0 ? 40 : 8), x1 = px + pw - 46, y0 = py + 22, y1 = py + ph - 16
    const sy = scale(d[0], d[1], y1, y0), sx = (i: number) => x0 + (m === 1 ? (x1 - x0) / 2 : ((x1 - x0) * i) / (m - 1))
    out.push(text(`frr-panel ${si}`, { x: px, y: py, w: pw, h: 16 }, s.name, 9.5, c.ink, { bold: true }))
    out.push(path(`frr-axis ${si}`, [[[x0, y1], [x1, y1]]], c.grid, 1))
    if (d[0] < 0 && d[1] > 0) out.push(path(`frr-zero ${si}`, [[[x0, sy(0)], [x1, sy(0)]]], c.muted, 0.75, true))
    if (k === 0) for (const t of [d[0], d[1]]) out.push(text(`frr-tick ${si} ${t === d[0] ? 'lo' : 'hi'}`, { x: px, y: sy(t) - 7, w: 34, h: 14 }, String(Number(t.toFixed(1))), 7.5, c.muted, { align: 'r' }))
    const runs: Pt[][] = []
    let cur: Pt[] | null = null
    s.values.forEach((v, i) => { if (v == null) { cur = null; return } if (!cur) { cur = []; runs.push(cur) } cur.push([sx(i), sy(v)]) })
    const drawn = runs.filter((q) => q.length > 1)
    if (drawn.length) out.push(path(`frr-line ${si}`, drawn, c.series[0]!, 1.75))
    s.values.forEach((v, i) => { if (v != null) out.push(dot(markName(si, i, v), sx(i), sy(v), 2.5, c.series[0]!, `${s.name}, ${pr.categories[i]}: ${fmt(p, v, s.cells[i]!)} ${pr.unit}`)) })
    const li = s.values.map((v) => v != null).lastIndexOf(true)
    if (li >= 0) { const t = fmt(p, s.values[li]!, s.cells[li]!); out.push(text(`frr-label ${si} ${li}`, { x: sx(li) + 6, y: sy(s.values[li]!) - 8, w: tw(t, 8.5), h: 16 }, t, 8.5, c.ink)) }
    out.push(text(`frr-cat ${si} first`, { x: x0 - 20, y: y1 + 2, w: 40, h: 12 }, pr.categories[0]!, 7.5, c.muted, { align: 'ctr' }))
    out.push(text(`frr-cat ${si} last`, { x: x1 - 20, y: y1 + 2, w: 40, h: 12 }, pr.categories.at(-1)!, 7.5, c.muted, { align: 'ctr' }))
  })
  out.push(text('frr-note', { x: 0, y: H - 14, w: W, h: 14 }, `Same scale in every panel (${pr.unit}); gaps are periods without data`, 8, c.muted))
  return out
}

/** KPI spotlight: the latest value, large, with the change since the earlier period and that period's value. */
function kpi(g: Ctx): Mark[] {
  const { pr, p, c } = g, out: Mark[] = [], [A, B] = pr.series as [Projected['series'][0], Projected['series'][0]]
  const a = A.values[0]!, b = B.values[0]!, ca = A.cells[0]!, cb = B.cells[0]!
  out.push(rect('frr-accent', { x: 0, y: TOP + 8, w: 5, h: 120 }, c.accent))
  out.push(text(`frr-cat 0`, { x: 20, y: TOP + 6, w: 600, h: 18 }, `${pr.categories[0]} · ${B.name}`, 11, c.muted))
  const big = fmt(p, b, cb)
  out.push(text(b == null ? 'frr-gap 1 0' : markName(1, 0, b), { x: 18, y: TOP + 26, w: tw(big, 44), h: 64 }, big, 44, c.ink, { bold: true, descr: `${pr.categories[0]}, ${B.name}: ${big} ${pr.unit}` }))
  out.push(text('frr-unit', { x: 24 + tw(big, 44), y: TOP + 58, w: 200, h: 22 }, pr.unit, 13, c.muted))
  const dv = a == null || b == null ? null : Number((b - a).toFixed(6))
  const line = dv == null ? `${A.name}: ${fmt(p, a, ca)}` : `${dv > 0 ? '▲' : dv < 0 ? '▼' : '='} ${fmt(p, dv, ca, true)} ${deltaUnit(pr.unit)} since ${A.name} (${fmt(p, a, ca)})`
  out.push(text(a == null ? 'frr-gap 0 0' : markName(0, 0, a), { x: 20, y: TOP + 98, w: tw(line, 12), h: 20 }, line, 12, c.ink, { descr: `${pr.categories[0]}, ${A.name}: ${fmt(p, a, ca)} ${pr.unit}` }))
  return out
}

/** Rating timeline: actions on an ordinal notch scale; each agency's rating holds until its next action. */
function ratingTimeline(g: Ctx): Mark[] {
  const { pr, W, H, c } = g, out: Mark[] = [], pts = pr.ratings!
  const notches = pts.map((x) => x.notch), lo = Math.max(0, Math.min(...notches) - 1), hi = Math.min(NOTCHES.length - 1, Math.max(...notches) + 1)
  const x0 = 64, x1 = W - 170, y0 = TOP + 10, y1 = H - 44
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000
  let t0 = Math.min(...pts.map((x) => t(x.date))), t1 = Math.max(...pts.map((x) => t(x.date)))
  if (t1 - t0 < 120) { t0 -= 182; t1 += 182 }
  const sx = scale(t0, t1, x0, x1), sy = (n: number) => y0 + ((n - lo) / (hi - lo || 1)) * (y1 - y0)
  for (let n = lo; n <= hi; n++) {
    out.push(path(`frr-grid n${n}`, [[[x0, sy(n)], [x1, sy(n)]]], c.grid, 0.6))
    out.push(text(`frr-tick n${n}`, { x: 0, y: sy(n) - 7, w: x0 - 10, h: 14 }, NOTCHES[n]!, 8.5, c.muted, { align: 'r' }))
  }
  for (let y = new Date(t0 * 86400000).getUTCFullYear() + 1; y <= new Date(t1 * 86400000).getUTCFullYear(); y++) {
    const x = sx(t(`${y}-01-01`))
    out.push(path(`frr-year ${y}`, [[[x, y0], [x, y1]]], c.grid, 0.6, true), text(`frr-year ${y} text`, { x: x - 24, y: y1 + 4, w: 48, h: 14 }, String(y), 8.5, c.muted, { align: 'ctr' }))
  }
  const agencies = [...new Set(pts.map((x) => x.agency))]
  agencies.forEach((ag, k) => {
    const col = c.series[k % c.series.length]!, mine = pts.filter((x) => x.agency === ag)
    const line: Pt[] = []
    mine.forEach((x, i) => { const X = sx(t(x.date)), Y = sy(x.notch); if (i) line.push([X, line[line.length - 1]![1]]); line.push([X, Y]) })
    if (line.length > 1) out.push(path(`frr-line ${k}`, [line], col, 2.25))
    mine.forEach((x) => {
      const X = sx(t(x.date)), Y = sy(x.notch), lab = `${x.rating}${x.outlook ? ` ${x.outlook}` : ''}`
      out.push(dot(`frr-rating ${x.evidence} ${x.notch}`, X, Y, 5, col, `${ag}, ${x.date}: ${x.action} ${lab}`))
      out.push(text(`frr-label ${x.evidence}`, { x: X - tw(lab, 8) / 2, y: Y - 22, w: tw(lab, 8), h: 14 }, lab, 8, c.ink, { align: 'ctr' }))
    })
    out.push(dot(`frr-legend ${k}`, x1 + 24, y0 + 8 + k * 20, 5, col), text(`frr-legend ${k} text`, { x: x1 + 34, y: y0 + k * 20, w: 136, h: 16 }, ag, 9, c.ink))
  })
  const undated = pr.undated?.length ? ` ${pr.undated.length} action${pr.undated.length === 1 ? '' : 's'} without a verified date ${pr.undated.length === 1 ? 'is' : 'are'} not placed (see the ratings table).` : ''
  out.push(text('frr-note', { x: 0, y: H - 18, w: W, h: 14 }, `Ordinal scale: notches are ordered, not quantities; AA+ = Aa1 = AA (high). Each point is an agency action with its press release as evidence.${undated}`, 7.5, c.muted))
  return out
}

// ------------------------------------------------------------------ V4: financial structures and distributions
const num = (v: number) => String(Number(v.toFixed(6))).replace('-', '−')
/** Blend two #rrggbb colours (t = 0: a, 1: b). */
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')

/** Yield curve: spot yields against maturity on a PROPORTIONAL tenor axis (1y to 2y is not drawn as wide as 10y to 20y). */
function yieldCurve(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], tn = pr.tenors!
  const x0 = 60, x1 = W - 190, y0 = TOP + 10, y1 = H - 42
  const d = domain(pr.series.flatMap((s) => s.values), false), sy = scale(d[0], d[1], y1, y0), sx = scale(0, Math.max(...tn), x0, x1)
  hGrid(out, g, sy, d, x0, x1)
  for (const t of [1, 2, 3, 5, 7, 10, 15, 20, 25, 30].filter((t) => t >= Math.min(...tn) && t <= Math.max(...tn)))
    out.push(path(`frr-xgrid ${t}`, [[[sx(t), y0], [sx(t), y1]]], c.grid, 0.5, true), text(`frr-xtick ${t}`, { x: sx(t) - 20, y: y1 + 4, w: 40, h: 14 }, `${t}y`, 8.5, c.muted, { align: 'ctr' }))
  out.push(text('frr-xaxis', { x: x0, y: y1 + 20, w: x1 - x0, h: 14 }, 'Remaining maturity in years (proportional axis)', 8, c.muted, { align: 'ctr' }))
  const ends = pr.series.map((s) => s.values.map((v) => v != null).lastIndexOf(true))
  const endY = spread(pr.series.map((s, si) => (ends[si]! >= 0 ? sy(s.values[ends[si]!]!) : -1e6)), 15, y0, y1)
  pr.series.forEach((s, si) => {
    const col = c.series[si % c.series.length]!, runs: Pt[][] = []
    let cur: Pt[] | null = null
    s.values.forEach((v, i) => { if (v == null) { cur = null; return } if (!cur) { cur = []; runs.push(cur) } cur.push([sx(tn[i]!), sy(v)]) })
    const drawn = runs.filter((r) => r.length > 1)
    if (drawn.length) out.push(path(`frr-line ${si}`, drawn, col, 2.25))
    s.values.forEach((v, i) => { if (v != null) out.push(dot(markName(si, i, v), sx(tn[i]!), sy(v), 2.5, col, `${s.name}, ${tn[i]}-year: ${fmt(p, v, s.cells[i]!)}%`)) })
    const li = ends[si]!
    if (li >= 0) { const t = `${s.name}: ${fmt(p, s.values[li]!, s.cells[li]!)} at ${tn[li]}y`; out.push(text(`frr-label ${si} ${li}`, { x: x1 + 10, y: endY[si]! - 8, w: tw(t, 9), h: 16 }, t, 9, col)) }
  })
  out.push(text('frr-unit', { x: 0, y: TOP - 4, w: 200, h: 14 }, `${pr.unit} (spot rates)`, 8, c.muted))
  return out
}

/** Histogram: counts in equal bins on a proportional value axis; bars touch (the bins are contiguous). */
function histogram(g: Ctx): Mark[] {
  const { pr, W, H, c } = g, out: Mark[] = [], s = pr.series[0]!, edges = pr.bins!
  const x0 = 60, x1 = W - 20, y0 = TOP + 24, y1 = H - 46
  const max = Math.max(1, ...s.values.map((v) => v ?? 0)), sy = scale(0, max * 1.12, y1, y0), sx = scale(edges[0]![0], edges.at(-1)![1], x0, x1)
  const step = Math.max(1, Math.ceil(max / 4))
  for (let t = 0; t <= max; t += step) out.push(path(`frr-grid y${t}`, [[[x0, sy(t)], [x1, sy(t)]]], t === 0 ? c.muted : c.grid, t === 0 ? 1.25 : 0.75), text(`frr-tick y${t}`, { x: 0, y: sy(t) - 7, w: x0 - 8, h: 14 }, String(t), 8, c.muted, { align: 'r' }))
  edges.forEach(([a, b], k) => {
    const v = s.values[k] ?? 0, cell = s.cells[k], names = cell && 'derived' in cell ? Object.keys(cell.derived.inputs) : []
    if (v > 0) out.push(rect(markName(0, k, v), { x: sx(a) + 1, y: sy(v), w: Math.max(1, sx(b) - sx(a) - 2), h: sy(0) - sy(v) }, c.series[0]!, `${num(a)} to ${num(b)}: ${v} (${names.join(', ')})`))
    else out.push(rect(markName(0, k, 0), { x: sx(a) + 1, y: sy(0) - 1, w: Math.max(1, sx(b) - sx(a) - 2), h: 1 }, c.grid, `${num(a)} to ${num(b)}: none`))
    out.push(text(`frr-label 0 ${k}`, { x: sx(a), y: sy(v) - 16, w: sx(b) - sx(a), h: 14 }, String(v), 9, c.ink, { align: 'ctr' }))
    out.push(text(`frr-edge ${k}`, { x: sx(a) - 24, y: y1 + 4, w: 48, h: 14 }, num(a), 8.5, c.muted, { align: 'ctr' }))
  })
  out.push(text(`frr-edge ${edges.length}`, { x: sx(edges.at(-1)![1]) - 24, y: y1 + 4, w: 48, h: 14 }, num(edges.at(-1)![1]), 8.5, c.muted, { align: 'ctr' }))
  if (edges[0]![0] < 0 && edges.at(-1)![1] > 0) out.push(path('frr-zero', [[[sx(0), y0], [sx(0), y1]]], c.muted, 1, true))
  const n = s.values.reduce<number>((a, v) => a + (v ?? 0), 0), w = edges[0]![1] - edges[0]![0]
  out.push(text('frr-note', { x: x0, y: y1 + 22, w: x1 - x0, h: 14 }, `${pr.unit}: ${n} values in bins of ${num(w)} (lower edge included; the last bin includes its upper edge)`, 8, c.muted, { align: 'ctr' }))
  return out
}

/** Box plot: per period, the middle half (Q1 to Q3) as a box, the median as a line, whiskers to the lowest and highest
 *  value, and every individual value as a dot beside the box (so a small sample can't hide behind a box). */
function box(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], k = pr.stats!, S = pr.series
  const x0 = 64, x1 = W - 20, y0 = TOP + 20, y1 = H - 44
  const d = domain(S.flatMap((s) => s.values), false), sy = scale(d[0], d[1], y1, y0)
  hGrid(out, g, sy, d, x0, x1)
  const n = pr.categories.length, band = (x1 - x0) / n, bw = Math.min(64, band * 0.38)
  pr.categories.forEach((cat, j) => {
    const cx = x0 + band * (j + 0.42), [mn, q1, md, q3, mx] = S.slice(0, k).map((s) => s.values[j]!)
    out.push(text(`frr-cat ${j}`, { x: cx - band / 2, y: y1 + 6, w: band, h: 14 }, cat, 8.5, c.muted, { align: 'ctr' }))
    if (mn == null || q1 == null || md == null || q3 == null || mx == null) { out.push(text(`frr-gap 0 ${j}`, { x: cx - 30, y: (y0 + y1) / 2, w: 60, h: 14 }, 'n/a', 8.5, c.muted, { align: 'ctr' })); return }
    const cell = (si: number) => S[si]!.cells[j]!
    out.push(path(`frr-whisker ${j}`, [[[cx, sy(mx)], [cx, sy(q3)]], [[cx, sy(q1)], [cx, sy(mn)]]], c.muted, 1))
    out.push(path(markName(0, j, mn), [[[cx - bw / 4, sy(mn)], [cx + bw / 4, sy(mn)]]], c.muted, 1.5, false, `${cat} lowest: ${fmt(p, mn, cell(0))}`))
    out.push(path(markName(4, j, mx), [[[cx - bw / 4, sy(mx)], [cx + bw / 4, sy(mx)]]], c.muted, 1.5, false, `${cat} highest: ${fmt(p, mx, cell(4))}`))
    out.push({ name: markName(1, j, q1), kind: 'rect', box: { x: cx - bw / 2, y: sy(q3), w: bw, h: Math.max(1, sy(q1) - sy(q3)) }, fill: mix(c.series[0]!, '#ffffff', 0.82), stroke: c.series[0]!, descr: `${cat} first quartile: ${fmt(p, q1, cell(1))}` })
    out.push(path(markName(3, j, q3), [[[cx - bw / 2, sy(q3)], [cx + bw / 2, sy(q3)]]], c.series[0]!, 1.25, false, `${cat} third quartile: ${fmt(p, q3, cell(3))}`))
    out.push(path(markName(2, j, md), [[[cx - bw / 2, sy(md)], [cx + bw / 2, sy(md)]]], c.ink, 2.5, false, `${cat} median: ${fmt(p, md, cell(2))}`))
    out.push(text(`frr-label 2 ${j}`, { x: cx - bw / 2 - 6 - tw(fmt(p, md, cell(2)), 8.5), y: sy(md) - 8, w: tw(fmt(p, md, cell(2)), 8.5), h: 16 }, fmt(p, md, cell(2)), 8.5, c.ink, { align: 'r' }))
    // every value, beside the box, in value order (a narrow zig-zag so close values stay visible)
    const pts = S.slice(k).map((s, e) => ({ e: e + k, v: s.values[j]!, name: s.name, cell: s.cells[j]! })).filter((x) => x.v != null).sort((a, b) => a.v - b.v)
    pts.forEach((x, r) => out.push(dot(markName(x.e, j, x.v), cx + bw / 2 + 12 + (r % 3) * 7, sy(x.v), 2.6, c.series[0]!, `${x.name}, ${cat}: ${fmt(p, x.v, x.cell)}`)))
    if (n <= 3) for (const [si, x] of [[0, pts[0]], [4, pts.at(-1)]] as const) if (x) {
      const t = `${x.name} ${fmt(p, x.v, x.cell)}`
      out.push(text(`frr-label ${si} ${j}`, { x: cx + bw / 2 + 36, y: sy(x.v) - 8, w: tw(t, 8.5), h: 16 }, t, 8.5, c.muted))
    }
  })
  const count = S.length - k
  out.push(text('frr-note', { x: x0, y: y1 + 24, w: x1 - x0, h: 14 }, `Box: middle half (Q1–Q3), line: median, whiskers: lowest and highest; dots: each of ${count} values. Quartiles by linear interpolation. ${pr.unit}`, 8, c.muted, { align: 'ctr' }))
  return out
}

/** Range: each entity's lowest-to-highest band over the period, with its latest value as a dot, sorted by that value. */
function rangePlot(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], [L, Hi, E] = pr.series as [Projected['series'][0], Projected['series'][0], Projected['series'][0]]
  const order = pr.categories.map((_, i) => i).sort((a, b) => (E.values[b] ?? -Infinity) - (E.values[a] ?? -Infinity))
  const lw = labelColumn(pr.categories), x0 = lw + 60, x1 = W - 70, y0 = TOP + 22, y1 = H - 22
  const d = domain([...L.values, ...Hi.values], false), sx = scale(d[0], d[1], x0, x1)
  vGrid(out, g, sx, d, y0, y1, pr.unit)
  out.push(rect('frr-legend 0', { x: W - 330, y: TOP + 3, w: 22, h: 6 }, mix(c.series[0]!, '#ffffff', 0.7)), text('frr-legend 0 text', { x: W - 302, y: TOP - 2, w: 160, h: 16 }, `lowest to highest, ${pr.periods![0]}–${pr.periods![1]}`, 9, c.ink))
  out.push(dot('frr-legend 1', W - 120, TOP + 6, 5, c.accent), text('frr-legend 1 text', { x: W - 110, y: TOP - 2, w: 100, h: 16 }, E.name, 9, c.ink))
  const rh = (y1 - y0) / pr.categories.length
  order.forEach((i, row) => {
    const y = y0 + rh * (row + 0.5), lo = L.values[i]!, hi = Hi.values[i]!, e = E.values[i]!
    out.push(text(`frr-cat ${i}`, { x: 0, y: y - 8, w: lw, h: 16 }, pr.categories[i]!, 9.5, c.ink, { align: 'r' }))
    if (lo == null || hi == null) { out.push(text(`frr-gap 0 ${i}`, { x: x0, y: y - 8, w: 60, h: 16 }, 'n/a', 9, c.muted)); return }
    const h = Math.min(8, rh / 3)
    out.push(rect(`frr-band ${i}`, { x: sx(lo), y: y - h / 2, w: Math.max(1, sx(hi) - sx(lo)), h }, mix(c.series[0]!, '#ffffff', 0.7)))
    out.push(rect(markName(0, i, lo), { x: sx(lo) - 1, y: y - h, w: 2, h: 2 * h }, c.series[0]!, `${pr.categories[i]} lowest: ${fmt(p, lo, L.cells[i]!)}`))
    out.push(rect(markName(1, i, hi), { x: sx(hi) - 1, y: y - h, w: 2, h: 2 * h }, c.series[0]!, `${pr.categories[i]} highest: ${fmt(p, hi, Hi.cells[i]!)}`))
    const lt = fmt(p, lo, L.cells[i]!), ht = fmt(p, hi, Hi.cells[i]!)
    out.push(text(`frr-label 0 ${i}`, { x: sx(lo) - 8 - tw(lt, 8.5), y: y - 8, w: tw(lt, 8.5), h: 16 }, lt, 8.5, c.muted, { align: 'r' }))
    out.push(text(`frr-label 1 ${i}`, { x: sx(hi) + 8, y: y - 8, w: tw(ht, 8.5), h: 16 }, ht, 8.5, c.muted))
    if (e != null) out.push(dot(markName(2, i, e), sx(e), y, Math.min(5.5, rh / 3), c.accent, `${pr.categories[i]}, ${E.name}: ${fmt(p, e, E.cells[i]!)}`))
  })
  return out
}

/** Sensitivity heatmap: the outcome for each pair of assumptions, shaded by how far it lies from today's value. The
 *  assumptions and the arithmetic are written on the visual: it is a scenario, not a forecast. */
function heatmap(g: Ctx): Mark[] {
  const { pr, p, W, H, c } = g, out: Mark[] = [], G = pr.grid!
  const rows = pr.series.length, cols = pr.categories.length, x0 = 190, y0 = TOP + 44
  const cw = Math.min(130, (W - x0 - 20) / cols), ch = Math.min(40, (H - y0 - 64) / rows)
  out.push(text('frr-axis cols', { x: x0, y: TOP + 4, w: cw * cols, h: 16 }, 'Nominal GDP growth, g (assumed, % a year)', 9, c.muted, { align: 'ctr' }))
  out.push(text('frr-axis rows', { x: 0, y: y0 - 22, w: x0 - 12, h: 16 }, 'Interest rate on debt, i (assumed)', 9, c.muted, { align: 'r' }))
  pr.categories.forEach((t, k) => out.push(text(`frr-colhead ${k}`, { x: x0 + k * cw, y: y0 - 20, w: cw, h: 16 }, `${num(G.growth[k]!)}%`, 9.5, c.ink, { align: 'ctr', bold: true })))
  const all = pr.series.flatMap((s) => s.values).filter((v): v is number => v != null), span = Math.max(...all.map((v) => Math.abs(v - G.start)), 1e-9)
  pr.series.forEach((s, si) => {
    out.push(text(`frr-rowhead ${si}`, { x: 0, y: y0 + si * ch + ch / 2 - 8, w: x0 - 12, h: 16 }, `${num(G.rates[si]!)}%`, 9.5, c.ink, { align: 'r', bold: true }))
    s.values.forEach((v, k) => {
      if (v == null) return
      const t = (v - G.start) / span, fill = t >= 0 ? mix('#ffffff', c.accent, Math.min(1, t) * 0.75) : mix('#ffffff', c.series[0]!, Math.min(1, -t) * 0.75)
      const box = { x: x0 + k * cw + 1, y: y0 + si * ch + 1, w: cw - 2, h: ch - 2 }, label = fmt(p, v, s.cells[k]!)
      out.push(rect(markName(si, k, v), box, fill, `i ${num(G.rates[si]!)}%, g ${num(G.growth[k]!)}%: ${label} ${pr.unit} in ${pr.label.match(/in (\S+),/)?.[1] ?? ''}`))
      out.push(text(`frr-label ${si} ${k}`, box, label, 10, Math.abs(t) > 0.55 ? '#ffffff' : c.ink, { align: 'ctr' }))
    })
  })
  const ny = y0 + rows * ch + 12
  out.push(text('frr-note 1', { x: 0, y: ny, w: W, h: 14 }, `Scenario arithmetic, not a forecast: debt(t+1) = debt(t) × (1 + i) / (1 + g) − primary balance, ${G.years} years from ${G.at}.`, 8.5, c.ink))
  out.push(text('frr-note 2', { x: 0, y: ny + 16, w: W, h: 14 }, `Verified ${G.at} inputs (${G.entity}): debt ${num(G.start)}, balance ${num(G.balance)}, interest ${num(G.interest)} → primary balance ${num(G.primary)}, held constant (${pr.unit}). Shading: above (red) or below (blue) today's debt ratio.`, 8, c.muted))
  return out
}

const LAYOUTS: Record<CompositeFamily, (g: Ctx) => Mark[]> = {
  dot: (g) => dots(g, false), lollipop: (g) => dots(g, true), dumbbell, slope, waterfall, step, multiples, kpi, rating_timeline: ratingTimeline,
  yield_curve: yieldCurve, histogram, box, range: rangePlot, heatmap,
}

/** Every shape of the composite, in design-space px. */
export function layout(p: Project, spec: VizSpec, pr: Projected, size: Size): Mark[] {
  const g: Ctx = { p, spec, pr, W: size.w, H: size.h, c: palette(p) }
  const title = text('frr-title', { x: 0, y: 0, w: size.w, h: 22 }, compositeTitle(spec, pr), 12, g.c.ink, { bold: true })
  const round = (b: Box): Box => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 })
  return [title, ...LAYOUTS[spec.family as CompositeFamily](g)].map((m) => ({ ...m, box: round(m.box) }))
}

// ------------------------------------------------------------------ DrawingML
const PX = 9525
const E = (v: number) => Math.round(v * PX)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hex = (c: string) => c.replace('#', '').toUpperCase()
const xfrm = (b: Box) => `<a:xfrm><a:off x="${E(b.x)}" y="${E(b.y)}"/><a:ext cx="${Math.max(1, E(b.w))}" cy="${Math.max(1, E(b.h))}"/></a:xfrm>`

function shapeXml(m: Mark, id: number, font: string): string {
  const nv = `<p:nvSpPr><p:cNvPr id="${id}" name="${esc(m.name)}"${m.descr ? ` descr="${esc(m.descr)}"` : ''}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  if (m.kind === 'text') {
    const algn = m.align ?? 'l'
    return `<p:sp>${nv}<p:spPr>${xfrm(m.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${algn}"/>` +
      `<a:r><a:rPr lang="en-US" sz="${Math.round(m.size * 100)}"${m.bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${hex(m.color)}"/></a:solidFill><a:latin typeface="${esc(font)}"/></a:rPr><a:t>${esc(m.text)}</a:t></a:r></a:p></p:txBody></p:sp>`
  }
  if (m.kind === 'path') {
    const b = m.box, rel = (q: Pt) => `<a:pt x="${E(q[0] - b.x)}" y="${E(q[1] - b.y)}"/>`
    const cmds = m.paths.map((run) => `<a:moveTo>${rel(run[0]!)}</a:moveTo>${run.slice(1).map((q) => `<a:lnTo>${rel(q)}</a:lnTo>`).join('')}`).join('')
    return `<p:sp>${nv}<p:spPr>${xfrm(b)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${Math.max(1, E(b.w))}" h="${Math.max(1, E(b.h))}" fill="none">${cmds}</a:path></a:pathLst></a:custGeom>` +
      `<a:noFill/><a:ln w="${Math.round(m.width * 12700 * 0.75)}" cap="rnd"><a:solidFill><a:srgbClr val="${hex(m.stroke)}"/></a:solidFill>${m.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></p:spPr></p:sp>`
  }
  return `<p:sp>${nv}<p:spPr>${xfrm(m.box)}<a:prstGeom prst="${m.kind === 'ellipse' ? 'ellipse' : 'rect'}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex(m.fill)}"/></a:solidFill>` +
    `${m.stroke ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${hex(m.stroke)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'}</p:spPr></p:sp>`
}

/** The group: placed at `place` (EMU) with its children in a size.w x size.h design space (chOff 0, chExt = size). */
export function groupXml(marks: Mark[], o: { guid: string; id: number; name: string; place: { x: number; y: number; cx: number; cy: number }; size: Size; font: string }): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${o.id}" name="${esc(o.name)}"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{${o.guid}}"/></a:ext></a:extLst></p:cNvPr><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="${o.place.x}" y="${o.place.y}"/><a:ext cx="${o.place.cx}" cy="${o.place.cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${E(o.size.w)}" cy="${E(o.size.h)}"/></a:xfrm></p:grpSpPr>` +
    marks.map((m, i) => shapeXml(m, o.id + 1 + i, o.font)).join('') + '</p:grpSp>'
}

/** What a composite group on the slide holds: each named child's box (design-space px) and text. */
export function readGroup(el: any): { size: Size | null; version: number; children: { name: string; box: Box; text: string | null }[] } {
  const version = Number(/ L(\d+)$/.exec(el.name ?? '')?.[1] ?? 0)
  const ch = el.childOffset, size = ch ? { w: Math.round((ch.cx / PX) * 10) / 10, h: Math.round((ch.cy / PX) * 10) / 10 } : null
  const ox = ch?.x ?? 0, oy = ch?.y ?? 0
  return {
    size, version,
    children: (el.children ?? []).map((k: any) => {
      const o = k.transform?.offset ?? { x: 0, y: 0, cx: 0, cy: 0 }
      const runs = k.text?.paragraphs?.flatMap((q: any) => q.runs?.map((r: any) => r.text) ?? []) ?? null
      return { name: k.name ?? '', box: { x: (o.x - ox) / PX, y: (o.y - oy) / PX, w: o.cx / PX, h: o.cy / PX }, text: runs ? runs.join('') : null }
    }),
  }
}
