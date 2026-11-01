import './polyfill'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { buildRenderSlide, HeuristicMetrics, OpentypeMetrics, type RenderSlide } from '@genoffice/pptx-render'
import * as opentype from 'opentype.js'
import { runTxn, type Op } from '@genoffice/pptx-ops'
import { materializeSlide, copyElementData, savePptx, openPptx } from '@genoffice/pptx-engine'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import { chartSeries, effectiveObs } from '@ws/model.js'
import { buildDeck, chartPayload, tableCellText, findByDurable, durableOf, EMU_PER_PX, type Binding } from './deck'

const FIT = 1000 // canvas width in px; slide is 1280 px wide in our model
const SCALE = FIT / 1280
// ?fonts=1: measure AND draw with the same real font (Liberation Sans, metric-compatible with Arial/Helvetica)
const REAL_FONTS = new URLSearchParams(location.search).has('fonts')
let metrics: any = new HeuristicMetrics()
async function loadFonts() {
  const [reg, bold] = await Promise.all(['/fonts/LiberationSans-Regular.ttf', '/fonts/LiberationSans-Bold.ttf'].map(async (u) => opentype.parse(await (await fetch(u)).arrayBuffer())))
  metrics = new OpentypeMetrics((st: any) => (st.bold ? bold : reg), new HeuristicMetrics())
  for (const [w, u] of [['400', '/fonts/LiberationSans-Regular.ttf'], ['700', '/fonts/LiberationSans-Bold.ttf']]) { const ff = new FontFace('Liberation Sans', `url(${u})`, { weight: w }); await ff.load(); (document as any).fonts.add(ff) }
}
const toEmu = (px: number) => Math.round((px / SCALE) * EMU_PER_PX)

type Box = { x: number; y: number; w: number; h: number; rotationDeg: number }
interface Session { opened: any; bindings: Record<string, Binding>; project: any; undo: any[]; redo: any[]; preview: boolean; journal: any[]; clipboard: any[] }
const S: Session = { opened: null, bindings: {}, project: null, undo: [], redo: [], preview: false, journal: [], clipboard: [] }
;(window as any).__exp = { S }

// ---------------------------------------------------------------- history (same snapshot semantics as GenOffice main)
const snap = () => ({ slides: structuredClone(S.opened.deck.slides), entries: new Map(S.opened.archive.entries), size: { ...S.opened.deck.size }, project: structuredClone(S.project), bindings: structuredClone(S.bindings) })
function restore(s: any) {
  const f = structuredClone({ slides: s.slides, project: s.project, bindings: s.bindings })
  S.opened.deck.slides = f.slides; S.opened.deck.size = { ...s.size }
  const e = S.opened.archive.entries; e.clear(); for (const [k, v] of s.entries) e.set(k, v)
  S.project = f.project; S.bindings = f.bindings
}
const pushHistory = () => { S.undo.push(snap()); S.redo = [] }
function undo() { const s = S.undo.pop(); if (!s) return false; S.redo.push(snap()); restore(s); return true }
function redo() { const s = S.redo.pop(); if (!s) return false; S.undo.push(snap()); restore(s); return true }

/** One user-visible action = one validated, atomic transaction = one undo step. */
function commit(label: string, ops: Op[], { reparse = false } = {}) {
  const plan = runTxn(S.opened, { dryRun: true, ops })
  if (plan.failures?.length) return { ok: false, failures: plan.failures }
  pushHistory()
  const r = runTxn(S.opened, { ops })
  if (!r.applied) { S.undo.pop(); return { ok: false, failures: r.failures } }
  if (reparse) materializeSlide(S.opened, 0)
  S.journal.push({ label, ops: ops.map((o) => o.op), at: Date.now() })
  return { ok: true, records: r.records }
}

