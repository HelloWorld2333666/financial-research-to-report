// VIS V0 patches: 0005 (a chart rebuild keeps gaps) and 0006 (honest stacks, area gaps and overlap,
// scatter axis near the data). Each test states what used to happen.
import { describe, expect, it } from 'vitest'
import { createBlankPptx, openPptx, materializeSlide } from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { buildRenderSlide, HeuristicMetrics } from '@genoffice/pptx-render'

const EMU = 9525
const CATS = ['2022', '2023', '2024', '2025']
const SERIES = [{ name: 'France', values: [111.4, null, 112.6, 115.7] }, { name: 'Germany', values: [64.1, 62.6, 62.9, 62.8] }]

async function chart(kind: string, extra: Record<string, unknown> = {}, series: any[] = SERIES, categories = CATS) {
  const deck = await openPptx(await createBlankPptx())
  const r = runTxn(deck, { ops: [{ op: 'addChart', target: { slide: 0 }, kind, categories, series, offset: { x: 40 * EMU, y: 40 * EMU, cx: 720 * EMU, cy: 360 * EMU }, ...extra } as any] })
  expect(r.applied).toBe(true)
  materializeSlide(deck, 0)
  return deck
}
const el = (deck: any) => deck.deck.slides[0].elements.find((e: any) => e.type === 'chart')
const node = (deck: any): any => buildRenderSlide(deck.deck.slides[0], deck.deck.size, { fitWidthPx: 1280, metrics: new HeuristicMetrics(), slideNo: 1 }).nodes.find((n: any) => n.type === 'chart')
const edit = (deck: any, patch: any) => { expect(runTxn(deck, { ops: [{ op: 'setChart', target: { slide: 0, el: el(deck).id }, patch }] }).applied).toBe(true); materializeSlide(deck, 0) }

describe('patch 0005: chart rebuilds keep gaps', () => {
  it('keeps a missing value missing through a type change, a style-only edit and a row/column swap', async () => {
    const deck = await chart('line')
    edit(deck, { kind: 'bar' }) // used to write 0
    expect(el(deck).chart.series[0].values).toEqual([111.4, null, 112.6, 115.7])
    edit(deck, { colorScheme: ['#1f4e9c', '#c8102e'] })
    expect(el(deck).chart.series[0].values[1]).toBeNull()
    edit(deck, { switchRowCol: true })
    expect(el(deck).chart.categories).toEqual(['France', 'Germany'])
    expect(el(deck).chart.series[1]).toMatchObject({ name: '2023', values: [null, 62.6] }) // France 2023 stays missing
  })
})

describe('patch 0006: stacks never show a false total', () => {
  for (const [kind, extra] of [['barStacked', {}], ['barPercentStacked', {}], ['barStacked', { barDir: 'bar' }]] as const) {
    it(`leaves an incomplete category empty in ${kind}${'barDir' in extra ? ' (horizontal)' : ''}`, async () => {
      const n = node(await chart(kind, extra))
      expect(n.bars.length).toBe(6) // 3 complete categories x 2 series; 2023 (France missing) draws nothing — used to draw Germany alone
    })
  }
  it('leaves complete stacks unaffected', async () => {
    const n = node(await chart('barStacked', {}, [{ name: 'A', values: [1, 2, 3, 4] }, { name: 'B', values: [1, 2, 3, 4] }]))
    expect(n.bars.length).toBe(8)
  })
  // Stacked areas get the same rule in the renderer, but our chart writer cannot create a stacked
  // area (no such insert kind), so that path is only exercised by decks made elsewhere.
})

describe('patch 0006: area charts', () => {
  const CATS5 = ['2021', '2022', '2023', '2024', '2025']
  const AREA = [{ name: 'France', values: [110.0, 111.4, null, 112.6, 115.7] }, { name: 'Germany', values: [68.1, 64.1, 62.6, 62.9, 62.8] }]
  it('breaks at gaps and draws overlapping series translucent', async () => {
    const n = node(await chart('area', {}, AREA, CATS5))
    expect(n.polylines.length).toBe(3) // France in two pieces around 2023 (used to be one shape across the gap) + Germany
    expect(n.polylines.every((p: any) => /^#[0-9a-f]{6}8c$/i.test(p.fill))).toBe(true) // used to be opaque: a later series hid an earlier one
  })
  it('keeps a single area series opaque', async () => {
    const n = node(await chart('area', {}, [AREA[1]], CATS5))
    expect(n.polylines.map((p: any) => p.fill)).toEqual([n.polylines[0].color])
  })
})

describe('patch 0006: scatter axes start near the data', () => {
  it('puts years on a 2021-2026 axis in whole-year steps (used to be 0-2,500)', async () => {
    const n = node(await chart('scatter'))
    // the x-axis tick labels follow the y-axis labels; labels use thousands separators
    const nums = n.labels.map((l: any) => Number(String(l.text).replace(/,/g, ''))).filter((v: number) => Number.isFinite(v))
    const years = nums.filter((v: number) => v >= 1900)
    expect(years).toEqual([2021, 2022, 2023, 2024, 2025, 2026])
    expect(nums).not.toContain(2500)
  })
  it('still starts at zero when the data spread is wide', async () => {
    const n = node(await chart('scatter', {}, [{ name: 'A', values: [5, 40, 80, 120] }], ['10', '50', '90', '130']))
    expect(n.labels.some((l: any) => l.text === '0')).toBe(true)
  })
})
