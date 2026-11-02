// Integrity: every bound value on the canvas equals the Evidence Core's working value, every figure
// written in bound text still agrees with the evidence or derivation it cites, and every binding
// resolves to an element. Run after every change; the server repeats it on the saved deck.
import type { OpenedPptx } from '@genoffice/pptx-engine'
import { cellText, ratingCells, textNumbers, unverifiedEdits } from './evidence'
import { check, isComposite, realize, type VizSpec } from './viz'
import { LAYOUT_VERSION, layout, readGroup } from './composite'
import { findEl, textOf } from './deck'
import type { Project, Sidecar } from './types'

export interface Integrity { ok: boolean; bindings: number; resolved: number; points: number; cells: number; figures: number; sourced: number; unsourced: number; unverified: number; mismatch: string[]
  /** composites drawn by an earlier layout: their values are checked; positions and labels wait for Re-project */
  outdated: string[] }

export function integrity(deck: OpenedPptx, project: Project, sidecar: Sidecar): Integrity {
  const out: Integrity = { ok: false, bindings: 0, resolved: 0, points: 0, cells: 0, figures: 0, sourced: 0, unsourced: 0, unverified: unverifiedEdits(project), mismatch: [], outdated: [] }
  for (const [durable, b] of Object.entries(sidecar.bindings)) {
    out.bindings++
    const f = findEl(deck, durable)
    if (!f) { out.mismatch.push(`binding ${durable} does not resolve`); continue }
    out.resolved++
    if (b.kind === 'viz' && isComposite(b.spec.family)) compositeCheck(out, f.el, project, b.spec)
    else if (b.kind === 'viz') {
      // the chart on the slide must equal the spec's realization from current data (VIS V1)
      let want
      try { want = realize(project, b.spec) } catch (e: any) { out.mismatch.push(`visual “${b.spec.title}”: ${e.message}`); continue }
      const chart = f.el.chart
      want.series.forEach((s, si) => s.values.forEach((v, i) => {
        out.points++
        const got = chart?.series?.[si]?.values?.[i]
        if (!((v == null && got == null) || v === got)) out.mismatch.push(`${s.name} ${want.categories[i]}: data ${v}, chart ${got}`)
      }))
      if (b.spec.family === 'scatter') want.categories.forEach((x, i) => {
        if (chart?.series?.[0]?.xValues?.[i] !== Number(x)) out.mismatch.push(`${b.spec.title} point ${i + 1}: data x ${x}, chart x ${chart?.series?.[0]?.xValues?.[i]}`)
      })
      else if (want.categories.join('\u0001') !== (chart?.categories ?? []).join('\u0001')) out.mismatch.push(`${b.spec.title}: categories differ from the data`)
    }
    if (b.kind === 'table') b.table.datasets.forEach((d, r) => b.table.dates.forEach((x, c) => {
      out.cells++
      const got = textOf(f.el.rows?.[r + 1]?.[c + 1]?.text), want = cellText(project, d, x)
      if (got !== want) out.mismatch.push(`${d} ${x}: data "${want}", table "${got}"`)
    }))
    if (b.kind === 'ratings') b.rows.forEach((id, r) => ratingCells(project.evidence[id]).forEach((want, c) => {
      out.cells++
      const got = textOf(f.el.rows?.[r + 1]?.[c]?.text)
      if (!project.evidence[id]) out.mismatch.push(`rating row ${id}: evidence missing`)
      else if (got !== want) out.mismatch.push(`rating ${id} column ${c + 1}: evidence "${want}", table "${got}"`)
    }))
    if (b.kind === 'text' && b.role !== 'source') for (const n of textNumbers(textOf(f.el), b.numbers, project)) {
      out.figures++
      if (n.status === 'ok') out.sourced++
      else if (n.status === 'unsourced') out.unsourced++
      else out.mismatch.push(`text says ${n.text}, data now ${n.data ?? 'missing'}`)
    }
  }
  out.ok = out.resolved === out.bindings && out.mismatch.length === 0
  return out
}

/** A composite on the slide must equal a fresh layout of its spec from current data (VIS V3): every data mark's
 *  value, every mark and value label where the layout puts it, and every label's text. */
function compositeCheck(out: Integrity, el: any, project: Project, spec: VizSpec) {
  const t = spec.title || spec.family
  if (el.type !== 'group') { out.mismatch.push(`visual “${t}”: expected a ${spec.family} (shapes), found a ${el.type}`); return }
  let want
  const got = readGroup(el)
  try { want = layout(project, spec, check(project, spec), got.size ?? { w: 1200, h: 400 }) } catch (e: any) { out.mismatch.push(`visual “${t}”: ${e.message}`); return }
  // drawn by an earlier layout: the data values (mark names) must still match; positions and label texts follow the
  // current layout code, so they are compared only once Re-project has redrawn the visual
  const current = got.version === LAYOUT_VERSION
  if (!current) out.outdated.push(t)
  const byName = new Map(got.children.map((c) => [c.name, c]))
  const dataKey = (n: string) => /^frr-(mark \d+ \d+|rating \S+)/.exec(n)?.[0]
  const gotData = new Map(got.children.filter((c) => dataKey(c.name)).map((c) => [dataKey(c.name)!, c.name.split(' ').at(-1)]))
  for (const m of want) {
    const key = dataKey(m.name)
    if (key) {
      out.points++
      const v = m.name.split(' ').at(-1), have = gotData.get(key)
      if (have !== v) { out.mismatch.push(`${t} ${key.replace(/^frr-/, '')}: data ${v}, visual ${have ?? 'missing'}`); continue }
    }
    if (!current || (!key && !/^frr-(label|title|cat|gap)/.test(m.name))) continue // gridlines, legends and notes are decoration
    const c = byName.get(m.name)
    if (!c) { if (!key) out.mismatch.push(`${t}: “${m.name.replace(/^frr-/, '')}” missing`); continue }
    if (Math.abs(c.box.x - m.box.x) > 1 || Math.abs(c.box.y - m.box.y) > 1 || Math.abs(c.box.w - m.box.w) > 1 || Math.abs(c.box.h - m.box.h) > 1)
      out.mismatch.push(`${t}: ${m.name.replace(/^frr-/, '')} is not where the data puts it`)
    if (m.kind === 'text' && c.text !== m.text) out.mismatch.push(`${t}: label says “${c.text}”, data “${m.text}”`)
  }
  for (const k of gotData.keys()) if (!want.some((m) => dataKey(m.name) === k)) out.mismatch.push(`${t} ${k.replace(/^frr-/, '')}: on the visual but not in the data`)
}
