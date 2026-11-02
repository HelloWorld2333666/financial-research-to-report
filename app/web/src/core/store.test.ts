// Store + commands: the M1 acceptance behaviours at unit level (the browser checks repeat them end to end).
// Fixtures come from the server's own code:
//   .venv/bin/python -c "import sys,json; sys.path.insert(0,'app/server'); from evidence import seed_project; from composer import compose;
//   p=seed_project('france','france-test','France (test fixture)'); json.dump(p,open('app/web/src/core/fixtures/france-project.json','w'),indent=1);
//   json.dump(compose(p),open('app/web/src/core/fixtures/france-proposal.json','w'),indent=1)"
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { checkText } from './claims'
import { findEl, textOf, walk } from './deck'
import { BUNDLE_SCHEMA, type Bundle, type Project } from './types'

const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
async function deck() {
  const s = await fresh()
  for (const p of proposal as any[]) expect(s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai', proposalId: `t:${p.key}` }).ok).toBe(true)
  return s
}
const ig = (s: Store) => integrity(s.deck, s.project, s.sidecar)
const byRole = (s: Store, role: string, slide = 's_1') => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'text' && b.role === role && b.slide === slide)![0]
const chartOn = (s: Store, slide: string) => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz' && b.slide === slide)![0]

