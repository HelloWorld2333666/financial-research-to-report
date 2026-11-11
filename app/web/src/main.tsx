import './platform/polyfill'
import './styles.css'
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
import { localTime } from './core/time'
import { RenderView } from './render'
import { useImages } from './core/images'
import { qaDeck, qaSlide } from './core/design/qa'
import { planSlide } from './core/design/planner'
import { DataPanel, EvidencePanel, ExportDialog, TasksPanel } from './panels'
// the chat (assistant-ui, AG-UI: about 0.7 MB) loads after the deck has drawn
const ChatPanel = React.lazy(() => import('./chat').then((m) => ({ default: m.ChatPanel })))
/** A thread the chat library cannot restore (e.g. a malformed saved message) must not take the editor down with it. */
class ChatBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: any) { return { error: String(e?.message ?? e) } }
  render() { return this.state.error ? <p className="bad small" data-chat-error>The chat could not open this thread ({this.state.error}). The deck and its data are unaffected.</p> : this.props.children }
}
import { changeOptions, type Intent } from './core/recommend'
import type { Command } from './core/commands'
import type { Finding } from './core/constraints'
import { Icon, IconButton, Menu, TooltipProvider, isDark, useTheme } from './ui'
import * as Dialog from '@radix-ui/react-dialog'

const FIT = 800 // default canvas width (self-test); the workspace fits the canvas to the stage
const PANEL_BREAK = 1280 // below this the panel is a drawer (Phase 1 defect 1)
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
      <div className="picker-head"><span className="brand-mark">R</span><h1>Research-to-Report</h1></div>
      <div className="row"><button className="primary" disabled={busy} onClick={() => create('france', 'France sovereign credit')}>New France project (verified Eurostat data)</button><button disabled={busy} onClick={() => create('blank', 'Untitled project')}>New blank project</button></div>
      {list?.length ? <ul className="project-grid">{list.map((p) => <li key={p.id}><a className="project-card" href={`?project=${p.id}`}><b>{p.title}</b><span>{p.slides ?? 0} slides · {p.journal} journal entries</span><span>Saved {localTime(p.saved)}</span></a></li>)}</ul> : <p className="muted">{list ? 'No projects yet.' : 'Loading…'}</p>}
    </div>
  )
}

