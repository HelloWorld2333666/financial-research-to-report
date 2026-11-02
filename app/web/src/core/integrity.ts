// Integrity: every bound value on the canvas equals the Evidence Core's working value, every figure
// written in bound text still agrees with the evidence or derivation it cites, and every binding
// resolves to an element. Run after every change; the server repeats it on the saved deck.
import type { OpenedPptx } from '@genoffice/pptx-engine'
import { cellText, chartData, textNumbers, unverifiedEdits } from './evidence'
import { findEl, textOf } from './deck'
import type { Project, Sidecar } from './types'

export interface Integrity { ok: boolean; bindings: number; resolved: number; points: number; cells: number; figures: number; sourced: number; unsourced: number; unverified: number; mismatch: string[] }

export function integrity(deck: OpenedPptx, project: Project, sidecar: Sidecar): Integrity {
  const out: Integrity = { ok: false, bindings: 0, resolved: 0, points: 0, cells: 0, figures: 0, sourced: 0, unsourced: 0, unverified: unverifiedEdits(project), mismatch: [] }
  for (const [durable, b] of Object.entries(sidecar.bindings)) {
    out.bindings++
    const f = findEl(deck, durable)
    if (!f) { out.mismatch.push(`binding ${durable} does not resolve`); continue }
    out.resolved++
    if (b.kind === 'chart') {
      const want = chartData(project, b.chart)
      want.series.forEach((s, si) => s.values.forEach((v, i) => {
        out.points++
        const got = f.el.chart?.series?.[si]?.values?.[i]
        if (!((v == null && got == null) || v === got)) out.mismatch.push(`${s.name} ${want.categories[i]}: data ${v}, chart ${got}`)
      }))
    }
    if (b.kind === 'table') b.table.datasets.forEach((d, r) => b.table.dates.forEach((x, c) => {
      out.cells++
      const got = textOf(f.el.rows?.[r + 1]?.[c + 1]?.text), want = cellText(project, d, x)
      if (got !== want) out.mismatch.push(`${d} ${x}: data "${want}", table "${got}"`)
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
