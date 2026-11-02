// M3 panels: the evidence inspector (where every number on the selected element comes from), the
// data workspace (source and working values side by side; edit, verify, restore) and the export
// dialog (the server decides; final needs every open item acknowledged).
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import type { Store } from './core/store'
import type { Command } from './core/commands'
import { findEl, render, slideIndex, textOf } from './core/deck'
import { cellText, derivationValue, effectiveObs, evidenceIndex, evidenceValue, RATING_COLUMNS, ratingCells, textNumbers } from './core/evidence'
import type { Project } from './core/types'
import { check, type Cell, type Projected } from './core/viz'
import { Thumb } from './chat'
import * as Dialog from '@radix-ui/react-dialog'

const when = (iso?: string) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '—')

/** One evidence item: the value, its source and exactly how it was retrieved. */
export function EvidenceCard({ p, id }: { p: Project; id: string }) {
  const e = p.evidence[id], r = evidenceValue(p, id)
  if (!e) return <div className="ev-card bad">Evidence {id} is not in this project.</div>
  const q = e.retrieval
  return (
    <div className="ev-card" data-evidence={id}>
      <div><b>{e.value}</b> {e.unit} · {e.period} · <span className="muted">{id}</span></div>
      {r.edited && <div className="bad">Working value {r.value ?? 'gap'} ({r.status === 'verified' ? 'manual, verified' : 'manual, unverified'}); source value kept</div>}
      <div>{e.source_title}</div>
      {e.excerpt && <blockquote className="ev-excerpt" data-excerpt>“{e.excerpt}” <span className="muted">(p. {e.page})</span></blockquote>}
      {q?.method === 'pdf_upload' ? <div className="muted">Uploaded PDF · SHA-256 {q.content_sha256?.slice(0, 16)}… · {q.note}</div>
        : q?.query_url ? <div className="ev-q">Query <a href={q.query_url} target="_blank" rel="noreferrer" data-query-url>{q.query_url}</a></div> : <div className="muted">No query URL recorded</div>}
      <div className="muted">{q?.method === 'pdf_upload' ? 'Uploaded' : 'Retrieved'} {when(q?.retrieved_at)} · {q?.method ?? 'unknown method'} · hash {q?.content_sha256 ? q.content_sha256.slice(0, 12) : 'not captured'}</div>
      <div className="muted">{e.verification === 'verified' ? `Verified by ${e.verified_by} on ${e.verified_on}` : 'Not verified'}</div>
    </div>
  )
}

function DerivationCard({ p, id }: { p: Project; id: string }) {
  const d = p.derivations?.[id]
  if (!d) return <div className="ev-card bad">Derivation {id} is not in this project.</div>
  const now = derivationValue(p, id)
  return (
    <div className="ev-card" data-derivation={id}>
      <div><b>{d.value}</b> {d.unit} · derived · <span className="muted">{id}</span></div>
      <div>{d.statement}</div>
      <div className="formula" data-formula>{d.formula}</div>
      {now != null && now !== d.value && <div className="bad">Inputs now give {now} {d.unit}</div>}
      {Object.entries(d.inputs).map(([name, ref]) => (
        <div key={name} className="ev-input" data-input={name}><span className="formula">{name}</span> =
          {p.derivations?.[ref] ? <DerivationCard p={p} id={ref} /> : <EvidenceCard p={p} id={ref} />}</div>
      ))}
    </div>
  )
}

function Row({ label, value, status, children }: { label: string; value: string; status: string; children: React.ReactNode }) {
  return (
    <details className={'num ' + status} data-status={status}>
      <summary><span className="num-v">{value}</span> <span className="muted">{label}</span>{status !== 'ok' && <span className="badge">{status}</span>}</summary>
      {children}
    </details>
  )
}

/** One projected value's provenance: the evidence behind a working value, or a derived value's formula and inputs. */
function CellProvenance({ p, cell }: { p: Project; cell: Cell }) {
  if (!cell) return <div className="bad">No value (gap)</div>
  if ('derived' in cell) return (
    <div className="ev-card" data-derived>
      <div className="formula" data-formula>{cell.derived.formula}</div>
      {Object.entries(cell.derived.inputs).map(([name, x]) => (
        <div key={name} className="ev-input"><span className="formula">{name}</span> = {x.value ?? '—'} ({x.dataset}, {x.period})
          {x.evidence ? <EvidenceCard p={p} id={x.evidence} /> : <div className="bad">manual value, no source evidence</div>}</div>
      ))}
    </div>
  )
  return cell.evidence ? <EvidenceCard p={p} id={cell.evidence} /> : <div className="bad">Manual value with no source evidence</div>
}

