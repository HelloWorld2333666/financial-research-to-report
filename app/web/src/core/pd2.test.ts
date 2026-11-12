// PD2: visual language, compositions and designed charts on the France fixture: every candidate valid and bound to
// evidence, built from native editable objects, verified by integrity, stable through data edits, chart changes,
// undo and save/reload.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, slideList, textOf, walk } from './deck'
import { BUNDLE_SCHEMA, type Project } from './types'
import { balanceRank, debtTrend, riskNarrative } from './design/editorial'
import { qaSlide } from './design/qa'
import { figures } from './evidence'
import { designTexts } from './design/spec'

const P = () => structuredClone(project) as unknown as Project
/** Test-only: four more countries with the fixture's deficits scaled (all still in deficit), for the seven-country brief. */
function seven(p: Project) {
  for (const [g, name, k] of [['IT', 'Italy', 0.6], ['ES', 'Spain', 0.45], ['NL', 'Netherlands', 0.3], ['BE', 'Belgium', 1.05]] as const) {
    const src = p.datasets['ds.fr.deficit']!, id = `ds.${g.toLowerCase()}.deficit`
    p.datasets[id] = { ...structuredClone(src), id, geo: g, entity: name, observations: src.observations.map((o) => ({ ...o, value: o.value == null ? null : Math.round(o.value * k * 10) / 10, evidence_id: `${o.evidence_id}.${g}` })) }
    for (const o of src.observations) p.evidence[`${o.evidence_id}.${g}`] = { ...p.evidence[o.evidence_id!], id: `${o.evidence_id}.${g}`, value: Math.round(o.value! * k * 10) / 10 }
  }
  return p
}
const store = (p: Project) => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: p, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
const BRIEFS = [['debt', (p: Project) => debtTrend(p)], ['balance', (p: Project) => balanceRank(p)], ['risk', (p: Project) => riskNarrative(p)]] as const

describe('PD2 editorial candidates', () => {
  it('offers two materially different, valid compositions per brief, every figure bound to evidence', () => {
    for (const [name, make] of BRIEFS) {
      const p = seven(P()), c = make(p)
      expect(c.length, name).toBeGreaterThanOrEqual(2) // Gate C adds recipe variants after the two PD2 compositions
      for (const x of c) expect(x.problems, `${name}: ${x.label}`).toEqual([])
      expect(new Set(c.slice(0, 2).map((x) => x.design.layout.composition!.kind)).size, name).toBe(2) // two different arrangements
      for (const x of c) for (const { where, t } of designTexts(x.design)) expect(figures(t.text).length, `${name} ${where}: ${t.text}`).toBeLessThanOrEqual((t.numbers ?? []).length)
    }
  })
  it('states only what the data support: directions and ranks are computed', () => {
    const p = seven(P())
    expect(debtTrend(p)[0]!.design.objects.find((o) => o.id === 'headline')).toMatchObject({ text: { text: "France's debt kept rising while Germany's fell" } })
    const h = (balanceRank(p)[0]!.design.objects.find((o) => o.id === 'headline') as any).text.text
    expect(h).toBe('France ran the second-largest deficit of the six') // Belgium (scaled ×1.05) is the only larger one
  })
})

describe('PD2 composed slides in the deck', () => {
  it('builds native objects and designed charts that integrity verifies, and QA finds no errors', async () => {
    for (const [name, make] of BRIEFS) for (const k of [0, 1]) {
      const s = await store(seven(P())), d = make(s.project)[k]!.design
      const r = s.exec({ kind: 'design.apply', design: d }, { actor: 'ai' })
      expect(r.ok, `${name} ${k}: ${r.error}`).toBe(true)
      const ig = integrity(s.deck, s.project, s.sidecar)
      expect(ig.ok, `${name} ${k}: ${ig.mismatch.join('; ')}`).toBe(true)
      expect(ig.points).toBeGreaterThan(0)
      expect(qaSlide(s, 0, s.metrics).filter((f) => f.level === 'error').map((f) => f.message), `${name} ${k}`).toEqual([])
      // designed charts are groups of named marks; the text, figures and shapes are native objects
      const els = s.sidecar.designs![slideList(s.deck)[0]!.id]!.elements
      for (const [obj, id] of Object.entries(els)) {
        const f = findEl(s.deck, id)!, b = s.sidecar.bindings[id]!
        if (b.kind === 'viz') { expect(f.el.type, `${name} ${obj}`).toBe('group'); expect((f.el.children ?? []).some((c: any) => /^frr-mark /.test(c.name ?? ''))).toBe(true) }
        else expect(['shape', 'text', 'picture'].includes(f.el.type) || f.el.type === 'textbox' || !!f.el.text || f.el.type === 'rect', `${name} ${obj}: ${f.el.type}`).toBe(true)
      }
    }
  })
  it('keeps data, chart choice and history consistent: data edit, change to a native chart, undo, save and reopen', async () => {
    const s = await store(seven(P()))
    expect(s.exec({ kind: 'design.apply', design: debtTrend(s.project)[0]!.design }, { actor: 'ai' }).ok).toBe(true)
    const sid = slideList(s.deck)[0]!.id, els = s.sidecar.designs![sid]!.elements, chart = els.primary!, hero = els.hero!
    // a data edit redraws the designed chart from the new value; the hero figure (bound text) is flagged until restored
    expect(s.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2025', value: 116 }).ok).toBe(true)
    const marks = () => (findEl(s.deck, chart)!.el.children ?? []).map((c: any) => c.name).filter((n: string) => /^frr-mark 1 /.test(n) || /^frr-mark 0 /.test(n))
    expect(marks().some((n: string) => n.endsWith(' 116'))).toBe(true)
    const stale = integrity(s.deck, s.project, s.sidecar)
    expect(stale.ok).toBe(false)
    expect(stale.mismatch.join(' ')).toMatch(/text says 115.7%?, data now 116/)
    expect(s.exec({ kind: 'data.restore', dataset: 'ds.fr.debt', date: '2025' }).ok).toBe(true)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    // the user switches the designed line to a native column chart: it becomes a PowerPoint chart, same data
    expect(s.exec({ kind: 'viz.change', id: chart, family: 'column' }).ok).toBe(true)
    expect(findEl(s.deck, chart)!.el.type).toBe('chart')
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    s.undo()
    expect(findEl(s.deck, chart)!.el.type).toBe('group')
    // edit the hero caption's slide text and reopen
    expect(s.exec({ kind: 'text.set', id: els.headline!, text: 'Debt kept climbing' }).ok).toBe(true)
    const back = await Store.fromBundle(JSON.parse(JSON.stringify(await s.toBundle())))
    expect(integrity(back.deck, back.project, back.sidecar).ok).toBe(true)
    expect(findEl(back.deck, chart)!.el.type).toBe('group')
    expect(textOf(findEl(back.deck, els.headline!)!.el)).toBe('Debt kept climbing')
    expect(textOf(findEl(back.deck, hero)!.el)).toContain('115.7%')
    expect(back.sidecar.designs![sid]!.design.layout.composition).toEqual({ kind: 'rail', params: { side: 'right', chartCols: 8 } })
    // nothing on the slide is a picture: the slide is editable objects throughout
    expect([...walk(back.deck)].filter((f) => f.index === 0 && f.el.type === 'picture')).toEqual([])
  })
})
