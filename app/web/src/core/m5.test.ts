// M5: research results land through proposals. A ratings placeholder becomes a table whose rows are
// verified rating evidence; Eurostat packs add datasets. WRITE_FIXTURES=1 also writes the server's
// ratings fixture (app/server/tests/fixtures/ratings-bundle.json).
// rating-evidence.json: .venv/bin/python -c "import sys,json; sys.path[:0]=['src','app/server','app/server/tests']; import pdfgen,
//   research_runs as rr; d=pdfgen.fixture_pdf(); p=rr.pdf_pages(d); e,_=rr.rating_evidence(d,'example-ratings-france.pdf','France',
//   rr.pattern_candidates(p),p); [x.update(verified_on='2026-11-02') or x['retrieval'].update(retrieved_at='2026-11-02T00:00:00+00:00') for x in e];
//   json.dump(e,open('app/web/src/core/fixtures/rating-evidence.json','w'),indent=1)"
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import ratings from './fixtures/rating-evidence.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, textOf } from './deck'
import { ratingCells } from './evidence'
import { BUNDLE_SCHEMA, type Project } from './types'

async function deck() {
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  for (const p of proposal as any[]) s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai' })
  return s
}
const placeholder = (s: Store) => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'placeholder')![0]
const fill = (id: string) => ({ kind: 'placeholder.fill' as const, id, evidence: ratings as any[], title: 'Rating actions: Example Ratings affirmed France at AA-, outlook negative (March 2025)',
  subtitle: 'Rating actions quoted from the agency press release (uploaded PDF); each verified on its page', source_note: 'Source: Example Ratings press release (uploaded PDF), p. 1.' })

describe('M5 research results', () => {
  it('replaces the ratings placeholder with a table of verified rating evidence, in one research step', async () => {
    const s = await deck()
    const ph = placeholder(s), slide = s.sidecar.bindings[ph]!.slide, n = s.undoStack.length
    const r = s.exec(fill(ph), { actor: 'research', proposalId: 'task:task-1' })
    expect(r.ok).toBe(true)
    expect(findEl(s.deck, ph)).toBeNull()
    const [tid, tb] = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'ratings')! as [string, any]
    expect(tb).toEqual({ kind: 'ratings', slide, rows: [(ratings as any[])[0].id] })
    const rows = findEl(s.deck, tid)!.el.rows
    expect(rows[1].map((c: any) => textOf(c.text))).toEqual(ratingCells((ratings as any[])[0]))
    expect(rows[1].map((c: any) => textOf(c.text))).toEqual(['Example Ratings', '2025-03-14', 'affirmed', 'AA-', 'negative'])
    const title = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'text' && (b as any).role === 'title' && b.slide === slide)![0]
    expect(textOf(findEl(s.deck, title)!.el)).toMatch(/^Rating actions: Example Ratings affirmed France at AA-/)
    expect(s.project.evidence[tb.rows[0]].excerpt).toBe('Example Ratings affirms France at AA-; Outlook Negative')
    const ig = integrity(s.deck, s.project, s.sidecar)
    expect([ig.ok, ig.unsourced]).toEqual([true, 0])
    expect(s.undoStack.length).toBe(n + 1); expect(s.proposals['task:task-1']).toBe('applied')
    expect(s.journal.at(-1)!.actor).toBe('research')
    s.undo(); expect(findEl(s.deck, ph)).not.toBeNull()
  })

  it('flags a ratings table that no longer matches its evidence', async () => {
    const s = await deck()
    s.exec(fill(placeholder(s)))
    const [tid] = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'ratings')!
    const f = findEl(s.deck, tid)!
    s.exec({ kind: 'ops.raw', ops: [{ op: 'setTableCell', target: { slide: f.index, el: f.el.id }, row: 1, col: 3, paragraphs: [{ runs: [{ text: 'AA' }] }] }] })
    expect(integrity(s.deck, s.project, s.sidecar).mismatch).toEqual([`rating ${(ratings as any[])[0].id} column 4: evidence "AA-", table "AA"`])
  })

  it('refuses to fill something that is not a placeholder, and adds datasets once', async () => {
    const s = await deck()
    const chart = Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'viz')![0]
    expect(s.exec(fill(chart)).error).toMatch(/not a research placeholder/)
    const ds = { ...structuredClone(s.project.datasets['ds.fr.debt']!), id: 'ds.es.debt', geo: 'ES', entity: 'Spain', observations: [{ date: '2025', value: 101.8, status: 'verified', evidence_id: 'ev.live.es.debt.2025' }] }
    const ev = { 'ev.live.es.debt.2025': { id: 'ev.live.es.debt.2025', value: 101.8, retrieval: { method: 'api', query_url: 'https://ec.europa.eu/eurostat/api/x' } } }
    expect(s.exec({ kind: 'data.addDatasets', datasets: [ds as any], evidence: ev }).summary).toBe('Add 1 verified dataset (Spain debt)')
    expect(s.project.evidence['ev.live.es.debt.2025'].retrieval.query_url).toContain('eurostat')
    expect(s.exec({ kind: 'data.addDatasets', datasets: [ds as any], evidence: ev }).error).toMatch(/already in the project/)
  })

  // node globals without @types/node (the client package doesn't depend on Node types)
  it.runIf((globalThis as any).process?.env?.WRITE_FIXTURES)('writes the server ratings fixture', async () => {
    const { writeFileSync } = await import('node:fs' as string)
    const s = await deck()
    s.exec(fill(placeholder(s)))
    writeFileSync(new URL('../../../server/tests/fixtures/ratings-bundle.json', import.meta.url), JSON.stringify(await s.toBundle()))
  })
})
