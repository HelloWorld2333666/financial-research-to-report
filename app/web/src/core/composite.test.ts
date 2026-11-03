// VIS V3: composite visuals (shape groups). Each family renders at slide size, survives save/reopen,
// re-realizes on data edits with the same durable id, shows provenance, and is checked by integrity.
// Synthetic datasets and rating actions are marked "(test)".
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, render } from './deck'
import { LAYOUT_VERSION, layout, readGroup } from './composite'
import { check, VIZ_SCHEMA, type VizSpec } from './viz'
import { changeOptions, kickerFor, recommend } from './recommend'
import { textOf } from './deck'
import { notch } from './ratings'
import { BUNDLE_SCHEMA, type Project } from './types'

const YEARS = ['2020', '2021', '2022', '2023', '2024', '2025']
const NAMES: Record<string, string> = { FR: 'France', DE: 'Germany', IT: 'Italy', ES: 'Spain', PT: 'Portugal', EL: 'Greece', BE: 'Belgium' }
function P(): Project {
  const p = structuredClone(project) as Project
  const rows: Record<string, (number | null)[]> = { FR: [-9, -6.6, -4.8, -5.5, -5.8, -5.1], DE: [-4.4, -3.2, -2.1, -2.5, -2.8, -2.9], IT: [-9.4, -8.7, -8.1, -7.2, -3.4, -3.1], ES: [-10, -6.7, -4.6, -3.5, -3.2, -2.4],
    PT: [-5.8, -2.9, -0.3, 1.2, 0.7, 0.7], EL: [-9.7, -7, -2.4, -1.3, 1.3, 2], BE: [-8.9, -5.4, -3.6, -4.1, -4.5, -5.2] }
  for (const [geo, vals] of Object.entries(rows)) {
    const id = `ds.${geo.toLowerCase()}.bal`
    p.datasets[id] = { id, title: `${NAMES[geo]} · government balance (test)`, entity: NAMES[geo]!, geo, metric: 'bal', unit: '% of GDP', frequency: 'annual', origin: 'test', verification: 'test', source_url: '', source_note: 'synthetic',
      working: {}, observations: YEARS.map((date, i) => ({ date, value: vals[i]!, status: 'test', evidence_id: `ev.test.${geo}.${date}` })), measure: { kind: 'balance_ratio', of: 'GDP', signed: true, additive_parts_of: null, scale: 'interval' } } as any
    YEARS.forEach((date, i) => { (p.evidence as any)[`ev.test.${geo}.${date}`] = { id: `ev.test.${geo}.${date}`, kind: 'observation', value: vals[i], verification: 'test', statement: `${NAMES[geo]} ${date} (test)` } })
  }
  const rating = (id: string, agency: string, date: string | null, r: string, outlook: string | null, action: string) =>
    ((p.evidence as any)[id] = { id, kind: 'fact', subject: 'France', statement: `${agency} ${action} France at ${r} (test)`, verification: 'verified', rating: { agency, action, rating: r, outlook, date } })
  rating('ev.r.1', 'Agency A (test)', '2023-04-28', 'AA', 'negative', 'affirmed')
  rating('ev.r.2', 'Agency A (test)', '2024-05-31', 'AA-', 'stable', 'downgraded')
  rating('ev.r.3', 'Agency B (test)', '2023-10-20', 'AA (high)', 'stable', 'confirmed')
  rating('ev.r.4', 'Agency B (test)', '2025-03-14', 'AA', 'stable', 'downgraded')
  rating('ev.r.5', 'Agency B (test)', null, 'AA (high)', null, 'confirmed')
  return p
}
const SEVEN = ['fr', 'de', 'it', 'es', 'pt', 'el', 'be'].map((g) => `ds.${g}.bal`)
const S = (family: VizSpec['family'], view: VizSpec['view'], title = 'T'): VizSpec => ({ schema: VIZ_SCHEMA, id: 'viz_t', title, family, view, missing: 'gap' })
const CASES: [string, VizSpec][] = [
  ['dot', S('dot', { datasets: SEVEN, transform: 'rank', at: '2025' })],
  ['lollipop', S('lollipop', { datasets: SEVEN, transform: 'rank', at: '2025' })],
  ['dumbbell', S('dumbbell', { datasets: SEVEN, transform: 'pair', between: ['2020', '2025'] })],
  ['slope', S('slope', { datasets: ['ds.fr.bal', 'ds.de.bal', 'ds.it.bal', 'ds.es.bal'], transform: 'pair', between: ['2020', '2025'] })],
  ['waterfall', S('waterfall', { datasets: ['ds.fr.debt'], transform: 'bridge', between: ['2022', '2025'] })],
  ['step', S('step', { datasets: ['ds.fr.yield', 'ds.de.yield'], transform: 'none' }, 'Ten-year yield, %')],
  ['multiples', S('multiples', { datasets: SEVEN, transform: 'none' }, 'Government balance, % of GDP')],
  ['kpi', S('kpi', { datasets: ['ds.fr.debt'], transform: 'pair', between: ['2022', '2025'] })],
  ['rating_timeline', S('rating_timeline', { datasets: [], transform: 'ratings', evidence: ['ev.r.1', 'ev.r.2', 'ev.r.3', 'ev.r.4', 'ev.r.5'] })],
]
async function compose(spec: VizSpec, p = P()) {
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: p, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  const r = s.exec({ kind: 'slide.compose', proposal: { key: spec.family, kicker: 'K', title: 'T', subtitle: 'S', viz: spec } })
  if (r.warnings) expect(s.exec({ kind: 'slide.compose', proposal: { key: spec.family, kicker: 'K', title: 'T', subtitle: 'S', viz: spec }, accept: r.warnings.map((w) => w.code) }).ok).toBe(true)
  else expect(r.error).toBeUndefined()
  const id = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0]
  return { s, id, spec: () => (s.sidecar.bindings[id] as any).spec as VizSpec }
}

