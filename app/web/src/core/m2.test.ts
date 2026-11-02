// M2 editing quality: theme and fonts, table style, title fit, multi-element commands, rich text, number formatting.
import { describe, expect, it } from 'vitest'
import project from './fixtures/france-project.json'
import proposal from './fixtures/france-proposal.json'
import { Store } from './store'
import { integrity } from './integrity'
import { findEl, render, sourceIdsFor, textOf } from './deck'
import { cellText } from './evidence'
import { BUNDLE_SCHEMA, type Project } from './types'

async function deck() {
  const s = await Store.fromBundle({ schema: BUNDLE_SCHEMA, project: structuredClone(project) as Project, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })
  for (const p of proposal as any[]) expect(s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai' }).ok).toBe(true)
  return s
}
const ids = (s: Store, pred: (b: any) => boolean) => Object.entries(s.sidecar.bindings).filter(([, b]) => pred(b)).map(([k]) => k)
const node = (s: Store, id: string) => {
  const f = findEl(s.deck, id)!, r = render(s.deck, f.index, 1280, s.metrics)
  const src = sourceIdsFor(r, [id])[0]
  const find = (ns: any[]): any => { for (const n of ns) { if (n.sourceId === src) return n; if (n.children) { const c = find(n.children); if (c) return c } } }
  return find(r.nodes as any[])
}
const box = (s: Store, id: string) => { const o = findEl(s.deck, id)!.el.transform.offset; return { x: o.x / 9525, y: o.y / 9525, w: o.cx / 9525, h: o.cy / 9525 } }

describe('M2 editing quality', () => {
  it('themes a new deck from Design DNA: Inter for headings and body, navy accent1', async () => {
    const s = await deck()
    const theme = [...s.deck.archive.entries.keys()].filter((k) => /ppt\/theme\/theme\d+\.xml$/.test(k)).map((k) => s.deck.archive.readText(k)!).join('')
    expect(theme).toMatch(/<a:latin typeface="Inter"/)
    expect(theme).toMatch(/<a:accent1>\s*<a:srgbClr val="1F4E9C"/i)
  })

  it('styles bound tables with the theme accent, not PowerPoint\'s default', async () => {
    const s = await deck()
    const t = ids(s, (b) => b.kind === 'table')[0]!
    const el = findEl(s.deck, t)!.el
    expect(el.styleId).toBeTruthy()
    expect(el.styleId).not.toBe('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}') // Office default "Medium Style 2 - Accent 1"
  })

  it('formats each dataset with consistent decimals', async () => {
    const s = await deck()
    expect(['2023', '2024', '2025'].map((d) => cellText(s.project, 'ds.fr.interest', d))).toEqual(['1.9', '2.0', '2.2'])
    expect(cellText(s.project, 'ds.fr.yield', '2025')).toBe('3.35')
  })

  it('shrinks a long title to fit its frame instead of overflowing', async () => {
    const s = await deck()
    const title = ids(s, (b) => b.kind === 'text' && b.role === 'title' && b.slide === 's_1')[0]!
    const long = "France's general government debt ratio climbed from 111.4% of GDP in 2022 to 115.7% in 2025 while Germany's held near 62.8%, widening a gap that markets have priced only partly so far"
    expect(s.exec({ kind: 'text.set', id: title, text: long }).ok).toBe(true)
    const n = node(s, title)
    expect(n.text.fontScale).toBeLessThan(1)
    expect(n.text.lines.length).toBeGreaterThan(1)
    expect(n.text.contentHeight).toBeLessThanOrEqual(n.box.h + 1)
  })

  it('keeps rich runs from the editor (EditParagraph[])', async () => {
    const s = await deck()
    const title = ids(s, (b) => b.kind === 'text' && b.role === 'title' && b.slide === 's_1')[0]!
    s.exec({ kind: 'text.set', id: title, paragraphs: [{ runs: [{ text: "France's debt " }, { text: 'rose', bold: false, italic: true }, { text: ' again' }] }] })
    const runs = findEl(s.deck, title)!.el.text.paragraphs[0].runs
    expect(runs.map((r: any) => [r.text, !!r.bold, !!r.italic])).toEqual([["France's debt ", true, false], ['rose', false, true], [' again', true, false]])
  })

  it('moves several elements as one undo step', async () => {
    const s = await deck()
    const [chart] = ids(s, (b) => b.kind === 'chart' && b.slide === 's_1'), [body] = ids(s, (b) => b.kind === 'text' && b.role === 'body' && b.slide === 's_1')
    const n = s.undoStack.length, a = box(s, chart!), b = box(s, body!)
    expect(s.exec({ kind: 'elements.transform', items: [{ id: chart!, box: { ...a, y: a.y + 20 } }, { id: body!, box: { ...b, y: b.y + 20 } }] }).ok).toBe(true)
    expect(s.undoStack.length).toBe(n + 1)
    expect(Math.round(box(s, chart!).y)).toBe(Math.round(a.y + 20)); expect(Math.round(box(s, body!).y)).toBe(Math.round(b.y + 20))
    s.undo(); expect(Math.round(box(s, chart!).y)).toBe(Math.round(a.y))
  })

  it('aligns and distributes top-level elements', async () => {
    const s = await deck()
    const [chart] = ids(s, (b) => b.kind === 'chart' && b.slide === 's_1'), [body] = ids(s, (b) => b.kind === 'text' && b.role === 'body' && b.slide === 's_1')
    expect(s.exec({ kind: 'elements.align', ids: [chart!, body!], mode: 'top' }).ok).toBe(true)
    expect(Math.round(box(s, chart!).y)).toBe(Math.round(box(s, body!).y))
    const three = ids(s, (b) => b.kind === 'text' && ['kicker', 'title', 'subtitle'].includes(b.role) && b.slide === 's_2')
    expect(s.exec({ kind: 'elements.distribute', ids: three, axis: 'vertical' }).ok).toBe(true)
    expect(s.exec({ kind: 'elements.distribute', ids: three.slice(0, 2), axis: 'vertical' }).error).toMatch(/at least 3/)
  })

  it('re-projects every bound value from data to repair a stale canvas', async () => {
    const s = await deck()
    const t = ids(s, (b) => b.kind === 'table')[0]!
    const f = findEl(s.deck, t)!
    s.exec({ kind: 'ops.raw', ops: [{ op: 'setTableCell', target: { slide: f.index, el: f.el.id }, row: 1, col: 1, paragraphs: [{ runs: [{ text: '9.99' }] }] }] })
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(false)
    expect(s.exec({ kind: 'deck.reproject' }).ok).toBe(true)
    expect(integrity(s.deck, s.project, s.sidecar).ok).toBe(true)
    expect(textOf(findEl(s.deck, t)!.el.rows[1][1].text)).toBe(cellText(s.project, 'ds.fr.interest', '2023'))
  })
})
