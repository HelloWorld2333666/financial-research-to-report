import './platform/polyfill'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { TextEditOverlay } from '@genoffice-slides/renderer/TextEditOverlay'
import { loadFonts } from './core/fonts'
import { Store } from './core/store'
import { durableOfSource, findEl, render, sourceIdsFor, textOf } from './core/deck'
import { integrity } from './core/integrity'
import { checkText } from './core/claims'
import { effectiveObs } from './core/evidence'
import { runChecks } from './checks'
import { DataPanel, EvidencePanel, ExportDialog } from './panels'

const FIT = 800
const K = 1280 / FIT // canvas px -> slide px
const params = new URLSearchParams(location.search)

function useStore(store: Store | null) {
  useSyncExternalStore(store?.subscribe ?? (() => () => {}), () => store?.revision ?? -1)
}

function Picker({ onOpen }: { onOpen: (s: Store) => void }) {
  const [list, setList] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch('/api/projects').then((r) => r.json()).then(setList).catch(() => setList([])) }, [])
  const create = async (seed: string, title: string) => { setBusy(true); const s = await Store.create(seed, title); history.replaceState(null, '', `?project=${s.project.id}`); onOpen(s) }
  return (
    <div className="picker">
      <h1>Projects</h1>
      <div className="row"><button disabled={busy} onClick={() => create('france', 'France sovereign credit')}>New France project (verified Eurostat data)</button><button disabled={busy} onClick={() => create('blank', 'Untitled project')}>New blank project</button></div>
      {list?.length ? <ul>{list.map((p) => <li key={p.id}><a href={`?project=${p.id}`}>{p.title}</a> <span className="muted">saved {p.saved?.replace('T', ' ').slice(0, 16)} · {p.slides ?? 0} slides · {p.journal} journal entries</span></li>)}</ul> : <p className="muted">{list ? 'No projects yet.' : 'Loading…'}</p>}
    </div>
  )
}