/** Every value a visual shows, from its spec's projection (VIS V1). */
function VizEvidence({ p, spec }: { p: Project; spec: any }) {
  let pr: Projected
  try { pr = check(p, spec) } catch (e: any) { return <p className="bad">This visual no longer fits its data: {e.message}</p> }
  const status = (c: Cell) => (!c ? 'unsourced' : 'derived' in c ? 'ok' : !c.evidence ? 'unsourced' : c.edited ? 'edited' : 'ok')
  return (
    <div className="evidence" data-viz={spec.id}>
      <div className="muted small">{spec.family}{spec.subtype && spec.subtype !== 'clustered' ? ` · ${spec.subtype}` : ''} · {pr.label} · {pr.unit}</div>
      {pr.x && <div className="ev-series"><h4>x: {p.datasets[pr.x.dataset]?.title}</h4>{pr.x.values.map((v, i) => (
        <Row key={i} label={pr.categories[i]!} value={String(v)} status={status(pr.x!.cells[i]!)}><CellProvenance p={p} cell={pr.x!.cells[i]!} /></Row>))}</div>}
      {pr.series.map((s, si) => (
        <div key={si} className="ev-series"><h4>{s.dataset ? p.datasets[s.dataset]?.title : s.name}</h4>
          {s.values.map((v, i) => v == null && !s.cells[i] ? null : (
            <Row key={i} label={pr.categories[i]!} value={v == null ? 'gap' : pr.ratings ? ratingText(pr, s.cells[i]!) : String(v)} status={status(s.cells[i]!)}><CellProvenance p={p} cell={s.cells[i]!} /></Row>
          ))}
        </div>
      ))}
      {!!pr.undated?.length && <p className="muted small" data-undated>{pr.undated.length} rating action{pr.undated.length === 1 ? '' : 's'} without a verified date (not placed on the timeline): {pr.undated.map((id) => (p.evidence[id] as any)?.statement ?? id).join('; ')}</p>}
    </div>
  )
}
/** A rating point shows its symbol and outlook, never the notch index it is drawn at. */
const ratingText = (pr: Projected, cell: Cell) => { const x = pr.ratings!.find((r) => cell && 'evidence' in cell && r.evidence === cell.evidence); return x ? `${x.rating}${x.outlook ? ` (${x.outlook})` : ''}` : '?' }

