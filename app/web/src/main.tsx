import './platform/polyfill'
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { blankSession, renderSlide, slideIds, type Session } from './engine/session'

const FIT = 800

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<any>(null)
  useEffect(() => {
    blankSession().then(setSession).catch((e) => setError(String(e)))
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }))
  }, [])
  const slide = useMemo(() => (session ? renderSlide(session, 0, FIT) : null), [session])

  // ?selftest=1: headless boot check (app/server/tests/test_web_boot.py reads <pre id="selftest">)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('selftest') || !slide || !health) return
    const pre = document.createElement('pre'); pre.id = 'selftest'; pre.hidden = true
    pre.textContent = JSON.stringify({ booted: true, slides: slideIds(session!), width: slide.widthPx, height: slide.heightPx, canvas: !!document.querySelector('canvas'), api: health })
    document.body.appendChild(pre)
  }, [slide, health])

  return (
    <div className="app">
      <header className="topbar"><span className="brand">Research-to-Report</span><span className="muted">Untitled project</span><span className="status">{health?.ok ? 'Service connected' : 'Service offline'}</span></header>
      <main className="body">
        <aside className="rail">{session && slideIds(session).map((id, i) => <div key={id} className="thumb">{i + 1}</div>)}</aside>
        <section className="stage">
          {error && <div className="error">Could not start the deck engine: {error}</div>}
          <div className="sheet" style={{ width: FIT, height: (FIT * 9) / 16 }}>
            {slide && <SlideCanvas slide={slide} selectedIds={[]} images={new Map()} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />}
          </div>
        </section>
        <aside className="panel"><p className="muted">Chat, data, evidence, claims and tasks arrive in M1–M5.</p></aside>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
