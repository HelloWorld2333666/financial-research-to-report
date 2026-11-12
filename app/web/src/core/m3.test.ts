// M3 Evidence Core integration: number references, derivations, verify/restore, stale-text integrity.
// WRITE_FIXTURES=1 also writes app/server/tests/fixtures/france-bundle.json (a composed France deck)
// for the server's integrity and export-policy tests.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, textOf } from './deck'
import { derivationValue, evaluate, evidenceValue, figures, textNumbers } from './evidence'
import { BUNDLE_SCHEMA, type Project } from './types'

async function deck() {
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  for (const p of proposal as any[]) expect(s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai' }).ok).toBe(true)
  return s
}
const textBindings = (s: Store) => Object.entries(s.sidecar.bindings).filter(([, b]) => b.kind === 'text' && b.role !== 'source') as [string, any][]

describe('M3 evidence core', () => {
  it('evaluates derivation formulas safely', () => {
    expect(evaluate('(own - peer) * 100', { own: 3.35, peer: 2.59 })).toBeCloseTo(76)
    expect(evaluate('abs(b)', { b: -5.1 })).toBe(5.1)
    expect(evaluate('-a + 2 * (b - 1) / 4', { a: 1, b: 3 })).toBe(0)
    for (const bad of ['a.constructor', 'alert(1)', 'a ** 2', '(a', 'x']) expect(() => evaluate(bad, { a: 1 })).toThrow()
  })

  it('reads figures in prose but not years, tenors or identifiers', () => {
    expect(figures('Growth slowed to 0.8% in 2025; the 10-year spread was 76 bp (gov_10dd_edpt1), +4.3 pp, −5.1%').map((f) => f.text)).toEqual(['0.8', '76', '+4.3', '−5.1'])
  })

  it('resolves every generated figure to evidence or a derivation', async () => {
    const s = await deck()
    const all = textBindings(s).flatMap(([id, b]) => textNumbers(textOf(findEl(s.deck, id)!.el), b.numbers, s.project))
    expect(all.length).toBe(14)
    expect(all.filter((n) => n.status !== 'ok')).toEqual([])
    expect(Object.keys(s.project.derivations!).sort()).toEqual(['der.fr.debt.change.2022-2025', 'der.fr.deficit.size.2025', 'der.frde.spread.2025'])
    const ig = integrity(s.deck, s.project, s.sidecar)
    expect([ig.ok, ig.figures, ig.sourced, ig.unsourced]).toEqual([true, 14, 14, 0])
  })

  it('recomputes a derivation from working values, so an input edit makes the text stale', async () => {
    const s = await deck()
    const d = s.project.derivations!['der.frde.spread.2025']!
    expect(derivationValue(s.project, d.id)).toBe(76)
    const own = evidenceValue(s.project, d.inputs.own!)
    expect(s.exec({ kind: 'data.set', dataset: own.ds!, date: own.date!, value: 3.6 }).ok).toBe(true)
    expect(derivationValue(s.project, d.id)).toBe(101)
    expect(integrity(s.deck, s.project, s.sidecar).mismatch).toEqual(expect.arrayContaining(['text says 76, data now 101', 'text says 3.35, data now 3.6']))
  })

  it('flags typed figures as unsourced, not as errors', async () => {
    const s = await deck()
    const [title] = textBindings(s).find(([, b]) => b.role === 'title' && b.slide === 's_1')!
    s.exec({ kind: 'text.set', id: title, text: "France's debt ratio rose from 111.4% to 120% of GDP" })
    expect(textNumbers(textOf(findEl(s.deck, title)!.el), (s.sidecar.bindings[title] as any).numbers, s.project).map((n) => n.status)).toEqual(['ok', 'unsourced'])
  })

  it('verifies and restores manual values in one undoable step each', async () => {
    const s = await deck()
    s.exec({ kind: 'data.set', dataset: 'ds.de.interest', date: '2023', value: 1.0 })
    const n = s.undoStack.length
    expect(s.exec({ kind: 'data.verify', dataset: 'ds.de.interest', date: '2023' }).ok).toBe(true)
    const w = s.project.datasets['ds.de.interest']!.working['2023']!
    expect([w.status, w.verified_by, !!w.verified_at, s.undoStack.length]).toEqual(['verified', 'you', true, n + 1])
    expect(s.exec({ kind: 'data.verify', dataset: 'ds.de.interest', date: '2023' }).error).toMatch(/already verified/)
    expect(s.exec({ kind: 'data.restore', dataset: 'ds.de.interest', date: '2023' }).ok).toBe(true)
    expect(s.project.datasets['ds.de.interest']!.working['2023']).toBeUndefined()
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    s.undo(); expect(s.project.datasets['ds.de.interest']!.working['2023']!.status).toBe('verified')
  })

  // node globals without @types/node (the client package doesn't depend on Node types)
  it.runIf((globalThis as any).process?.env?.WRITE_FIXTURES)('writes the server test fixture', async () => {
    const { writeFileSync } = await import('node:fs' as string)
    const s = await deck()
    writeFileSync(new URL('../../../server/tests/fixtures/france-bundle.json', import.meta.url), JSON.stringify(await s.toBundle()))
  })
})