/** Every number on the selected element and what it resolves to. */
export function EvidencePanel({ store }: { store: Store }) {
  const p = store.project, sel = store.selection
  if (sel.length !== 1) return <p className="muted">Select one element to see where each of its numbers comes from.</p>
  const id = sel[0]!, b = store.sidecar.bindings[id], f = findEl(store.deck, id)
  if (!b || !f) return <p className="muted">This element is not bound to data.</p>
  const idx = evidenceIndex(p)
  const series = (dsId: string, dates?: string[]) => {
    const ds = p.datasets[dsId]
    const obs = effectiveObs(ds).filter((o) => !dates || dates.includes(o.date))
    return (
      <div key={dsId} className="ev-series">
        <h4>{ds?.title ?? dsId}</h4>
        {obs.map((o) => o.value == null && !o.edited ? null : (
          <Row key={o.date} label={o.date} value={b.kind === 'table' ? cellText(p, dsId, o.date) : String(o.value ?? 'gap')}
            status={!o.evidence_id ? 'unsourced' : o.edited ? (o.status === 'verified' ? 'verified-edit' : 'edited') : 'ok'}>
            {o.evidence_id ? <EvidenceCard p={p} id={o.evidence_id} /> : <div className="bad">Manual value with no source evidence ({o.status})</div>}
          </Row>
        ))}
      </div>
    )
  }
  if (b.kind === 'viz') return <VizEvidence p={p} spec={b.spec} />
  if (b.kind === 'table') return <div className="evidence">{b.table.datasets.map((d) => series(d, b.table.dates))}</div>
  if (b.kind === 'placeholder') return <PlaceholderPanel store={store} id={id} b={b} />
  if (b.kind === 'ratings') return (
    <div className="evidence">{b.rows.map((eid) => (
      <Row key={eid} label={ratingCells(p.evidence[eid])[0]} value={ratingCells(p.evidence[eid]).slice(2, 5).join(' · ')} status={p.evidence[eid] ? 'ok' : 'unsourced'}>
        <EvidenceCard p={p} id={eid} />
      </Row>))}</div>
  )
  if (b.kind !== 'text') return <p className="muted">No numbers.</p>
  const nums = textNumbers(textOf(f.el), b.numbers, p)
  if (!nums.length) return <p className="muted">No figures in this text.</p>
  return (
    <div className="evidence">
      {nums.map((n, i) => (
        <Row key={i} label={n.ref?.derivation ? 'derived' : n.ref?.evidence ? (idx.get(n.ref.evidence)?.ds ?? 'evidence') : 'no source'} value={n.text} status={n.status}>
          {n.status === 'stale' && <div className="bad">The data now says {n.data ?? 'nothing'}; edit the text or restore the value.</div>}
          {n.ref?.evidence && <EvidenceCard p={p} id={n.ref.evidence} />}
          {n.ref?.derivation && <DerivationCard p={p} id={n.ref.derivation} />}
          {n.status === 'unsourced' && <div className="bad">This figure was typed, not generated from evidence. A final export needs it acknowledged.</div>}
        </Row>
      ))}
    </div>
  )
}

