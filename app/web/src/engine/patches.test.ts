// Patches 0002 (paste makes independent charts) and 0003 (automatic axis-label thinning).
import { describe, expect, it } from 'vitest'
import { createBlankPptx, openPptx, materializeSlide, copyElementData } from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { buildRenderSlide, HeuristicMetrics } from '@genoffice/pptx-render'

const EMU = 9525
async function deckWithChart(categories: string[], values: number[], widthPx = 720) {
  const deck = await openPptx(await createBlankPptx())
  const r = runTxn(deck, { ops: [{ op: 'addChart', target: { slide: 0 }, kind: 'line', title: 'Debt', categories, series: [{ name: 'France', values }], offset: { x: 40 * EMU, y: 40 * EMU, cx: widthPx * EMU, cy: 360 * EMU } }] })
  expect(r.applied).toBe(true)
  materializeSlide(deck, 0)
  return deck
}
const charts = (deck: any) => deck.deck.slides[0].elements.filter((e: any) => e.type === 'chart')
const chartPart = (deck: any, el: any) => {
  const rid = /r:id="([^"]+)"/.exec(el.anchor.originalXml)![1]
  return deck.archive.readRels(deck.deck.slides[0].path).get(rid).target as string
}

describe('paste (patch 0002)', () => {
  it('gives the pasted chart its own chart part, so editing it leaves the original unchanged', async () => {
    const deck = await deckWithChart(['2023', '2024', '2025'], [109.5, 112.6, 115.7])
    const [orig] = charts(deck)
    const item = copyElementData(deck, deck.deck.slides[0], orig)
    expect(runTxn(deck, { ops: [{ op: 'pasteElements', target: { slide: 0 }, items: [item], dx: 16 * EMU, dy: 16 * EMU }] }).applied).toBe(true)
    materializeSlide(deck, 0)
    const [a, b] = charts(deck)
    expect(chartPart(deck, a)).not.toBe(chartPart(deck, b))
    expect(runTxn(deck, { ops: [{ op: 'setChart', target: { slide: 0, el: b.id }, patch: { categories: ['2023', '2024', '2025'], series: [{ name: 'France', values: [1, 2, 3] }] } }] }).applied).toBe(true)
    materializeSlide(deck, 0)
    const [a2, b2] = charts(deck)
    expect(a2.chart.series[0].values).toEqual([109.5, 112.6, 115.7])
    expect(b2.chart.series[0].values).toEqual([1, 2, 3])
  })
})

describe('axis labels (patch 0003)', () => {
  const years = Array.from({ length: 25 }, (_, i) => String(2002 + i))
  const labels = (deck: any) => {
    const r = buildRenderSlide(deck.deck.slides[0], deck.deck.size, { fitWidthPx: 960, metrics: new HeuristicMetrics() })
    const node: any = r.nodes.find((n: any) => n.type === 'chart')
    return node.labels.filter((l: any) => /^20\d\d$/.test(l.text))
  }

  it('thins 25 crowded year labels so none overlap', async () => {
    const shown = labels(await deckWithChart(years, years.map((_, i) => 60 + i)))
    expect(shown.length).toBeLessThan(25)
    expect(shown[0].text).toBe('2002')
    const m = new HeuristicMetrics()
    const right = (l: any) => l.x + m.measure(l.text, { fontSizePx: l.fontSizePx } as any)
    for (let i = 1; i < shown.length; i++) expect(shown[i].x).toBeGreaterThan(right(shown[i - 1]))
  })

  it('keeps every label when there is room', async () => {
    expect(labels(await deckWithChart(['2023', '2024', '2025'], [1, 2, 3])).length).toBe(3)
  })
})
