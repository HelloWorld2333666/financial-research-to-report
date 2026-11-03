// VIS V2: the recommender and the hard meaning constraints. Synthetic datasets are marked "(test)";
// the seven-country set mirrors the brief's example ("compare seven countries' fiscal balances").
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { changeOptions, recommend } from './recommend'
import { BUNDLE_SCHEMA, type Project } from './types'

const YEARS = ['2020', '2021', '2022', '2023', '2024', '2025']
function addSet(p: Project, metric: string, rows: Record<string, number[]>, extra: any = {}) {
  for (const [geo, vals] of Object.entries(rows)) {
    const id = `ds.${geo.toLowerCase()}.${metric}`
    p.datasets[id] = { id, title: `${geo} · ${metric} (test)`, entity: geo, geo, metric, unit: extra.unit ?? '% of GDP', frequency: 'annual', origin: 'test', verification: 'test',
      source_url: '', source_note: 'synthetic test fixture', working: {}, observations: (extra.years ?? YEARS).map((date: string, i: number) => ({ date, value: vals[i] ?? null, status: 'test' })),
      measure: extra.measure ?? { kind: 'balance_ratio', of: 'GDP', signed: true, additive_parts_of: null, scale: 'interval' } } as any
  }
  return Object.keys(rows).map((g) => `ds.${g.toLowerCase()}.${metric}`)
}
const P = () => structuredClone(project) as Project
const seven = (p: Project) => addSet(p, 'balance', { FR: [-9, -6.6, -4.8, -5.5, -5.8, -5.1], DE: [-4.4, -3.2, -2.1, -2.5, -2.8, -2.5], IT: [-9.4, -8.7, -8.1, -7.2, -3.4, -3.3], ES: [-10, -6.7, -4.6, -3.5, -3.2, -2.8],
  PT: [-5.8, -2.9, -0.3, 1.2, 0.7, 0.3], EL: [-9.7, -7, -2.4, -1.3, 1.3, 0.6], BE: [-8.9, -5.4, -3.6, -4.1, -4.5, -4.6] })

describe('VIS V2 recommender', () => {
  it("recommends a ranked horizontal bar for seven countries' balances at one period, with a table as an alternative", () => {
    const p = P(), ids = seven(p)
    const r = recommend(p, { intent: 'ranking', datasets: ids })
    expect(r.recommended!.key).toBe('bar:rank')
    expect(r.recommended!.why).toBe('It compares 7 entities at one point in time (2025), sorted; bars diverge from zero because 5 values are negative.')
    const alts = r.candidates.filter((c) => !c.refused && c !== r.recommended).map((c) => c.key)
    expect(alts).toContain('table:rank')
    expect(r.candidates.find((c) => c.key === 'pie:latest')!.refused).toMatch(/negative|not parts of a total/) // never a pie of balances
    const t = r.candidates.find((c) => c.key === 'table:rank')!.table!
    expect([t.dates, t.datasets[0]]).toEqual([['2025'], 'ds.el.balance']) // sorted like the ranking: Greece (+0.6) first
  })
  it('refuses part-to-whole visuals for ratios, with the reason, and offers them for genuine parts', () => {
    const p = P()
    const r = recommend(p, { intent: 'composition', datasets: ['ds.fr.debt', 'ds.de.debt'] })
    for (const k of ['doughnut:latest', 'pie:latest', 'column:stacked:none', 'column:percent:none'])
      expect(r.candidates.find((c) => c.key === k)!.refused).toMatch(/not parts of a total/)
    expect(r.recommended!.key).toBe('bar:rank') // the only honest option left for "composition" of ratios
    const parts = addSet(p, 'holders', { DOM: [46, 45.5, 45.2, 44.8], FOR: [54, 54.5, 54.8, 55.2] }, { unit: '% of debt', years: ['2022', '2023', '2024', '2025'],
      measure: { kind: 'share', signed: false, additive_parts_of: 'fr.debt', scale: 'interval' } })
    const c = recommend(p, { intent: 'composition', datasets: parts })
    expect(c.recommended!.spec!.family).toMatch(/doughnut|column/)
    expect(c.candidates.find((x) => x.key === 'pie:latest')!.refused).toBeNull()
  })
  it('picks columns for a few discrete periods and a line for a long series', () => {
    const p = P()
    expect(recommend(p, { intent: 'trend', datasets: ['ds.fr.debt', 'ds.de.debt'] }).recommended!.label).toBe('Columns') // 4 periods
    const long = addSet(p, 'long', { FR: Array.from({ length: 16 }, (_, i) => 80 + i * 2) }, { years: Array.from({ length: 16 }, (_, i) => String(2010 + i)),
      measure: { kind: 'ratio', signed: false, additive_parts_of: null, scale: 'interval' } })
    const r = recommend(p, { intent: 'trend', datasets: long })
    expect([r.recommended!.label, r.recommended!.why]).toEqual(['Line', '16 periods show the trend; gaps stay visible as breaks.'])
  })
  it('shows a change from zero, a relationship as a scatter, and warns about a single-unit combo', () => {
    const p = P()
    const ch = recommend(p, { intent: 'change', datasets: ['ds.fr.debt', 'ds.de.debt'], between: ['2022', '2025'] })
    expect([ch.recommended!.key, ch.recommended!.spec!.view.transform]).toEqual(['bar:diff', 'diff'])
    expect(recommend(p, { intent: 'relationship', datasets: ['ds.fr.interest', 'ds.fr.growth'] }).recommended!.spec!.family).toBe('scatter')
    const few = recommend(p, { intent: 'relationship', datasets: ['ds.fr.debt', 'ds.fr.yield'] }) // 4 pairs: allowed, not recommended
    expect([few.recommended, few.candidates[0]!.state, few.candidates[0]!.warnings[0]!.code]).toEqual([null, 'warning', 'few_points'])
    const combo = recommend(p, { intent: 'trend', datasets: ['ds.fr.debt', 'ds.de.debt'] }).candidates.find((c) => c.key === 'combo:none')!
    expect([combo.state, combo.warnings[0]!.code]).toEqual(['warning', 'combo_one_unit'])
  })
  it('reports datasets that are not in the project instead of guessing', () => {
    expect(recommend(P(), { intent: 'ranking', datasets: ['ds.xx.debt'] }).error).toBe('not in the project: ds.xx.debt')
  })
})

