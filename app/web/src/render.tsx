// Render page (design exploration): one slide, or one design candidate, at exactly 1280 x 720 through the same
// renderer the editor uses, with no editor chrome, for real screenshots (headless Chrome) and side-by-side review.
//   ?render=1&project=<id>&slide=<n>                        an existing slide (1-based)
//   ?render=1&deck=<sha>&slide=<n> | &sheet=1&from=&to=&cols=&w=   a design-library template deck (local, private):
//                                                           one slide, or a contact sheet of a slide range
//   ?render=1&project=<id>&brief=<name>&cand=<k>            candidate k of a design brief, applied to a COPY of the
//                                                           project in memory (never saved), then drawn
// The page writes <pre id="render"> with what it drew (candidate label, QA findings) for the caller.
import React, { useEffect, useState } from 'react'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { Store } from './core/store'
import { loadFonts } from './core/fonts'
import { render, slideList } from './core/deck'
import { qaSlide } from './core/design/qa'
import { BRIEFS, composeBrief } from './core/design/briefs'

/** Every image a render tree refers to (pictures, picture fills, pattern images), loaded for the canvas. */
async function loadImages(trees: any[]): Promise<Map<string, HTMLImageElement>> {
  const urls = new Set<string>()
  const walk = (x: any) => { if (!x || typeof x !== 'object') return; for (const [k, v] of Object.entries(x)) { if (typeof v === 'string' && (k === 'dataUrl' || k === 'image') && /^(data:image|blob:)/.test(v)) urls.add(v); else if (typeof v === 'object') walk(v) } }
  trees.forEach(walk)
  const out = new Map<string, HTMLImageElement>()
  await Promise.all([...urls].map((u) => new Promise<void>((res) => { const im = new Image(); im.onload = () => { out.set(u, im); res() }; im.onerror = () => res(); im.src = u })))
  return out
}

function b64(bytes: Uint8Array) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }

/** A template deck from the private design library, opened read-only in memory. */
async function openTemplate(sha: string) {
  const r = await fetch(`/api/design-library/deck/${sha}`)
  if (!r.ok) throw new Error((await r.json()).error)
  const bytes = new Uint8Array(await r.arrayBuffer())
  return Store.fromBundle({ schema: 'frr-bundle/1', project: { schema: 'frr-project/1', id: 'template', title: 'template', datasets: {}, evidence: {}, gaps: [], design_dna: {} as any }, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: b64(bytes) } as any)
}

/** Pixel statistics of each contact-sheet cell (its Konva layers composited on white, at 64 x 36): tone, dark share,
 *  ink coverage and the most frequent saturated colours. Deterministic design signals without looking at the image. */
function cellStats(sw = 1280, sh = 720) { // the slide sits at the stage's top-left; the stage is larger (pasteboard)
  const W = 64, H = 36, c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })!
  return [...document.querySelectorAll<HTMLElement>('[data-cell]')].map((cell) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    cell.querySelectorAll('canvas').forEach((k) => { const r = k.width / (parseFloat(k.style.width) || k.width); try { g.drawImage(k, 0, 0, sw * r, sh * r, 0, 0, W, H) } catch { /* tainted: skip */ } })
    const d = g.getImageData(0, 0, W, H).data, hist = new Map<string, number>(), sat = new Map<string, number>()
    let lum = 0, dark = 0
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]], L = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255
      lum += L; if (L < 0.3) dark++
      const q = '#' + [r, gg, b].map((v) => (v >> 4).toString(16).repeat(2)).join('')
      hist.set(q, (hist.get(q) ?? 0) + 1)
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 60) sat.set(q, (sat.get(q) ?? 0) + 1)
    }
    const n = W * H, [bg, bgN] = [...hist.entries()].sort((x, y) => y[1] - x[1])[0]
    return { n: Number(cell.dataset.cell), lum: +(lum / n).toFixed(3), dark: +(dark / n).toFixed(3), ink: +(1 - bgN / n).toFixed(3), bg,
      accents: [...sat.entries()].filter(([, k]) => k / n > 0.004).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([q, k]) => [q, +(k / n).toFixed(3)]), blank: bgN / n > 0.995 }
  })
}

