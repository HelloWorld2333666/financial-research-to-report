// Render page (design exploration): one slide, or one design candidate, at exactly 1280 x 720 through the same
// renderer the editor uses, with no editor chrome, for real screenshots (headless Chrome) and side-by-side review.
//   ?render=1&project=<id>&slide=<n>                        an existing slide (1-based)
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

export function RenderView() {
  const params = new URLSearchParams(location.search)
  const [slide, setSlide] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    (async () => {
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
  if (!slide) return null
  return (
    <div style={{ width: 1280, height: 720, overflow: 'hidden', position: 'absolute', left: 0, top: 0 }}>
      <SlideCanvas slide={slide} selectedIds={[]} images={new Map()} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />
    </div>
  )
}