describe('VIS V2 constraints cannot be bypassed', () => {
  const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  it('refuses an explicit pie of ratios through compose, update and change', async () => {
    const s = await fresh()
    const pie = { schema: 'frr-viz/1', title: 'Debt', family: 'pie', view: { datasets: ['ds.fr.debt', 'ds.de.debt'], transform: 'latest' }, missing: 'gap' }
    expect(s.exec({ kind: 'slide.compose', proposal: { key: 'x', kicker: 'K', title: 'T', subtitle: 'S', viz: pie } }).error).toMatch(/not parts of a total/)
    s.exec({ kind: 'slide.compose', proposal: { key: 'y', kicker: 'K', title: 'T', subtitle: 'S', viz: { intent: 'trend', title: 'Debt', datasets: ['ds.fr.debt', 'ds.de.debt'] } } })
    const [id, b] = Object.entries(s.sidecar.bindings).find(([, x]) => x.kind === 'viz') as [string, any]
    expect(s.exec({ kind: 'viz.update', id, spec: { ...b.spec, ...pie, id: b.spec.id } as any }).error).toMatch(/not parts of a total/)
    expect(s.exec({ kind: 'viz.change', id, family: 'column', subtype: 'stacked' }).error).toMatch(/not parts of a total/)
  })
})

describe('VIS V2 change-visual options', () => {
  it('lists the recommended visual per intent, the current one, and refused ones with reasons', async () => {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    s.exec({ kind: 'slide.compose', proposal: { key: 'y', kicker: 'K', title: 'T', subtitle: 'S', viz: { intent: 'trend', title: 'Debt', datasets: ['ds.fr.debt', 'ds.de.debt'] } } })
    const [, b] = Object.entries(s.sidecar.bindings).find(([, x]) => x.kind === 'viz') as [string, any]
    const opts = changeOptions(s.project, b.spec)
    expect(opts.filter((o) => o.recommended).map((o) => `${o.intent}:${o.family}:${o.transform}`)).toEqual(['trend:column:none', 'ranking:bar:rank', 'change:bar:diff', 'distribution:range:range']) // composition's best (ranked bar) is already listed
    expect(opts.find((o) => o.family === 'box')!.refused).toMatch(/quartiles of 2 values are not a distribution/)
    expect(opts.find((o) => o.current)!.family).toBe('column')
    expect(opts.find((o) => o.family === 'pie')!.refused).toMatch(/not parts of a total/)
  })
})

describe('VIS V2 composer requests by intent', () => {
  it('the France deck is no longer all lines, and every visual passes integrity', async () => {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    for (const p of proposal as any[]) expect(s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai' }).ok).toBe(true)
    const fam = Object.values(s.sidecar.bindings).filter((b) => b.kind === 'viz').map((b: any) => b.spec.family)
    expect(fam).toEqual(['column', 'column', 'column']) // 4-6 annual periods each: columns (a line from 12 periods)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  })
})
