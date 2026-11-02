// VIS V1: the renderer-independent spec (frr-viz/1). Views and provenance, shape refusals, every native
// family realized from a spec (integrity, save/reopen, undo), change-visual keeping gaps, migration of
// M1-M5 chart bindings. WRITE_FIXTURES=1 also writes the Python parity fixture.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl } from './deck'
import { check, project as projectView, VizError, type VizSpec } from './viz'
import { BUNDLE_SCHEMA, type Project } from './types'

/** The France fixture plus a synthetic, test-only pair of datasets that ARE parts of one total (debt by
 *  holder), so part-to-whole visuals can be exercised; no real dataset in the project is additive. */
const P = () => {
  const p = structuredClone(project) as Project
  const years = ['2022', '2023', '2024', '2025']
  for (const [id, entity, vals] of [['ds.fr.hold.dom', 'Domestic holders', [46.0, 45.5, 45.2, 44.8]], ['ds.fr.hold.for', 'Non-resident holders', [54.0, 54.5, 54.8, 55.2]]] as const)
    p.datasets[id] = { id, title: `France · debt held by ${entity.toLowerCase()} (test)`, entity, geo: 'FR', metric: 'holders', unit: '% of debt', frequency: 'annual', origin: 'test',
      verification: 'test', source_url: '', source_note: 'synthetic test fixture', working: {}, observations: years.map((date, i) => ({ date, value: vals[i]!, status: 'test' })),
      measure: { kind: 'share', signed: false, additive_parts_of: 'fr.debt.total', scale: 'interval' } } as any
  return p
}
const spec = (family: VizSpec['family'], view: VizSpec['view'], extra: Partial<VizSpec> = {}): VizSpec => ({ schema: 'frr-viz/1', id: 'viz_test', title: 'T', family, view, missing: 'gap', ...extra })
const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
const vizOf = (s: Store) => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz') as [string, any]
async function withVisual(v: Omit<VizSpec, 'schema' | 'id' | 'missing'>) {
  const s = await fresh()
  const r = s.exec({ kind: 'slide.compose', proposal: { key: 'v', kicker: 'K', title: 'Title', subtitle: 'S', viz: v } }, { actor: 'ai' })
  return { s, r }
}