function Workspace({ store }: { store: Store }) {
  useStore(store)
  const [cur, setCur] = useState(0)
  const [editing, setEditing] = useState<any>(null)
  const [entered, setEntered] = useState<string | null>(null)
  const [tab, setTab] = useState<'evidence' | 'data' | 'journal' | 'integrity' | 'claims' | 'versions'>('evidence')
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState('Saved')
  const [versions, setVersions] = useState<any[]>([])
  const clickedOutside = useRef(false)
  const slides = store.slides()
  const index = Math.min(cur, slides.length - 1)
  const slide = useMemo(() => render(store.deck, index, FIT, store.metrics), [store.revision, index])
  const thumbs = useMemo(() => slides.map((s) => render(store.deck, s.index, 150, store.metrics)), [store.revision, slides.length])
  const ig = useMemo(() => integrity(store.deck, store.project, store.sidecar), [store.revision])
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice((n) => (n === m ? null : n)), 4000) }
  const exec: typeof store.exec = (cmd, meta) => { const r = store.exec(cmd, meta); if (!r.ok) say(r.error!); return r }

  // autosave 1.5 s after the last change
  useEffect(() => {
    if (!store.dirty) return
    setSaveState('Unsaved changes')
    const t = setTimeout(async () => { setSaveState('Saving…'); const r = await store.save(); setSaveState(r.ok ? 'Saved' : `Save failed: ${r.error}`) }, 1500)
    return () => clearTimeout(t)
  }, [store.revision])
  const loadVersions = () => fetch(`/api/projects/${store.project.id}/versions`).then((r) => r.json()).then(setVersions)
  useEffect(() => { if (tab === 'versions') loadVersions() }, [tab])

  // ---- canvas -> commands (selection is held as durable ids)
  const durable = (sourceId: string) => durableOfSource(store.deck, index, sourceId)
  const nodeOf = (sourceId: string) => { const f = (ns: any[]): any => { for (const n of ns) { if (n.sourceId === sourceId) return n; if (n.children) { const c = f(n.children); if (c) return c } } }; return f(slide.nodes as any[]) }
  const onSelect = (sourceId: string | null, additive?: boolean) => {
    if (sourceId == null) { store.select([]); setEntered(null); return }
    const d = durable(sourceId); if (!d) return
    store.select(additive ? (store.selection.includes(d) ? store.selection.filter((x) => x !== d) : [...store.selection, d]) : [d])
  }
  const onTransform = (sourceId: string, b: any, preview?: boolean) => {
    if (preview) return // the canvas previews the drag locally; commit once at the end
    const d = durable(sourceId); if (d) exec({ kind: 'element.transform', id: d, box: { x: b.x * K, y: b.y * K, w: b.w * K, h: b.h * K }, rotDeg: b.rotationDeg })
  }
  // a multi-selection gesture is ONE step (M1 committed one step per element)
  const onTransformMulti = (items: any[]) => exec({ kind: 'elements.transform', items: items.map((it) => ({ id: durable(it.sourceId)!, box: { x: it.box.x * K, y: it.box.y * K, w: it.box.w * K, h: it.box.h * K }, rotDeg: it.box.rotationDeg })).filter((it) => it.id) })
  const onEditText = (sourceId: string, caret?: any) => {
    const d = durable(sourceId); const b = d ? store.sidecar.bindings[d] : undefined
    if (b && b.kind !== 'text') return say(`${b.kind === 'chart' ? 'Chart' : 'This'} content comes from data; edit the data instead`)
    if (d && nodeOf(sourceId)) setEditing({ id: d, caret })
  }
  // GenOffice's rich-text editor commits EditParagraph[] (runs keep bold/italic/size/colour); Escape cancels
  const commitText = (paragraphs: any[]) => { const ed = editing; setEditing(null); if (ed?.id) exec({ kind: 'text.set', id: ed.id, paragraphs }) }
  const onEditTableCell = (sourceId: string, row: number, col: number) => {
    const d = durable(sourceId); const b: any = d ? store.sidecar.bindings[d] : undefined
    if (!b || b.kind !== 'table' || row < 1 || col < 1) return
    const ds = b.table.datasets[row - 1], date = b.table.dates[col - 1], n = nodeOf(sourceId)
    const cell = (n.cells || []).find((c: any) => c.row === row && c.col === col)
    const v = String(effectiveObs(store.project.datasets[ds]).find((o) => o.date === date)?.value ?? '')
    setEditing({ cell: { ds, date }, value: v, initial: v, box: cell ? { x: n.box.x + cell.x, y: n.box.y + cell.y, w: cell.w, h: cell.h } : n.box })
  }
  const commitEdit = () => {
    const ed = editing; setEditing(null); if (!ed || ed.value === ed.initial) return
    if (ed?.cell) {
      const v = ed.value.trim() === '' ? null : Number(ed.value)
      if (v !== null && !Number.isFinite(v)) return say('Not a number')
      exec({ kind: 'data.set', dataset: ed.cell.ds, date: ed.cell.date, value: v })
    }
  }
  useEffect(() => {
    clickedOutside.current = false
    if (!editing) return
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.edit-overlay')) clickedOutside.current = true }
    addEventListener('pointerdown', down, true); return () => removeEventListener('pointerdown', down, true)
  }, [!!editing])
  const keepFocus = (e: React.FocusEvent<any>) => { if (!clickedOutside.current) { const t = e.target; setTimeout(() => t.isConnected && t.focus(), 0); return } commitEdit() }

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest('input,textarea')) return
      const m = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), sel = store.selection
      if (m && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() }
      else if (m && k === 'g' && !e.shiftKey && sel.length >= 2) { e.preventDefault(); exec({ kind: 'element.group', ids: sel }) }
      else if (m && k === 'g' && e.shiftKey && sel.length === 1) { e.preventDefault(); exec({ kind: 'element.ungroup', id: sel[0]! }) }
      else if (m && k === 'c' && sel.length) { say(`Copied ${store.copy(sel)}`) }
      else if (m && k === 'v' && store.clipboard.length) { e.preventDefault(); const r = exec({ kind: 'clipboard.paste', slide: slides[index]!.id, items: store.clipboard }); if (r.ok) store.select(r.created!) }
      else if ((k === 'backspace' || k === 'delete') && sel.length) { e.preventDefault(); exec({ kind: 'element.delete', ids: sel }) }
    }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [editing, index, store])

  const draftDeck = async () => {
    const { slides: props } = await (await fetch('/api/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: store.project }) })).json()
    for (const p of props) exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai', proposalId: `compose:${p.key}` })
  }
  const claims = useMemo(() => Object.entries(store.sidecar.bindings).filter(([, b]) => b.kind === 'text' && ['title', 'body'].includes((b as any).role) && b.slide === slides[index]?.id)
    .flatMap(([id]) => { const f = findEl(store.deck, id); return f ? checkText(textOf(f.el), store.project) : [] }), [store.revision, index])
  const enteredSource = entered ? sourceIdsFor(slide, [entered])[0] ?? null : null
  ;(window as any).__ws = { store, setCur }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./">Research-to-Report</a><span>{store.project.title}</span>
        <button onClick={() => store.undo()} disabled={!store.undoStack.length}>Undo</button><button onClick={() => store.redo()} disabled={!store.redoStack.length}>Redo</button>
        {slides.length === 1 && !store.deck.deck.slides[0]!.elements.length && Object.keys(store.project.datasets).length > 0 && <button className="primary" onClick={draftDeck}>Draft deck from evidence</button>}
        <button onClick={async () => { const v = await store.saveVersion(`Version ${new Date().toLocaleString()}`); say(`Saved version ${v.version}`); if (tab === 'versions') loadVersions() }}>Save version</button>
        {editing && !editing.cell && <span className="format" role="toolbar" aria-label="Text format">
          {/* mousedown + preventDefault keeps focus and the selection in the editor; the editor reads bold/italic/underline back from the DOM on commit */}
          {([['bold', 'B'], ['italic', 'I'], ['underline', 'U']] as const).map(([cmd, label]) => <button key={cmd} title={cmd} className={'fmt-' + cmd} onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd) }}>{label}</button>)}
        </span>}
        {store.selection.length >= 2 && <span className="align" role="toolbar" aria-label="Align">
          {(['left', 'centerH', 'right', 'top', 'centerV', 'bottom'] as const).map((m) => <button key={m} title={`Align ${m}`} onClick={() => exec({ kind: 'elements.align', ids: store.selection, mode: m })}>{{ left: '⇤', centerH: '↔', right: '⇥', top: '⤒', centerV: '↕', bottom: '⤓' }[m]}</button>)}
          {store.selection.length >= 3 && (['horizontal', 'vertical'] as const).map((a) => <button key={a} title={`Distribute ${a}`} onClick={() => exec({ kind: 'elements.distribute', ids: store.selection, axis: a })}>{a === 'horizontal' ? '⋯' : '⋮'}</button>)}
        </span>}
        <span className="status" data-save={saveState}>{saveState}</span>
        <button onClick={() => setExporting(true)} disabled={!store.deck.deck.slides[0]?.elements.length}>Export…</button>
      </header>
      <main className="body">
        <aside className="rail">{thumbs.map((t, i) => (
          <div key={slides[i]!.id} className={'thumb' + (i === index ? ' current' : '')} data-slide={slides[i]!.id} onClick={() => { setCur(i); store.select([]) }}>
            <div className="thumb-canvas" style={{ transform: `scale(${150 / t.widthPx})` }}><SlideCanvas slide={t} selectedIds={[]} images={new Map()} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} /></div>
            <span>{i + 1}</span>
          </div>))}</aside>
        <section className="stage">
          {notice && <div className="notice" role="status">{notice}</div>}
          <div className="sheet" style={{ width: FIT, height: (FIT * 9) / 16 }}>
            <SlideCanvas slide={slide} selectedIds={sourceIdsFor(slide, store.selection)} images={new Map()} zoom={1}
              onSelect={onSelect} onEditText={onEditText} onTransform={onTransform} onTransformMulti={onTransformMulti} onEditTableCell={onEditTableCell}
              onContextMenu={() => {}} onTableColResize={() => {}} onMarqueeSelect={(ids) => store.select(ids.map(durable).filter(Boolean) as string[])}
              enteredGroupId={enteredSource} onEnterGroup={(g, c) => { setEntered(durable(g)); store.select(c ? [durable(c)!].filter(Boolean) : []) }}
              editingText={editing && !editing.cell ? { sourceId: sourceIdsFor(slide, [editing.id])[0]! } : null} />
            {editing && (editing.cell
              ? <input className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }} onBlur={keepFocus} style={{ left: editing.box.x, top: editing.box.y, width: editing.box.w, height: editing.box.h, textAlign: 'right' }} />
              : (() => { const src = sourceIdsFor(slide, [editing.id])[0]; const n = src && nodeOf(src)
                  return n ? <TextEditOverlay key={editing.id} node={n} scale={slide.scale} caretPoint={editing.caret} onCommit={commitText} onCancel={() => setEditing(null)} zoom={1} /> : null })())}
          </div>
          <div className="statusline"><span className={ig.ok ? 'good' : 'bad'}>Integrity {ig.ok ? 'OK' : 'MISMATCH'}</span>{ig.mismatch.some((m) => !m.startsWith('text says')) && <> <button onClick={() => exec({ kind: 'deck.reproject' })}>Re-project from data</button></>}{ig.mismatch.some((m) => m.startsWith('text says')) && <> <button className="link" onClick={() => setTab('integrity')}>text disagrees with data</button></>} · {ig.resolved}/{ig.bindings} bindings · {ig.points} chart points · {ig.cells} table cells · {ig.sourced}/{ig.figures} figures in text sourced · {ig.unverified} unverified edits · selected {store.selection.length}</div>
        </section>
        <aside className="panel">
          <nav className="tabs">{(['evidence', 'data', 'journal', 'integrity', 'claims', 'versions'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} data-tab={t} onClick={() => setTab(t)}>{t}</button>)}</nav>
          {tab === 'evidence' && <EvidencePanel store={store} />}
          {tab === 'data' && <DataPanel store={store} exec={exec} />}
          {tab === 'journal' && <ol className="journal">{[...store.journal].reverse().map((j) => <li key={j.seq} data-actor={j.actor}><b>{j.actor}</b> {j.summary}<span className="muted"> · {j.at.slice(11, 19)}</span></li>)}</ol>}
          {tab === 'integrity' && <div>{ig.ok ? <p className="good">Every bound value matches the working layer.</p> : ig.mismatch.slice(0, 20).map((m) => <p key={m} className="bad">{m}</p>)}</div>}
          {tab === 'claims' && <div>{claims.length ? claims.map((c, i) => <div key={i} className={'claim ' + c.status}><div>{c.text}</div><div className="muted">{c.status}: {c.detail}</div></div>) : <p className="muted">No numeric claims on this slide.</p>}</div>}
          {tab === 'versions' && <ul>{versions.map((v) => <li key={v.version}>{v.version}. {v.label} <span className="muted">· {v.journal} entries</span></li>)}</ul>}
        </aside>
      </main>
      {exporting && <ExportDialog store={store} close={() => setExporting(false)} reproject={() => exec({ kind: 'deck.reproject' })} />}
    </div>
  )
}

