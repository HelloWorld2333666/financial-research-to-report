// PD1: design specification, planner, layout, editable build, ownership, QA, persistence (France fixture data).
import { describe, expect, it } from 'vitest'
import { HeuristicMetrics } from '@genoffice/pptx-render'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, slideList, textOf } from './deck'
import { effectiveObs } from './evidence'
import { BUNDLE_SCHEMA, type Project } from './types'
import { planSlide } from './design/planner'
import { validateDesign, type SlideDesign } from './design/spec'
import { layoutDesign, H, W } from './design/layout'
import { PROFILES } from './design/profiles'
import { qaDeck, qaSlide } from './design/qa'

const P = () => structuredClone(project) as unknown as Project
const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: P(), sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
const box = (s: Store, id: string) => { const o = findEl(s.deck, id)!.el.transform.offset; return [o.x, o.y, o.cx, o.cy].map((v: number) => Math.round(v / 9525)) }
const elementsOf = (s: Store) => s.sidecar.designs![slideList(s.deck)[0]!.id]!.elements
/** Test-only: four more countries with the fixture's deficit series shifted, so a seven-country comparison can be planned. */
function withSevenCountries(p: Project) {
  for (const [g, name, k] of [['IT', 'Italy', 0.6], ['ES', 'Spain', 0.4], ['NL', 'Netherlands', -0.5], ['BE', 'Belgium', 0.9]] as const) {
    const src = p.datasets['ds.fr.deficit']!, id = `ds.${g.toLowerCase()}.deficit`
    p.datasets[id] = { ...structuredClone(src), id, geo: g, entity: name, observations: src.observations.map((o) => ({ ...o, value: o.value == null ? null : Math.round(o.value * k * 10) / 10, evidence_id: `${o.evidence_id}.${g}` })) }
    for (const o of src.observations) p.evidence[`${o.evidence_id}.${g}`] = { ...p.evidence[o.evidence_id!], id: `${o.evidence_id}.${g}`, value: Math.round(o.value! * k * 10) / 10 }
  }
  return p
}

