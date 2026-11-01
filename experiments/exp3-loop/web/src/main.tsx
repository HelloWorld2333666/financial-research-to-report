import './polyfill'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { effectiveObs } from '@ws/model.js'
import * as E from './engine'
import { checkText } from './claims'
import { Api, ThreadHost, Thumb, type AppApi } from './chat'
import { runChecks } from './checks'

const S = E.S
;(window as any).__exp3 = { E, S, checkText }

function App() {
  const [ready, setReady] = useState(false), [ver, setVer] = useState(0)
  const [cur, setCur] = useState<string | null>(null)          // current slide durable id
  const [sel, setSel] = useState<string[]>([])                 // parse-time ids on the current slide
  const [tab, setTab] = useState<'chat' | 'data' | 'claims' | 'tasks'>('chat')
  const [thread, setThread] = useState('project')
  const [threads, setThreads] = useState<string[]>(['project'])
  const [editing, setEditing] = useState<any>(null)
  const [tasks, setTasks] = useState<any[]>([])
  const [log, setLog] = useState<string[]>([])
  const applied = useRef(new Set<string>())
  const clickedOutside = useRef(false)
  const rerender = useCallback(() => setVer((v) => v + 1), [])
  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 40))

  useEffect(() => { E.init().then(async () => {
    if (new URLSearchParams(location.search).has('checks')) { const res = await runChecks(); const pre = document.createElement('pre'); pre.id = 'checks-result'; pre.textContent = JSON.stringify(res); document.body.appendChild(pre); (window as any).__checks = res }
    setReady(true); setCur(E.slides()[0].id) }).catch((e) => say('INIT FAILED ' + e)) }, [])
  // background tasks: poll while any is running
  useEffect(() => { const t = setInterval(async () => { if (!tasks.some((x) => x.status === 'running')) return; const all = await (await fetch('/api/tasks')).json(); setTasks((prev) => prev.map((p) => all.find((a: any) => a.id === p.id) || p)) }, 1500); return () => clearInterval(t) }, [tasks])

  const slideList = ready ? E.slides() : []
  const ci = cur ? E.slideIndex(cur) : -1
  const renderCur = useMemo(() => (ready && ci >= 0 ? E.render(ci) : null), [ready, ci, ver])
  const thumbs = useMemo(() => (ready ? slideList.map((s) => ({ ...s, r: E.render(s.index, 150) })) : []), [ready, ver, slideList.length])
  const durable = (id: string) => (ci >= 0 ? E.durableOf(ci, id) : null)
  const selection = sel.map((id) => {
    const d = durable(id); const b: any = d ? S.bindings[d] : null
    if (!b) return { id: d || id, kind: 'element' }
    if (b.kind === 'chart') return { id: d, kind: 'chart', label: b.chart.title, chart_metric: S.project.datasets[b.chart.series[0]]?.metric, datasets: b.chart.series }
    if (b.kind === 'table') return { id: d, kind: 'table', label: b.table.title, datasets: b.table.datasets }
    return { id: d, kind: b.kind, label: b.role || b.label }
  })
  const agentState = { thread: thread === 'project' ? 'project' : 'slide', slide: thread === 'project' ? cur : thread.slice(6), selection }

  const ensureThread = (sid: string) => setThreads((t) => (t.includes('slide:' + sid) ? t : [...t, 'slide:' + sid]))
  const api: AppApi = {
    previewSlide: (p) => E.preview(() => [E.applySlide(p)]),
    applySlide: (p) => { let sid: string | null = null; const r = E.step(`AI: add slide “${p.key}”`, () => { sid = E.applySlide(p) }); if (!r.ok) { say('Apply failed: ' + r.error); return null } say(`Applied slide ${p.key} (${sid})`); ensureThread(sid!); setCur(sid); setSel([]); rerender(); return sid },
    previewSeries: (r) => E.preview(() => { E.addSeries(r.element, r.dataset, r.evidence || {}); return [S.bindings[r.element]?.slide] }),
    applySeries: (r) => { const x = E.step(`AI: add ${r.dataset.entity} to chart`, () => E.addSeries(r.element, r.dataset, r.evidence || {})); say(x.ok ? `Added ${r.dataset.id}` : 'Apply failed: ' + x.error); rerender(); return x.ok },
    isApplied: (k) => applied.current.has(k), markApplied: (k) => { applied.current.add(k) },
    onTask: (t) => setTasks((all) => (all.some((a) => a.id === t.task_id) ? all : [...all, { id: t.task_id, topic: t.topic, status: 'running', log: [] }])),
  }

  // ---- canvas callbacks
  const nodeBox = (id: string) => { const f = (ns: any[]): any => { for (const n of ns) { if (n.sourceId === id) return n; if (n.children) { const c = f(n.children); if (c) return c } } }; return renderCur ? f(renderCur.nodes) : null }
  const onTransform = (id: string, b: any, previewFlag?: boolean) => { if (previewFlag) return; const r = E.step('Move/resize', () => E.transform(ci, id, b)); if (r.ok) rerender() }
  const onEditText = (id: string) => {
    const d = durable(id), b: any = d && S.bindings[d]; if (b && b.kind !== 'text') return
    const n = nodeBox(id), el = (S.opened.deck.slides[ci] as any).elements.find((e: any) => e.id === id)
    if (n) setEditing({ durable: d, value: E.textOf(el), initial: E.textOf(el), box: n.box })
  }
  const onEditTableCell = (id: string, row: number, col: number) => {
    const d = durable(id), b: any = d && S.bindings[d]; if (!b || b.kind !== 'table' || row < 1 || col < 1) return
    const dsId = b.table.datasets[row - 1], date = b.table.dates[col - 1], n = nodeBox(id)
    const cell = (n.cells || []).find((c: any) => c.row === row && c.col === col)
    const v = String(effectiveObs(S.project.datasets[dsId]).find((o: any) => o.date === date)?.value ?? '')
    setEditing({ cell: { dsId, date, row, col, sourceId: id }, value: v, initial: v, box: cell ? { x: n.box.x + cell.x, y: n.box.y + cell.y, w: cell.w, h: cell.h } : n.box })
  }
  const commitEdit = () => {
    const ed = editing; setEditing(null); if (!ed || ed.value === ed.initial) return
    if (ed.cell) { const v = ed.value.trim() === '' ? null : Number(ed.value); if (v !== null && !Number.isFinite(v)) return say('Not a number')
      const r = E.step(`Edit ${ed.cell.dsId} ${ed.cell.date}`, () => E.setWorking(ed.cell.dsId, ed.cell.date, v)); say(r.ok ? `Working edit ${ed.cell.dsId} ${ed.cell.date} = ${v}` : 'FAILED ' + r.error) }
    else { const r = E.step('Edit text', () => E.setText(ed.durable, ed.value)); say(r.ok ? 'Text edited' : 'FAILED ' + r.error) }
    rerender()
  }
  useEffect(() => { clickedOutside.current = false; if (!editing) return; const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.edit-overlay')) clickedOutside.current = true }; addEventListener('pointerdown', down, true); return () => removeEventListener('pointerdown', down, true) }, [!!editing])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (editing || (e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return; if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey ? E.redo() : E.undo()) { say(e.shiftKey ? 'Redo' : 'Undo'); setSel([]); rerender() } } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [editing])

  // ---- claims on the current slide (and all slides for the badge)
  const claimsFor = (sid: string) => { const ch: any = Object.values(S.bindings).find((b: any) => b.kind === 'chart' && b.slide === sid); const metric = ch ? S.project.datasets[ch.chart.series[0]]?.metric : null
    return Object.entries(S.bindings).filter(([, b]) => b.kind === 'text' && b.slide === sid && ['title', 'body'].includes((b as any).role)).flatMap(([d]) => { const f = E.findEl(d); return f ? checkText(E.textOf(f.el), S.project, 'France', metric) : [] }) }
  const claims = ready && cur ? claimsFor(cur) : []
  const allBad = ready ? slideList.reduce((n, s) => n + claimsFor(s.id).filter((c) => c.status === 'mismatch').length, 0) : 0
  const integ = ready ? E.integrity() : null
  Object.assign((window as any).__exp3, { api, setCur, setSel, setTab, setThread, rerender, integrity: E.integrity, claimsFor, tasksState: () => tasks })

  const selBinding: any = sel.length === 1 && durable(sel[0]) ? S.bindings[durable(sel[0])!] : null
  return <Api.Provider value={api}>
    <div style={{ display: 'flex', height: '100vh', font: '13px -apple-system, system-ui, sans-serif', color: '#1d2433', background: '#eef0f3' }}>
      <div style={{ width: 170, padding: 10, overflowY: 'auto', position: 'relative', zIndex: 10, background: '#f7f8fa', borderRight: '1px solid #dde2e8' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Slides</div>
        {thumbs.map((t) => <div key={t.id} className="thumb" data-slide={t.id} onClick={() => { setCur(t.id); setSel([]) }} style={{ marginBottom: 8, outline: t.id === cur ? '2px solid #1f4e9c' : 'none', cursor: 'pointer' }}><Thumb render={t.r} width={150} /><div style={{ fontSize: 10, color: '#667' }}>{t.index + 1} · {t.id}</div></div>)}
      </div>
      <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden', position: 'relative' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Experiment 3 · AI-native loop (GenOffice canvas · Evidence Core · assistant-ui/AG-UI · local Qwen)</div>
        <div style={{ position: 'relative', width: E.FIT, height: E.FIT * 9 / 16, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}>
          {renderCur && <SlideCanvas slide={renderCur} selectedIds={sel} images={new Map()} zoom={1}
            onSelect={(id, add) => setSel((s) => (id == null ? [] : add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))}
            onEditText={onEditText} onTransform={onTransform} onEditTableCell={onEditTableCell} onContextMenu={() => {}} onTableColResize={() => {}}
            editingText={editing && !editing.cell ? { sourceId: (S.opened.deck.slides[ci] as any).elements.find((e: any) => E.durableOf(ci, e.id) === editing.durable)?.id } : null} />}
          {editing && (editing.cell
            ? <input className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
                onBlur={(e) => { if (!clickedOutside.current) { const t = e.target; setTimeout(() => t.isConnected && t.focus(), 0); return } commitEdit() }} style={{ position: 'absolute', left: editing.box.x, top: editing.box.y, width: editing.box.w, height: editing.box.h, boxSizing: 'border-box', textAlign: 'right', border: '2px solid #1f4e9c' }} />
            : <textarea className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit() }}
                onBlur={(e) => { if (!clickedOutside.current) { const t = e.target; setTimeout(() => t.isConnected && t.focus(), 0); return } commitEdit() }} style={{ position: 'absolute', left: editing.box.x, top: editing.box.y, width: editing.box.w, minHeight: editing.box.h, boxSizing: 'border-box', font: '13px "Liberation Sans", sans-serif', border: '2px solid #1f4e9c' }} />)}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, position: 'relative', zIndex: 10, background: '#eef0f3' }}>
          {integ && <span style={{ color: integ.ok ? '#176b2c' : '#b00' }}>Integrity {integ.ok ? 'OK' : 'MISMATCH'} · bindings {integ.resolved}/{integ.bindings} · chart points {integ.points} · table cells {integ.cells} · unverified manual edits {integ.unverified}</span>}
          {' · '}<span style={{ color: allBad ? '#b00' : '#176b2c' }}>Claims flagged {allBad}</span>{' · '}Undo {S.undo.length} · Journal {S.journal.length}
          {integ && integ.mismatch.slice(0, 3).map((m) => <div key={m} style={{ color: '#b00' }}>{m}</div>)}
          <div style={{ marginTop: 6, color: '#555' }}>{log.slice(0, 4).map((l) => <div key={l}>{l}</div>)}</div>
        </div>
      </div>
      <div style={{ width: 430, display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #dde2e8', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e6eb' }}>{(['chat', 'data', 'claims', 'tasks'] as const).map((t) => <button key={t} className={'tab tab-' + t} onClick={() => setTab(t)} style={{ flex: 1, padding: 8, border: 0, background: tab === t ? '#fff' : '#f3f5f8', fontWeight: tab === t ? 600 : 400 }}>{t === 'claims' ? `claims${allBad ? ` (${allBad})` : ''}` : t === 'tasks' ? `tasks${tasks.length ? ` (${tasks.filter((x) => x.status === 'running').length} running)` : ''}` : t}</button>)}</div>
        <div style={{ flex: 1, padding: 10, overflow: 'hidden', display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column' }}>
          <div style={{ marginBottom: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{threads.map((t) => <button key={t} className="thread-tab" data-thread={t} onClick={() => setThread(t)} style={{ fontWeight: t === thread ? 700 : 400 }}>{t === 'project' ? 'Project' : 'Slide ' + (E.slideIndex(t.slice(6)) + 1)}</button>)}</div>
          {selection.length > 0 && <div className="sel-chips" style={{ fontSize: 11, marginBottom: 6 }}>Selected: {selection.map((s: any) => <span key={s.id} style={{ background: '#e8eef8', borderRadius: 10, padding: '1px 6px', marginRight: 4 }}>{s.kind}{s.label ? ` · ${s.label}` : ''}</span>)}</div>}
          <div style={{ flex: 1, minHeight: 0 }}>{threads.map((t) => <ThreadHost key={t} threadId={t} visible={t === thread} state={agentState} placeholder={t === 'project' ? 'Ask about the whole deck…' : 'Ask about this slide or the selection…'} />)}</div>
        </div>
        {tab === 'data' && <div style={{ padding: 10, overflowY: 'auto' }}>{selBinding?.kind === 'chart' ? <DataSheet spec={selBinding.chart} onEdit={(d, x, v) => { const r = E.step(`Edit ${d} ${x}`, () => E.setWorking(d, x, v)); say(r.ok ? `Data sheet: ${d} ${x} = ${v}` : 'FAILED'); rerender() }} /> : <i>Select a chart to edit its data.</i>}</div>}
        {tab === 'claims' && <div style={{ padding: 10, overflowY: 'auto', fontSize: 12 }}>{claims.length ? claims.map((c, i) => <div key={i} className={'claim claim-' + c.status} style={{ marginBottom: 8, borderLeft: `3px solid ${c.status === 'supported' ? '#2e8b57' : c.status === 'mismatch' ? '#c8102e' : '#aaa'}`, paddingLeft: 6 }}><div>{c.text}</div><div style={{ color: '#666' }}>{c.status}: {c.detail}</div></div>) : <i>No numeric claims on this slide.</i>}</div>}
        {tab === 'tasks' && <div style={{ padding: 10, overflowY: 'auto', fontSize: 12 }}>{tasks.length ? tasks.map((t) => <div key={t.id} className="task" data-status={t.status} style={{ border: '1px solid #dde2e8', borderRadius: 6, padding: 8, marginBottom: 8 }}>
          <b>{t.topic}</b> · {t.status}<div style={{ color: '#666' }}>{(t.log || []).slice(-2).join(' · ')}</div>
          {t.status === 'done' && t.result && <div style={{ marginTop: 6 }}>{t.result.message}<ul style={{ margin: '4px 0', paddingLeft: 16 }}>{t.result.tried.map((x: any) => <li key={x.url}>{x.url.replace('https://', '')}: {x.status}, {x.chars} chars{x.usable ? ' (usable)' : ''}</li>)}</ul>
            {!applied.current.has(t.id) ? <button onClick={() => { const target = Object.values(S.bindings).find((b: any) => b.kind === 'placeholder')?.slide || cur!; const r = E.step('AI: research gap placeholder', () => E.addPlaceholder(target, t.result.proposal.label, t.result.proposal.request)); if (r.ok) { applied.current.add(t.id); setCur(target); rerender(); say('Placed research request on ' + target) } else say('FAILED ' + r.error) }}>Apply: place research request on slide</button> : <span>applied</span>}</div>}
        </div>) : <i>No background tasks.</i>}</div>}
      </div>
    </div>
  </Api.Provider>
}

function DataSheet({ spec, onEdit }: { spec: E.ChartSpec; onEdit: (d: string, x: string, v: number | null) => void }) {
  const data = E.chartData(spec)
  return <div className="sheet"><b>Edit data · {spec.title}</b><table style={{ borderCollapse: 'collapse', marginTop: 6 }}><thead><tr><th></th>{spec.series.map((d) => <th key={d}>{S.project.datasets[d].entity}</th>)}</tr></thead>
    <tbody>{data.categories.map((x) => <tr key={x}><td>{x}</td>{spec.series.map((d) => { const o = effectiveObs(S.project.datasets[d]).find((q: any) => q.date === x)
      return <td key={d}><input data-ds={d} data-date={x} key={`${d}${x}${o?.value}`} defaultValue={o?.value ?? ''} placeholder="gap" style={{ width: 70, textAlign: 'right', background: o?.edited ? '#fff6d6' : undefined }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} onBlur={(e) => { const t = e.target.value.trim(), v = t === '' ? null : Number(t); if ((v ?? null) !== (o?.value ?? null) && (v === null || Number.isFinite(v))) onEdit(d, x, v) }} /></td> })}</tr>)}</tbody></table>
    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Sources: {spec.series.map((d) => S.project.datasets[d].source_note).join('; ')}. Edited cells are working values (unverified); source values are kept.</div></div>
}

createRoot(document.getElementById('root')!).render(<App />)