function Workspace({ store }: { store: Store }) {
  useStore(store)
  // ?slide=N opens slide N (1-based), e.g. for a screenshot of a given slide
  const [cur, setCur] = useState(() => Math.max(0, Number(new URLSearchParams(location.search).get('slide') ?? 1) - 1) || 0)
  const [editing, setEditing] = useState<any>(null)
  const [entered, setEntered] = useState<string | null>(null)
  const [tab, setTab] = useState<'chat' | 'evidence' | 'data' | 'tasks' | 'journal' | 'integrity' | 'claims' | 'versions'>('chat')
  useEffect(() => { const go = (e: any) => setTab(e.detail); addEventListener('frr:tab', go); return () => removeEventListener('frr:tab', go) }, [])
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ state: 'saved' | 'dirty' | 'saving' | 'error'; text: string }>({ state: 'saved', text: 'Saved' })
  const [theme, setTheme] = useTheme()
  const [panelOpen, setPanelOpen] = useState(() => innerWidth >= PANEL_BREAK)
  useEffect(() => { // crossing the breakpoint resets the panel to that layout's default
    let wide = innerWidth >= PANEL_BREAK
    const on = () => { const w = innerWidth >= PANEL_BREAK; if (w !== wide) { wide = w; setPanelOpen(w) } }
    addEventListener('resize', on); return () => removeEventListener('resize', on)
  }, [])
  // the canvas fills the stage (M2-M5 used a fixed 800 px): width bounded by the stage's width and height
  const stageRef = useRef<HTMLElement | null>(null)
  const [fit, setFit] = useState(FIT)
  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver(([e]) => { const { width, height } = e!.contentRect; setFit(Math.round(Math.max(420, Math.min(1280, width - 72, ((height - 96) * 16) / 9)))) })
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const K = 1280 / fit // canvas px -> slide px
  const [versions, setVersions] = useState<any[]>([])
  const clickedOutside = useRef(false)
  const slides = store.slides()
  const index = Math.min(cur, slides.length - 1)
  const slide = useMemo(() => render(store.deck, index, fit, store.metrics), [store.revision, index, fit])
  const probeSlide = useRef(slide); probeSlide.current = slide
  useEffect(() => { // ?probe=1: the slide as drawn at this window size, for the headless screenshot test (16:9 at every width)
    if (!new URLSearchParams(location.search).has('probe')) return
    const t = setInterval(() => { const sl = probeSlide.current; let pre = document.getElementById('probe'); if (!pre) { pre = document.createElement('pre'); pre.id = 'probe'; pre.hidden = true; document.body.appendChild(pre) }
      const c = [...document.querySelectorAll('.stage canvas')].map((x) => x.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0]
      pre.textContent = JSON.stringify({ slideW: sl.widthPx, slideH: sl.heightPx, viewport: innerWidth, stage: document.querySelector('.stage')?.clientWidth ?? 0, canvas: c ? [Math.round(c.width), Math.round(c.height)] : null, slides: store.slides().length }) }, 500)
    return () => clearInterval(t)
  }, [])
  const thumbs = useMemo(() => slides.map((s) => render(store.deck, s.index, 150, store.metrics)), [store.revision, slides.length])
  // pictures (inserted images, picture fills and backgrounds) for the canvas and the slide rail
  const images = useImages(useMemo(() => [slide, ...thumbs], [slide, thumbs]))
  const ig = useMemo(() => integrity(store.deck, store.project, store.sidecar), [store.revision])
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice((n) => (n === m ? null : n)), 4000) }
  // a visual allowed with a warning returns its warnings instead of applying: the user reads them and may "Use anyway"
  const [confirm, setConfirm] = useState<{ cmd: Command; meta?: Parameters<typeof store.exec>[1]; warnings: Finding[] } | null>(null)
  const exec: typeof store.exec = (cmd, meta) => {
    const r = store.exec(cmd, meta)
    if (r.warnings) setConfirm({ cmd, meta, warnings: r.warnings })
    else if (!r.ok) say(r.error!)
    return r
  }
  const useAnyway = () => { if (!confirm) return; setConfirm(null); exec({ ...confirm.cmd, accept: confirm.warnings.map((w) => w.code) } as Command, confirm.meta) }

  // autosave 1.5 s after the last change
  useEffect(() => {
    if (!store.dirty) return
    setSaveState({ state: 'dirty', text: 'Unsaved changes' })
    const t = setTimeout(async () => { setSaveState({ state: 'saving', text: 'Saving…' }); const r = await store.save(); setSaveState(r.ok ? { state: 'saved', text: 'Saved' } : { state: 'error', text: `Save failed: ${r.error}` }) }, 1500)
    return () => clearTimeout(t)
  }, [store.revision])
  // leaving within the autosave delay would drop the last change: warn, and save right away
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (!store.dirty) return; store.save(); e.preventDefault(); e.returnValue = '' }
    addEventListener('beforeunload', leave); return () => removeEventListener('beforeunload', leave)
  }, [store])
  const loadVersions = () => fetch(`/api/projects/${store.project.id}/versions`).then((r) => r.json()).then(setVersions)

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
    if (b && b.kind !== 'text') return say(`${b.kind === 'viz' ? 'Chart' : 'This'} content comes from data; edit the data instead`)
    // the editor gets the node as it was when editing began: a re-render (e.g. the click that ends the edit
    // deselects) builds new node objects, and a new node re-populates the editor, which would drop the typing
    const node = d && nodeOf(sourceId)
    if (node) setEditing({ id: d, caret, node })
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
      // typing in fields, dialogs and menus never reaches the canvas (Backspace would delete the selection)
      if (editing || (e.target as HTMLElement).closest('input,textarea,[role=dialog],[role=menu]')) return
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
  ;(window as any).__ws = { store, setCur, qaSlide, qaDeck, planSlide, findEl, textOf } // inspection hooks for the browser checks

  // change visual (VIS V2): recommended, also valid, allowed with a warning (asks first), and invalid ones with
  // the reason and, where one exists, a change of view that makes them valid
  const selId = store.selection.length === 1 ? store.selection[0]! : null
  const selBinding = selId ? store.sidecar.bindings[selId] : undefined
  const selViz = selBinding?.kind === 'viz' ? selBinding : null
  const INTENT_LABEL: Record<Intent, string> = { trend: 'Over time', ranking: 'Ranking', change: 'Change', composition: 'Composition', relationship: 'Relationship', spotlight: 'Spotlight', ratings: 'Ratings', distribution: 'Distribution', curve: 'Yield curve', maturity: 'Maturity', sensitivity: 'Sensitivity' }
  const visualItems = useMemo(() => {
    if (!selViz || !selId) return []
    const opts = changeOptions(store.project, selViz.spec)
    const pick = (o: { family: any; subtype?: any; transform: any; at?: string; from?: string; between?: [string, string] }) => () =>
      exec({ kind: 'viz.change', id: selId, family: o.family, ...(o.subtype ? { subtype: o.subtype } : {}), transform: o.transform, ...(o.at ? { at: o.at } : {}), ...(o.from ? { from: o.from } : {}), ...(o.between ? { between: o.between } : {}) })
    const mark = (o: (typeof opts)[number]) => (o.current ? '✓ ' : '')
    const rec = opts.filter((o) => o.recommended && o.state === 'valid'), other = opts.filter((o) => !o.recommended && o.state === 'valid')
    const warned = opts.filter((o) => o.state === 'warning'), no = opts.filter((o) => o.state === 'invalid')
    return [
      { heading: true, label: 'Recommended for this data' },
      ...rec.map((o) => ({ label: `${mark(o)}${INTENT_LABEL[o.intent]}: ${o.label}`, onSelect: pick(o), testId: `rec-${o.family}-${o.transform}` })),
      ...(other.length ? [{ separator: true, label: '' }, { heading: true, label: 'Also valid' }, ...other.map((o) => ({ label: `${mark(o)}${o.label}`, onSelect: pick(o), testId: `opt-${o.family}-${o.subtype ?? ''}-${o.transform}` }))] : []),
      ...(warned.length ? [{ separator: true, label: '' }, { heading: true, label: 'Allowed with a warning' },
        ...warned.map((o) => ({ label: `${mark(o)}⚠ ${o.label}${o.current ? ' (kept anyway)' : ''}`, onSelect: pick(o), testId: `warn-${o.family}-${o.subtype ?? ''}-${o.transform}` }))] : []),
      ...(no.length ? [{ separator: true, label: '' }, { heading: true, label: 'Not valid for this data' }, ...no.flatMap((o) => [
        { label: `${o.label}: ${o.refused}`, disabled: true, testId: `no-${o.family}-${o.subtype ?? ''}` },
        ...o.fixes.map((x) => ({ label: `↳ ${x.label}`, onSelect: pick(x), testId: `fix-${o.family}-${o.subtype ?? ''}` }))])] : []),
    ]
  }, [store.revision, selId])
  const saveVersion = async () => { const v = await store.saveVersion(`Version ${new Date().toLocaleString()}`); say(`Saved version ${v.version}`); loadVersions() }
  const canDraft = slides.length === 1 && !store.deck.deck.slides[0]!.elements.length && Object.keys(store.project.datasets).length > 0
  const reprojectable = ig.mismatch.some((m) => !m.startsWith('text says'))
  const openTab = (t: typeof tab) => { setTab(t); setPanelOpen(true) }
  const primary = [['chat', 'Chat', 'chat'], ['evidence', 'Evidence', 'evidence'], ['data', 'Data', 'data'], ['tasks', 'Tasks', 'tasks']] as const
  const secondary = [['journal', 'Journal'], ['integrity', 'Integrity'], ['claims', 'Claims'], ['versions', 'Versions']] as const
  useEffect(() => { loadVersions() }, [])

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
      <header className="topbar">
        <a className="brand" href="./" aria-label="All projects"><span className="brand-mark">R</span></a>
        <div className="crumb"><a className="home muted" href="./">Projects</a><span className="sep">/</span><b title={store.project.title}>{store.project.title}</b></div>
        <span className="save-pill" data-save={saveState.text} data-state={saveState.state}>{saveState.text}</span>
        <div className="tools">
          <IconButton icon="undo" label="Undo" kbd="⌘Z" onClick={() => store.undo()} disabled={!store.undoStack.length} />
          <IconButton icon="redo" label="Redo" kbd="⇧⌘Z" onClick={() => store.redo()} disabled={!store.redoStack.length} />
          {editing && !editing.cell && <><span className="vsep" /><span className="group format" role="toolbar" aria-label="Text format">
            {/* mousedown + preventDefault keeps focus and the selection in the editor; the editor reads bold/italic/underline back from the DOM on commit */}
            {([['bold', 'B', '⌘B'], ['italic', 'I', '⌘I'], ['underline', 'U', '⌘U']] as const).map(([cmd, label, k]) => <button key={cmd} title={`${cmd} (${k})`} className={'icon-btn fmt-' + cmd} onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd) }}>{label}</button>)}
          </span></>}
          {store.selection.length >= 2 && <><span className="vsep" /><span className="group align" role="toolbar" aria-label="Align">
            {(['left', 'centerH', 'right', 'top', 'centerV', 'bottom'] as const).map((m) => <button key={m} title={`Align ${m}`} className="icon-btn" onClick={() => exec({ kind: 'elements.align', ids: store.selection, mode: m })}>{{ left: '⇤', centerH: '↔', right: '⇥', top: '⤒', centerV: '↕', bottom: '⤓' }[m]}</button>)}
            {store.selection.length >= 3 && (['horizontal', 'vertical'] as const).map((a) => <button key={a} title={`Distribute ${a}`} className="icon-btn" onClick={() => exec({ kind: 'elements.distribute', ids: store.selection, axis: a })}>{a === 'horizontal' ? '⋯' : '⋮'}</button>)}
          </span></>}
          {selViz && <><span className="vsep" /><Menu align="start" items={visualItems}
            trigger={<button className="ghost" data-change-visual aria-label="Change visual"><span className="label">Visual: {selViz.spec.family}{selViz.spec.subtype && selViz.spec.subtype !== 'clustered' ? ` (${selViz.spec.subtype})` : ''} ▾</span></button>} /></>}
        </div>
        <span className="spacer" />
        <div className="top-actions">
          {canDraft && <button className="primary" onClick={draftDeck}><span className="label">Draft deck from evidence</span></button>}
          <Menu trigger={<button className="ghost" aria-label="Versions"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="history" /><span className="label">Versions</span></span></button>}
            items={[{ label: 'Save version now', icon: 'check', onSelect: saveVersion, testId: 'save-version' }, { separator: true, label: '' }, { heading: true, label: versions.length ? 'Saved versions' : 'No versions yet' },
              ...[...versions].reverse().slice(0, 6).map((v) => ({ label: `${v.version}. ${v.label}`, disabled: true }))]} />
          <IconButton icon={isDark(theme) ? 'sun' : 'moon'} label={isDark(theme) ? 'Light chrome' : 'Dark chrome'} onClick={() => setTheme(isDark(theme) ? 'light' : 'dark')} />
          <IconButton icon="panel" label={panelOpen ? 'Hide panel' : 'Show panel'} on={panelOpen} onClick={() => setPanelOpen(!panelOpen)} />
          <button className="primary" onClick={() => setExporting(true)} disabled={!store.deck.deck.slides[0]?.elements.length}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="export" />Export</span></button>
        </div>
      </header>
      <main className="body">
        <aside className="rail" aria-label="Slides">{thumbs.map((t, i) => (
          <div key={slides[i]!.id} className={'thumb-row' + (i === index ? ' current' : '')} data-slide={slides[i]!.id} onClick={() => { setCur(i); store.select([]) }}>
            <span className="no">{i + 1}</span>
            <div className="thumb"><div className="thumb-canvas" style={{ transform: `scale(${136 / t.widthPx})` }}><SlideCanvas slide={t} selectedIds={[]} images={images} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} /></div></div>
          </div>))}</aside>
        <section className="stage" ref={stageRef}>
          {notice && <div className="notice" role="status">{notice}</div>}
          <div className="sheet" style={{ width: fit, height: (fit * 9) / 16 }}>
            <SlideCanvas slide={slide} selectedIds={sourceIdsFor(slide, store.selection)} images={images} zoom={1}
              onSelect={onSelect} onEditText={onEditText} onTransform={onTransform} onTransformMulti={onTransformMulti} onEditTableCell={onEditTableCell}
              onContextMenu={() => {}} onTableColResize={() => {}} onMarqueeSelect={(ids) => store.select(ids.map(durable).filter(Boolean) as string[])}
              enteredGroupId={enteredSource} onEnterGroup={(g, c) => { setEntered(durable(g)); store.select(c ? [durable(c)!].filter(Boolean) : []) }}
              editingText={editing && !editing.cell ? { sourceId: sourceIdsFor(slide, [editing.id])[0]! } : null} />
            {editing && (editing.cell
              ? <input className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }} onBlur={keepFocus} style={{ left: editing.box.x, top: editing.box.y, width: editing.box.w, height: editing.box.h, textAlign: 'right' }} />
              : (() => { const src = sourceIdsFor(slide, [editing.id])[0]; const n = src && nodeOf(src) && editing.node
                  return n ? <TextEditOverlay key={editing.id} node={n} scale={slide.scale} caretPoint={editing.caret} onCommit={commitText} onCancel={() => setEditing(null)} zoom={1} /> : null })())}
          </div>
          <div className="statusline">
            <span className={'ig-pill ' + (ig.ok ? 'good' : 'bad')}>Integrity {ig.ok ? 'OK' : 'MISMATCH'}</span>
            {reprojectable && <button className="link" onClick={() => exec({ kind: 'deck.reproject' })}>Re-project from data</button>}
            {ig.mismatch.some((m) => m.startsWith('text says')) && <button className="link" onClick={() => openTab('integrity')}>text disagrees with data</button>}
            <span>{ig.resolved}/{ig.bindings} bindings · {ig.points} chart points · {ig.cells} table cells · {ig.sourced}/{ig.figures} figures in text sourced · {ig.unverified} unverified edits · selected {store.selection.length}</span>
            {ig.outdated.length > 0 && <span className="muted" data-outdated> · {ig.outdated.length} visual{ig.outdated.length === 1 ? '' : 's'} drawn by an earlier layout (values checked) <button className="ghost" onClick={() => exec({ kind: 'deck.reproject' })}>Redraw</button></span>}
          </div>
        </section>
        <div className="scrim" onClick={() => setPanelOpen(false)} />
        <aside className="panel" aria-label="Assistant and evidence">
          <nav className="tabs">
            {primary.map(([t, label, icon]) => <button key={t} className={'tab' + (tab === t ? ' on' : '')} data-tab={t} onClick={() => setTab(t)}><Icon name={icon} /><span className="label">{label}</span></button>)}
            <span className="spacer" />
            <Menu trigger={<button className={'tab' + (secondary.some(([t]) => t === tab) ? ' on' : '')} aria-label="More panels" data-tab-more><Icon name="more" />{secondary.find(([t]) => t === tab)?.[1] ?? ''}</button>}
              items={secondary.map(([t, label]) => ({ label, onSelect: () => setTab(t), testId: t }))} />
          </nav>
          <div className="panel-body">
            {/* always mounted: a request in flight survives switching tabs */}
            <ChatBoundary><React.Suspense fallback={tab === 'chat' ? <p className="muted small">Loading chat…</p> : null}><ChatPanel store={store} slideId={slides[index]?.id} slideNo={index + 1} visible={tab === 'chat'} /></React.Suspense></ChatBoundary>
            {tab === 'evidence' && <EvidencePanel store={store} />}
            {tab === 'data' && <DataPanel store={store} exec={exec} />}
            {tab === 'tasks' && <TasksPanel store={store} />}
            {tab === 'journal' && <ol className="journal">{[...store.journal].reverse().map((j) => <li key={j.seq} data-actor={j.actor}><b>{j.actor}</b> {j.summary}<span className="muted"> · {localTime(j.at, { time: true })}</span></li>)}</ol>}
            {tab === 'integrity' && <div>{ig.ok ? <p className="good">Every bound value matches the working layer.</p> : ig.mismatch.slice(0, 20).map((m) => <p key={m} className="bad">{m}</p>)}</div>}
            {tab === 'claims' && <div>{claims.length ? claims.map((c, i) => <div key={i} className={'claim ' + c.status}><div>{c.text}</div><div className="muted">{c.status}: {c.detail}</div></div>) : <p className="muted">No numeric claims on this slide.</p>}</div>}
            {tab === 'versions' && <div><button onClick={saveVersion}>Save version now</button><ul>{versions.map((v) => <li key={v.version}>{v.version}. {v.label} <span className="muted">· {v.journal} entries</span></li>)}</ul></div>}
          </div>
        </aside>
      </main>
      <Dialog.Root open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" data-use-anyway aria-describedby={undefined}>
            <Dialog.Title asChild><h3>Use this visual anyway?</h3></Dialog.Title>
            <ul className="warn-list">{confirm?.warnings.map((w) => <li key={w.code} data-warning={w.code}>{w.reason}</li>)}</ul>
            <p className="muted small">It is drawn from the same data: the values, their sources and the integrity checks don't change, and Undo reverts it. Your choice is recorded on the chart and in the journal, so later edits won't ask again unless something new comes up.</p>
            <div className="p-actions"><button onClick={() => setConfirm(null)}>Cancel</button><button className="primary" data-use-anyway-confirm onClick={useAnyway}>Use anyway</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={exporting} onOpenChange={setExporting}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby={undefined}>
            {exporting && <ExportDialog store={store} close={() => setExporting(false)} reproject={() => exec({ kind: 'deck.reproject' })} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function App() {
  const [store, setStore] = useState<Store | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (params.has('render')) return
    if (params.has('checks')) { import('./checks').then((m) => m.runChecks()).then((r) => { const pre = document.createElement('pre'); pre.id = 'checks'; pre.hidden = true; pre.textContent = JSON.stringify(r); document.body.appendChild(pre) }); return }
    const id = params.get('project')
    if (id) Promise.all([Store.open(id), loadFonts()]).then(([s, m]) => { s.metrics = m; setStore(s) }).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { // ?selftest=1: headless boot check
    if (!params.has('selftest')) return
    Promise.all([fetch('/api/health').then((r) => r.json()), Store.fromBundle({ schema: 'frr-bundle/1', project: { schema: 'frr-project/1', id: 'selftest', title: 'Self test', datasets: {}, evidence: {}, gaps: [], design_dna: {} as any }, sidecar: { schema: 'frr-sidecar/1', bindings: {} }, journal: [], threads: {}, deck: null })])
      .then(([h, s]) => { const r = render(s.deck, 0, FIT, s.metrics); const pre = document.createElement('pre'); pre.id = 'selftest'; pre.hidden = true; pre.textContent = JSON.stringify({ booted: true, api: h, slides: s.slides().map((x) => x.id), width: r.widthPx, canvas: true }); document.body.appendChild(pre) })
  }, [])
  if (params.has('render')) return <RenderView />
  if (params.has('checks')) return <div className="picker"><h1>Running checks…</h1></div>
  if (error) return <div className="picker"><h1>Could not open the project</h1><p>{error}</p><a href="./">Back to projects</a></div>
  return <TooltipProvider>{store ? <Workspace store={store} /> : <Picker onOpen={(s) => loadFonts().then((m) => { s.metrics = m; setStore(s) })} />}</TooltipProvider>
}

createRoot(document.getElementById('root')!).render(<App />)
