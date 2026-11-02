// Chat (M4): assistant-ui threads over AG-UI to the PydanticAI agent (app/server/agent.py). One thread
// for the project and one per slide, all kept mounted so a running request survives switching. The
// canvas selection rides as AG-UI state. Tool results render as OUR proposal cards: preview on a
// copy of the deck, apply as one journalled step (actor "ai"), or reject. After a tool call the app
// shows the summary the server wrote from the result, not model prose (Experiment 3: the model said
// "has been added" before Apply). Messages and proposal states are saved with the project.
import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { useAgUiRuntime, useAgUiSetState } from '@assistant-ui/react-ag-ui'
import { HttpAgent } from '@ag-ui/client'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'
import type { Store } from './core/store'
import type { Command } from './core/commands'
import { findEl, render, slideIndex, textOf } from './core/deck'
import { textNumbers } from './core/evidence'
import { checkText } from './core/claims'
import { changeOptions, recommend, type Candidate } from './core/recommend'
import { assess } from './core/viz'
import type { Finding } from './core/constraints'

interface Host { store: Store; slide: () => string | undefined }
const HostCtx = createContext<Host>(null as any)
const useRev = (store: Store) => useSyncExternalStore(store.subscribe, () => store.revision)
const parse = (r: any) => { if (r == null || typeof r !== 'string') return r; try { return JSON.parse(r) } catch { return { kind: 'error', message: r } } }

/** What the agent may know about the canvas selection: ids, kinds, labels and, for text, its sourced figures. */
export function describeSelection(store: Store) {
  const p = store.project
  return store.selection.map((id) => {
    const b: any = store.sidecar.bindings[id], f = findEl(store.deck, id)
    if (b?.kind === 'text' && f) {
      const text = textOf(f.el)
      const figures = textNumbers(text, b.numbers, p).filter((n) => n.status === 'ok' && n.ref).map((n, i) => ({ key: `n${i + 1}`, text: n.ref!.text, evidence: n.ref!.evidence, derivation: n.ref!.derivation }))
      return { id, kind: 'text', role: b.role, label: b.role, text, figures }
    }
    // to the agent a visual is a chart: its title, metric and datasets (from the spec)
    if (b?.kind === 'viz') return { id, kind: 'chart', label: b.spec.title, family: b.spec.family, metric: p.datasets[b.spec.view.datasets[0]!]?.metric ?? null, datasets: b.spec.view.datasets }
    if (b?.kind === 'table') return { id, kind: 'table', label: b.table.title, metric: p.datasets[b.table.datasets[0]]?.metric ?? null, datasets: b.table.datasets }
    return { id, kind: b?.kind ?? 'element', label: b?.label ?? null }
  })
}

export function Thumb({ slide, width = 300 }: { slide: any; width?: number }) {
  return (
    <div className="pv-thumb" style={{ width, height: (width * 9) / 16 }}>
      <div style={{ transform: `scale(${width / slide.widthPx})`, transformOrigin: '0 0' }}>
        <SlideCanvas slide={slide} selectedIds={[]} images={new Map()} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />
      </div>
    </div>
  )
}

/** A proposal: preview (dry run on the live deck, restored), apply (one undoable step), reject. */
/** A proposal: Preview, Apply, Reject. A visual allowed with a warning shows the warning and applies only through
 *  "Use anyway" (known up front via `warn`, or reported by the command); `blocked` (invalid) cannot be applied. */
