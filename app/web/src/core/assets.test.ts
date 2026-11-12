import { describe, expect, it } from 'vitest'
import { ASSETS, assetKeys, flattenPath, iconMarks, iconRuns, mapMarks, projector } from './design/assets'
import { groupXml } from './composite'
import { languageOf } from './design/language'
import { validateDesign, DESIGN_SCHEMA, type SlideDesign } from './design/spec'

describe('icons: SVG line icons become vector paths', () => {
  it('flattens lines, curves, arcs and closes subpaths', () => {
    const runs = flattenPath('M2 2h10v10z M20 4a2 2 0 1 0 0 4')
    expect(runs.length).toBe(2)
    expect(runs[0]![0]).toEqual([2, 2])
    expect(runs[0]![runs[0]!.length - 1]).toEqual([2, 2]) // closed back to the start
    const end = runs[1]![runs[1]!.length - 1]!
    expect(end[0]).toBeCloseTo(20, 5); expect(end[1]).toBeCloseTo(8, 5)
  })
  it('reads circles, rects and lines with numbered attributes (x1, y1)', () => {
    const runs = iconRuns('<svg><circle cx="6" cy="6" r="2"/><line x1="19" x2="5" y1="5" y2="19"/><rect x="2" y="2" width="4" height="4" rx="1"/></svg>')
    expect(runs.length).toBe(3)
    expect(runs[1]).toEqual([[19, 5], [5, 19]])
  })
  it('scales an icon into its box as one stroked shape', () => {
    ASSETS.set('icon:test', { meta: { key: 'icon:test', kind: 'icon', license: 'ISC', attribution: 'test', source_url: '', media_type: 'image/svg+xml' }, svg: '<svg><line x1="0" y1="0" x2="24" y2="24"/></svg>' })
    const m = iconMarks('icon:test', { x: 100, y: 50, w: 48, h: 48 }, '#0D4A64')!
    expect(m[0]!.kind).toBe('path')
    expect((m[0] as any).paths[0]).toEqual([[100, 50], [148, 98]])
    expect(iconMarks('icon:missing', { x: 0, y: 0, w: 10, h: 10 }, '#000')).toBeNull()
  })
})

describe('maps: country geometry becomes editable filled shapes', () => {
  // a two-country topology: a square "Bahrain" (048) and a square "Qatar" (634), in degrees
  const topo = { type: 'Topology', transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [[[50, 25], [1, 0], [0, 1], [-1, 0], [0, -1]], [[52, 24], [1, 0], [0, 2], [-1, 0], [0, -2]]],
    objects: { countries: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: '048', properties: { name: 'Bahrain' }, arcs: [[0]] }, { type: 'Polygon', id: '634', properties: { name: 'Qatar' }, arcs: [[1]] }] } } }
  ASSETS.set('geo:countries-50m', { meta: { key: 'geo:countries-50m', kind: 'geo', license: 'PD', attribution: 'Natural Earth', source_url: '', media_type: 'application/json' }, json: topo })
  const L = languageOf('atlas'), box = { x: 0, y: 0, w: 400, h: 300 }
  const spec = { view: [48, 22, 56, 28] as [number, number, number, number], regions: [{ geo: 'BH', tone: 'focus' as const }],
    routes: [{ id: 'lane', path: [[40, 26], [51, 26.5], [55, 26]] as [number, number][], style: 'disrupted' as const }],
    points: [{ id: 'far', lon: 10, lat: 10, label: 'Outside' }], labels: [{ lon: 53, lat: 23, text: 'Qatar' }] }
  const marks = mapMarks(spec, box, L)!
  it('fills each country, the focus region in the structure colour', () => {
    const bh = marks.find((m) => m.name === 'frr-map BH') as any, qa = marks.find((m) => m.name === 'frr-map QA') as any
    expect(bh.fill).toBe(L.color.navy); expect(bh.closed).toBe(true)
    expect(qa.fill).toBe('#FFFFFF')
  })
  it('clips routes to the map and drops points outside it', () => {
    const lane = marks.find((m) => m.name === 'frr-route lane') as any
    for (const [x, y] of lane.paths.flat()) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(400); expect(y).toBeGreaterThanOrEqual(0) }
    expect(marks.some((m) => m.name.startsWith('frr-point far'))).toBe(false)
    expect(marks.some((m) => m.name === 'frr-map label Qatar')).toBe(true)
  })
  it('projects inside the box and writes filled custom geometry', () => {
    const P = projector(spec.view, box), [x, y] = P(52, 25)
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(400); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(300)
    const xml = groupXml(marks, { guid: '00000000-0000-0000-0000-000000000000', id: 10, name: 'frr-map test', place: { x: 0, y: 0, cx: 1, cy: 1 }, size: { w: 400, h: 300 }, font: 'Inter' })
    expect(xml).toContain('<a:close/>')
    expect(xml).toMatch(/<a:custGeom>.*<a:path w="\d+" h="\d+">/)
  })
})

