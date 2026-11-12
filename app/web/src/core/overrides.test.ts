// VIS V2 refinement: three states for a visual. Recommended; allowed with a warning (the user may "Use anyway",
// recorded on the spec and in the journal); invalid (blocked: no acknowledgement unlocks it). Synthetic datasets
// are marked "(test)".
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findings } from './constraints'
import { changeOptions } from './recommend'
import { assess, project as projectView, VIZ_SCHEMA, type VizSpec } from './viz'
import { BUNDLE_SCHEMA, type Project } from './types'

const YEARS = ['2020', '2021', '2022', '2023', '2024', '2025']
function addSet(p: Project, metric: string, rows: Record<string, (number | null)[]>, extra: any = {}) {
  for (const [geo, vals] of Object.entries(rows)) {
    const id = `ds.${geo.toLowerCase()}.${metric}`
    p.datasets[id] = { id, title: `${geo} · ${metric} (test)`, entity: extra.entity?.[geo] ?? geo, geo, metric, unit: extra.unit ?? '% of GDP', frequency: 'annual', origin: 'test', verification: 'test',
      source_url: '', source_note: 'synthetic test fixture', working: {}, observations: (extra.years ?? YEARS).map((date: string, i: number) => ({ date, value: vals[i] ?? null, status: 'test' })).filter((o: any) => o.value != null),
      measure: extra.measure ?? { kind: 'ratio', of: 'GDP', signed: false, additive_parts_of: null, scale: 'interval' } } as any
  }
  return Object.keys(rows).map((g) => `ds.${g.toLowerCase()}.${metric}`)
}
const PARTS = { kind: 'share', signed: true, additive_parts_of: 'fr.debt', scale: 'interval' }
const P = () => structuredClone(project) as Project
const spec = (family: VizSpec['family'], datasets: string[], view: Partial<VizSpec['view']> = {}, subtype?: VizSpec['subtype']): VizSpec =>
  ({ schema: VIZ_SCHEMA, id: 'viz_t1', title: 'T', family, ...(subtype ? { subtype } : {}), view: { datasets, transform: 'none', ...view }, missing: 'gap' })
const codes = (p: Project, s: VizSpec) => { const a = assess(p, s); return { invalid: a.invalid?.code ?? null, warnings: a.warnings.map((w) => w.code) } }

describe('which rules block and which only warn', () => {
  it('blocks what would misstate the data', () => {
    const p = P()
    const holders = addSet(p, 'hold', { DOM: [46, 45, 44, 45, 44, 43], FOR: [54, 55, 56, 55, null, 57] }, { unit: '% of debt', measure: PARTS })
    const flows = addSet(p, 'flow', { A: [3, 2, 4, 3, 2, 1], B: [-1, -2, 1, -1, -2, -1] }, { unit: 'EUR bn', measure: PARTS })
    addSet(p, 'eur', { FR: [10, 11, 12, 13, 14, 15] }, { unit: 'EUR bn' })
    expect(codes(p, spec('pie', ['ds.fr.debt', 'ds.de.debt'], { transform: 'latest' })).invalid).toBe('not_parts') // ratios are not parts of a total
    expect(codes(p, spec('column', ['ds.fr.debt', 'ds.de.debt'], {}, 'stacked')).invalid).toBe('not_parts')
    expect(codes(p, spec('doughnut', holders, { transform: 'at', at: '2024' })).invalid).toBe('shape') // a missing part (V1: no missing values in a pie)
    expect(codes(p, spec('column', holders, {}, 'stacked')).invalid).toBe('missing_parts') // over time: 2024 has a part missing
    expect(codes(p, spec('column', flows, {}, 'percent')).invalid).toBe('negative_parts')
    expect(codes(p, spec('combo', ['ds.fr.debt', 'ds.fr.growth', 'ds.fr.eur'], { from: '2022' })).invalid).toBe('combo_units')
    expect(codes(p, spec('line', ['ds.fr.debt', 'ds.fr.growth'])).invalid).toBe('view') // two units on one axis
  })
  it('warns about what is faithful but less suitable', () => {
    const p = P()
    const flows = addSet(p, 'flow', { A: [3, 2, 4, 3, 2, 1], B: [-1, -2, 1, -1, -2, -1] }, { unit: 'EUR bn', measure: PARTS })
    const slices = addSet(p, 'slice', Object.fromEntries('ABCDEFGH'.split('').map((g, i) => [g, [10 + i, 10 + i, 10 + i, 10 + i, 10 + i, 10 + i]])), { unit: '% of debt', measure: PARTS })
    const eight = addSet(p, 'r8', Object.fromEntries('ABCDEFGH'.split('').map((g, i) => [g, YEARS.map((_, y) => 50 + i + y)])))
    const long = addSet(p, 'r11', Object.fromEntries('ABCDEFG'.split('').map((g, i) => [g, Array.from({ length: 11 }, (_, y) => 50 + i + y)])), { years: Array.from({ length: 11 }, (_, y) => String(2015 + y)) })
    const w = (s: VizSpec) => { const c = codes(p, s); expect(c.invalid).toBeNull(); return c.warnings }
    expect(w(spec('column', flows, {}, 'stacked'))).toEqual(['negative_stack'])
    expect(w(spec('pie', slices, { transform: 'latest' }))).toEqual(['many_slices'])
    expect(w(spec('line', ['ds.fr.debt', 'ds.de.debt'], { from: '2024' }))).toEqual(['few_periods'])
    expect(w(spec('line', eight))).toEqual(['many_lines'])
    expect(w(spec('area', ['ds.fr.debt', 'ds.de.debt']))).toEqual(['overlapping_areas'])
    expect(w(spec('column', long))).toEqual(['many_bars'])
    expect(w(spec('scatter', ['ds.fr.debt', 'ds.fr.yield']))).toEqual(['few_points'])
    expect(w(spec('combo', ['ds.fr.debt', 'ds.de.debt']))).toEqual(['combo_one_unit'])
  })
  it('offers a change of view that makes an invalid part-to-whole valid, never new values', () => {
    const p = P()
    const holders = addSet(p, 'hold', { DOM: [46, 45, 44, 45, 44, 43], FOR: [54, null, 56, 55, 56, 57] }, { unit: '% of debt', measure: PARTS }) // 2021 not reported
    const fr = findings(p, spec('column', holders, {}, 'stacked'), projectView(p, { datasets: holders, transform: 'none' }))
    expect(fr.map((f) => f.code)).toEqual(['missing_parts'])
    const stacked = changeOptions(p, spec('column', holders)).find((o) => o.subtype === 'stacked')!
    expect([stacked.state, stacked.fixes]).toEqual(['invalid', [{ family: 'column', subtype: 'stacked', transform: 'none', from: '2022', label: 'Show 2022–2025, the periods where every part is reported' }]])
    const pie = changeOptions(p, spec('pie', holders, { transform: 'at', at: '2021' })).find((o) => o.family === 'pie')!
    expect([pie.state, pie.refused, pie.fixes.map((x) => [x.family, x.transform, x.at])]).toEqual(['invalid', 'a pie cannot show missing or negative values', [['pie', 'at', '2025']]])
  })
})