function Card({ pid, title, cmd, children, blocked, warn }: { pid: string; title: string; cmd: Command | null; children?: React.ReactNode; blocked?: string | null; warn?: Finding[] }) {
  const { store } = useContext(HostCtx)
  useRev(store)
  const state = store.proposals[pid] ?? 'open'
  const [pv, setPv] = useState<any>(null), [err, setErr] = useState<string | null>(null), [need, setNeed] = useState<Finding[] | null>(warn?.length ? warn : null)
  const withAccept = (): Command | null => cmd && (need ? { ...cmd, accept: need.map((w) => w.code) } as Command : cmd)
  const preview = () => { const c = withAccept(); if (c) setPv(store.preview(c, (o) => o.slides.map((sid) => render(store.deck, slideIndex(store.deck, sid), 300, store.metrics)))) }
  const apply = () => {
    const c = withAccept(); if (!c) return
    const r = store.exec(c, { actor: 'ai', proposalId: pid })
    if (r.warnings) { setNeed(r.warnings); setErr(null); return }
    setErr(r.ok ? null : r.error!); if (r.ok) setPv(null)
  }
  const open = state === 'open' || state === 'undone'
  return (
    <div className="proposal" data-proposal={pid} data-state={state}>
      <div className="p-title">{title}</div>
      {children}
      {pv && (pv.ok ? pv.value.map((s: any, i: number) => <Thumb key={i} slide={s} />) : <div className="bad">Preview failed: {pv.error}</div>)}
      {err && <div className="bad">Could not apply: {err}</div>}
      {blocked && open && <div className="bad small">{blocked}</div>}
      {need && open && !blocked && <div className="warn-box" data-warning>{need.map((w) => <div key={w.code}>⚠ {w.reason}</div>)}
        <div className="muted">Allowed: same data, sources and integrity checks; Undo reverts it.</div></div>}
      {open ? (
        <div className="p-actions">
          <button onClick={preview} disabled={!cmd}>{pv ? 'Refresh preview' : 'Preview'}</button>
          <button className="primary" onClick={apply} disabled={!cmd || !!blocked} data-apply={need && !blocked ? 'anyway' : 'apply'}>{need && !blocked ? 'Use anyway' : state === 'undone' ? 'Apply again' : 'Apply'}</button>
          <button onClick={() => store.reject(pid)}>Reject</button>
        </div>
      ) : <div className="p-state">{state === 'applied' ? 'Applied (one step; Undo reverts it)' : 'Rejected'}</div>}
    </div>
  )
}

const Summary = ({ r }: { r: any }) => <div className="p-summary" data-summary>{r.summary}</div>
const Running = ({ what }: { what: string }) => <div className="tool-running">{what}… (local model)</div>
// a validation error (the model called the tool with the wrong arguments) arrives as a list, not our {kind, message}
const ErrorNote = ({ r }: { r: any }) => <div className="bad small" data-tool-error>{r?.message ?? (Array.isArray(r) ? `The model called the tool incorrectly (${r.map((e: any) => e.msg ?? e).join('; ')}); nothing was changed. Ask again.` : 'The tool returned nothing; nothing was changed.')}</div>

function DeckTool(props: any) {
  const r = parse(props.result)
  if (!r) return <Running what="Drafting slides from verified data" />
  if (r.kind !== 'deck_proposal') return <ErrorNote r={r} />
  return <div><Summary r={r} />{r.slides.map((s: any) => <Card key={s.key} pid={`${props.toolCallId}:${s.key}`} title={`Slide · ${s.title}`} cmd={{ kind: 'slide.compose', proposal: s }} />)}</div>
}

function SeriesTool(props: any) {
  const { store } = useContext(HostCtx)
  const r = parse(props.result)
  if (!r) return <Running what="Retrieving and verifying" />
  if (r.kind !== 'series_proposal') return <ErrorNote r={r} />
  const gone = !findEl(store.deck, r.element)
  return (
    <Card pid={props.toolCallId} title={`Add ${r.dataset.entity} to “${r.chart_label}”`} cmd={gone ? null : { kind: 'chart.addSeries', id: r.element, dataset: r.dataset, evidence: r.evidence }}
      blocked={gone ? 'The chart no longer exists.' : null}>
      <Summary r={r} />
      <div className="muted small">Source: {r.dataset.source_note}</div>
    </Card>
  )
}

