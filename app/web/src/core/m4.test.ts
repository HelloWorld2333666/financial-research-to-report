// M4 AI loop in the store: proposal states follow apply/undo/redo/reject, thread transcripts are kept,
// AI rewrites carry their number references, and batches are one step.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, textOf } from './deck'
import { textNumbers } from './evidence'
import { BUNDLE_SCHEMA, type Project } from './types'

const fresh = () => Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
async function deck() {
  const s = await fresh()
  ;(proposal as any[]).forEach((p) => s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai', proposalId: `call_1:${p.key}` }))
  return s
}
const title = (s: Store, slide = 's_1') => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'text' && (b as any).role === 'title' && b.slide === slide)![0]

describe('M4 AI loop', () => {
  it('records proposal states: applied, undone by Undo, applied again by Redo, rejected', async () => {
    const s = await deck()
    expect(Object.values(s.proposals)).toEqual(['applied', 'applied', 'applied', 'applied'])
    expect(s.journal.every((j) => j.actor === 'ai' && j.proposalId?.startsWith('call_1:'))).toBe(true)
    s.undo(); expect(s.proposals['call_1:ratings']).toBe('undone')
    s.redo(); expect(s.proposals['call_1:ratings']).toBe('applied')
    s.reject('call_2'); expect(s.proposals['call_2']).toBe('rejected')
    const b = await s.toBundle()
    expect(b.threads.proposals['call_1:debt']).toBe('applied')
  })

  it('keeps thread transcripts as JSON and only marks a change when they differ', async () => {
    const s = await fresh()
    const msgs = [{ id: 'm1', role: 'user', createdAt: new Date('2026-11-02T10:00:00Z'), content: [{ type: 'text', text: 'hi' }] }]
    const r0 = s.revision
    s.setThreadMessages('p:project', msgs)
    expect(s.revision).toBe(r0 + 1)
    expect(s.threadMessages('p:project')[0].createdAt).toBe('2026-11-02T10:00:00.000Z')
    s.setThreadMessages('p:project', msgs); expect(s.revision).toBe(r0 + 1)
  })

  it('applies an AI rewrite with its number references, so integrity checks the new wording', async () => {
    const s = await deck()
    const t = title(s)
    const numbers = (s.sidecar.bindings[t] as any).numbers
    const after = "France's debt rose from 111.4% to 115.7% (2022–2025); Germany: 62.8% in 2025, 64.1% in 2022"
    expect(s.exec({ kind: 'text.set', id: t, text: after, numbers }, { actor: 'ai', proposalId: 'call_3' }).ok).toBe(true)
    expect(textOf(findEl(s.deck, t)!.el)).toBe(after)
    expect(textNumbers(after, (s.sidecar.bindings[t] as any).numbers, s.project).map((n) => n.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(s.journal.at(-1)!.summary).toBe('Rewrite text (4 figures bound to evidence)')
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
  })

  it('does not treat selection as an unsaved change, and keeps edits made during a save dirty', async () => {
    const s = await deck()
    let release: (() => void) | null = null
    const g = globalThis as any, real = g.fetch
    g.fetch = async () => { await new Promise<void>((r) => (release = r)); return { ok: true, json: async () => ({}) } }
    const inFlight = async () => { while (!release) await new Promise((r) => setTimeout(r, 1)); const r = release; release = null; return r }
    try {
      const saving = s.save()
      const done = await inFlight() // the bundle is built and the request is out
      s.exec({ kind: 'text.set', id: title(s), text: 'Edited during the save' })
      done(); await saving
      expect(s.dirty).toBe(true) // the in-flight save did not contain the edit
      const again = s.save(); (await inFlight())(); await again
      expect(s.dirty).toBe(false)
      s.select([title(s)]); expect(s.dirty).toBe(false)
    } finally { g.fetch = real }
  })

  it('runs a layout batch as one undo step', async () => {
    const s = await deck()
    const ids = Object.entries(s.sidecar.bindings).filter(([, b]) => b.slide === 's_2' && b.kind === 'text').map(([k]) => k).slice(0, 3)
    const n = s.undoStack.length
    expect(s.exec({ kind: 'batch', commands: [{ kind: 'elements.align', ids, mode: 'left' }, { kind: 'elements.distribute', ids, axis: 'vertical' }] }).ok).toBe(true)
    expect(s.undoStack.length).toBe(n + 1)
    expect(s.exec({ kind: 'batch', commands: [{ kind: 'elements.align', ids, mode: 'left' }, { kind: 'element.delete', ids: ['e_nope'] }] }).ok).toBe(false)
    expect(s.undoStack.length).toBe(n + 1) // the failed batch changed nothing
  })
})