describe('PD1 planner and validator', () => {
  it('plans a debt trend as genuinely different, valid designs with every figure bound to evidence', () => {
    const p = P(), r = planSlide(p, { purpose: 'trend', metric: 'debt', focus: 'FR' })
    expect(r.error).toBeUndefined()
    expect(r.candidates.length).toBeGreaterThanOrEqual(2)
    for (const c of r.candidates) expect(c.problems).toEqual([])
    expect(new Set(r.candidates.map((c) => JSON.stringify(c.design.layout))).size).toBe(r.candidates.length)
    expect(new Set(r.candidates.map((c) => c.design.layout.family))).toEqual(new Set(['analytical_hero', 'comparative']))
    const d = r.candidates[0]!.design
    expect(d.claim.text).toContain('111.4%')
    expect(d.claim.text).toContain('115.7% of GDP')
    expect(d.claim.numbers!.every((n) => n.evidence || n.derivation)).toBe(true)
    expect(d.rationale).toHaveLength(8) // the eight planning questions
    expect(r.inputs.map((x) => x.dataset).sort()).toEqual(['ds.de.debt', 'ds.fr.debt'])
  })
  it('refuses unsupported figures, copied data and a KPI with two figures', () => {
    const p = P(), d = planSlide(p, { purpose: 'trend' }).candidates[0]!.design
    const bad: SlideDesign = structuredClone(d)
    bad.claim = { text: 'France debt reached 130% of GDP' }
    expect(validateDesign(p, bad).join(' ')).toMatch(/"130" has no evidence/)
    const copy: any = structuredClone(d); copy.objects.push({ id: 'x', kind: 'text', role: 'caption', text: { text: 'x' }, values: [1, 2] })
    expect(validateDesign(p, copy).join(' ')).toMatch(/referenced, not copied/)
    const risk = planSlide(p, { purpose: 'risk' }).candidates[0]!.design, kpi: any = risk.objects.find((o) => o.kind === 'kpi')
    kpi.value = { text: '115.7% and 62.8%', numbers: kpi.value.numbers }
    expect(validateDesign(p, risk).join(' ')).toMatch(/exactly one figure/)
  })
  it('keeps the model\'s wording only when its figures come from the evidence', () => {
    const p = P()
    const ok = planSlide(p, { purpose: 'trend', claim: 'France\'s debt climbed to 115.7% of GDP' }).candidates[0]!.design
    expect(ok.objects.find((o) => o.id === 'title')!.kind === 'text' && (ok.objects.find((o) => o.id === 'title') as any).text.text).toBe('France\'s debt climbed to 115.7% of GDP')
    // a qualitative statement the data contradict (France's gap to Germany widened), with no figure to check: not used
    const qual = planSlide(p, { purpose: 'trend', claim: 'France has steadily closed the distance to Germany, while Italy remains the highest debtor.' })
    expect(qual.notes.join(' ')).toMatch(/states something without a figure/)
    expect((qual.candidates[0]!.design.objects.find((o) => o.id === 'title') as any).text.text).toMatch(/^France's government debt rose from 111.4%/)
    // a figure in the wrong direction: contradicted by the claim checker
    const dir = planSlide(p, { purpose: 'trend', claim: "France's debt fell from 111.4% in 2022 to 115.7% of GDP in 2025" })
    expect(dir.notes.join(' ')).toMatch(/contradict/)
    const r = planSlide(p, { purpose: 'trend', claim: 'France\'s debt climbed to 120% of GDP' })
    expect(r.notes.join(' ')).toMatch(/120 is not a figure from the evidence/)
    expect((r.candidates[0]!.design.objects.find((o) => o.id === 'title') as any).text.text).not.toContain('120')
  })
  it('plans an executive risk summary from verified measures only, and a seven-country comparison', () => {
    const p = P(), risk = planSlide(p, { purpose: 'risk' })
    expect(risk.candidates.map((c) => c.problems)).toEqual([[], []])
    const d = risk.candidates[0]!.design
    expect(d.objects.filter((o) => o.kind === 'kpi').length).toBeGreaterThanOrEqual(3)
    expect(d.claim.text).toMatch(/^Three pressures in the verified data: debt at 115.7% of GDP, a deficit of 5.1% and a 76 bp spread over Germany$/)
    expect(planSlide(p, { purpose: 'comparison' }).error).toMatch(/at least three countries/)
    const seven = withSevenCountries(P()), cmp = planSlide(seven, { purpose: 'comparison', metric: 'deficit' })
    expect(cmp.candidates.length).toBe(2)
    for (const c of cmp.candidates) expect(c.problems).toEqual([])
    expect(cmp.candidates[0]!.design.claim.text).toMatch(/France's 2025 government balance of −5.1% of GDP was the (\w+ )?weakest of the six countries/)
  })
})

describe('PD1 layout', () => {
  it('lays out every family inside the slide, with the hero chart filling the content area', () => {
    const p = P(), pr = PROFILES.institutional!, m = new HeuristicMetrics()
    for (const c of [...planSlide(p, { purpose: 'trend' }).candidates, ...planSlide(p, { purpose: 'risk' }).candidates]) {
      const L = layoutDesign(c.design, pr, m)
      for (const [id, b] of Object.entries(L.boxes)) { expect(b.x, id).toBeGreaterThanOrEqual(0); expect(b.y + b.h, id).toBeLessThanOrEqual(H); expect(b.x + b.w, id).toBeLessThanOrEqual(W) }
      expect(L.notes).toEqual([])
    }
    const hero = planSlide(p, { purpose: 'trend' }).candidates[0]!.design, L = layoutDesign(hero, pr, m)
    const c = L.zones.content, b = L.boxes.primary!
    expect((b.w * b.h) / (c.w * c.h)).toBeGreaterThan(0.55) // the earlier France slide gave its chart about 45% of a larger, mostly empty slide
  })
})

describe('PD1 editable slides, ownership and persistence', () => {
  it('applies a design as native editable elements, passes integrity and QA, keeps manual edits through a redesign and a data change', async () => {
    const s = await fresh(), plan = planSlide(s.project, { purpose: 'trend' })
    const r = s.exec({ kind: 'design.apply', design: plan.candidates[0]!.design }, { actor: 'ai' })
    expect(r.ok, r.error).toBe(true)
    const el = elementsOf(s), chart = el.primary!, title = el.title!
    expect(findEl(s.deck, chart)!.el.type).toBe('chart')
    expect(s.sidecar.bindings[chart]).toMatchObject({ kind: 'viz' })
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    const qa = qaSlide(s, 0, s.metrics)
    expect(qa.filter((f) => f.level === 'error')).toEqual([])
    expect(qa.map((f) => f.code)).not.toContain('small_primary_visual')
    // the user moves the chart and rewrites the title
    const [x, y, w, h] = box(s, chart)
    expect(s.exec({ kind: 'element.transform', id: chart, box: { x: x! + 10, y: y!, w: w! - 40, h: h! } }).ok).toBe(true)
    expect(s.exec({ kind: 'text.set', id: title, text: 'My own title' }).ok).toBe(true)
    expect(s.sidecar.owned![chart]).toEqual({ box: true }); expect(s.sidecar.owned![title]).toEqual({ text: true })
    const moved = box(s, chart)
    // the AI redesigns the slide with another layout
    const other = plan.candidates.find((c) => c.design.layout.family === 'comparative')!.design
    const re = s.exec({ kind: 'design.apply', design: other, slide: slideList(s.deck)[0]!.id }, { actor: 'ai' })
    expect(re.ok, re.error).toBe(true)
    expect(re.summary).toMatch(/your position kept/)
    expect(re.summary).toMatch(/your text kept/)
    expect(box(s, chart)).toEqual(moved)
    expect(textOf(findEl(s.deck, title)!.el)).toBe('My own title')
    expect(elementsOf(s).secondary).toBeTruthy() // the table was added
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    // a data change updates the chart through its binding without moving it
    expect(s.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2025', value: 116 }).ok).toBe(true)
    expect(box(s, chart)).toEqual(moved)
    expect(s.exec({ kind: 'data.restore', dataset: 'ds.fr.debt', date: '2025' }).ok).toBe(true)
    // save and reopen: design record, ownership and bindings survive
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    expect(back.sidecar.designs).toEqual(s.sidecar.designs)
    expect(back.sidecar.owned).toEqual(s.sidecar.owned)
    expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
    expect(box(back, chart)).toEqual(moved)
    // undo the redesign: the earlier layout returns
    const nUndo = s.undoStack.length
    s.undo(); s.undo(); s.undo()
    expect(s.undoStack.length).toBe(nUndo - 3)
    expect(elementsOf(s).secondary).toBeUndefined()
  })
  it('changes the profile without changing a value, and the deck check sees one consistent style', async () => {
    const s = await fresh()
    for (const purpose of ['trend', 'risk'] as const) expect(s.exec({ kind: 'design.apply', design: planSlide(s.project, { purpose }).candidates[0]!.design }, { actor: 'ai' }).ok).toBe(true)
    const values = () => JSON.stringify(Object.values(s.project.datasets).map((d) => effectiveObs(d).map((o) => o.value)))
    const before = values()
    expect(qaDeck(s, s.metrics)).toEqual([])
    // the user moves a KPI card: its position is theirs, its style still follows the profile
    const risk = Object.values(s.sidecar.designs!).find((a) => a.design.layout.family === 'executive_insight')!, kpi = risk.elements.kpi1!
    const o = findEl(s.deck, kpi)!.el.transform.offset
    expect(s.exec({ kind: 'element.transform', id: kpi, box: { x: o.x / 9525, y: o.y / 9525 + 4, w: o.cx / 9525, h: o.cy / 9525 } }).ok).toBe(true)
    expect(JSON.stringify(findEl(s.deck, kpi)!.el.fill ?? null).toLowerCase()).toContain('f1ece0') // the institutional card fill
    const r = s.exec({ kind: 'design.profile', profile: 'editorial' })
    expect(r.ok, r.error).toBe(true)
    expect(values()).toBe(before)
    expect(Object.values(s.sidecar.designs!).every((a) => a.design.profile === 'editorial')).toBe(true)
    expect(JSON.stringify(findEl(s.deck, kpi)!.el.fill ?? null).toLowerCase()).not.toContain('f1ece0') // replaced by the editorial card style
    expect(findEl(s.deck, kpi)!.el.transform.offset.y).toBe(o.y + 4 * 9525) // the user's position is kept
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    expect(qaDeck(s, s.metrics)).toEqual([])
  })
})
