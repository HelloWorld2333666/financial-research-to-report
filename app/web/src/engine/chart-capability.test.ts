// Visualization audit (VIS-01): every chart type the vendored GenOffice engine can WRITE, put through our
// real store and engine: insert, parse with a gap, render, save/reopen, undo/redo, data edit, type
// change, and our evidence-binding adapter. This records what actually works rather than what the
// source suggests. AUDIT_OUT=<file> writes the matrix as JSON (for docs/workspace-prototype/VIS-01*).
import { describe, expect, it } from 'vitest'
import { materializeSlide } from '@genoffice/pptx-engine'
import project from '../core/fixtures/france-project.json'
import { Store } from '../core/store'
import { integrity } from '../core/integrity'
import { render } from '../core/deck'
import { BUNDLE_SCHEMA, type Project } from '../core/types'
import { chartKindRefusal } from '../core/vocabulary'

const KINDS: { id: string; kind: string; barDir?: 'bar' }[] = [
  { id: 'bar (clustered column)', kind: 'bar' }, { id: 'barStacked', kind: 'barStacked' }, { id: 'barPercentStacked', kind: 'barPercentStacked' },
  { id: 'horizontal bar', kind: 'bar', barDir: 'bar' }, { id: 'line', kind: 'line' }, { id: 'area', kind: 'area' }, { id: 'pie', kind: 'pie' },
  { id: 'doughnut', kind: 'doughnut' }, { id: 'scatter', kind: 'scatter' }, { id: 'radar', kind: 'radar' }, { id: 'comboBarLine', kind: 'comboBarLine' },
  { id: 'pie3D', kind: 'pie3D' }, { id: 'bar3D', kind: 'bar3D' },
]
const CATS = ['2022', '2023', '2024', '2025']
const SERIES = [{ name: 'France', values: [111.4, null, 112.6, 115.7] }, { name: 'Germany', values: [64.1, 62.6, null, 62.8] }]

const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
const chartEl = (s: Store) => (s.deck.deck.slides[0] as any).elements.find((e: any) => e.type === 'chart')
const values = (s: Store) => chartEl(s)?.chart?.series?.map((x: any) => x.values)
const add = (s: Store, k: (typeof KINDS)[number]) => {
  const r = s.exec({ kind: 'ops.raw', ops: [{ op: 'addChart', target: { slide: 0 }, kind: k.kind, ...(k.barDir ? { barDir: k.barDir } : {}), categories: CATS, series: SERIES, offset: { x: 381000, y: 1295400, cx: 6858000, cy: 3810000 }, title: 'Gross debt, % of GDP' } as any] })
  materializeSlide(s.deck, 0)
  return r
}
const setChart = (s: Store, patch: any) => { const el = chartEl(s); const r = s.exec({ kind: 'ops.raw', ops: [{ op: 'setChart', target: { slide: 0, el: el.id }, patch } as any] }); materializeSlide(s.deck, 0); return r }