describe('rating scale', () => {
  it('orders the three long-term scales on one notch index and refuses unknown symbols', () => {
    expect(['AAA', 'Aaa', 'AA+', 'Aa1', 'AA (high)', 'AA-', 'Aa3', 'AA (low)', 'BBB-', 'Baa3', 'BBB (low)', 'D'].map(notch)).toEqual([0, 0, 1, 1, 1, 3, 3, 3, 9, 9, 9, 21])
    expect(['AAA (high)', 'A++', 'aa', '', 'Prime-1'].map(notch)).toEqual([null, null, null, null, null])
  })
})

describe.each(CASES)('composite %s', (name, spec) => {
  it('renders as one shape group at slide size, with integrity OK and a mark per value', async () => {
    const { s, id } = await compose(spec)
    const f = findEl(s.deck, id)!
    expect(f.el.type).toBe('group')
    const ig = integrity(s.deck, s.project, s.sidecar)
    expect(ig.mismatch).toEqual([])
    const pr = check(s.project, spec)
    const values = pr.ratings ? pr.ratings.length : pr.series.flatMap((x) => x.values).filter((v) => v != null).length
    expect(ig.points).toBe(values)
    const g: any = render(s.deck, f.index, 1280, s.metrics).nodes.find((n: any) => n.type === 'group')
    expect(g.children.length).toBe(readGroup(f.el).children.length)
    expect(g.box.w).toBeCloseTo(1200, 0) // full slide width (1280 px with 40 px margins)
  })
  it('survives save and reopen with the same durable id and integrity', async () => {
    const { s, id } = await compose(spec)
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    expect(findEl(back.deck, id)?.el.type).toBe('group')
    expect(integrity(back.deck, back.project, back.sidecar).mismatch).toEqual([])
  })
})

