// M3 panels: the evidence inspector (where every number on the selected element comes from), the
// data workspace (source and working values side by side; edit, verify, restore) and the export
// dialog (the server decides; final needs every open item acknowledged).
import React, { useEffect, useState } from 'react'
import type { Store } from './core/store'
import { findEl, textOf } from './core/deck'
import { cellText, derivationValue, effectiveObs, evidenceIndex, evidenceValue, textNumbers } from './core/evidence'
import type { Project } from './core/types'

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
      {q?.query_url ? <div className="ev-q">Query <a href={q.query_url} target="_blank" rel="noreferrer" data-query-url>{q.query_url}</a></div> : <div className="muted">No query URL recorded</div>}
      <div className="muted">Retrieved {when(q?.retrieved_at)} · {q?.method ?? 'unknown method'} · hash {q?.content_sha256 ? q.content_sha256.slice(0, 12) : 'not captured'}</div>
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
  if (b.kind === 'chart') return <div className="evidence">{b.chart.series.map((d) => series(d))}</div>
  if (b.kind === 'table') return <div className="evidence">{b.table.datasets.map((d) => series(d, b.table.dates))}</div>
  if (b.kind === 'placeholder') return <p className="bad">Placeholder: {b.label}. No data yet; a final export needs this acknowledged.</p>
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
  const fromSel = b?.kind === 'chart' ? b.chart.series : b?.kind === 'table' ? b.table.datasets : []
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

/** Export: the server re-checks the saved deck and enforces the policy; this dialog only asks. */
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
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Export deck">
        <h3>Export deck (.pptx)</h3>
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
      </div>
    </div>
  )
}