describe('Use anyway: user overrides of warnings', () => {
  async function deck() {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    s.exec({ kind: 'slide.compose', proposal: { key: 'd', kicker: 'K', title: 'T', subtitle: 'S', viz: { intent: 'trend', title: 'Gross debt, % of GDP', datasets: ['ds.fr.debt', 'ds.de.debt'] } } })
    const id = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0]
    return { s, id, spec: () => (s.sidecar.bindings[id] as any).spec as VizSpec }
  }

  it('asks first, then keeps the visual with the same data, provenance, undo/redo and integrity', async () => {
    const { s, id, spec } = await deck()
    const before = structuredClone(spec()), steps = s.undoStack.length
    const ask = s.exec({ kind: 'viz.change', id, family: 'area' })
    expect([ask.ok, ask.warnings?.map((w) => w.code), ask.error]).toEqual([false, ['overlapping_areas'], expect.stringMatching(/^Needs confirmation: overlapping areas/)])
    expect([spec(), s.undoStack.length]).toEqual([before, steps]) // nothing changed
    const ok = s.exec({ kind: 'viz.change', id, family: 'area', accept: ['overlapping_areas'] })
    expect(ok.ok).toBe(true)
    expect([spec().family, spec().accepted_warnings, spec().view, spec().id]).toEqual(['area', ['overlapping_areas'], before.view, before.id])
    expect(s.journal.at(-1)!.summary).toMatch(/to area \(used anyway despite: overlapping_areas\)$/)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    s.undo(); expect([spec().family, spec().accepted_warnings]).toEqual(['column', undefined])
    s.redo(); expect([spec().family, spec().accepted_warnings]).toEqual(['area', ['overlapping_areas']])
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  })

  it('a ranking turned back into a time series is titled by its series, not by the ranked period', async () => {
    const p = P(), ids = addSet(p, 'bal', { FR: [-9, -6.6, -4.8, -5.5, -5.8, -5.1], DE: [-4.4, -3.2, -2.1, -2.5, -2.8, -2.5] }, { entity: { FR: 'France', DE: 'Germany' } })
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: p, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    s.exec({ kind: 'slide.compose', proposal: { key: 'r', kicker: 'K', title: 'T', subtitle: 'S', viz: { intent: 'ranking', datasets: ids } } })
    const id = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0], sp = () => (s.sidecar.bindings[id] as any).spec as VizSpec
    expect(sp().title).toMatch(/, 2025$/)
    expect(s.exec({ kind: 'viz.change', id, family: 'column', transform: 'none' }).ok).toBe(true)
    expect(sp().title).toBe('Bal (test), % of GDP') // the series' label and unit; no single period
  })

  it('never lets an acknowledgement unlock an invalid visual', async () => {
    const { s, id, spec } = await deck()
    const r = s.exec({ kind: 'viz.change', id, family: 'pie', transform: 'latest', accept: ['not_parts', 'missing_parts', 'shape'] })
    expect([r.ok, r.warnings, r.error]).toEqual([false, undefined, expect.stringMatching(/not parts of a total/)])
    expect(s.exec({ kind: 'viz.change', id, family: 'column', subtype: 'stacked', accept: ['not_parts'] }).error).toMatch(/not parts of a total/)
    // a replacement spec cannot acknowledge its own warnings
    const self = s.exec({ kind: 'viz.update', id, spec: { ...spec(), family: 'area', accepted_warnings: ['overlapping_areas'] } })
    expect(self.warnings?.map((w) => w.code)).toEqual(['overlapping_areas'])
    expect(spec().family).toBe('column')
  })

  it('survives save and reload; a later change of visual asks again', async () => {
    const { s, id } = await deck()
    s.exec({ kind: 'viz.change', id, family: 'area', accept: ['overlapping_areas'] })
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    const sp = () => (back.sidecar.bindings[id] as any).spec as VizSpec
    expect([sp().family, sp().accepted_warnings]).toEqual(['area', ['overlapping_areas']])
    expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
    expect(back.exec({ kind: 'viz.change', id, family: 'line' }).ok).toBe(true) // a clean visual drops the acknowledgement
    expect(sp().accepted_warnings).toBeUndefined()
    expect(back.exec({ kind: 'viz.change', id, family: 'area' }).warnings?.map((w) => w.code)).toEqual(['overlapping_areas'])
  })

  it('AI edits after an override keep it, ask about anything new, and stay blocked from invalid results', async () => {
    const { s, id } = await deck()
    s.exec({ kind: 'viz.change', id, family: 'area', accept: ['overlapping_areas'] })
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    const sp = () => (back.sidecar.bindings[id] as any).spec as VizSpec
    const it_ = { ...structuredClone(back.project.datasets['ds.de.debt']!), id: 'ds.it.debt', geo: 'IT', entity: 'Italy', title: 'Italy · debt (test)' }
    // the same warning still applies: the AI's added series doesn't need a new confirmation
    const add = back.exec({ kind: 'chart.addSeries', id, dataset: it_ }, { actor: 'ai', proposalId: 'p1' })
    expect([add.ok, sp().view.datasets, sp().accepted_warnings]).toEqual([true, ['ds.fr.debt', 'ds.de.debt', 'ds.it.debt'], ['overlapping_areas']])
    expect(back.journal.at(-1)).toMatchObject({ actor: 'ai', kind: 'chart.addSeries' })
    // a data edit re-realizes the overridden visual; warnings never block data
    expect(back.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2025', value: 116 }).ok).toBe(true)
    expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
    // an AI change to a line with only two periods is a new warning: asked, not applied
    const two = back.exec({ kind: 'viz.change', id, family: 'line', from: '2024' }, { actor: 'ai', proposalId: 'p2' })
    expect([two.ok, two.warnings?.map((w) => w.code), sp().family]).toEqual([false, ['few_periods'], 'area'])
    // an AI change to a pie of ratios is invalid whatever it passes
    expect(back.exec({ kind: 'viz.change', id, family: 'pie', transform: 'latest', accept: ['overlapping_areas'] }, { actor: 'ai' }).ok).toBe(false)
    // an AI series in another unit is refused on the overridden chart too
    const gr = { ...structuredClone(back.project.datasets['ds.fr.growth']!), id: 'ds.es.growth', geo: 'ES', entity: 'Spain' }
    expect(back.exec({ kind: 'chart.addSeries', id, dataset: gr }, { actor: 'ai' }).error).toMatch(/units/)
    expect(sp().view.datasets).toEqual(['ds.fr.debt', 'ds.de.debt', 'ds.it.debt'])
  })

  it('a slide composed with an explicit warned visual needs the same acknowledgement', async () => {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    const proposal = { key: 'a', kicker: 'K', title: 'T', subtitle: 'S', viz: spec('scatter', ['ds.fr.debt', 'ds.fr.yield']) }
    expect(s.exec({ kind: 'slide.compose', proposal }).warnings?.map((w) => w.code)).toEqual(['few_points'])
    expect(s.exec({ kind: 'slide.compose', proposal, accept: ['few_points'] }).ok).toBe(true)
    expect(Object.values(s.sidecar.bindings).find((b) => b.kind === 'viz')).toMatchObject({ spec: { family: 'scatter', accepted_warnings: ['few_points'] } })
    expect(s.journal.at(-1)!.summary).toMatch(/used anyway despite: few_points/)
  })
})