describe('store and commands', () => {
  it('composes four slides as four undoable AI steps with full integrity', async () => {
    const s = await deck()
    expect(s.slides().length).toBe(4)
    expect(s.undoStack.length).toBe(4)
    expect(s.journal.map((j) => [j.kind, j.actor, j.proposalId])).toEqual((proposal as any[]).map((p) => ['slide.compose', 'ai', `t:${p.key}`]))
    const r = ig(s); expect(r.ok).toBe(true); expect(r.points).toBeGreaterThan(0); expect(r.cells).toBeGreaterThan(0)
  })

  it('keeps every generated claim consistent with the data', async () => {
    const s = await deck()
    for (const [id, b] of Object.entries(s.sidecar.bindings)) {
      if (b.kind !== 'text' || !['title', 'body'].includes(b.role)) continue
      const chart = Object.values(s.sidecar.bindings).find((x) => x.kind === 'viz' && x.slide === b.slide) as any
      const metric = chart ? s.project.datasets[chart.spec.view.datasets[0]]!.metric : null
      expect(checkText(textOf(findEl(s.deck, id)!.el), s.project, 'France', metric).filter((c) => c.status === 'mismatch')).toEqual([])
    }
  })

  it('keeps bindings through group and ungroup of two bound text boxes', async () => {
    const s = await deck()
    const ids = [byRole(s, 'title'), byRole(s, 'subtitle')]
    expect(s.exec({ kind: 'element.group', ids }).ok).toBe(true)
    expect(ids.every((id) => findEl(s.deck, id)?.group)).toBe(true) // same durable ids, now inside the group
    expect(ig(s).ok).toBe(true)
    const group = [...walk(s.deck)].find((f) => f.el.type === 'group')!.durable!
    expect(s.exec({ kind: 'element.ungroup', id: group }).ok).toBe(true)
    expect(ids.every((id) => findEl(s.deck, id) && !findEl(s.deck, id)!.group)).toBe(true)
    expect(ig(s).ok).toBe(true)
  })

  it('refuses to group charts with a clear message and changes nothing', async () => {
    const s = await deck()
    const before = s.undoStack.length
    const r = s.exec({ kind: 'element.group', ids: [chartOn(s, 's_1'), byRole(s, 'title')] })
    expect(r.ok).toBe(false); expect(r.error).toMatch(/can't be grouped/)
    expect(s.undoStack.length).toBe(before)
  })

  it('pastes a chart that can be edited alone', async () => {
    const s = await deck()
    const orig = chartOn(s, 's_1')
    s.copy([orig])
    const r = s.exec({ kind: 'clipboard.paste', slide: 's_1', items: s.clipboard })
    expect(r.ok).toBe(true)
    const copy = r.created![0]!
    expect((s.sidecar.bindings[copy] as any).spec.view.datasets).toEqual((s.sidecar.bindings[orig] as any).spec.view.datasets)
    // VIS V1: one axis shows one unit, so growth (%) cannot join a debt chart (% of GDP)
    expect(s.exec({ kind: 'chart.addSeries', id: copy, dataset: s.project.datasets['ds.de.growth']! }).error).toMatch(/different units/)
    expect(s.exec({ kind: 'chart.addSeries', id: copy, dataset: s.project.datasets['ds.fr.interest']! }).ok).toBe(true)
    expect((s.sidecar.bindings[orig] as any).spec.view.datasets).toEqual(['ds.fr.debt', 'ds.de.debt'])
    expect(findEl(s.deck, orig)!.el.chart.series.length).toBe(2)
    expect(findEl(s.deck, copy)!.el.chart.series.length).toBe(3)
    expect(ig(s).ok).toBe(true)
  })

  it('records manual data edits in the working layer, keeps the source, and flags stale text', async () => {
    const s = await deck()
    expect(s.exec({ kind: 'data.set', dataset: 'ds.fr.interest', date: '2025', value: 2.3 }).ok).toBe(true)
    const d = s.project.datasets['ds.fr.interest']!
    expect(d.working['2025']!.value).toBe(2.3)
    expect(d.observations.find((o) => o.date === '2025')!.value).toBe(2.2)
    // the table was re-projected; only the sentence that cites 2025 interest is now stale (M3)
    expect(ig(s).mismatch).toEqual(['text says 2.2, data now 2.3'])
    const title = textOf(findEl(s.deck, byRole(s, 'title', 's_2'))!.el)
    expect(checkText(title, s.project).some((c) => c.status === 'mismatch' && /2\.3/.test(c.detail))).toBe(true)
    expect(s.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2023', value: null }).ok).toBe(true)
    const el = findEl(s.deck, chartOn(s, 's_1'))!.el
    expect(el.chart.series[0].values[el.chart.categories.indexOf('2023')]).toBeNull()
  })

  it('undoes and redoes, and refuses invalid operations atomically', async () => {
    const s = await deck()
    const title = byRole(s, 'title')
    s.exec({ kind: 'text.set', id: title, text: 'Manual title' })
    s.undo(); expect(textOf(findEl(s.deck, title)!.el)).not.toBe('Manual title')
    s.redo(); expect(textOf(findEl(s.deck, title)!.el)).toBe('Manual title')
    const n = s.undoStack.length, rev = s.revision
    const r = s.exec({ kind: 'ops.raw', ops: [{ op: 'setFill', target: { slide: 0, el: 'e_doesnotexist' }, fill: '#c8102e' }] })
    expect(r.ok).toBe(false); expect(s.undoStack.length).toBe(n); expect(s.revision).toBe(rev)
  })

  it('previews without touching the live document', async () => {
    const s = await fresh()
    const before = s.deck.deck.slides.map((x: any) => x.elements.length).join()
    const pv = s.preview({ kind: 'slide.compose', proposal: (proposal as any[])[0] }, (out) => out.slides)
    expect(pv.ok && pv.value).toEqual(['s_1'])
    expect(s.deck.deck.slides.map((x: any) => x.elements.length).join()).toBe(before)
    expect(Object.keys(s.sidecar.bindings)).toEqual([])
  })

  it('saves to a bundle and reopens with the same content, journal, threads and full integrity', async () => {
    const s = await deck()
    s.exec({ kind: 'data.set', dataset: 'ds.de.debt', date: '2023', value: 62 })
    s.threads = { project: { messages: [{ role: 'user', content: 'Analyze France' }] } }
    const bundle: Bundle = JSON.parse(JSON.stringify(await s.toBundle()))
    const back = await Store.fromBundle(bundle)
    expect(ig(back)).toEqual(ig(s))
    expect(ig(back).ok).toBe(true)
    const texts = (x: Store) => Object.keys(x.sidecar.bindings).sort().map((id) => [id, textOf(findEl(x.deck, id)!.el)])
    expect(texts(back)).toEqual(texts(s))
    expect(back.journal).toEqual(s.journal)
    expect(back.threads).toEqual(s.threads)
    expect(back.project.datasets['ds.de.debt']!.working['2023']!.value).toBe(62)
  })
})