function RewriteTool(props: any) {
  const { store } = useContext(HostCtx)
  useRev(store)
  const r = parse(props.result)
  if (!r) return <Running what="Rewording" />
  if (r.kind !== 'rewrite_proposal') return <ErrorNote r={r} />
  const p = store.project, b: any = store.sidecar.bindings[r.element]
  const chart: any = b && Object.values(store.sidecar.bindings).find((x: any) => x.kind === 'viz' && x.slide === b.slide)
  const nums = textNumbers(r.after, r.numbers, p)
  const claims = checkText(r.after, p, 'France', chart ? p.datasets[chart.spec.view.datasets[0]]?.metric ?? null : null)
  const bad = nums.filter((n) => n.status !== 'ok').map((n) => `${n.text} ${n.status}`).concat(claims.filter((c) => c.status === 'mismatch').map((c) => c.detail))
  const gone = !findEl(store.deck, r.element)
  return (
    <Card pid={props.toolCallId} title={`Rewrite ${r.role ?? 'text'}`} cmd={gone ? null : { kind: 'text.set', id: r.element, text: r.after, numbers: r.numbers }}
      blocked={gone ? 'The text box no longer exists.' : bad.length ? `Checks failed: ${bad.join('; ')}` : null}>
      <Summary r={r} />
      <div className="rw"><div className="muted small">Before</div><div className="rw-before">{r.before}</div><div className="muted small">After</div><div className="rw-after" data-after>{r.after}</div></div>
      <div className={bad.length ? 'bad small' : 'good small'} data-checks={bad.length ? 'fail' : 'pass'}>
        {bad.length ? 'Not verified' : `Verified: ${nums.length} figure${nums.length === 1 ? '' : 's'} bound to evidence; claim check passed`}
      </div>
    </Card>
  )
}

function LayoutTool(props: any) {
  const r = parse(props.result)
  if (!r) return <Running what="Planning layout" />
  if (r.kind !== 'layout_proposal') return <ErrorNote r={r} />
  return <Card pid={props.toolCallId} title={`Layout · ${r.action.replace('_', ' ')}`} cmd={r.commands.length === 1 ? r.commands[0] : { kind: 'batch', commands: r.commands, summary: r.action }}><Summary r={r} /></Card>
}

function ResearchTool(props: any) {
  const { slide } = useContext(HostCtx)
  const r = parse(props.result)
  if (!r) return <Running what="Starting research" />
  if (r.kind === 'task_started') return (
    <div className="proposal" data-task-started={r.task_id}><div className="p-title">Background task · {r.title}</div><Summary r={r} />
      <div className="p-actions"><button onClick={() => dispatchEvent(new CustomEvent('frr:tab', { detail: 'tasks' }))}>Open Tasks</button></div></div>
  )
  if (r.kind !== 'research_proposal') return <ErrorNote r={r} />
  const target = r.slide ?? slide()
  return <Card pid={props.toolCallId} title={`Research request · ${r.request.topic}`} cmd={target ? { kind: 'placeholder.add', slide: target, label: r.label, request: r.request } : null}><Summary r={r} /></Card>
}

/** A chart by intent (VIS V2): the recommender picks from the data; alternatives and refusals keep their reasons. */
function VisualTool(props: any) {
  const { store } = useContext(HostCtx)
  useRev(store)
  const r = parse(props.result)
  if (!r) return <Running what="Choosing a visual" />
  if (r.kind !== 'visual_request') return <ErrorNote r={r} />
  const rec = recommend(store.project, r)
  const warned = rec.candidates.filter((c) => c.state === 'warning'), refused = rec.candidates.filter((c) => c.state === 'invalid')
  if (!rec.recommended && !warned.length) return <div><Summary r={r} /><div className="bad small" data-tool-error>No valid visual for this data: {rec.error ?? refused.map((c) => `${c.label}: ${c.refused}`).join('; ')}</div></div>
  const cmdFor = (c: Candidate): Command => {
    const ds = store.project.datasets[r.datasets[0]]
    const base = { key: `visual:${c.key}`, kicker: (ds?.metric ?? 'data').toUpperCase(), title: c.spec?.title ?? c.table?.title, subtitle: `${ds?.unit ?? ''} · Eurostat · ${r.intent}`.replace(/^ · /, '') }
    return { kind: 'slide.compose', proposal: c.spec ? { ...base, viz: c.spec } : { ...base, table: c.table } }
  }
  const alts = rec.candidates.filter((c) => c.state === 'valid' && c !== rec.recommended).slice(0, 2)
  const warnCard = (c: Candidate) => <Card key={c.key} pid={`${props.toolCallId}:${c.key}`} title={`${rec.recommended ? 'Allowed with a warning' : 'Possible, with a warning'}: ${c.label}`} cmd={cmdFor(c)} warn={c.warnings}><div className="muted small">{c.why}</div></Card>
  return (
    <div data-visual-request>
      <Summary r={r} />
      {rec.recommended ? <Card pid={`${props.toolCallId}:${rec.recommended.key}`} title={`Recommended: ${rec.recommended.label}`} cmd={cmdFor(rec.recommended)}>
        <div className="p-summary" data-why>{rec.recommended.why}</div>
      </Card> : <div className="muted small">No visual fits this data without a caveat; these are possible:</div>}
      {alts.map((c) => <Card key={c.key} pid={`${props.toolCallId}:${c.key}`} title={`Alternative: ${c.label}`} cmd={cmdFor(c)}><div className="muted small">{c.why}</div></Card>)}
      {!rec.recommended && warned.map(warnCard)}
      {rec.recommended && warned.length > 0 && <details className="small" data-warned><summary className="muted">Allowed with a warning ({warned.length})</summary>{warned.map(warnCard)}</details>}
      {refused.length > 0 && <details className="small"><summary className="muted">Not valid for this data ({refused.length})</summary>
        {refused.map((c) => <div key={c.key} className="muted" data-refused={c.key}>{c.label}: {c.refused}</div>)}</details>}
    </div>
  )
}