/** Source and working values side by side for one dataset; edit, verify and restore manual values. */
export function DataPanel({ store, exec }: { store: Store; exec: Store['exec'] }) {
  const p = store.project
  const b = store.selection.length === 1 ? store.sidecar.bindings[store.selection[0]!] : undefined
  const fromSel = b?.kind === 'viz' ? b.spec.view.datasets : b?.kind === 'table' ? b.table.datasets : []
  const ids = Object.keys(p.datasets)
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => { if (fromSel[0]) setPick(fromSel[0]) }, [store.selection.join()])
  const dsId = pick && p.datasets[pick] ? pick : ids[0]
  const edits = Object.entries(p.datasets).flatMap(([d, ds]) => Object.entries(ds.working).map(([date, w]) => ({ d, date, w })))
  const open = edits.filter((e) => e.w.status !== 'verified')
  if (!dsId) return <p className="muted">This project has no datasets.</p>
  const ds = p.datasets[dsId]!
  const set = (date: string, raw: string, current: number | null) => {
    const v = raw.trim() === '' ? null : Number(raw)
    if (v !== null && !Number.isFinite(v)) return
    if (v !== current) exec({ kind: 'data.set', dataset: dsId, date, value: v })
  }
  return (
    <div className="data">
      <div className={open.length ? 'bad' : 'good'} data-unverified={open.length}>{open.length ? `${open.length} manual value${open.length === 1 ? '' : 's'} not verified` : 'No unverified manual values'}
        {open.map((e) => <button key={e.d + e.date} className="link" onClick={() => setPick(e.d)}>{e.d} {e.date}</button>)}</div>
      <select value={dsId} onChange={(e) => setPick(e.target.value)} aria-label="Dataset">{ids.map((d) => <option key={d} value={d}>{p.datasets[d]!.title}{fromSel.includes(d) ? ' (selected)' : ''}</option>)}</select>
      <div className="muted">{ds.source_note} · {ds.unit}</div>
      <table className="grid" data-dataset={dsId}>
        <thead><tr><th>Period</th><th>Source</th><th>Working</th><th>Status</th><th /></tr></thead>
        <tbody>{effectiveObs(ds).map((o) => {
          const w = ds.working[o.date]
          return (
            <tr key={o.date} data-date={o.date} className={w ? (w.status === 'verified' ? 'verified' : 'edited') : ''}>
              <td>{o.date}</td>
              <td className="n">{o.source ?? '—'}</td>
              <td className="n"><input key={`${o.date}:${o.value}`} defaultValue={o.value ?? ''} aria-label={`Working value ${o.date}`}
                onBlur={(e) => set(o.date, e.target.value, o.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></td>
              <td>{w ? (w.deleted ? 'gap, ' : '') + (w.status === 'verified' ? `verified by ${w.verified_by}` : `manual by ${w.by}`) : o.evidence_id ? 'source' : o.status}</td>
              <td>{w && w.status !== 'verified' && <button onClick={() => exec({ kind: 'data.verify', dataset: dsId, date: o.date })}>Verify</button>}
                {w && <button onClick={() => exec({ kind: 'data.restore', dataset: dsId, date: o.date })}>Restore</button>}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

/** Export: the server re-checks the saved deck and enforces the policy; this dialog only asks. Rendered inside a Radix Dialog (focus trap, Escape). */
export function ExportDialog({ store, close, reproject }: { store: Store; close: () => void; reproject: () => void }) {
  const [mode, setMode] = useState<'draft' | 'final'>('draft')
  const [pol, setPol] = useState<any>(null), [ack, setAck] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false), [result, setResult] = useState<any>(null), [error, setError] = useState<string | null>(null)
  const load = async () => {
    setPol(null); setError(null)
    if (store.dirty) { const r = await store.save(); if (!r.ok) return setError(`Save failed: ${r.error}`) }
    setPol(await (await fetch(`/api/projects/${store.project.id}/export`)).json())
  }
  useEffect(() => { load() }, [])
  const ready = pol && !pol.blocking.some((x: any) => x.key === 'empty') && (mode === 'draft' || (!pol.blocking.length && pol.acknowledge.every((a: any) => ack[a.key])))
  const go = async () => {
    setBusy(true); setError(null)
    const r = await fetch(`/api/projects/${store.project.id}/export`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, acknowledged: Object.keys(ack).filter((k) => ack[k]) }) })
    const j = await r.json(); setBusy(false)
    if (!r.ok) return setError(j.error)
    setResult(j)
    const a = document.createElement('a'); a.href = j.url; a.download = j.file; a.click()
  }
  return (
    <>
        <Dialog.Title asChild><h3>Export deck (.pptx)</h3></Dialog.Title>
        <div className="seg">{(['draft', 'final'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setResult(null) }}>{m === 'draft' ? 'Draft' : 'Final report'}</button>)}</div>
        {!pol ? <p className="muted">{error ?? 'Checking the saved deck…'}</p> : <>
          <p className="muted small">Server check of the saved deck: {pol.integrity.resolved}/{pol.integrity.bindings} bindings, {pol.integrity.points} chart points, {pol.integrity.cells} table cells, {pol.integrity.sourced}/{pol.integrity.figures} figures in text sourced.</p>
          {pol.blocking.map((x: any) => <div key={x.key} className="block bad" data-blocking={x.key}>{x.text}{x.key === 'integrity' && x.items?.some((i: any) => !i.detail.startsWith('text says')) && <> <button onClick={() => { reproject(); load() }}>Re-project from data</button></>}
            {x.key === 'integrity' && x.items?.some((i: any) => i.detail.startsWith('text says')) && <div className="small">Text that cites a changed value must be edited (or the value restored in Data).</div>}
            {x.items?.slice(0, 5).map((i: any, k: number) => <div key={k} className="small">{i.detail}</div>)}</div>)}
          {mode === 'draft'
            ? <p className="muted">Drafts can contain anything. {pol.acknowledge.length || pol.blocking.length ? 'Each slide gets a red “DRAFT” banner because this deck has open items.' : 'Nothing is open, so no banner is added.'}</p>
            : <>
              <p className="muted">A final export certifies nothing on its own. Resolve or explicitly acknowledge each item; acknowledgements are recorded with the export.</p>
              {pol.acknowledge.length ? pol.acknowledge.map((a: any) => <label key={a.key} className="ack" data-ack={a.key}><input type="checkbox" checked={!!ack[a.key]} onChange={(e) => setAck({ ...ack, [a.key]: e.target.checked })} /><span>{a.text}</span></label>)
                : <p className="good">Nothing to acknowledge: every value is sourced and verified.</p>}
            </>}
          {error && <p className="bad" data-error>{error}</p>}
          {result && <p className="good" data-exported={result.mode}>Exported {result.file} ({Math.round(result.bytes / 1024)} KB){result.draft_banner ? ' with DRAFT banner' : ''}. <a href={result.url} download={result.file}>Download again</a></p>}
          {pol.exports?.length > 0 && <p className="muted small">Previous exports: {pol.exports.slice(-3).map((x: any) => `${x.mode} ${when(x.at)}`).join(' · ')}</p>}
        </>}
        <div className="row end"><button onClick={close}>Close</button><button className="primary" disabled={!ready || busy} onClick={go}>{busy ? 'Exporting…' : mode === 'final' ? 'Export final' : 'Export draft'}</button></div>
    </>
  )
}

// ------------------------------------------------------------------ M5: research requests, uploads and the task centre
async function startPdfTask(store: Store, file: File, params: Record<string, any>) {
  if (store.dirty) await store.save()
  const up = await fetch(`/api/projects/${store.project.id}/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file })
  const meta = await up.json()
  if (!up.ok) throw new Error(meta.error)
  const t = await fetch(`/api/projects/${store.project.id}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'rating_pdf', title: `Rating actions from ${meta.filename}`, params: { upload: meta.id, ...params } }) })
  if (!t.ok) throw new Error((await t.json()).error)
  dispatchEvent(new CustomEvent('frr:tab', { detail: 'tasks' }))
}

