// Gate C: recipes R1 (tinted figures rail), R2 (ranked bars on a panel with rank numerals), R3 (shaded period and one
// callout) and R9 (agenda, divider) on the France fixture: valid, bound to evidence, verified by integrity, native
// objects, QA clean; the recipe table is consistent; navigation numerals are exempt from figure checks and nothing else.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import recipes from './design/recipes.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, slideList, textOf } from './deck'
import { BUNDLE_SCHEMA, type Project } from './types'
import { balanceRank, balanceTrend, debtTrend, navigation } from './design/editorial'
import { qaSlide } from './design/qa'
import { planSlide } from './design/planner'
import { designTexts, validateDesign, type CompositionKind } from './design/spec'
import { figures } from './evidence'

const P = () => structuredClone(project) as unknown as Project
function seven(p: Project) {
  for (const [g, name, k] of [['IT', 'Italy', 0.6], ['ES', 'Spain', 0.45], ['NL', 'Netherlands', 0.3], ['BE', 'Belgium', 1.05]] as const) {
    const src = p.datasets['ds.fr.deficit']!, id = `ds.${g.toLowerCase()}.deficit`
    p.datasets[id] = { ...structuredClone(src), id, geo: g, entity: name, observations: src.observations.map((o) => ({ ...o, value: o.value == null ? null : Math.round(o.value * k * 10) / 10, evidence_id: `${o.evidence_id}.${g}` })) }
    for (const o of src.observations) p.evidence[`${o.evidence_id}.${g}`] = { ...p.evidence[o.evidence_id!], id: `${o.evidence_id}.${g}`, value: Math.round(o.value! * k * 10) / 10 }
  }
  return p
}
const store = (p: Project) => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: p, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
const pick = (c: { label: string; design: any }[], re: RegExp) => c.find((x) => re.test(x.label))!
const CASES: [string, (p: Project) => any][] = [
  ['R1', (p) => pick(debtTrend(p), /\(R1\)/)],
  ['R2', (p) => pick(balanceRank(p), /\(R2\)/)],
  ['R3', (p) => balanceTrend(p)[0]],
  ['R9 agenda', (p) => navigation(p, 'agenda', 1)[0]],
  ['R9 divider', (p) => navigation(p, 'divider', 1)[0]],
]
const KINDS: CompositionKind[] = ['rail', 'statement', 'wide', 'bands', 'lead_panel', 'agenda', 'divider', 'columns']

describe('Gate C recipe table', () => {
  it('has unique ids, known compositions and rules for every recipe', () => {
    const ids = recipes.recipes.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of recipes.recipes) {
      expect(KINDS, r.id).toContain(r.composition.kind)
      expect(r.rules.length, r.id).toBeGreaterThan(0)
      expect(r.archetypes.length, r.id).toBeGreaterThan(0)
    }
  })
  it('every recipe candidate names its recipe, and that recipe exists', () => {
    const p = seven(P())
    for (const [name, make] of CASES) expect(ids(), name).toContain(make(p).design.layout.composition.recipe)
    function ids() { return recipes.recipes.map((r) => r.id) }
  })
})