function App() {
  const [store, setStore] = useState<Store | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (params.has('checks')) { runChecks().then((r) => { const pre = document.createElement('pre'); pre.id = 'checks'; pre.hidden = true; pre.textContent = JSON.stringify(r); document.body.appendChild(pre) }); return }
    const id = params.get('project')
    if (id) Promise.all([Store.open(id), loadFonts()]).then(([s, m]) => { s.metrics = m; setStore(s) }).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { // ?selftest=1: headless boot check
    if (!params.has('selftest')) return
    Promise.all([fetch('/api/health').then((r) => r.json()), Store.fromBundle({ schema: 'frr-bundle/1', project: { schema: 'frr-project/1', id: 'selftest', title: 'Self test', datasets: {}, evidence: {}, gaps: [], design_dna: {} as any }, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })])
      .then(([h, s]) => { const r = render(s.deck, 0, FIT, s.metrics); const pre = document.createElement('pre'); pre.id = 'selftest'; pre.hidden = true; pre.textContent = JSON.stringify({ booted: true, api: h, slides: s.slides().map((x) => x.id), width: r.widthPx, canvas: true }); document.body.appendChild(pre) })
  }, [])
  if (params.has('checks')) return <div className="picker"><h1>Running checks…</h1></div>
  if (error) return <div className="picker"><h1>Could not open the project</h1><p>{error}</p><a href="./">Back to projects</a></div>
  return store ? <Workspace store={store} /> : <Picker onOpen={(s) => loadFonts().then((m) => { s.metrics = m; setStore(s) })} />
}

createRoot(document.getElementById('root')!).render(<App />)