function PlaceholderPanel({ store, id, b }: { store: Store; id: string; b: any }) {
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false)
  return (
    <div className="evidence" data-placeholder={id}>
      <p className="bad">Placeholder: {b.label}. No data yet; a final export needs this acknowledged.</p>
      <div className="muted">{b.request?.reason}</div>
      <label className="upload">
        <span>{busy ? 'Uploading…' : 'Upload the agency press release (PDF)'}</span>
        <input type="file" accept="application/pdf,.pdf" aria-label="Upload agency PDF" disabled={busy} onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return
          setBusy(true); setErr(null)
          try { await startPdfTask(store, file, { entity: b.request?.entity ?? 'France', element: id, slide: b.slide }) } catch (x: any) { setErr(String(x.message ?? x)) } finally { setBusy(false); e.target.value = '' }
        }} />
      </label>
      <div className="muted small">pypdf reads the text; the local model quotes; each rating is kept only if its excerpt is found on its page.</div>
      {err && <p className="bad" data-error>{err}</p>}
    </div>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`

function TaskResult({ store, t }: { store: Store; t: any }) {
  const r = t.result, pid = `task:${t.id}`
  const state = store.proposals[pid] ?? 'open', open = state === 'open' || state === 'undone'
  const [pv, setPv] = useState<any>(null), [err, setErr] = useState<string | null>(null)
  let cmd: Command | null = null, blocked: string | null = null
  if (r.kind === 'datasets_proposal') {
    const fresh = r.datasets.filter((d: any) => !store.project.datasets[d.id])
    cmd = fresh.length ? { kind: 'data.addDatasets', datasets: r.datasets, evidence: r.evidence } : null
    if (!fresh.length) blocked = 'Every series is already in the project.'
  }
  if (r.kind === 'rating_proposal') {
    const target = r.element && findEl(store.deck, r.element) && store.sidecar.bindings[r.element]?.kind === 'placeholder' ? r.element : null
    cmd = target ? { kind: 'placeholder.fill', id: target, evidence: r.evidence, title: r.title, subtitle: 'Rating actions quoted from the agency press release (uploaded PDF); each verified on its page', source_note: r.source_note } : null
    if (!target) blocked = 'The placeholder this request belongs to is no longer on the deck.'
  }
  const preview = () => cmd && setPv(store.preview(cmd, (o) => o.slides.map((sid) => render(store.deck, slideIndex(store.deck, sid), 300, store.metrics))))
  const apply = () => { if (!cmd) return; const x = store.exec(cmd, { actor: 'research', proposalId: pid }); setErr(x.ok ? null : x.error!); if (x.ok) setPv(null) }
  return (
    <div className="proposal" data-proposal={pid} data-state={state}>
      <div className="p-summary" data-summary>{r.summary}</div>
      {r.kind === 'rating_proposal' && <table className="grid small"><thead><tr>{RATING_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{r.evidence.map((e: any) => <tr key={e.id}>{ratingCells(e).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody></table>}
      {r.kind === 'rating_proposal' && r.evidence.map((e: any) => <blockquote key={e.id} className="ev-excerpt">“{e.excerpt}” <span className="muted">(p. {e.page})</span></blockquote>)}
      {r.kind === 'datasets_proposal' && <div className="muted small">{r.datasets.map((d: any) => `${d.entity} ${d.metric} (${d.observations.length})`).join(' · ')}{r.failed?.length ? ` · failed: ${r.failed.join('; ')}` : ''}</div>}
      {r.kind === 'no_evidence' && <div className="small">{r.rejected.slice(0, 6).map((c: any, i: number) => <div key={i} className="muted">p. {c.page}: {c.reason} — “{String(c.excerpt).slice(0, 90)}…”</div>)}</div>}
      {pv && (pv.ok ? pv.value.map((s: any, i: number) => <Thumb key={i} slide={s} />) : <div className="bad">Preview failed: {pv.error}</div>)}
      {err && <div className="bad">Could not apply: {err}</div>}
      {cmd || blocked ? (open ? <>
        {blocked && <div className="bad small">{blocked}</div>}
        <div className="p-actions"><button onClick={preview} disabled={!cmd}>Preview</button><button className="primary" onClick={apply} disabled={!cmd}>{state === 'undone' ? 'Apply again' : 'Apply'}</button><button onClick={() => store.reject(pid)}>Reject</button></div>
      </> : <div className="p-state">{state === 'applied' ? 'Applied (one step; Undo reverts it)' : 'Rejected'}</div>) : null}
    </div>
  )
}

/** Background tasks for this project: they run on the server, so editing or reloading never stops them. */
export function TasksPanel({ store }: { store: Store }) {
  useSyncExternalStore(store.subscribe, () => store.revision)
  const [tasks, setTasks] = useState<any[]>([]), [err, setErr] = useState<string | null>(null)
  const load = () => fetch(`/api/projects/${store.project.id}/tasks`).then((r) => r.json()).then(setTasks).catch(() => {})
  const live = tasks.some((t) => t.status === 'queued' || t.status === 'running')
  useEffect(() => { load(); const h = setInterval(load, live ? 1000 : 5000); return () => clearInterval(h) }, [live])
  const act = async (t: any, what: 'cancel' | 'retry') => { await fetch(`/api/projects/${store.project.id}/tasks/${t.id}/${what}`, { method: 'POST' }); load() }
  return (
    <div className="tasks">
      <label className="upload"><span>Upload an agency PDF for rating actions</span>
        <input type="file" accept="application/pdf,.pdf" aria-label="Upload PDF" onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return
          const ph = Object.entries(store.sidecar.bindings).find(([, b]) => b.kind === 'placeholder') as [string, any] | undefined
          try { setErr(null); await startPdfTask(store, file, { entity: ph?.[1].request?.entity ?? 'France', element: ph?.[0] ?? null, slide: ph?.[1].slide ?? null }); load() } catch (x: any) { setErr(String(x.message ?? x)) }
          e.target.value = ''
        }} /></label>
      {err && <p className="bad">{err}</p>}
      {!tasks.length && <p className="muted small">No tasks yet. Ask in chat for research (e.g. “get Spain's fiscal data”), or upload an agency PDF.</p>}
      {[...tasks].reverse().map((t) => (
        <div key={t.id} className="task" data-task={t.id} data-status={t.status}>
          <div className="task-head"><b>{t.title}</b><span className={'badge-' + t.status}>{t.status}</span></div>
          <div className="bar"><div style={{ width: pct(t.progress) }} /></div>
          <ol className="task-log">{t.log.slice(-4).map((l: any, i: number) => <li key={i}><span className="muted">{l.at.slice(11, 19)}</span> {l.msg}</li>)}</ol>
          {t.error && <div className="bad small">{t.error}</div>}
          <div className="p-actions">
            {(t.status === 'running' || t.status === 'queued') && <button onClick={() => act(t, 'cancel')}>Cancel</button>}
            {['failed', 'cancelled', 'interrupted'].includes(t.status) && <button onClick={() => act(t, 'retry')}>Retry</button>}
          </div>
          {t.status === 'done' && t.result && <TaskResult store={store} t={t} />}
        </div>
      ))}
    </div>
  )
}