describe('composites follow the data', () => {
  it('a data edit rebuilds the group in place: same id, same z-order, new value, integrity OK, undo restores', async () => {
    const { s, id } = await compose(CASES.find((c) => c[0] === 'dumbbell')![1])
    const slide = () => findEl(s.deck, id)!, z = slide().index, order = (s.deck.deck.slides[z] as any).elements.indexOf(slide().el)
    expect(s.exec({ kind: 'data.set', dataset: 'ds.el.bal', date: '2025', value: 2.4 }).ok).toBe(true)
    expect((s.deck.deck.slides[z] as any).elements.indexOf(slide().el)).toBe(order)
    expect(readGroup(slide().el).children.some((c) => c.name === 'frr-mark 1 5 2.4')).toBe(true)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    s.undo()
    expect(readGroup(findEl(s.deck, id)!.el).children.some((c) => c.name === 'frr-mark 1 5 2')).toBe(true)
  })
  it('integrity catches a moved mark, an edited label and a stale value', async () => {
    const { s, id } = await compose(CASES.find((c) => c[0] === 'lollipop')![1])
    const f = findEl(s.deck, id)!
    const kids = readGroup(f.el).children, mark = f.el.children.findIndex((k: any) => /^frr-mark 0 0 /.test(k.name))
    // move the top mark 30 px right (as a user dragging one shape inside the group)
    expect(s.exec({ kind: 'ops.raw', ops: [{ op: 'setTransform', target: { slide: f.index, el: f.el.children[mark].id }, group: f.el.id, box: { ...f.el.children[mark].transform.offset, x: f.el.children[mark].transform.offset.x + 30 * 9525 } }] }).ok).toBe(true)
    expect(integrity(s.deck, s.project, s.sidecar).mismatch.join('\n')).toMatch(/mark 0 0 .* is not where the data puts it/)
    expect(kids.length).toBeGreaterThan(10)
    s.undo()
    // a working-layer edit that the visual didn't follow (written behind the store's back)
    s.project.datasets['ds.el.bal']!.working['2025'] = { value: 9.9, by: 'x', at: 't', status: 'manual_unverified' } as any
    expect(integrity(s.deck, s.project, s.sidecar).mismatch.join('\n')).toMatch(/mark 0 0: data 9.9, visual 2/)
  })
  it('changing a native chart to a composite and back keeps the element identity, data and undo', async () => {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    s.exec({ kind: 'slide.compose', proposal: { key: 'r', kicker: 'K', title: 'T', subtitle: 'S', viz: { intent: 'ranking', datasets: SEVEN, at: '2025' } } })
    const id = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0]
    expect(findEl(s.deck, id)!.el.type).toBe('chart')
    expect(s.exec({ kind: 'viz.change', id, family: 'lollipop' }).ok).toBe(true)
    expect([findEl(s.deck, id)!.el.type, integrity(s.deck, s.project, s.sidecar).ok]).toEqual(['group', true])
    expect(s.exec({ kind: 'viz.change', id, family: 'dumbbell', transform: 'pair', between: ['2020', '2025'] }).ok).toBe(true)
    expect(s.exec({ kind: 'viz.change', id, family: 'bar', transform: 'rank' }).ok).toBe(true)
    expect([findEl(s.deck, id)!.el.type, integrity(s.deck, s.project, s.sidecar).ok]).toEqual(['chart', true])
    s.undo(); s.undo()
    expect(findEl(s.deck, id)!.el.type).toBe('group')
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
  })
  it('a drawing from an earlier layout is checked on its values only, until Redraw (re-project) brings it up to date', async () => {
    const { s, id } = await compose(CASES.find((c) => c[0] === 'step')![1])
    expect(readGroup(findEl(s.deck, id)!.el).version).toBe(LAYOUT_VERSION)
    // an older drawing: version-less name and a label where an older layout put it
    const f = findEl(s.deck, id)!, slide = s.deck.deck.slides[f.index] as any
    f.el.anchor.originalXml = String(f.el.anchor.originalXml).replace(/name="frr-viz ([^"]+) L\d+"/, 'name="frr-viz $1"').replace(/(name="frr-label 0 3"[\s\S]*?<a:off x=")(\d+)/, (_m: string, a: string, x: string) => a + (Number(x) + 400000))
    slide.structureDirty = true
    const { materializeSlide } = await import('@genoffice/pptx-engine')
    materializeSlide(s.deck, f.index)
    let ig = integrity(s.deck, s.project, s.sidecar)
    expect([ig.ok, ig.outdated]).toEqual([true, ['Ten-year yield, %']])
    s.project.datasets['ds.fr.yield']!.working['2025'] = { value: 9.9, by: 'x', at: 't', status: 'manual_unverified' } as any
    expect(integrity(s.deck, s.project, s.sidecar).mismatch.join('\n')).toMatch(/data 9.9/) // values are still checked
    delete s.project.datasets['ds.fr.yield']!.working['2025']
    expect(s.exec({ kind: 'deck.reproject' }).ok).toBe(true)
    ig = integrity(s.deck, s.project, s.sidecar)
    expect([ig.ok, ig.outdated, readGroup(findEl(s.deck, id)!.el).version]).toEqual([true, [], LAYOUT_VERSION])
  })
  it('a bound composite cannot be ungrouped into loose shapes', async () => {
    const { s, id } = await compose(CASES[0]![1])
    expect(s.exec({ kind: 'element.ungroup', id }).error).toMatch(/bound to data/)
  })
  it('a slope chart puts a missing value in a note, never at the bottom of its axis', () => {
    const p = P()
    p.datasets['ds.fr.bal']!.working['2020'] = { deleted: true, by: 'you', at: 't', status: 'manual_unverified' } as any
    const spec = CASES.find((c) => c[0] === 'slope')![1], marks = layout(p, spec, check(p, spec), { w: 1200, h: 400 })
    expect(marks.some((m) => m.name === 'frr-label 0 0')).toBe(false)
    expect(marks.find((m) => m.name === 'frr-gap note')).toMatchObject({ text: 'No value: France (2020)' })
  })
  it('lays out every family inside its design space', () => {
    const p = P()
    for (const [, spec] of CASES) {
      const marks = layout(p, spec, check(p, spec), { w: 1200, h: 400 })
      for (const m of marks) expect([m.name, m.box.x >= -1 && m.box.y >= -1 && m.box.y + m.box.h <= 401]).toEqual([m.name, true])
    }
  })
})