/** Change the selected chart, checked against the data first. Invalid: the reason, plus valid alternatives (and a
 *  change of view that fixes it, if any). Allowed with a warning: the warning and "Use anyway". */
function ChangeVisualTool(props: any) {
  const { store } = useContext(HostCtx)
  useRev(store)
  const r = parse(props.result)
  if (!r) return <Running what="Checking the change" />
  if (r.kind !== 'visual_change_request') return <ErrorNote r={r} />
  const b: any = store.sidecar.bindings[r.element]
  if (b?.kind !== 'viz') return <Card pid={props.toolCallId} title={`Change visual: ${r.family}`} cmd={null} blocked="The chart is no longer on the deck."><Summary r={r} /></Card>
  const target = { ...b.spec, family: r.family, subtype: r.subtype, view: { ...b.spec.view, ...(r.transform ? { transform: r.transform } : {}) } }
  const a = assess(store.project, target)
  const change = (o: { family: any; subtype?: any; transform?: any; at?: string; from?: string }): Command =>
    ({ kind: 'viz.change', id: r.element, family: o.family, ...(o.subtype ? { subtype: o.subtype } : {}), ...(o.transform ? { transform: o.transform } : {}), ...(o.at ? { at: o.at } : {}), ...(o.from ? { from: o.from } : {}) })
  const opts = a.invalid ? changeOptions(store.project, b.spec) : []
  const fix = opts.find((o) => o.family === r.family && (o.subtype ?? 'clustered') === (r.subtype ?? 'clustered') && o.fixes.length)?.fixes[0]
  const instead = opts.filter((o) => o.state === 'valid' && !o.current).sort((x, y) => Number(y.recommended) - Number(x.recommended)).slice(0, 2)
  return (
    <div data-visual-change>
      <Card pid={props.toolCallId} title={`Change visual: ${r.family}${r.subtype ? ` (${r.subtype})` : ''}`} blocked={a.invalid ? `Not possible: ${a.invalid.reason}` : null}
        cmd={a.invalid ? null : change(r)} warn={a.invalid ? undefined : a.warnings}>
        <Summary r={r} />
      </Card>
      {fix && <Card pid={`${props.toolCallId}:fix`} title={`Instead: ${fix.label}`} cmd={change(fix)} />}
      {instead.map((o) => <Card key={o.label} pid={`${props.toolCallId}:${o.family}:${o.subtype ?? ''}:${o.transform}`} title={`Instead: ${o.label}`} cmd={change(o)} />)}
    </div>
  )
}

const Text = ({ text }: any) => <div className="msg-text">{text}</div>
const Fallback = (p: any) => <div className="muted small">tool {p.toolName}</div>
const tools = { by_name: { compose_deck: DeckTool, add_comparison: SeriesTool, rewrite_text: RewriteTool, layout_suggestion: LayoutTool, start_research: ResearchTool, propose_visual: VisualTool, change_visual: ChangeVisualTool }, Fallback }

const UserMessage = () => <MessagePrimitive.Root className="msg-user"><MessagePrimitive.Parts components={{ Text }} /></MessagePrimitive.Root>
function AssistantMessage() {
  // in a turn that called a tool, the proposal cards and their server-written summaries ARE the reply:
  // model text is hidden, whether it shares the tool call's message or follows in a new one (AG-UI)
  const hasTool = useAuiState((s: any) => {
    const ms = s.thread.messages as any[], i = ms.findIndex((m) => m.id === s.message.id)
    for (let j = i; j >= 0 && ms[j].role === 'assistant'; j--) if ((ms[j].content as any[]).some((p) => p.type === 'tool-call')) return true
    return false
  })
  return <MessagePrimitive.Root className="msg-assistant"><MessagePrimitive.Parts components={{ Text: hasTool ? () => null : Text, tools } as any} /></MessagePrimitive.Root>
}