async function audit(k: (typeof KINDS)[number]) {
  const r: Record<string, any> = { type: k.id }
  const s = await fresh()
  const a = add(s, k)
  // V0 (decision D-V3): 3-D kinds are refused by our commands; the engine still renders them in imported decks
  if (chartKindRefusal(k.kind)) { r.excluded = true; r.insert = a.ok ? 'ok' : `refused: ${a.error}`; return r }
  r.insert = a.ok ? 'ok' : `fails: ${a.error}`
  if (!a.ok) return r
  if (r.excluded) return r
  const el = chartEl(s)
  r.parsedAs = `${el.chart.kind}${el.chart.barDir ? '/' + el.chart.barDir : ''}${el.chart.grouping ? '/' + el.chart.grouping : ''}${el.chart.holePct ? '/hole' + el.chart.holePct : ''}${el.chart.pseudo3D ? '/3D' : ''}`
  r.gapParsed = values(s)?.[0]?.[1] === null && values(s)?.[1]?.[2] === null
  try {
    const n: any = render(s.deck, 0, 1280, s.metrics).nodes.find((x: any) => x.type === 'chart')
    // chart render nodes are flat arrays: bars, polylines (lines, areas, radar), markers, wedges (pie), paths (pseudo-3D faces), labels
    const kinds = ['bars', 'polylines', 'markers', 'wedges', 'paths', 'labels']
    r.renderPrims = n ? Object.fromEntries(kinds.map((k) => [k, n[k]?.length ?? 0]).filter(([, v]) => v)) : null
    r.renders = !!n && kinds.slice(0, 5).some((k) => (n[k]?.length ?? 0) > 0)
  } catch (e: any) { r.renders = false; r.renderError = String(e.message ?? e) }
  const before = JSON.stringify(values(s))
  const back = await Store.fromBundle(await s.toBundle())
  r.saveReopen = JSON.stringify(values(back)) === before && chartEl(back)?.chart?.kind === el.chart.kind
  s.undo(); const gone = !chartEl(s); s.redo(); r.undoRedo = gone && JSON.stringify(values(s)) === before
  const e = setChart(s, { categories: CATS, series: [{ name: 'France', values: [111.4, null, 112.6, 116.0] }, SERIES[1]] })
  r.dataEdit = e.ok && values(s)?.[0]?.[3] === 116.0 && values(s)?.[0]?.[1] === null
  if (!e.ok) r.dataEditError = e.error
  const toBar = setChart(s, { kind: 'bar' })
  r.typeChangeToBar = toBar.ok && chartEl(s).chart.kind === 'bar'
  r.typeChangeKeepsGap = toBar.ok && values(s)?.[0]?.[1] === null
  const s2 = await fresh(); add(s2, KINDS[0]!)
  const fromBar = setChart(s2, { kind: k.kind, ...(k.barDir ? { barDir: k.barDir } : {}) })
  r.typeChangeFromBar = fromBar.ok && chartEl(s2).chart.kind === el.chart.kind
  const styleOnly = setChart(s2, { colorScheme: ['#1f4e9c', '#c8102e'] })
  r.styleEditKeepsGap = styleOnly.ok && values(s2)?.[0]?.[1] === null
  // our evidence binding (slide.compose + chartData + integrity): only 'line' | 'bar' are in ChartSpec today
  const s3 = await fresh()
  const c = s3.exec({ kind: 'slide.compose', proposal: { key: 'x', kicker: 'K', title: 'T', subtitle: 'S', chart: { type: k.kind, title: 'Debt', series: ['ds.fr.debt', 'ds.de.debt'] } } }, { actor: 'ai' })
  r.boundCompose = c.ok ? (integrity(s3.deck, s3.project, s3.sidecar).ok ? 'ok' : 'integrity mismatch') : `fails: ${c.error}`
  if (c.ok) { s3.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2023', value: null }); r.boundGapEdit = integrity(s3.deck, s3.project, s3.sidecar).ok }
  return r
}

describe('VIS-01 chart capability audit', () => {
  it('records what each engine chart type actually does in our app', async () => {
    const matrix = []
    for (const k of KINDS) matrix.push(await audit(k))
    const out = (globalThis as any).process?.env?.AUDIT_OUT
    if (out) { const { writeFileSync } = await import('node:fs' as string); writeFileSync(out, JSON.stringify(matrix, null, 1)) }
    expect(matrix.length).toBe(KINDS.length)
    for (const r of matrix) {
      if (r.excluded) { expect(r.insert).toMatch(/^refused: 3-D charts distort comparisons/); continue }
      // verified in our app for every type the engine writes
      expect([r.type, r.insert, r.gapParsed, r.renders, r.saveReopen, r.undoRedo, r.dataEdit, r.typeChangeToBar, r.typeChangeFromBar])
        .toEqual([r.type, 'ok', true, true, true, true, true, true, true])
      // evidence-bound compose of FR + DE debt: overlapping areas of series that do not add up need "Use anyway" (VIS V2 warning)
      if (r.type === 'area') expect(r.boundCompose).toMatch(/Needs confirmation: overlapping areas can read as a total/)
      else expect([r.type, r.boundCompose]).toEqual([r.type, 'ok'])
      // VIS-01 finding F2, fixed by vendor patch 0005: a rebuild without a series patch (type change,
      // style-only edit) used to map gaps to zeros
      expect([r.type, r.typeChangeKeepsGap, r.styleEditKeepsGap]).toEqual([r.type, true, true])
    }
  }, 20_000) // renders every engine chart type: slow when the machine is busy
})
