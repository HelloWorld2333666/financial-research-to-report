// Patch 0001 (vendor/genoffice/patches): missing values break chart lines instead of being bridged.
import { describe, expect, it } from 'vitest'
import { createBlankPptx, openPptx, materializeSlide } from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { buildRenderSlide, HeuristicMetrics } from '@genoffice/pptx-render'

async function lineChart(values: (number | null)[]) {
  const deck = await openPptx(await createBlankPptx())
  const r = runTxn(deck, { ops: [{ op: 'addChart', target: { slide: 0 }, kind: 'line', title: 'Debt', categories: values.map((_, i) => String(2020 + i)), series: [{ name: 'Italy', values }], offset: { x: 0, y: 0, cx: 6096000, cy: 3429000 } }] })
  expect(r.applied).toBe(true)
  materializeSlide(deck, 0)
  const el: any = deck.deck.slides[0]!.elements.find((e: any) => e.type === 'chart')
  const render = buildRenderSlide(deck.deck.slides[0]!, deck.deck.size, { fitWidthPx: 960, metrics: new HeuristicMetrics() })
  const node: any = render.nodes.find((n: any) => n.type === 'chart')
  return { el, lines: node.polylines.filter((p: any) => !p.closed && p.points.length >= 4) }
}

describe('chart gaps', () => {
  it('writes and parses dispBlanksAs="gap" and keeps the missing value as null', async () => {
    const { el } = await lineChart([106.5, 105.4, null, 110.9, 112.0])
    expect(el.chart.dispBlanksAs).toBe('gap')
    expect(el.chart.series[0].values[2]).toBeNull()
  })

  it('draws two line segments around a missing value, not one bridged line', async () => {
    const { lines } = await lineChart([106.5, 105.4, null, 110.9, 112.0])
    // two data segments (2020–21, 2023–24) plus the 2-point legend swatch; nothing bridges 2022
    expect(lines.map((p: any) => p.points.length / 2).sort()).toEqual([2, 2, 2])
  })

  it('draws one continuous line when nothing is missing', async () => {
    const { lines } = await lineChart([106.5, 105.4, 109.1, 110.9, 112.0])
    expect(lines.map((p: any) => p.points.length / 2).sort()).toEqual([2, 5])
  })
})