function StateSync({ state }: { state: any }) { const set = useAgUiSetState(); useEffect(() => { set(state) }, [JSON.stringify(state)]); return null }

const revive = (msgs: any[]) => msgs.map((m) => ({ ...m, createdAt: new Date(m.createdAt ?? Date.now()) }))

function ThreadHost({ store, threadId, visible, state, placeholder }: { store: Store; threadId: string; visible: boolean; state: any; placeholder: string }) {
  const agent = useMemo(() => new HttpAgent({ url: '/api/agent', threadId }), [threadId])
  // restore the saved transcript (tool results included, so proposal cards come back with their states)
  const history = useMemo(() => ({
    async load() {
      const msgs = revive(store.threadMessages(threadId))
      return { headId: msgs.at(-1)?.id ?? null, messages: msgs.map((message, i) => ({ message, parentId: i ? msgs[i - 1].id : null })) }
    },
    async append() {}, // saved from the thread state below, once each run settles
  }), [threadId])
  const runtime = useAgUiRuntime({ agent, adapters: { history } as any })
  useEffect(() => runtime.thread.subscribe(() => {
    const st = runtime.thread.getState()
    if (!st.isRunning && st.messages.length) store.setThreadMessages(threadId, st.messages)
  }), [runtime])
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <StateSync state={state} />
      <div className="thread" data-thread={threadId} style={{ display: visible ? 'flex' : 'none' }}>
        <ThreadPrimitive.Root className="thread-root">
          <ThreadPrimitive.Viewport className="thread-viewport">
            <ThreadPrimitive.Empty><p className="muted small">{placeholder}</p></ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input placeholder="Ask, e.g. “Compare this chart with Italy”" minRows={2} aria-label="Message" />
            <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  )
}

export function ChatPanel({ store, slideId, slideNo, visible }: { store: Store; slideId: string | undefined; slideNo: number; visible: boolean }) {
  useRev(store)
  const [scope, setScope] = useState<'project' | 'slide'>('project')
  const [cfg, setCfg] = useState<any>(null)
  useEffect(() => { fetch('/api/agent/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ reachable: false })) }, [])
  const pid = store.project.id
  const current = scope === 'project' ? `${pid}:project` : `${pid}:${slideId}`
  // every thread with history stays mounted, plus the one on screen
  const ids = [...new Set([`${pid}:project`, ...Object.keys(store.threads.messages ?? {}), ...(slideId ? [`${pid}:${slideId}`] : [])])].filter((t) => t.startsWith(pid + ':'))
  const host = useMemo<Host>(() => ({ store, slide: () => slideId }), [store, slideId])
  const selection = describeSelection(store)
  return (
    <HostCtx.Provider value={host}>
      <div className="chat" style={{ display: visible ? 'flex' : 'none' }}>
        <div className="seg chat-scope">
          <button className={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')} data-scope="project">Project</button>
          <button className={scope === 'slide' ? 'on' : ''} onClick={() => setScope('slide')} data-scope="slide" disabled={!slideId}>Slide {slideNo}</button>
        </div>
        <div className="model-line" data-model data-ready={cfg ? String(!!cfg.reachable) : undefined}>{cfg ? `${cfg.model ?? 'model'} via ${cfg.provider ?? '?'} · ${cfg.reachable ? 'ready' : 'not reachable'}` : 'Checking model…'}{selection.length ? ` · selected: ${selection.map((s) => s.label ?? s.kind).join(', ')}` : ''}</div>
        {ids.map((t) => {
          const slide = t.slice(pid.length + 1)
          return <ThreadHost key={t} store={store} threadId={t} visible={t === current} placeholder={slide === 'project' ? 'Project thread: ask for a deck, research, or changes across slides.' : `Slide thread: ask about ${slide}.`}
            state={{ project: pid, thread: slide === 'project' ? 'project' : slide, slide: slide === 'project' ? slideId ?? null : slide, selection }} />
        })}
      </div>
    </HostCtx.Provider>
  )
}