describe('Gate C recipe candidates', () => {
  it('are valid, with every figure bound to evidence', () => {
    const p = seven(P())
    for (const [name, make] of CASES) {
      const c = make(p)
      expect(c.problems, name).toEqual([])
      for (const { where, t } of designTexts(c.design)) expect(figures(t.text).length, `${name} ${where}`).toBeLessThanOrEqual((t.numbers ?? []).length)
    }
  })
  it('R2 ranks run in the headline\'s direction: the focus numeral is the rank the headline states', () => {
    const p = seven(P()), c = pick(balanceRank(p), /\(R2\)/)
    expect(c.design.objects.find((o: any) => o.id === 'headline').text.text).toMatch(/second-largest/)
    expect(c.design.objects.find((o: any) => o.kind === 'viz').viz.view.order).toBe('asc')
  })
  it('R3 states only what the data show, and refuses data it was not written for', () => {
    const p = P(), h = balanceTrend(p)[0]!.design.objects.find((o: any) => o.id === 'headline') as any
    expect(h.text.text).toBe("France's deficit stopped narrowing after 2022 and stayed wider than Germany's every year")
    const q = P()
    for (const o of q.datasets['ds.fr.deficit']!.observations) if (o.date === '2025') { o.value = -4.0; q.evidence[o.evidence_id!] = { ...q.evidence[o.evidence_id!], value: -4.0 } as any }
    expect(() => balanceTrend(q)).toThrow(/stopped narrowing/) // 2025 narrower than 2022: the sentence would be false
  })
  it('navigation slides refuse figures, charts and out-of-range sections', () => {
    const p = P(), d = navigation(p, 'divider', 0)[0]!.design
    d.objects.push({ id: 'k', kind: 'kpi', role: 'kpi', value: { text: '5%' }, label: 'x' } as any)
    expect(validateDesign(p, d).join(' ')).toMatch(/no charts, tables or figures/)
    const d2 = navigation(p, 'divider', 0)[0]!.design
    ;(d2.objects.find((o: any) => o.id === 'standfirst') as any).text.text = 'Debt reached 115.7% of GDP'
    expect(validateDesign(p, d2).join(' ')).toMatch(/115\.7.*no evidence/)
    expect(() => navigation(p, 'agenda', 5)).toThrow()
  })
})

describe('Gate C slides in the deck', () => {
  it('build native objects that integrity verifies; QA finds nothing; no pictures', async () => {
    for (const [name, make] of CASES) {
      const s = await store(seven(P())), d = make(s.project).design
      const r = s.exec({ kind: 'design.apply', design: d }, { actor: 'ai' })
      expect(r.ok, `${name}: ${r.error}`).toBe(true)
      const ig = integrity(s.deck, s.project, s.sidecar)
      expect(ig.ok, `${name}: ${ig.mismatch.join('; ')}`).toBe(true)
      expect(ig.unsourced, name).toBe(0)
      expect(qaSlide(s, 0, s.metrics).map((f) => `${f.level}:${f.code}`), name).toEqual([])
      const els = s.sidecar.designs![slideList(s.deck)[0]!.id]!.elements
      for (const id of Object.values(els)) expect(findEl(s.deck, id)!.el.type, `${name} ${id}`).not.toBe('picture')
      if (name.startsWith('R9')) expect(Object.values(s.sidecar.bindings).some((b: any) => b.role === 'nav')).toBe(true)
    }
  })
  it('a navigation numeral edited into a figure is checked again', async () => {
    const s = await store(P()), d = navigation(s.project, 'divider', 1)[0]!.design
    s.exec({ kind: 'design.apply', design: d }, { actor: 'ai' })
    const els = s.sidecar.designs![slideList(s.deck)[0]!.id]!.elements, id = els['number']!
    expect(textOf(findEl(s.deck, id)!.el)).toBe('02')
    const r = s.exec({ kind: 'text.set', id, text: '02: 5.1%' }, { actor: 'user' })
    expect(r.ok, r.error).toBe(true)
    expect(integrity(s.deck, s.project, s.sidecar).unsourced).toBeGreaterThan(0)
  })
})

describe('Gate D fixes: what the local model actually sent', () => {
  it('a ranking with an explicit peer list gets the editorial designs, the requested recipe first', () => {
    const p = seven(P())
    const r = planSlide(p, { purpose: 'comparison', metric: 'deficit', focus: 'FR', peers: ['AT', 'BE', 'DE', 'ES', 'IT', 'NL'], recipe: 'ranked-bars' })
    expect(r.error).toBeUndefined()
    expect(r.candidates[0]!.design.layout.composition?.recipe).toBe('ranked-bars')
    expect(r.candidates.every((c) => c.design.layout.family === 'composed')).toBe(true)
  })
  it('a recipe the data cannot carry is reported, and the closest designs still follow', () => {
    const r = planSlide(seven(P()), { purpose: 'trend', metric: 'debt', focus: 'FR', peers: ['DE', 'IT'], recipe: 'trend-annotated' })
    expect(r.notes.join(' ')).toMatch(/No "trend-annotated" design fits this data/)
    expect(r.candidates.length).toBeGreaterThan(0)
  })
  it('a deficit trend request reaches the R3 brief', () => {
    const r = planSlide(P(), { purpose: 'trend', metric: 'deficit', focus: 'FR', peers: ['DE'], recipe: 'trend-annotated' })
    expect(r.candidates[0]!.design.layout.composition?.recipe).toBe('trend-annotated')
  })
})