describe('VIS V1 views and provenance', () => {
  it('projects a time series with gaps and the evidence of every value', () => {
    const p = P()
    p.datasets['ds.fr.debt']!.working['2023'] = { deleted: true, by: 'you', at: 't', status: 'manual_unverified' }
    const pr = projectView(p, { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' })
    expect(pr.shape).toBe('time')
    expect(pr.categories).toEqual(['2022', '2023', '2024', '2025'])
    expect(pr.series[0]!.values[1]).toBeNull() // a gap, not 0
    expect(pr.series[0]!.cells[0]).toMatchObject({ evidence: 'ev.exp2.1', dataset: 'ds.fr.debt', period: '2022', edited: false })
  })
  it('projects a cross-section at the latest common period, and ranks it', () => {
    const p = P()
    const latest = projectView(p, { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'latest' })
    expect([latest.shape, latest.categories, latest.label]).toEqual(['cross', ['France', 'Germany'], 'general government gross debt, 2025'])
    const asc = projectView(p, { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'rank', order: 'asc' })
    expect(asc.categories).toEqual(['Germany', 'France'])
  })
  it('derives a change between two periods with its formula and inputs', () => {
    const pr = projectView(P(), { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'diff', between: ['2022', '2025'] })
    expect(pr.unit).toBe('pp') // a change in % of GDP is in percentage points
    expect(pr.series[0]!.values[0]).toBeCloseTo(4.3)
    expect(pr.series[0]!.cells[0]).toMatchObject({ derived: { formula: 'end - start', inputs: { start: { evidence: 'ev.exp2.1', period: '2022' }, end: { evidence: 'ev.exp2.4', period: '2025' } } } })
    expect(projectView(P(), { datasets: ['ds.fr.debt'], transform: 'pct_change', between: ['2022', '2025'] }).unit).toBe('%')
  })
  it('pairs two datasets for a scatter, sorted by x, with both provenances', () => {
    const pr = projectView(P(), { datasets: ['ds.fr.debt', 'ds.fr.yield'], transform: 'none' }, { scatter: true })
    expect(pr.shape).toBe('pairs')
    expect(pr.x!.values).toEqual([...pr.x!.values].sort((a, b) => a - b))
    expect(pr.x!.cells.every((c) => c && 'evidence' in c && c.evidence)).toBe(true)
  })
})

describe('VIS V1 refusals (shape rules; meaning rules come in V2)', () => {
  const p = P()
  const refuse = (s: VizSpec, msg: RegExp) => expect(() => check(p, s)).toThrow(msg)
  it('refuses what a family cannot show', () => {
    refuse(spec('line', { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'latest' }), /needs a time axis/)
    refuse(spec('pie', { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' }), /one series at one period/)
    refuse(spec('pie', { datasets: ['ds.fr.deficit', 'ds.de.deficit'], transform: 'latest' }), /missing or negative/)
    refuse(spec('column', { datasets: ['ds.fr.debt', 'ds.fr.growth'], transform: 'none' }), /different units/)
    refuse(spec('column', { datasets: ['ds.fr.debt'], transform: 'none' }, { subtype: 'stacked' }), /at least two series/)
    refuse(spec('area', { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' }, { subtype: 'stacked' }), /stacked areas/)
    refuse(spec('scatter', { datasets: ['ds.fr.debt'], transform: 'none' }), /exactly two datasets/)
    expect(() => check(p, spec('line', { datasets: ['ds.xx'], transform: 'none' }))).toThrow(VizError)
  })
})

const HOLDERS = ['ds.fr.hold.dom', 'ds.fr.hold.for']
const FAMILIES: Array<[string, Omit<VizSpec, 'schema' | 'id' | 'missing'>]> = [
  ['column', { title: 'Debt', family: 'column', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' } }],
  ['column stacked', { title: 'Holders', family: 'column', subtype: 'stacked', view: { datasets: HOLDERS, transform: 'none' } }],
  ['column 100%', { title: 'Holders', family: 'column', subtype: 'percent', view: { datasets: HOLDERS, transform: 'none' } }],
  ['bar ranked', { title: 'Deficit 2025', family: 'bar', view: { datasets: ['ds.fr.deficit', 'ds.de.deficit'], transform: 'rank' } }],
  ['bar change', { title: 'Debt change', family: 'bar', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'diff', between: ['2022', '2025'] } }],
  ['line', { title: 'Debt', family: 'line', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' } }],
  ['area', { title: 'Debt', family: 'area', view: { datasets: ['ds.fr.debt'], transform: 'none' } }],
  ['pie', { title: 'Holders 2025', family: 'pie', view: { datasets: HOLDERS, transform: 'latest' } }],
  ['doughnut', { title: 'Holders 2025', family: 'doughnut', view: { datasets: HOLDERS, transform: 'latest' } }],
  ['scatter', { title: 'Growth vs interest', family: 'scatter', view: { datasets: ['ds.fr.interest', 'ds.fr.growth'], transform: 'none' } }],
  ['combo', { title: 'Debt and yield', family: 'combo', view: { datasets: ['ds.fr.debt', 'ds.fr.yield'], transform: 'none' } }],
]

describe('VIS V1 native adapter: every family realized from a spec', () => {
  for (const [name, v] of FAMILIES) {
    it(`${name}: integrity, save/reopen and undo`, async () => {
      const { s, r } = await withVisual(v)
      expect(r.error).toBeUndefined()
      const [id, b] = vizOf(s)
      expect([b.spec.schema, b.spec.family, b.spec.id]).toEqual(['frr-viz/1', v.family, expect.stringMatching(/^viz_/)])
      expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
      const back = await Store.fromBundle(await s.toBundle())
      expect((back.sidecar.bindings[id] as any).spec).toEqual(b.spec)
      expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
      s.undo(); expect(findEl(s.deck, id)).toBeNull()
      s.redo(); expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    })
  }
  it('reads a ranked horizontal bar top-down: largest first at the top', async () => {
    const { s } = await withVisual(FAMILIES[3]![1])
    const el = findEl(s.deck, vizOf(s)[0])!.el
    expect(el.chart.categories).toEqual(['France', 'Germany']) // drawn bottom-up, so France (-5.x) is listed last = top
  })
  it('titles a single-period or change view by what it shows, with its unit', async () => {
    const { s } = await withVisual(FAMILIES[4]![1]) // bar of the 2022-2025 change, spec title "Debt change"
    expect(findEl(s.deck, vizOf(s)[0])!.el.chart.title).toBe('Change: general government gross debt, 2022–2025, pp')
    const { s: t } = await withVisual(FAMILIES[5]![1]) // time series keeps its own title
    expect(findEl(t.deck, vizOf(t)[0])!.el.chart.title).toBe('Debt')
  })
})

describe('VIS V1 change visual and data edits', () => {
  it('changes line → column → horizontal ranking, keeping gaps and integrity, one step each', async () => {
    const { s } = await withVisual(FAMILIES[5]![1])
    const [id] = vizOf(s)
    s.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2023', value: null })
    const n = s.undoStack.length
    expect(s.exec({ kind: 'viz.change', id, family: 'column' }).ok).toBe(true)
    expect(findEl(s.deck, id)!.el.chart.series[0].values[1]).toBeNull() // used to become 0 before patch 0005
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    expect(s.exec({ kind: 'viz.change', id, family: 'bar', transform: 'rank' }).ok).toBe(true)
    expect(findEl(s.deck, id)!.el.chart.barDir).toBe('bar')
    expect(s.undoStack.length).toBe(n + 2)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  })
  it('refuses an invalid change and leaves the visual as it was', async () => {
    const { s } = await withVisual(FAMILIES[5]![1])
    const [id, b] = vizOf(s), before = JSON.stringify(b.spec), n = s.undoStack.length
    expect(s.exec({ kind: 'viz.change', id, family: 'pie' }).error).toMatch(/one series at one period/)
    // V2 meaning rule: debt ratios of two countries are not parts of a total, at any period
    expect(s.exec({ kind: 'viz.change', id, family: 'pie', transform: 'latest' }).error).toMatch(/not parts of a total/)
    expect([JSON.stringify((s.sidecar.bindings[id] as any).spec), s.undoStack.length]).toEqual([before, n])
    expect(s.exec({ kind: 'viz.change', id, family: 'bar', transform: 'rank' }).ok).toBe(true)
  })
  it('re-ranks a bar chart when the data changes', async () => {
    const { s } = await withVisual(FAMILIES[3]![1])
    const [id] = vizOf(s)
    s.exec({ kind: 'data.set', dataset: 'ds.de.deficit', date: '2025', value: -9.9 })
    expect(findEl(s.deck, id)!.el.chart.categories).toEqual(['Germany', 'France'])
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  })
})

describe('VIS V1 migration', () => {
  it('opens an M1-M5 deck: chart bindings become specs with the same datasets, integrity intact', async () => {
    const { s } = await withVisual(FAMILIES[5]![1])
    const b = await s.toBundle()
    const [id, v] = Object.entries(b.sidecar.bindings).find(([, x]: any) => x.kind === 'viz') as [string, any]
    b.sidecar.bindings[id] = { kind: 'chart', slide: v.slide, chart: { type: 'line', title: v.spec.title, series: v.spec.view.datasets } } as any
    const old = await Store.fromBundle(b)
    expect((old.sidecar.bindings[id] as any).spec).toMatchObject({ schema: 'frr-viz/1', id: `viz_${id.slice(2)}`, family: 'line', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'none' } })
    expect(integrity(old.deck, old.project, old.sidecar).ok).toBe(true)
  })
})

// node globals without @types/node (the client package doesn't depend on Node types)
it.runIf((globalThis as any).process?.env?.WRITE_FIXTURES)('writes the Python parity fixture', async () => {
  const { writeFileSync } = await import('node:fs' as string)
  const working = { dataset: 'ds.fr.debt', date: '2023', entry: { deleted: true, by: 'you', at: 't', status: 'manual_unverified' } }
  const p = P(); p.datasets[working.dataset]!.working[working.date] = working.entry as any
  const cases = FAMILIES.map(([name, v]) => {
    const sp = spec(v.family, v.view, { title: v.title, subtype: v.subtype })
    const pr = check(p, sp)
    return { name, spec: sp, expected: { shape: pr.shape, categories: pr.categories, series: pr.series.map((x) => x.values), x: pr.x?.values ?? null } }
  })
  // composite views (VIS V3): two periods per entity, a bridge, and rating actions on the ordinal scale
  const extraEvidence = {
    'ev.r.t1': { id: 'ev.r.t1', kind: 'fact', subject: 'France', statement: 'Agency A (test) affirmed AA', rating: { agency: 'Agency A (test)', action: 'affirmed', rating: 'AA', outlook: 'negative', date: '2023-04-28' } },
    'ev.r.t2': { id: 'ev.r.t2', kind: 'fact', subject: 'France', statement: 'Agency B (test) confirmed AA (high)', rating: { agency: 'Agency B (test)', action: 'confirmed', rating: 'AA (high)', outlook: 'stable', date: '2023-10-20' } },
    'ev.r.t3': { id: 'ev.r.t3', kind: 'fact', subject: 'France', statement: 'Agency A (test) downgraded to Aa3', rating: { agency: 'Agency A (test)', action: 'downgraded', rating: 'Aa3', outlook: 'stable', date: '2024-05-31' } },
    'ev.r.t4': { id: 'ev.r.t4', kind: 'fact', subject: 'France', statement: 'Agency B (test) confirmed, undated', rating: { agency: 'Agency B (test)', action: 'confirmed', rating: 'AA (high)', outlook: null, date: null } },
  }
  Object.assign(p.evidence, extraEvidence)
  const composite: [string, Omit<VizSpec, 'schema' | 'id' | 'missing'>][] = [
    ['dumbbell', { title: 'Debt', family: 'dumbbell', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'pair', between: ['2022', '2025'] } }],
    ['kpi', { title: 'Debt', family: 'kpi', view: { datasets: ['ds.de.debt'], transform: 'pair' } }],
    ['waterfall', { title: 'Deficit', family: 'waterfall', view: { datasets: ['ds.fr.deficit'], transform: 'bridge', between: ['2020', '2025'] } }],
    ['lollipop', { title: 'Deficit', family: 'lollipop', view: { datasets: ['ds.fr.deficit', 'ds.de.deficit'], transform: 'rank', at: '2024' } }],
    ['multiples', { title: 'Growth', family: 'multiples', view: { datasets: ['ds.fr.growth', 'ds.de.growth'], transform: 'none' } }],
    ['rating_timeline', { title: 'Ratings', family: 'rating_timeline', view: { datasets: [], transform: 'ratings', evidence: Object.keys(extraEvidence) } }],
  ]
  for (const [name, v] of composite) {
    const sp = spec(v.family, v.view, { title: v.title })
    const pr = check(p, sp)
    cases.push({ name, spec: sp, expected: { shape: pr.shape, categories: pr.categories, series: pr.series.map((x) => x.values), x: null } })
  }
  const extra = Object.fromEntries(HOLDERS.map((id) => [id, p.datasets[id]])) // synthetic test datasets the server fixture lacks
  writeFileSync(new URL('../../../server/tests/fixtures/viz-parity.json', import.meta.url), JSON.stringify({ working, extra, extraEvidence, cases }, null, 1))
})
