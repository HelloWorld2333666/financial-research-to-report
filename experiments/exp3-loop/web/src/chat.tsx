// Chat threads: assistant-ui over AG-UI (PydanticAI backend). One runtime per thread (project + one per
// slide), all kept mounted so history survives switching. The canvas selection rides as AG-UI state.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive, ComposerPrimitive } from '@assistant-ui/react'
import { useAgUiRuntime, useAgUiSetState } from '@assistant-ui/react-ag-ui'
import { HttpAgent } from '@ag-ui/client'
import { SlideCanvas } from '@genoffice-slides/renderer/SlideCanvas'

export interface AppApi {
  previewSlide: (p: any) => any; applySlide: (p: any) => string | null
  previewSeries: (r: any) => any; applySeries: (r: any) => boolean
  isApplied: (key: string) => boolean; markApplied: (key: string) => void
  onTask: (t: any) => void
}
export const Api = createContext<AppApi>(null as any)

const parse = (r: any) => { if (typeof r !== 'string') return r; try { return JSON.parse(r) } catch { return { kind: 'text', message: r } } }

export function Thumb({ render, width = 300 }: { render: any; width?: number }) {
  return <div style={{ width, height: width * 9 / 16, overflow: 'hidden', pointerEvents: 'none', border: '1px solid #d8dde4', background: '#fff' }}>
    <div style={{ transform: `scale(${width / render.widthPx})`, transformOrigin: '0 0' }}>
      <SlideCanvas slide={render} selectedIds={[]} images={new Map()} zoom={1} onSelect={() => {}} onEditText={() => {}} onTransform={() => {}} onEditTableCell={() => {}} onContextMenu={() => {}} onTableColResize={() => {}} />
    </div></div>
}

function Card({ id, title, children, onPreview, onApply }: { id: string; title: string; children?: any; onPreview: () => any; onApply: () => boolean | string | null }) {
  const api = useContext(Api)
  const [pv, setPv] = useState<any>(null), [state, setState] = useState<'open' | 'applied' | 'rejected' | 'failed'>(api.isApplied(id) ? 'applied' : 'open')
  return <div className="proposal" data-state={state} style={{ border: '1px solid #cfd6df', borderRadius: 8, padding: 8, margin: '6px 0', background: state === 'applied' ? '#eef7f0' : state === 'rejected' ? '#f6f6f6' : '#fff' }}>
    <div style={{ fontWeight: 600, fontSize: 12 }}>{title}</div>{children}
    {pv && (pv.error ? <div style={{ color: '#b00' }}>Preview failed: {pv.error}</div> : pv.slides.map((s: any) => <div key={s.id} style={{ marginTop: 6 }}><Thumb render={s.render} width={300} /></div>))}
    {state === 'open' && <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
      <button onClick={() => setPv(onPreview())}>Preview</button>
      <button onClick={() => { const ok = onApply(); if (ok) { api.markApplied(id); setState('applied') } else setState('failed') }}>Apply</button>
      <button onClick={() => setState('rejected')}>Reject</button></div>}
    {state !== 'open' && <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{state}</div>}
  </div>
}

function DeckTool(props: any) {
  const api = useContext(Api), r = parse(props.result)
  if (!r) return <div className="tool-running">Composing deck…</div>
  if (r.kind !== 'deck_proposal') return <div>{r.message}</div>
  return <div><div style={{ fontSize: 12, color: '#555' }}>{r.note}</div>
    {r.slides.map((s: any) => <Card key={s.key} id={`${props.toolCallId}:${s.key}`} title={`Slide · ${s.title}`} onPreview={() => api.previewSlide(s)} onApply={() => api.applySlide(s)} />)}</div>
}
function SeriesTool(props: any) {
  const api = useContext(Api), r = parse(props.result)
  if (!r) return <div className="tool-running">Retrieving and verifying…</div>
  if (r.kind !== 'series_proposal') return <div style={{ color: '#a33' }}>{r.message}</div>
  return <Card id={props.toolCallId} title={`Add ${r.dataset.entity} to “${r.chart_label}”`} onPreview={() => api.previewSeries(r)} onApply={() => api.applySeries(r)}>
    <div style={{ fontSize: 11, color: '#555' }}>{r.retrieved ? `Retrieved live from Eurostat; ${r.dataset.observations.length} values verified by re-fetch${r.rejected ? `, ${r.rejected} rejected` : ''}.` : 'From verified project data.'} Source: {r.dataset.source_note}</div></Card>
}
function TaskTool(props: any) {
  const api = useContext(Api), r = parse(props.result)
  useEffect(() => { if (r?.kind === 'task_started') api.onTask(r) }, [r?.task_id])
  return <div style={{ fontSize: 12 }}>{r ? `Background task ${r.task_id} started: ${r.topic}. It will appear in Tasks.` : 'Starting task…'}</div>
}
const Text = ({ text }: any) => <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
const Fallback = (p: any) => <div style={{ fontSize: 11, color: '#777' }}>tool {p.toolName}</div>
const tools = { by_name: { compose_deck: DeckTool, add_comparison: SeriesTool, start_background_research: TaskTool }, Fallback }

const UserMessage = () => <MessagePrimitive.Root className="msg-user" style={{ margin: '8px 0', padding: '6px 10px', background: '#e8eef8', borderRadius: 8, alignSelf: 'flex-end' }}><MessagePrimitive.Parts components={{ Text }} /></MessagePrimitive.Root>
const AssistantMessage = () => <MessagePrimitive.Root className="msg-assistant" style={{ margin: '8px 0' }}><MessagePrimitive.Parts components={{ Text, tools } as any} /></MessagePrimitive.Root>

function StateSync({ state }: { state: any }) { const set = useAgUiSetState<any>(); useEffect(() => { set(state) }, [JSON.stringify(state)]); return null }

export function ThreadHost({ threadId, visible, state, placeholder }: { threadId: string; visible: boolean; state: any; placeholder: string }) {
  const agent = useMemo(() => new HttpAgent({ url: '/api/agent', threadId }), [threadId])
  const runtime = useAgUiRuntime({ agent })
  return <AssistantRuntimeProvider runtime={runtime}>
    <StateSync state={state} />
    <div className="thread" data-thread={threadId} style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
      <ThreadPrimitive.Root style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 4px' }}>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid #e2e6eb' }}>
          <ComposerPrimitive.Input placeholder={placeholder} minRows={2} style={{ flex: 1, font: 'inherit', padding: 6 }} />
          <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </div>
  </AssistantRuntimeProvider>
}
