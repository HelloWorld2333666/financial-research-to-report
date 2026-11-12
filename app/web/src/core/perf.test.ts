// M6 performance check: integrity on a large deck and per-slide render time, from the France fixtures.
// Bounds are generous (CI machines vary); the measured times are printed for the M6 results note.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { render } from './deck'
import { BUNDLE_SCHEMA, type Project } from './types'

const ms = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t }

describe('M6 performance', () => {
  it('integrity and slide rendering stay fast on a 40-slide France deck', async () => {
    const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as unknown as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
    for (let i = 0; i < 10; i++) for (const p of proposal as any[]) expect(s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai' }).ok).toBe(true)
    const n = s.slides().length
    expect(n).toBe(10 * (proposal as any[]).length)

    integrity(s.deck, s.project, s.sidecar) // warm-up
    const ig = integrity(s.deck, s.project, s.sidecar)
    const tIg = Math.min(...[0, 1, 2].map(() => ms(() => integrity(s.deck, s.project, s.sidecar))))
    expect(ig.ok).toBe(true)

    const per = Array.from({ length: n }, (_, i) => ms(() => render(s.deck, i, 800, s.metrics)))
    const sorted = [...per].sort((a, b) => a - b)
    const median = sorted[Math.floor(n / 2)]!, worst = sorted[n - 1]!
    console.log(`[perf] ${n} slides, ${ig.bindings} bindings, ${ig.points} points: integrity ${tIg.toFixed(0)} ms; render median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`)
    expect(tIg).toBeLessThan(2000)
    expect(median).toBeLessThan(250)
  }, 60_000)
})