// ---------------------------------------------------------------- Evidence Core side: working-layer edits
function setWorking(dsId: string, date: string, value: number | null) {
  const ds = S.project.datasets[dsId], src = ds.observations.find((o: any) => o.date === date)
  ds.working ||= {}
  if (value === null) ds.working[date] = { deleted: true, by: 'you', at: new Date().toISOString(), status: 'manual_unverified' }
  else if (src && src.value === value) delete ds.working[date]
  else ds.working[date] = { value, by: 'you', at: new Date().toISOString(), status: 'manual_unverified' }
}
/** Ops that re-project every bound chart/table that reads the given datasets. */
function reprojectOps(dsIds: Set<string>): Op[] {
  const ops: Op[] = []
  for (const [durable, b] of Object.entries(S.bindings)) {
    const el = findByDurable(S.opened, durable); if (!el) continue
    if (b.kind === 'chart' && S.project.charts[b.chart_id].series.some((s: any) => dsIds.has(s.dataset))) {
      const { categories, series } = chartPayload(S.project, b.chart_id)
      ops.push({ op: 'setChart', target: { slide: 0, el: el.id }, patch: { categories, series } })
    }
    if (b.kind === 'datatable') {
      const tEl = S.project.elements.find((e: any) => e.id === b.element)
      for (const [rc, cell] of Object.entries(b.cells)) if (dsIds.has(cell.dataset)) {
        const [row, col] = rc.split(':').map(Number)
        ops.push({ op: 'setTableCell', target: { slide: 0, el: el.id }, row, col, paragraphs: [{ runs: [{ text: tableCellText(S.project, cell.dataset, cell.date, tEl.fmt), fontSize: 9 }], align: 'right' }] })
      }
    }
  }
  return ops
}
function editDataValue(dsId: string, date: string, value: number | null) {
  const before = snap()
  setWorking(dsId, date, value)
  const ops = reprojectOps(new Set([dsId]))
  const plan = runTxn(S.opened, { dryRun: true, ops })
  if (plan.failures?.length) { restore(before); return { ok: false, failures: plan.failures } }
  S.undo.push(before); S.redo = []
  const r = runTxn(S.opened, { ops }); if (!r.applied) { restore(S.undo.pop()); return { ok: false, failures: r.failures } }
  materializeSlide(S.opened, 0) // chart edits rewrite the chart part; reparse like GenOffice does
  S.journal.push({ label: `Edited ${dsId} ${date}`, ops: ops.map((o) => o.op), at: Date.now() })
  return { ok: true, ops: ops.length }
}

// ---------------------------------------------------------------- integrity: every bound value on the canvas equals the working layer
function textOf(el: any): string {
  const paras = el?.paragraphs || el?.text?.paragraphs || el?.textBody?.paragraphs || []
  return paras.map((p: any) => (p.runs || []).map((r: any) => r.text ?? '').join('')).join('\n')
}
function integrity() {
  const out: any = { bindings: 0, resolved: 0, chartPoints: 0, chartMismatch: [] as string[], cells: 0, cellMismatch: [] as string[], duplicateDurable: [] as string[] }
  const all: string[] = []
  const walk = (els: any[]) => els.forEach((e) => { const d = durableOf(S.opened, e.id); if (d) all.push(d); if (e.children) walk(e.children) })
  walk(S.opened.deck.slides[0].elements)
  out.duplicateDurable = all.filter((d, i) => all.indexOf(d) !== i)
  for (const [durable, b] of Object.entries(S.bindings)) {
    out.bindings++
    const el = findByDurable(S.opened, durable); if (!el) continue
    out.resolved++
    if (b.kind === 'chart') {
      const want = chartSeries(S.project, b.chart_id), got = el.chart
      want.series.forEach((s: any, si: number) => s.values.forEach((v: any, i: number) => {
        out.chartPoints++
        const g = got?.series?.[si]?.values?.[i]
        if (!((v == null && g == null) || v === g)) out.chartMismatch.push(`${b.chart_id} ${s.label} ${want.x[i]}: want ${v} got ${g}`)
      }))
    }
    if (b.kind === 'datatable') {
      const tEl = S.project.elements.find((e: any) => e.id === b.element)
      for (const [rc, cell] of Object.entries(b.cells)) {
        out.cells++
        const [r, c] = rc.split(':').map(Number)
        const got = textOf(el.rows?.[r]?.[c]?.text), want = tableCellText(S.project, cell.dataset, cell.date, tEl.fmt)
        if (got !== want) out.cellMismatch.push(`${cell.dataset} ${cell.date}: want "${want}" got "${got}"`)
      }
    }
  }
  out.ok = out.resolved === out.bindings && !out.chartMismatch.length && !out.cellMismatch.length && !out.duplicateDurable.length
  return out
}