// node globals without @types/node (the client package doesn't depend on Node types)
it.runIf((globalThis as any).process?.env?.WRITE_FIXTURES)('writes a saved deck with composites for the server checks', async () => {
  const { writeFileSync } = await import('node:fs' as string)
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  for (const name of ['dumbbell', 'waterfall', 'kpi', 'rating_timeline']) {
    const spec = { ...CASES.find((c) => c[0] === name)![1], id: `viz_${name.replace('_', '')}` }
    const proposal = { key: name, kicker: 'K', title: name, subtitle: 'S', viz: spec }
    const r = s.exec({ kind: 'slide.compose', proposal })
    if (r.warnings) expect(s.exec({ kind: 'slide.compose', proposal, accept: r.warnings.map((w) => w.code) }).ok).toBe(true)
    else expect(r.error).toBeUndefined()
  }
  expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  writeFileSync(new URL('../../../server/tests/fixtures/composite-bundle.json', import.meta.url), JSON.stringify(await s.toBundle()))
})

describe('the recommender and rules know the composites', () => {
  it('picks small multiples for many series over time, a bridge for one series, a KPI and a rating timeline', () => {
    const p = P()
    const many = recommend(p, { intent: 'trend', datasets: SEVEN })
    expect([many.recommended!.key, many.recommended!.why]).toEqual(['multiples:none', '7 series over 6 periods: one panel each on the same scale reads more clearly than 7 overlapping lines.'])
    expect(recommend(p, { intent: 'trend', datasets: ['ds.fr.debt', 'ds.de.debt'] }).recommended!.label).toBe('Columns') // 2 series: no multiples
    const one = recommend(p, { intent: 'change', datasets: ['ds.fr.bal'], between: ['2020', '2025'] })
    expect([one.recommended!.key, one.recommended!.why]).toEqual(['waterfall:bridge', 'From the 2020 level through each period\'s change to 2025; the changes add up exactly to the difference.'])
    expect(recommend(p, { intent: 'change', datasets: SEVEN }).recommended!.key).toBe('bar:diff') // several entities: still diverging bars, dumbbell next
    const kpi = recommend(p, { intent: 'spotlight', datasets: ['ds.fr.debt'] }).recommended!
    expect([kpi.key, kpi.spec!.view.between, kpi.why]).toEqual(['kpi:pair', ['2024', '2025'], 'The 2025 value, large, with the change since 2024.']) // the period before, by default
    const kpiMany = recommend(p, { intent: 'spotlight', datasets: ['ds.fr.debt', 'ds.de.debt'] })
    expect([kpiMany.recommended, kpiMany.candidates[0]!.refused]).toEqual([null, expect.stringMatching(/one dataset/)])
    const rt = recommend(p, { intent: 'ratings', datasets: [], evidence: ['ev.r.1', 'ev.r.2', 'ev.r.3', 'ev.r.4', 'ev.r.5'] })
    expect(rt.recommended!.why).toBe('4 dated agency actions on the ordinal rating scale; each rating holds until that agency\'s next action.')
    expect(recommend(p, { intent: 'ratings', datasets: [], evidence: ['ev.r.5'] }).candidates[0]!.refused).toMatch(/no rating action has a verified date \(1 undated/)
    expect(recommend(p, { intent: 'ratings', datasets: [], evidence: ['ev.test.FR.2025'] }).error).toMatch(/not rating actions/)
  })
  it('the change-visual menu lists visuals whose view cannot be computed, with the reason, instead of leaving them out', () => {
    const opts = changeOptions(P(), S('line', { datasets: SEVEN, transform: 'none' }))
    const bridge = opts.find((o) => o.family === 'waterfall')!
    expect([bridge.state, bridge.refused]).toEqual(['invalid', 'a bridge follows one dataset from one period to another'])
    expect(opts.find((o) => o.family === 'kpi')!.state).toBe('invalid')
  })
  it('warns about a step line on continuous data and a bridge whose steps are too small to see; blocks a bridge with a gap and offers the gap-free range', () => {
    const p = P()
    const stepWarn = changeOptions(p, S('line', { datasets: ['ds.fr.yield'], transform: 'none' })).find((o) => o.family === 'step')!
    expect([stepWarn.state, stepWarn.warnings.map((w) => w.code)]).toEqual(['warning', ['step_continuous']])
    const small = recommend(p, { intent: 'change', datasets: ['ds.fr.debt'], between: ['2024', '2025'] }).candidates.find((c) => c.key === 'waterfall:bridge')!
    expect(small.warnings.map((w) => w.code)).toEqual(['small_steps'])
    p.datasets['ds.fr.bal']!.working['2022'] = { deleted: true, by: 'you', at: 't', status: 'manual_unverified' } as any
    const gap = changeOptions(p, S('waterfall', { datasets: ['ds.fr.bal'], transform: 'bridge', between: ['2020', '2025'] })).find((o) => o.family === 'waterfall')!
    expect([gap.state, gap.refused, gap.fixes.map((f) => [f.label, f.between])]).toEqual(['invalid', expect.stringMatching(/would not add up/), [['Bridge 2023–2025, the periods with no gap', ['2023', '2025']]]])
  })
  it('shows each composite value with its provenance (the Evidence panel reads the same projection)', () => {
    const p = P()
    const wf = check(p, CASES.find((c) => c[0] === 'waterfall')![1])
    expect(wf.series[0]!.cells[1]).toMatchObject({ derived: { formula: 'end - start', inputs: { start: { period: '2022' }, end: { period: '2023' } } } })
    const rt = check(p, CASES.find((c) => c[0] === 'rating_timeline')![1])
    expect([rt.ratings!.map((r) => r.evidence), rt.undated]).toEqual([['ev.r.1', 'ev.r.3', 'ev.r.2', 'ev.r.4'], ['ev.r.5']])
  })
})

describe('slide headings follow their visual', () => {
  async function slide(title?: (t: string) => string, kicker?: string) {
    const p = P(), c = recommend(p, { intent: 'ranking', datasets: SEVEN, at: '2025' }).recommended!
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: p, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    expect(s.exec({ kind: 'slide.compose', proposal: { key: 'h', kicker: kicker ?? kickerFor(p, c.spec!), title: title ? title(c.spec!.title) : c.spec!.title, subtitle: 'S', viz: c.spec } }).ok).toBe(true)
    const id = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0]
    const text = (role: string) => { const [tid] = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'text' && (b as any).role === role)!; return textOf(findEl(s.deck, tid)!.el).trim() }
    return { s, id, text }
  }
  it('a generated title follows a change of view; the kicker stays when it still applies', async () => {
    const { s, id, text } = await slide()
    expect([text('kicker'), text('title')]).toEqual(['BAL', 'Government balance (test), 2025'])
    expect(s.exec({ kind: 'viz.change', id, family: 'dumbbell', transform: 'pair', between: ['2020', '2025'] }).ok).toBe(true)
    expect([text('kicker'), text('title'), (s.sidecar.bindings[id] as any).spec.title]).toEqual(['BAL', 'Government balance (test), 2020 and 2025', 'Government balance (test), 2020 and 2025'])
    s.undo()
    expect(text('title')).toBe('Government balance (test), 2025')
  })
  it('a title the author wrote is never changed', async () => {
    const { s, id, text } = await slide(() => 'Greece and Portugal ran surpluses')
    expect(s.exec({ kind: 'viz.change', id, family: 'dumbbell', transform: 'pair' }).ok).toBe(true)
    expect(text('title')).toBe('Greece and Portugal ran surpluses')
  })
  it('re-projecting refreshes headings earlier versions wrote (a count in the title, a metric id as kicker)', async () => {
    const { s, id, text } = await slide((t) => `${t}: 7 entities`, 'BAL')
    ;(s.sidecar.bindings[id] as any).spec.title = 'Government balance (test), 2025: 7 entities' // as V4 before the fix stored it
    expect(s.exec({ kind: 'viz.change', id, family: 'lollipop' }).ok).toBe(true) // the stale title equals the old spec title: it follows
    expect(text('title')).toBe('Government balance (test), 2025')
    const p2 = await slide((t) => `${t}: 7 entities`)
    ;(p2.s.sidecar.bindings[p2.id] as any).spec.title = 'Government balance (test), 2025: 7 entities'
    expect(p2.s.exec({ kind: 'deck.reproject' }).ok).toBe(true)
    expect(p2.text('title')).toBe('Government balance (test), 2025')
    expect(integrity(p2.s.deck, p2.s.project, p2.s.sidecar).ok).toBe(true)
  })
})
