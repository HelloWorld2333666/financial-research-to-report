// VIS V4: financial structures and distributions. Yield curve (proportional tenor axis), maturity ladder (native
// columns of one country's debt by remaining maturity), range, box plot, histogram and a debt-sensitivity grid.
// Synthetic datasets are marked "(test)"; the sensitivity grid reads the France fixture's Eurostat data.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, render } from './deck'
import { layout, readGroup } from './composite'
import { assess, binEdges, check, quantile, VIZ_SCHEMA, type VizSpec } from './viz'
import { recommend } from './recommend'
import { BUNDLE_SCHEMA, type Project } from './types'

const EU = ['BE', 'BG', 'CZ', 'DK', 'DE', 'EE', 'IE', 'EL', 'ES', 'FR', 'HR', 'IT', 'CY', 'LV', 'LT', 'LU', 'HU', 'MT', 'NL', 'AT', 'PL', 'PT', 'RO', 'SI', 'SK', 'FI', 'SE']
const BAL = [-4.5, -3.0, -2.2, 2.8, -2.5, -1.4, 1.2, 2.0, -2.4, -5.1, -2.9, -3.1, 3.4, -2.0, -1.3, 0.8, -4.9, -3.6, -1.0, -4.3, -6.6, 0.7, -8.4, -1.9, -5.3, -4.2, -1.5]
const TENORS = [1, 2, 3, 5, 7, 10, 15, 20, 30]
function ds(p: Project, id: string, o: { entity: string; geo: string; metric: string; unit: string; obs: [string, number | null][]; measure: any }) {
  p.datasets[id] = { id, title: `${o.entity} · ${o.metric} (test)`, entity: o.entity, geo: o.geo, metric: o.metric, unit: o.unit, frequency: 'annual', origin: 'test', verification: 'test',
    source_url: '', source_note: 'synthetic', working: {}, observations: o.obs.map(([date, value]) => ({ date, value, status: 'test', evidence_id: `ev.${id}.${date}` })), measure: o.measure } as any
  for (const [date, value] of o.obs) (p.evidence as any)[`ev.${id}.${date}`] = { id: `ev.${id}.${date}`, kind: 'observation', value, verification: 'test', statement: `${id} ${date} (test)` }
  return id
}
function P(): Project {
  const p = structuredClone(project) as Project
  EU.forEach((g, k) => ds(p, `ds.${g.toLowerCase()}.bal`, { entity: g, geo: g, metric: 'bal', unit: '% of GDP', obs: [['2023', BAL[k]! - 0.8], ['2024', BAL[k]! - 0.3], ['2025', BAL[k]!]], measure: { kind: 'balance_ratio', signed: true, additive_parts_of: null, scale: 'interval' } }))
  for (const [curve, shift] of [['yc_all', 0.35], ['yc_aaa', 0]] as const)
    for (const t of TENORS) ds(p, `ds.ea.${curve}_y${t}`, { entity: 'Euro area', geo: 'EA', metric: `${curve}_y${t}`, unit: '%', obs: [['2025-09', 1.9 + Math.log(t) * 0.45 + shift], ['2026-09', 2.0 + Math.log(t) * 0.38 + shift]],
      measure: { kind: 'yield', signed: true, additive_parts_of: null, scale: 'interval', tenor: t, curve } })
  ;[['rmd_le1', 0, '1 year or less', 14.1], ['rmd_1_5', 1, '1 to 5 years', 33.2], ['rmd_5_10', 2, '5 to 10 years', 30.6], ['rmd_10_30', 3, '10 to 30 years', 31.9], ['rmd_gt30', 4, 'over 30 years', 5.4]].forEach(([m, order, label, v]) => {
    ds(p, `ds.fr.${m}`, { entity: 'France', geo: 'FR', metric: m as string, unit: '% of GDP', obs: [['2024', (v as number) - 0.4], ['2025', v as number]], measure: { kind: 'debt_by_maturity', signed: false, additive_parts_of: 'fr.debt_by_maturity', scale: 'interval', bucket: { order, label } } })
    ds(p, `ds.it.${m}`, { entity: 'Italy', geo: 'IT', metric: m as string, unit: '% of GDP', obs: [['2025', (v as number) + 3]], measure: { kind: 'debt_by_maturity', signed: false, additive_parts_of: 'it.debt_by_maturity', scale: 'interval', bucket: { order, label } } })
  })
  return p
}
const ALL = EU.map((g) => `ds.${g.toLowerCase()}.bal`)
const CURVE = TENORS.map((t) => `ds.ea.yc_all_y${t}`)
const BUCKETS = ['rmd_le1', 'rmd_1_5', 'rmd_5_10', 'rmd_10_30', 'rmd_gt30'].map((m) => `ds.fr.${m}`)
const S = (family: VizSpec['family'], view: VizSpec['view']): VizSpec => ({ schema: VIZ_SCHEMA, id: 'viz_t', title: 'T', family, view, missing: 'gap' })
const CASES: [string, VizSpec][] = [
  ['yield_curve', S('yield_curve', { datasets: [...CURVE, ...TENORS.map((t) => `ds.ea.yc_aaa_y${t}`)], transform: 'curve', at: '2026-09' })],
  ['maturity ladder', S('column', { datasets: BUCKETS, transform: 'buckets' })],
  ['range', S('range', { datasets: ALL.slice(0, 8), transform: 'range' })],
  ['box', S('box', { datasets: ALL, transform: 'distribution', between: ['2023', '2025'] })],
  ['histogram', S('histogram', { datasets: ALL, transform: 'histogram' })],
  ['heatmap', S('heatmap', { datasets: ['ds.fr.debt', 'ds.fr.deficit', 'ds.fr.interest'], transform: 'sensitivity' })],
]
async function compose(spec: VizSpec) {
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  const proposal = { key: spec.family, kicker: 'K', title: 'T', subtitle: 'S', viz: spec }
  const r = s.exec({ kind: 'slide.compose', proposal })
  if (r.warnings) expect(s.exec({ kind: 'slide.compose', proposal, accept: r.warnings.map((w) => w.code) }).ok).toBe(true)
  else expect(r.error).toBeUndefined()
  return { s, id: Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0] }
}