// ---------------------------------------------------------------- frame timing during pointer gestures
const perf = { gestures: [] as any[], cur: null as any, handlerMs: [] as number[] }
function frameLoop(t: number) { if (perf.cur) { if (perf.cur.last) perf.cur.dts.push(t - perf.cur.last); perf.cur.last = t } requestAnimationFrame(frameLoop) }
requestAnimationFrame(frameLoop)
addEventListener('pointerdown', () => { perf.cur = { dts: [], last: 0 } }, true)
addEventListener('pointerup', () => {
  const g = perf.cur; perf.cur = null; if (!g || g.dts.length < 5) return
  const d = g.dts.slice(1).sort((a: number, b: number) => a - b)
  perf.gestures.push({ frames: d.length, avgFps: +(1000 / (d.reduce((a: number, b: number) => a + b, 0) / d.length)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) })
}, true)

// ---------------------------------------------------------------- app
function App() {
  const [ver, setVer] = useState(0)
  const [ready, setReady] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [group, setGroup] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ sourceId: string; cell?: { row: number; col: number }; value: string; box: any } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [proposal, setProposal] = useState<{ ops: Op[]; plan?: string[]; failures?: any[]; label: string } | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const rerender = useCallback(() => setVer((v) => v + 1), [])
  const openedAt = useRef(0)
  useEffect(() => { if (editing) openedAt.current = performance.now() }, [editing?.sourceId, editing?.cell?.row, editing?.cell?.col])
  // The overlay keeps focus (the canvas grabs it after a click) until the user presses outside it.
  const clickedOutside = useRef(false)
  useEffect(() => {
    clickedOutside.current = false
    if (!editing) return
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.edit-overlay')) clickedOutside.current = true }
    addEventListener('pointerdown', down, true); return () => removeEventListener('pointerdown', down, true)
  }, [editing?.sourceId, editing?.cell?.row, editing?.cell?.col])
  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 30))

  useEffect(() => {
    (async () => {
      S.project = await (await fetch('/project.json')).json()
      if (REAL_FONTS) { await loadFonts(); S.project.design_dna.font = 'Liberation Sans' }
      const b = await buildDeck(S.project, 's-france-debt')
      S.opened = b.opened; S.bindings = b.bindings
      setReady(true); say(`Deck built through pptx-ops: ${Object.keys(b.bindings).length} bound elements`)
    })().catch((e) => { console.error(e); say('BUILD FAILED: ' + e.message) })
  }, [])

  const slide: RenderSlide | null = useMemo(() => {
    if (!ready) return null
    const t0 = performance.now()
    const r = buildRenderSlide(S.opened.deck.slides[0], S.opened.deck.size, { fitWidthPx: FIT, metrics, slideNo: 1 })
    perf.handlerMs.push(performance.now() - t0)
    return r
  }, [ready, ver])

  const node = (sourceId: string) => { const f = (ns: any[]): any => { for (const n of ns) { if (n.sourceId === sourceId) return n; if (n.children) { const c = f(n.children); if (c) return c } } }; return slide ? f(slide.nodes) : null }
  const bindingOf = (sourceId: string) => { const d = durableOf(S.opened, sourceId); return d ? S.bindings[d] : undefined }

  // ---- canvas callbacks -> ops
  const transformOp = (sourceId: string, b: Box, groupId?: string): Op => {
    if (groupId) {
      const grp = S.opened.deck.slides[0].elements.find((e: any) => e.id === groupId)
      const ch = grp.childOffset, chX = ch?.x ?? grp.transform.offset.x, chY = ch?.y ?? grp.transform.offset.y
      const g = grp.transform.offset, sx = ch?.cx ? g.cx / ch.cx : 1, sy = ch?.cy ? g.cy / ch.cy : 1
      return { op: 'setTransform', target: { slide: 0, el: sourceId }, group: groupId, rotDeg: b.rotationDeg,
        box: { x: toEmu(b.x / sx) + chX, y: toEmu(b.y / sy) + chY, cx: toEmu(b.w / sx), cy: toEmu(b.h / sy) } }
    }
    return { op: 'setTransform', target: { slide: 0, el: sourceId }, rotDeg: b.rotationDeg, resizeTableGrid: true, box: { x: toEmu(b.x), y: toEmu(b.y), cx: toEmu(b.w), cy: toEmu(b.h) } }
  }
  const onTransform = (sourceId: string, b: Box, preview?: boolean, groupId?: string) => {
    const t0 = performance.now(), op = transformOp(sourceId, b, groupId)
    if (runTxn(S.opened, { dryRun: true, ops: [op] }).failures?.length) return
    if (preview) { if (!S.preview) { pushHistory(); S.preview = true } } else if (S.preview) S.preview = false; else pushHistory()
    const r = runTxn(S.opened, { ops: [op] }); if (!r.applied) return
    if (!preview) S.journal.push({ label: 'Transform', ops: ['setTransform'], at: Date.now() })
    perf.handlerMs.push(performance.now() - t0); rerender()
  }
  const onTransformMulti = (items: { sourceId: string; groupId?: string; box: Box }[]) => {
    const r = commit('Transform selection', items.map((i) => transformOp(i.sourceId, i.box, i.groupId))); if (r.ok) rerender()
  }
  const onEditText = (sourceId: string) => {
    const b = bindingOf(sourceId); if (b && b.kind !== 'text') { say(`${b.kind} content comes from data: use Edit data`); return }
    const el = S.opened.deck.slides[0].elements.find((e: any) => e.id === sourceId) ?? findChild(sourceId)
    const n = node(sourceId); if (!n) return
    setEditing({ sourceId, value: textOf(el), box: n.box, initial: textOf(el) } as any)
  }
  const findChild = (id: string) => { for (const e of S.opened.deck.slides[0].elements) for (const c of e.children || []) if (c.id === id) return c }
  const onEditTableCell = (sourceId: string, row: number, col: number) => {
    const n = node(sourceId), b = bindingOf(sourceId); if (!n) return
    const tableEl = S.opened.deck.slides[0].elements.find((e: any) => e.id === sourceId)
    const cellBind = b?.kind === 'datatable' ? b.cells[`${row}:${col}`] : undefined
    const value = cellBind ? String(effectiveObs(S.project.datasets[cellBind.dataset]).find((o: any) => o.date === cellBind.date)?.value ?? '') : textOf(tableEl?.rows?.[row]?.[col]?.text)
    const xs = n.colX ?? null
    setEditing({ sourceId, cell: { row, col }, value, box: cellBox(n, row, col) ?? n.box, initialCell: value } as any)
  }
  const cellBox = (n: any, row: number, col: number) => {
    const cell = (n.cells || []).find((c: any) => c.row === row && c.col === col)
    return cell ? { x: n.box.x + cell.x, y: n.box.y + cell.y, w: cell.w, h: cell.h } : null
  }
  const commitEdit = () => {
    const ed = editing; setEditing(null); if (!ed) return
    if ((ed as any).initial !== undefined ? ed.value === (ed as any).initial : ed.value === (ed as any).initialCell) return // no-op: no history entry
    if (ed.cell) {
      const b = bindingOf(ed.sourceId), cb = b?.kind === 'datatable' ? b.cells[`${ed.cell.row}:${ed.cell.col}`] : undefined
      if (cb) {
        const v = ed.value.trim() === '' ? null : Number(ed.value.replace(/[, ]/g, ''))
        if (v !== null && !Number.isFinite(v)) { say('Not a number: edit ignored'); return }
        const r = editDataValue(cb.dataset, cb.date, v); say(r.ok ? `Working edit ${cb.dataset} ${cb.date} = ${v} → ${r.ops} ops (table + charts)` : 'FAILED ' + JSON.stringify(r.failures))
      } else {
        const r = commit('Edit cell', [{ op: 'setTableCell', target: { slide: 0, el: ed.sourceId }, row: ed.cell.row, col: ed.cell.col, paragraphs: [{ runs: [{ text: ed.value, bold: ed.cell.row === 0 || ed.cell.col === 0 }] }] }])
        say(r.ok ? 'Label cell edited' : 'FAILED')
      }
    } else {
      const grp = S.opened.deck.slides[0].elements.find((e: any) => (e.children || []).some((c: any) => c.id === ed.sourceId))
      const r = commit('Edit text', [{ op: 'setText', target: { slide: 0, el: ed.sourceId }, ...(grp ? { group: grp.id } : {}), paragraphs: ed.value.split('\n').map((t) => ({ runs: [{ text: t }] })) }])
      say(r.ok ? 'Text edited' : 'FAILED ' + JSON.stringify(r.failures))
    }
    rerender()
  }

  // ---- keyboard: undo/redo, group/ungroup, copy/paste, delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest('input,textarea')) return
      const m = e.metaKey || e.ctrlKey
      if (m && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo() : undo()) && (say(e.shiftKey ? 'Redo' : 'Undo'), rerender()) }
      else if (m && e.key.toLowerCase() === 'g' && !e.shiftKey && sel.length >= 2) { e.preventDefault(); const r = commit('Group', [{ op: 'groupElements', target: { slide: 0 }, els: sel }]); if (r.ok) { setSel([]); say('Grouped'); rerender() } else say('Group refused: ' + (r.failures?.[0]?.error || '').split('.')[0]) }
      else if (m && e.key.toLowerCase() === 'g' && e.shiftKey && sel.length === 1) { e.preventDefault(); const r = commit('Ungroup', [{ op: 'ungroupElement', target: { slide: 0, el: sel[0] } }]); if (r.ok) { setSel([]); say('Ungrouped'); rerender() } }
      else if (m && e.key.toLowerCase() === 'c' && sel.length) { S.clipboard = sel.map((id) => { const el = S.opened.deck.slides[0].elements.find((x: any) => x.id === id); return { item: copyElementData(S.opened, S.opened.deck.slides[0], el), binding: bindingOf(id) } }); say(`Copied ${sel.length}`) }
      else if (m && e.key.toLowerCase() === 'v' && S.clipboard.length) { e.preventDefault(); paste() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel.length) { const r = commit('Delete', sel.map((id) => ({ op: 'deleteElement', target: { slide: 0, el: id } }))); if (r.ok) { setSel([]); say('Deleted'); rerender() } }
    }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [sel, editing])

  function paste() {
    const durables = () => S.opened.deck.slides[0].elements.map((e: any) => durableOf(S.opened, e.id))
    const before = new Set(durables())
    const r = commit('Paste', [{ op: 'pasteElements', target: { slide: 0 }, items: S.clipboard.map((c) => c.item), dx: toEmu(16), dy: toEmu(16) }], { reparse: true })
    if (!r.ok) { say('Paste FAILED ' + JSON.stringify(r.failures)); return }
    // created ids are transaction-local and change on reparse: the new elements are the new durable ids, in paste order
    const fresh = durables().filter((d) => d && !before.has(d)) as string[]
    fresh.forEach((d, i) => { const b = S.clipboard[i]?.binding; if (b) S.bindings[d] = structuredClone(b) })
    setSel(fresh.map((d) => findByDurable(S.opened, d)?.id).filter(Boolean)); say(`Pasted ${fresh.length}; durable ${fresh.join(',')}; binding copied`); rerender()
  }

  // ---- AI-style op batches
  const ids = () => { const by = (eid: string) => Object.entries(S.bindings).find(([, b]) => b.element === eid)?.[0]; return { title: by('s-france-debt-title')!, comment: by('el-debt-comment')!, rule: by('s-france-debt-rule')!, chart: by('el-debt-chart')!, table: by('el-debt-table')! } }
  const aiBatch = (invalid = false): Op[] => {
    const d = ids(), t = (x: string) => ({ slide: 0, el: invalid && x === d.rule ? 'e_doesnotexist' : x })
    const c = findByDurable(S.opened, d.comment)
    return [
      { op: 'setTransform', target: t(d.comment), box: { ...c.transform.offset, y: c.transform.offset.y + toEmu(20) } },
      { op: 'setText', target: t(d.title), paragraphs: [{ runs: [{ text: "France's debt path is decoupling from Germany's" }] }] },
      { op: 'setFill', target: t(d.rule), fill: '#c8102e' },
      { op: 'alignElements', target: { slide: 0 }, els: [d.chart, d.comment], mode: 'left' },
      { op: 'addElement', target: { slide: 0 }, kind: 'roundRect', offset: { x: toEmu(620), y: toEmu(600), cx: toEmu(140), cy: toEmu(28) }, fill: '#FDECEE', paragraphs: [{ runs: [{ text: 'AI note: verify 2026', fontSize: 8, color: '#c8102e' }], align: 'center' }] },
    ]
  }
  const propose = (invalid = false) => {
    const ops = aiBatch(invalid), r = runTxn(S.opened, { dryRun: true, ops })
    setProposal({ ops, plan: r.plan, failures: r.failures, label: invalid ? 'Invalid AI batch' : 'AI batch (5 ops)' })
  }
  const applyProposal = () => {
    if (!proposal) return
    const before = JSON.stringify(S.opened.deck.slides)
    pushHistory()
    const r = runTxn(S.opened, { ops: proposal.ops, isolation: 'atomic' })
    if (!r.applied) { S.undo.pop(); const same = JSON.stringify(S.opened.deck.slides) === before; say(`Atomic apply refused: ${r.failures?.length} failure(s); deck unchanged: ${same}`); (window as any).__exp.lastAtomic = { applied: false, unchanged: same, failures: r.failures } }
    else { S.journal.push({ label: proposal.label, ops: proposal.ops.map((o) => o.op), at: Date.now() }); say(`Applied ${proposal.label} as one step`); (window as any).__exp.lastAtomic = { applied: true } }
    setProposal(null); rerender()
  }

  // ---- save → reopen
  const saveReopen = async () => {
    const t0 = performance.now(), bytes = await savePptx(S.opened), t1 = performance.now()
    S.opened = await openPptx(bytes)
    const t2 = performance.now()
    S.undo = []; S.redo = []
    const res = integrity(); rerender()
    say(`Saved ${(bytes.length / 1024).toFixed(0)} KB (${(t1 - t0).toFixed(0)} ms), reopened (${(t2 - t1).toFixed(0)} ms): ${res.resolved}/${res.bindings} bindings resolved`)
    ;(window as any).__exp.lastSave = { kb: bytes.length / 1024, saveMs: t1 - t0, openMs: t2 - t1, integrity: res }
    return res
  }
  const downloadPptx = async () => { const b = await savePptx(S.opened); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b])); a.download = 'exp1-france.pptx'; a.click() }

  Object.assign((window as any).__exp, { integrity, perf, editDataValue, propose, applyProposal, saveReopen, undo: () => { undo(); rerender() }, redo: () => { redo(); rerender() }, setSel, rerender, ids, findByDurable, durableOf, savePptx })

  const selBinding = sel.length === 1 ? bindingOf(sel[0]) : undefined
  const integ = ready ? integrity() : null

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16 }}>
      <div>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Experiment 1 · GenOffice SlideCanvas + pptx-ops, our Evidence Core bindings</div>
        <div style={{ position: 'relative', width: FIT + 40, background: '#fff', padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}>
          {slide && (
            <SlideCanvas slide={slide} selectedIds={sel} images={new Map()} zoom={1}
              onSelect={(id, add) => (((window as any).__selLog ||= []).push([id, add]), setSel((s) => (id == null ? [] : add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id])))}
              onEditText={onEditText} onTransform={onTransform} onTransformMulti={onTransformMulti}
              onTransformCancel={() => { if (S.preview) { S.preview = false; undo(); rerender() } }}
              onEditTableCell={onEditTableCell} onContextMenu={() => {}}
              onTableColResize={(id, col, w) => { const r = commit('Column width', [{ op: 'setTableColWidth', target: { slide: 0, el: id }, col, widthEmu: toEmu(w) }]); if (r.ok) rerender() }}
              onMarqueeSelect={(ids) => setSel(ids)}
              enteredGroupId={group} onEnterGroup={(g, c) => { setGroup(g); setSel(c ? [c] : []) }}
              editingText={editing ? { sourceId: editing.sourceId, cell: editing.cell } : null} />
          )}
          {editing && (
            editing.cell
              ? <input className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }} onBlur={(e) => { if (!clickedOutside.current) { const t = e.target; setTimeout(() => t.isConnected && t.focus(), 0); return } commitEdit() }}
                  style={{ position: 'absolute', left: 20 + editing.box.x, top: 20 + editing.box.y, width: editing.box.w, height: editing.box.h, boxSizing: 'border-box', font: '12px system-ui', textAlign: 'right', border: '2px solid #1f4e9c' }} />
              : <textarea className="edit-overlay" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit() }} onBlur={(e) => { if (!clickedOutside.current) { const t = e.target; setTimeout(() => t.isConnected && t.focus(), 0); return } commitEdit() }}
                  style={{ position: 'absolute', left: 20 + editing.box.x, top: 20 + editing.box.y, width: editing.box.w, minHeight: editing.box.h, boxSizing: 'border-box', font: '13px "Helvetica Neue", Helvetica, sans-serif', border: '2px solid #1f4e9c' }} />
          )}
        </div>
      </div>
      <div style={{ width: 340, fontSize: 12, position: 'relative', zIndex: 10 }}>
        {sheet && <DataSheet chartId={sheet} onClose={() => setSheet(null)} onEdit={(ds, d, v) => { const r = editDataValue(ds, d, v); say(r.ok ? `Data sheet: ${ds} ${d} = ${v}` : 'FAILED'); rerender() }} ver={ver} />}
        <Panel title="Selection">
          {sel.length ? sel.map((id) => <div key={id}><code>{id}</code> → <code>{durableOf(S.opened, id)}</code></div>) : <i>none</i>}
          {selBinding && <div style={{ marginTop: 6 }}>Binding: <b>{selBinding.kind}</b> {('chart_id' in selBinding) && <code>{selBinding.chart_id}</code>} ({selBinding.element})</div>}
          {selBinding?.kind === 'chart' && <button onClick={() => setSheet(selBinding.chart_id)}>Edit data</button>}
          {group && <button onClick={() => setGroup(null)}>Exit group</button>}
        </Panel>
        <Panel title="AI proposals (pptx-ops dryRun → atomic apply)">
          <button onClick={() => propose(false)}>Propose 5-op batch</button> <button onClick={() => propose(true)}>Propose invalid batch</button>
          {proposal && <div style={{ marginTop: 6, padding: 6, background: '#f6f7f9' }}>
            <b>{proposal.label}</b>
            {proposal.plan && <ol style={{ margin: '4px 0', paddingLeft: 18 }}>{proposal.plan.map((p, i) => <li key={i}>{p}</li>)}</ol>}
            {proposal.failures?.length ? <div style={{ color: '#b00' }}>dryRun failures: {proposal.failures.map((f: any) => `#${f.index} ${f.error}`).join(' | ')}</div> : null}
            <button onClick={applyProposal}>Apply</button> <button onClick={() => setProposal(null)}>Reject</button>
          </div>}
        </Panel>
        <Panel title="Persistence">
          <button onClick={saveReopen}>Save → reopen</button> <button onClick={downloadPptx}>Download .pptx</button>
          <div>Undo {S.undo.length} · Redo {S.redo.length} · Journal {S.journal.length}</div>
        </Panel>
        <Panel title="Integrity (canvas vs working layer)">
          {integ && <div style={{ color: integ.ok ? '#176b2c' : '#b00' }}>
            {integ.ok ? 'OK' : 'MISMATCH'} · bindings {integ.resolved}/{integ.bindings} · chart points {integ.chartPoints} · cells {integ.cells}
            {[...integ.chartMismatch, ...integ.cellMismatch, ...integ.duplicateDurable.map((d: string) => 'duplicate durable id ' + d)].slice(0, 6).map((m: string) => <div key={m}>{m}</div>)}
          </div>}
        </Panel>
        <Panel title="Frame timing">{perf.gestures.slice(-4).map((g, i) => <div key={i}>{g.frames} frames · {g.avgFps} fps · p95 {g.p95ms} ms</div>)}</Panel>
        <Panel title="Log">{log.map((l, i) => <div key={i}>{l}</div>)}</Panel>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: any }) {
  return <div style={{ background: '#fff', padding: 10, marginBottom: 10, boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}><div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>{children}</div>
}

/** Our data editor (replaces GenOffice's ChartDataDialog, which turns empty cells into 0). */
function DataSheet({ chartId, onClose, onEdit }: { chartId: string; onClose: () => void; onEdit: (ds: string, date: string, v: number | null) => void; ver: number }) {
  const spec = S.project.charts[chartId], s = chartSeries(S.project, chartId)
  const cell = (dsId: string, date: string) => effectiveObs(S.project.datasets[dsId]).find((o: any) => o.date === date)
  const rows: { label: string; date: string; ds: string[] }[] = s.snapshot
    ? spec.series.map((x: any) => ({ label: x.label, date: String(spec.x.date), ds: [x.dataset] }))
    : s.x.map((d: string) => ({ label: d, date: d, ds: spec.series.map((x: any) => x.dataset) }))
  const cols = s.snapshot ? [String(spec.x.date)] : spec.series.map((x: any) => x.label)
  return (
    <div className="sheet" style={{ marginBottom: 10, background: '#fff', padding: 10, maxHeight: 360, overflow: 'auto' }}>
      <b>Edit data · {spec.title}</b> <button onClick={onClose}>Close</button>
      <table style={{ borderCollapse: 'collapse', marginTop: 6 }}><thead><tr><th></th>{cols.map((c: string) => <th key={c} style={{ padding: '2px 8px' }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td style={{ padding: '2px 8px' }}>{r.label}</td>{r.ds.map((ds) => {
          const o = cell(ds, r.date)
          return <td key={ds}><input data-ds={ds} data-date={r.date} defaultValue={o?.value ?? ''} key={`${ds}${r.date}${o?.value}`} placeholder="gap"
            style={{ width: 56, textAlign: 'right', background: o?.edited ? '#fff6d6' : undefined }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            onBlur={(e) => { const t = e.target.value.trim(), v = t === '' ? null : Number(t); if ((v ?? null) !== (o?.value ?? null) && (v === null || Number.isFinite(v))) onEdit(ds, r.date, v) }} /></td>
        })}</tr>)}</tbody></table>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