describe('Gate E proposals (burgundy, columns composition)', () => {
  it('are valid, bound to evidence, verified by integrity, native objects only, QA clean', async () => {
    const { debtCommentary, balanceTable, riskMatrix } = await import('./design/proposals')
    for (const [name, make] of [['debt', debtCommentary], ['balance', balanceTable], ['risk', riskMatrix]] as const) {
      const s = await store(seven(P())), c = (make as any)(s.project)
      expect(c.problems, name).toEqual([])
      const r = s.exec({ kind: 'design.apply', design: c.design }, { actor: 'ai' })
      expect(r.ok, `${name}: ${r.error}`).toBe(true)
      const ig = integrity(s.deck, s.project, s.sidecar)
      expect(ig.ok, `${name}: ${ig.mismatch.join('; ')}`).toBe(true)
      expect(ig.unsourced, name).toBe(0)
      expect(qaSlide(s, 0, s.metrics).filter((f) => f.level === 'error').map((f) => f.message), name).toEqual([])
      const els = s.sidecar.designs![slideList(s.deck)[0]!.id]!.elements
      for (const id of Object.values(els)) expect(findEl(s.deck, id)!.el.type, `${name} ${id}`).not.toBe('picture')
    }
  })
  it('a lead-in carries words only', async () => {
    const { debtCommentary } = await import('./design/proposals')
    const p = P(), d = debtCommentary(p).design
    ;(d.objects.find((o: any) => o.id === 'c1') as any).text.lead = 'Up 4.3 pp.'
    expect(validateDesign(p, d).join(' ')).toMatch(/lead-in carries words only/)
  })
})

describe('Gate E knowledge: new techniques render as native, verified objects', () => {
  it('dashboard (delta, benchmark list, flags, divider, motif), executive split and debt-dynamics diagram', async () => {
    const { debtDashboard, execSummary, debtDynamics } = await import('./design/proposals')
    for (const [name, make] of [['dashboard', debtDashboard], ['summary', execSummary], ['dynamics', debtDynamics]] as const) {
      const s = await store(seven(P())), c = (make as any)(s.project)
      expect(c.problems, name).toEqual([])
      const r = s.exec({ kind: 'design.apply', design: c.design }, { actor: 'ai' })
      expect(r.ok, `${name}: ${r.error}`).toBe(true)
      const ig = integrity(s.deck, s.project, s.sidecar)
      expect(ig.ok, `${name}: ${ig.mismatch.join('; ')}`).toBe(true)
      expect(ig.unsourced, name).toBe(0)
      expect(qaSlide(s, 0, s.metrics).filter((f) => f.level === 'error').map((f) => f.message), name).toEqual([])
      // pictures exist only as decoration (motifs), bound as decor and described with their provenance
      const slide = s.deck.deck.slides[0]!
      const pics = (slide.elements as any[]).filter((el) => el.type === 'picture')
      expect(pics.length, `${name}: motif pictures`).toBe(name === 'dynamics' ? 0 : 1)
      for (const el of pics) {
        expect(Object.values(s.sidecar.bindings).some((b: any) => b.kind === 'decor'), name).toBe(true)
        expect(String(el.descr ?? ''), name).toMatch(/self-authored/)
      }
    }
  })
  it('diagram edge labels carry words only; the planner builds a Gate E recipe on request', async () => {
    const { debtDynamics } = await import('./design/proposals')
    const p = P(), d = debtDynamics(p).design
    d.layout.composition!.params!.diagram!.edges[0]!.label = 'adds 0.3 pp'
    expect(validateDesign(p, d).join(' ')).toMatch(/edge label carries words only/)
    const r = planSlide(P(), { purpose: 'risk', focus: 'FR', peers: ['DE'], recipe: 'causal-chain' })
    expect(r.candidates[0]!.design.layout.composition?.recipe).toBe('causal-chain')
    const t = planSlide(P(), { purpose: 'trend', metric: 'debt', focus: 'FR', peers: ['DE', 'IT'], recipe: 'multi-module' })
    expect(t.candidates[0]!.design.layout.composition?.recipe).toBe('multi-module')
  })
})