describe('the statistics are the standard ones', () => {
  it('quartiles by linear interpolation (Excel QUARTILE.INC) and round equal-width bins', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map((q) => quantile([1, 2, 3, 4, 5, 6, 7, 8], q))).toEqual([1, 2.75, 4.5, 6.25, 8])
    expect(binEdges(BAL)).toEqual([[-10, -8], [-8, -6], [-6, -4], [-4, -2], [-2, 0], [0, 2], [2, 4]])
    expect(binEdges([1, 2, 3, 4])).toEqual([[1, 2], [2, 3], [3, 4]]) // 4 sits on the last edge: in the closed last bin
  })
})

describe.each(CASES)('V4 %s', (name, spec) => {
  it('renders, with integrity OK and a mark per value, and survives save/reopen', async () => {
    const { s, id } = await compose(spec)
    const f = findEl(s.deck, id)!
    expect(f.el.type).toBe(name === 'maturity ladder' ? 'chart' : 'group') // the ladder is a native column chart (editable as a PowerPoint chart)
    const ig = integrity(s.deck, s.project, s.sidecar)
    expect(ig.mismatch).toEqual([])
    const pr = check(s.project, spec)
    expect(ig.points).toBe(pr.series.flatMap((x) => x.values).filter((v) => v != null).length)
    if (name !== 'maturity ladder') expect((render(s.deck, f.index, 1280, s.metrics).nodes.find((n: any) => n.type === 'group') as any).children.length).toBe(readGroup(f.el).children.length)
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    expect(integrity(back.deck, back.project, back.sidecar).mismatch).toEqual([])
  })
})