function SheetView({ slides, cols, w, images }: { slides: { n: number; slide: any; error?: string }[]; cols: number; w: number; images: Map<string, HTMLImageElement> }) {
  const h = Math.round((w * 9) / 16)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${w}px)`, gap: 8, padding: 8, background: '#3a3f47', width: cols * (w + 8) + 8 }}>
      {slides.map((x) => (
        <div key={x.n} data-cell={x.n} style={{ position: 'relative', width: w, height: h, background: '#fff', overflow: 'hidden' }}>
          {x.slide && <div style={{ transform: `scale(${w / x.slide.widthPx})`, transformOrigin: '0 0' }}><SlideCanvas slide={x.slide} selectedIds={[]} images={images} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} /></div>}
          {x.error && <div style={{ padding: 8, color: '#b00', font: '11px Inter' }}>render error: {x.error}</div>}
          <div style={{ position: 'absolute', left: 0, top: 0, background: '#14284B', color: '#fff', font: '600 12px Inter', padding: '2px 6px' }}>{x.n}</div>
        </div>))}
    </div>
  )
}

export function RenderView() {
  const params = new URLSearchParams(location.search)
  const [slide, setSlide] = useState<any>(null)
  const [sheet, setSheet] = useState<{ n: number; slide: any; error?: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  useEffect(() => {
    (async () => {
      const deck = params.get('deck')
      if (deck) {
        const [t, metrics] = await Promise.all([openTemplate(deck), loadFonts()])
        const total = slideList(t.deck).length, done = (meta: any) => setTimeout(() => { const pre = document.createElement('pre'); pre.id = 'render'; pre.hidden = true; pre.textContent = JSON.stringify(meta); document.body.appendChild(pre) }, 800)
        if (params.has('sheet')) {
          const from = Math.max(1, Number(params.get('from') ?? 1)), to = Math.min(total, Number(params.get('to') ?? total)), w = Number(params.get('w') ?? 360)
          const out: { n: number; slide: any; error?: string }[] = []
          for (let n = from; n <= to; n++) { try { out.push({ n, slide: render(t.deck, n - 1, 1280, metrics) }) } catch (e: any) { out.push({ n, slide: null, error: String(e?.message ?? e).slice(0, 80) }) } }
          setImages(await loadImages(out.map((x) => x.slide))); setSheet(out); setTimeout(() => done({ kind: 'sheet', total, from, to, errors: out.filter((x) => x.error).map((x) => x.n), cells: cellStats() }), 400); return
        }
        const n = Math.max(1, Number(params.get('slide') ?? 1))
        const one = render(t.deck, n - 1, 1280, metrics); (window as any).__render = one; setImages(await loadImages([one])); setSlide(one); done({ kind: 'template-slide', total, n }); return
      }
      const [live, metrics] = await Promise.all([Store.open(params.get('project')!), loadFonts()])
      live.metrics = metrics
      let s = live, index = Math.max(0, Number(params.get('slide') ?? 1) - 1), meta: any = { kind: 'slide', index: index + 1 }
      const brief = params.get('brief')
      if (brief) {
        if (!BRIEFS[brief]) throw new Error(`unknown brief ${brief}`)
        s = await Store.fromBundle(JSON.parse(JSON.stringify(await live.toBundle()))) // a copy: nothing is saved
        s.metrics = metrics
        const cands = composeBrief(s.project, brief), k = Number(params.get('cand') ?? 0), c = cands[k]
        if (!c) throw new Error(`brief ${brief} has ${cands.length} candidates`)
        if (c.problems.length) throw new Error(`candidate ${k} is not valid: ${c.problems.join('; ')}`)
        const r = s.exec({ kind: 'design.apply', design: c.design }, { actor: 'ai' })
        if (!r.ok) throw new Error(r.error)
        index = slideList(s.deck).length - 1
        meta = { kind: 'candidate', brief, cand: k, label: c.label, composition: c.design.layout, candidates: cands.length }
      }
      const out = render(s.deck, index, 1280, s.metrics)
      meta.qa = qaSlide(s, index, s.metrics).map((f) => `${f.level}:${f.code}: ${f.message}`)
      setSlide(out)
      setTimeout(() => { const pre = document.createElement('pre'); pre.id = 'render'; pre.hidden = true; pre.textContent = JSON.stringify(meta); document.body.appendChild(pre) }, 600)
    })().catch((e) => { setError(String(e?.message ?? e)); const pre = document.createElement('pre'); pre.id = 'render'; pre.hidden = true; pre.textContent = JSON.stringify({ error: String(e?.message ?? e) }); document.body.appendChild(pre) })
  }, [])
  if (error) return <pre style={{ padding: 20, color: '#b00' }}>{error}</pre>
  if (sheet) return <SheetView slides={sheet} cols={Number(params.get('cols') ?? 4)} w={Number(params.get('w') ?? 360)} images={images} />
  if (!slide) return null
  return (
    <div style={{ width: 1280, height: 720, overflow: 'hidden', position: 'absolute', left: 0, top: 0 }}>
      <SlideCanvas slide={slide} selectedIds={[]} images={images} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />
    </div>
  )
}