describe('plans name their assets; designs keep figures off maps and pictures', () => {
  it('collects asset keys from images, maps, cells, nodes, marks and flagged charts', () => {
    const keys = assetKeys([
      { kind: 'image', asset: 'commons:X.jpg' }, { kind: 'map', map: { view: [0, 0, 1, 1] } }, { kind: 'text', cell: { r: 0, c: 0, flag: 'BH', icon: 'ship' } },
      { kind: 'kpi', mark: 'flag:eg' }, { kind: 'kpi', node: { r: 0, c: 0, icon: 'percent' } }, { kind: 'viz', draw: { flags: true }, request: { datasets: ['ds.qa.growth'] } },
    ], (ds) => ds.split('.')[1])
    expect(keys.sort()).toEqual(['commons:X.jpg', 'flag:bh', 'flag:eg', 'flag:qa', 'geo:countries-50m', 'icon:percent', 'icon:ship'].sort())
  })
  it('refuses figures in map labels, bad asset keys and anchors to a missing map', () => {
    const p: any = { datasets: {}, evidence: {}, derivations: {} }
    const d: SlideDesign = { schema: DESIGN_SCHEMA, id: 't', objective: 'o', claim: { text: 'c' }, audience: 'executive', density: 'low', profile: 'institutional', language: 'atlas', rationale: [],
      layout: { family: 'composed', params: {}, composition: { kind: 'columns', params: { columns: [{ span: 12, slots: ['m'] }] } } },
      objects: [{ id: 'h', kind: 'text', role: 'headline', text: { text: 'Head' } },
        { id: 'm', kind: 'map', role: 'primary', slot: 'm', map: { view: [0, 0, 10, 10], labels: [{ lon: 1, lat: 1, text: 'Growth 5%' }] } },
        { id: 'i', kind: 'image', role: 'photo', asset: 'http://example.com/x.jpg', slot: 'm' },
        { id: 'k', kind: 'text', role: 'note', text: { text: 'pinned' }, anchor: { map: 'nomap', lon: 1, lat: 1 } }] as any }
    const errs = validateDesign(p, d).join('\n')
    expect(errs).toMatch(/map labels carry names only/)
    expect(errs).toMatch(/not an asset key/)
    expect(errs).toMatch(/not a map on this slide/)
  })
})

describe('deck identity and geography details', () => {
  it('derives an identity from one primary colour and recolours the structure roles', async () => {
    const { registerIdentity, languageOf } = await import('./design/language')
    const id = registerIdentity({ id: 'test-identity', primary: '#6E1F3B', type: 'sans' })
    const L = languageOf(id)
    expect(L.color.navy).toBe('#6E1F3B')
    expect(L.type.hero.color).toBe('#6E1F3B') // was the base structure colour
    expect(L.type.headline.font).toBe('Inter')
    expect(languageOf('atlas').color.navy).toBe('#0D4A64') // the base language is untouched
  })
  it('normalises statistical country codes for flags', async () => {
    const { normKey } = await import('./design/assets')
    expect(normKey('flag:el')).toBe('flag:gr'); expect(normKey('flag:UK')).toBe('flag:gb'); expect(normKey('flag:BR')).toBe('flag:br')
  })
  it('never draws a ring that crosses the 180th meridian across the map', () => {
    const topo = { type: 'Topology', transform: { scale: [1, 1], translate: [0, 0] },
      arcs: [[[178, -17], [4, 0], [0, 1], [-4, 0], [0, -1]]], // 178 → 182 (written as -178 by the source after wrapping)
      objects: { countries: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: '242', properties: { name: 'Fiji' }, arcs: [[0]] }] } } }
    // the source writes the far side as negative longitudes: rewrite the decoded arc that way
    topo.arcs = [[[178, -17], [-356, 0], [0, 1], [356, 0], [0, -1]]] as any
    ASSETS.set('geo:countries-50m', { meta: { key: 'geo:countries-50m', kind: 'geo', license: 'PD', attribution: '', source_url: '', media_type: 'application/json' }, json: topo })
    const marks = mapMarks({ view: [-120, -56, -30, 33] }, { x: 0, y: 0, w: 600, h: 700 }, languageOf('atlas'))!
    expect(marks.some((m) => m.name === 'frr-map FJ')).toBe(false) // far outside the Americas once unwrapped
  })
})