describe('V4 visuals are faithful by construction', () => {
  const p = P()
  it('a yield curve spaces maturities in proportion to their length', () => {
    const spec = CASES[0]![1], marks = layout(p, spec, check(p, spec), { w: 1200, h: 400 })
    const x = (i: number) => { const m = marks.find((k) => k.name.startsWith(`frr-mark 0 ${i} `))!; return m.box.x + m.box.w / 2 }
    const [x1, x2, x10, x20] = [x(0), x(1), x(5), x(7)] // tenors 1, 2, 10, 20
    expect((x20 - x10) / (x2 - x1)).toBeCloseTo(10, 1) // mark boxes are rounded to 0.1 px
    expect(check(p, spec).series.map((s) => s.name)).toEqual(['all ratings, 2026-09', 'AAA, 2026-09'])
    expect(assess(p, S('yield_curve', { datasets: CURVE.slice(0, 3), transform: 'curve' })).invalid?.code).toBe('few_tenors')
    expect(assess(p, S('line', { datasets: CURVE, transform: 'curve' })).invalid?.reason).toMatch(/drawn as yield_curve/) // an evenly spaced category axis is refused
  })
  it('a maturity ladder is one country in maturity order; its buckets are parts of that country\'s debt only', () => {
    const pr = check(p, CASES[1]![1])
    expect([pr.categories, pr.series[0]!.values]).toEqual([['1 year or less', '1 to 5 years', '5 to 10 years', '10 to 30 years', 'over 30 years'], [14.1, 33.2, 30.6, 31.9, 5.4]])
    expect(assess(p, S('doughnut', { datasets: BUCKETS, transform: 'buckets' })).invalid).toBeNull() // genuine parts of France's debt
    expect(assess(p, S('column', { datasets: [...BUCKETS.slice(0, 2), 'ds.it.rmd_5_10'], transform: 'buckets' })).invalid?.reason).toMatch(/one country/)
    expect(assess(p, S('column', { datasets: BUCKETS.slice(0, 3), transform: 'buckets' })).warnings.map((w) => w.code)).toEqual(['incomplete_buckets'])
  })
  it('a box plot carries every value; too few values are refused, few are flagged', () => {
    const pr = check(p, CASES[3]![1])
    expect([pr.stats, pr.series.length, pr.categories]).toEqual([5, 32, ['2023', '2024', '2025']])
    // 2025: median and quartiles of the 27 balances (Python's statistics.quantiles(method='inclusive') gives the same)
    expect([pr.series[1]!.values[2], pr.series[2]!.values[2], pr.series[3]!.values[2]]).toEqual([-4.25, -2.4, -1.15])
    expect(pr.series[2]!.cells[2]).toMatchObject({ derived: { formula: 'median of 27 values, 2025 (linear interpolation)' } })
    expect(assess(p, S('box', { datasets: ALL.slice(0, 4), transform: 'distribution' })).invalid?.code).toBe('too_few_values')
    expect(assess(p, S('box', { datasets: ALL.slice(0, 7), transform: 'distribution' })).warnings.map((w) => w.code)).toEqual(['few_observations'])
  })
  it('a histogram counts each value once, with the stated edge rule', () => {
    const pr = check(p, CASES[4]![1])
    expect(pr.series[0]!.values).toEqual([1, 1, 6, 7, 6, 3, 3])
    expect(pr.series[0]!.values.reduce<number>((a, v) => a + v!, 0)).toBe(27)
    expect(Object.keys((pr.series[0]!.cells[6] as any).derived.inputs)).toEqual(['DK', 'EL', 'CY']) // 2.8, 2.0 and 3.4 in [2, 4]: 2.0 on the lower edge counts here
    expect(assess(p, S('histogram', { datasets: ALL.slice(0, 12), transform: 'histogram' })).warnings.map((w) => w.code)).toEqual(['few_observations'])
  })
  it('a range needs three periods per entity', () => {
    expect(assess(p, S('range', { datasets: ALL.slice(0, 3), transform: 'range', between: ['2024', '2025'] })).invalid?.code).toBe('short_range')
    const pr = check(p, CASES[2]![1])
    expect([pr.series[0]!.values[0], pr.series[1]!.values[0], pr.series[2]!.values[0]]).toEqual([-5.3, -4.5, -4.5]) // Belgium: lowest, highest, 2025
  })
  it('the sensitivity grid is the stated arithmetic on verified inputs, with its assumptions on the visual', () => {
    const spec = CASES[5]![1], pr = check(p, spec), G = pr.grid!
    const d0 = p.datasets['ds.fr.debt']!.observations.find((o) => o.date === '2025')!.value!
    const pb = p.datasets['ds.fr.deficit']!.observations.find((o) => o.date === '2025')!.value! + p.datasets['ds.fr.interest']!.observations.find((o) => o.date === '2025')!.value!
    let d = d0; for (let k = 0; k < 5; k++) d = (d * 1.03) / 1.02 - pb
    expect([G.start, G.primary, pr.series[1]!.values[1]]).toEqual([d0, Number(pb.toFixed(6)), Number(d.toFixed(6))]) // i = 3%, g = 2%
    expect(pr.label).toBe('Debt ratio in 2030, France: interest and growth assumptions')
    expect((pr.series[0]!.cells[0] as any).derived.formula).toMatch(/i = 2% and g = 1% are assumptions/)
    const notes = layout(p, spec, pr, { w: 1200, h: 400 }).filter((m) => m.name.startsWith('frr-note')).map((m: any) => m.text).join(' ')
    expect(notes).toMatch(/^Scenario arithmetic, not a forecast/)
    expect(assess(p, S('heatmap', { datasets: ['ds.fr.debt', 'ds.de.deficit', 'ds.fr.interest'], transform: 'sensitivity' })).invalid?.reason).toMatch(/one country's debt, balance and interest/)
    expect(assess(p, S('heatmap', { ...spec.view, datasets: spec.view.datasets, transform: 'sensitivity', params: { years: 15 } } as any)).warnings.map((w) => w.code)).toEqual(['long_horizon'])
  })
  it('the recommender picks them by intent', () => {
    const dist = recommend(p, { intent: 'distribution', datasets: ALL })
    expect([dist.recommended!.key, dist.candidates.find((c) => c.key === 'histogram:histogram')!.state]).toEqual(['box:distribution', 'valid'])
    expect(dist.recommended!.why).toBe('The spread of 27 values in 2025: box for the middle half, line for the median, every value as a dot.')
    expect(recommend(p, { intent: 'curve', datasets: CURVE, between: ['2025-09', '2026-09'] }).recommended!.why).toBe('Spot yields by maturity on a proportional tenor axis (9 maturities, 2025-09 and 2026-09).')
    expect(recommend(p, { intent: 'maturity', datasets: BUCKETS }).recommended!.key).toBe('column:buckets')
    const sens = recommend(p, { intent: 'sensitivity', datasets: ['ds.fr.debt', 'ds.fr.deficit', 'ds.fr.interest'], params: { years: 3, rates: [2, 4], growth: [1, 3] } })
    expect([sens.recommended!.key, sens.recommended!.spec!.view.params]).toEqual(['heatmap:sensitivity', { years: 3, rates: [2, 4], growth: [1, 3] }])
  })
})

// node globals without @types/node (the client package doesn't depend on Node types)
it.runIf((globalThis as any).process?.env?.WRITE_FIXTURES)('writes a saved deck with V4 visuals for the server checks', async () => {
  const { writeFileSync } = await import('node:fs' as string)
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  for (const [name, spec] of CASES) {
    const proposal = { key: name, kicker: 'K', title: name, subtitle: 'S', viz: { ...spec, id: `viz_${name.replace(/[^a-z]/g, '')}` } }
    const r = s.exec({ kind: 'slide.compose', proposal })
    if (r.warnings) expect(s.exec({ kind: 'slide.compose', proposal, accept: r.warnings.map((w) => w.code) }).ok).toBe(true)
    else expect(r.error).toBeUndefined()
  }
  expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  writeFileSync(new URL('../../../server/tests/fixtures/structures-bundle.json', import.meta.url), JSON.stringify(await s.toBundle()))
  // the client's projection of each case, for the server's parity test
  const p = P(), cases = [...CASES, ['box (one period)', S('box', { datasets: ALL, transform: 'distribution' })] as [string, VizSpec],
    ['heatmap (assumptions)', S('heatmap', { datasets: ['ds.fr.debt', 'ds.fr.deficit', 'ds.fr.interest'], transform: 'sensitivity', params: { years: 3, rates: [1.5, 4], growth: [0.5, 2.5, 3] } })] as [string, VizSpec],
    ['yield_curve (two dates)', S('yield_curve', { datasets: CURVE, transform: 'curve', between: ['2025-09', '2026-09'] })] as [string, VizSpec]]
  const expected = cases.map(([name, spec]) => { const pr = check(p, spec); return { name, spec, expected: { shape: pr.shape, categories: pr.categories, series: pr.series.map((x) => x.values) } } })
  writeFileSync(new URL('../../../server/tests/fixtures/structures-parity.json', import.meta.url), JSON.stringify({ project: p, cases: expected }))
})
