// The workspace store: one open project (deck + Evidence Core project + bindings sidecar + journal +
// threads), selection by durable id, snapshot undo/redo, and bundle save/load through the service.
import { createBlankPptx, openPptx, savePptx, copyElementData, type OpenedPptx } from '@genoffice/pptx-engine'
import { HeuristicMetrics, type FontMetricsProvider } from '@genoffice/pptx-render'
import { run, themeOps, txn, type ClipItem, type Command, type Outcome } from './commands'
import { findEl, slideList } from './deck'
import { migrateSidecar } from './sidecar'
import { BUNDLE_SCHEMA, type Actor, type Bundle, type JournalEntry, type Project, type Sidecar } from './types'

interface Snapshot { slides: any; entries: Map<string, unknown>; size: any; project: Project; sidecar: Sidecar }
export interface ExecResult extends Partial<Outcome> { ok: boolean; error?: string }

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export class Store {
  deck!: OpenedPptx
  project!: Project
  sidecar: Sidecar = { schema: 'frr-sidecar/1', bindings: {} }
  journal: JournalEntry[] = []
  threads: Record<string, any> = {}
  selection: string[] = []
  metrics: FontMetricsProvider = new HeuristicMetrics()
  undoStack: Snapshot[] = []
  redoStack: Snapshot[] = []
  revision = 0 // bumps on every change; the UI re-renders from it
  savedRevision = 0
  clipboard: ClipItem[] = []
  private listeners = new Set<() => void>()

  static async fromBundle(b: Bundle): Promise<Store> {
    const s = new Store()
    s.project = b.project
    s.sidecar = migrateSidecar(b.sidecar)
    s.journal = b.journal ?? []
    s.threads = b.threads ?? {}
    s.deck = await openPptx(b.deck ? unb64(b.deck) : await createBlankPptx())
    // a new deck takes its theme (colours, heading/body font) from the project's Design DNA
    if (!b.deck && b.project.design_dna?.series) txn({ deck: s.deck, project: s.project, sidecar: s.sidecar }, themeOps(b.project.design_dna))
    return s
  }

  async toBundle(): Promise<Bundle> {
    const bytes = await savePptx(this.deck)
    return { schema: BUNDLE_SCHEMA, project: this.project, sidecar: this.sidecar, journal: this.journal, threads: this.threads, deck: b64(bytes), slides: this.deck.deck.slides.length }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private changed() { this.revision++; this.listeners.forEach((f) => f()) }
  get dirty() { return this.revision !== this.savedRevision }

  private snap(): Snapshot {
    return { slides: structuredClone(this.deck.deck.slides), entries: new Map(this.deck.archive.entries), size: { ...this.deck.deck.size }, project: structuredClone(this.project), sidecar: structuredClone(this.sidecar) }
  }
  private restore(s: Snapshot) {
    this.deck.deck.slides = structuredClone(s.slides); this.deck.deck.size = { ...s.size }
    const e = this.deck.archive.entries; e.clear(); for (const [k, v] of s.entries) e.set(k, v as any)
    this.project = structuredClone(s.project); this.sidecar = structuredClone(s.sidecar)
  }
  private log(kind: string, actor: Actor, summary: string, slides: string[], proposalId?: string) {
    this.journal.push({ seq: (this.journal.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), kind, actor, summary, slides, ...(proposalId ? { proposalId } : {}) })
  }

  /** Run one command as one undoable, journaled step. On any failure nothing changes. */
  exec(cmd: Command, meta: { actor: Actor; proposalId?: string } = { actor: 'user' }): ExecResult {
    const before = this.snap()
    try {
      const out = run({ deck: this.deck, project: this.project, sidecar: this.sidecar }, cmd)
      this.undoStack.push(before); this.redoStack = []
      this.log(cmd.kind, meta.actor, out.summary, out.slides, meta.proposalId)
      this.selection = this.selection.filter((d) => findEl(this.deck, d))
      this.changed()
      return { ok: true, ...out }
    } catch (e: any) {
      this.restore(before)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  /** Apply a command, read the result, then restore: a dry run that never touches the live document. */
  preview<T>(cmd: Command, read: (out: Outcome) => T): { ok: boolean; value?: T; error?: string } {
    const before = this.snap()
    try { return { ok: true, value: read(run({ deck: this.deck, project: this.project, sidecar: this.sidecar }, cmd)) } }
    catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
    finally { this.restore(before) }
  }

  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(this.snap()); this.restore(s); this.log('history.undo', 'user', 'Undo', []); this.changed(); return true }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(this.snap()); this.restore(s); this.log('history.redo', 'user', 'Redo', []); this.changed(); return true }

  select(ids: string[]) { this.selection = ids; this.changed() }
  copy(ids: string[]) {
    this.clipboard = ids.map((id) => { const f = findEl(this.deck, id)!; return { item: copyElementData(this.deck, this.deck.deck.slides[f.index]!, f.group ?? f.el), binding: this.sidecar.bindings[id] } })
    return this.clipboard.length
  }
  slides() { return slideList(this.deck) }

  // ---------------------------------------------------------------- persistence through the service
  /** Integrity of the deck as the SERVER read it from disk after the last save (app/server/integrity.py). */
  serverIntegrity: any = null
  async save(): Promise<{ ok: boolean; error?: string }> {
    const rev = this.revision
    const r = await fetch(`/api/projects/${this.project.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await this.toBundle()) })
    if (!r.ok) return { ok: false, error: (await r.json()).error }
    this.serverIntegrity = (await r.json()).integrity ?? null
    this.savedRevision = rev; this.changed(); this.savedRevision = this.revision
    return { ok: true }
  }
  async saveVersion(label: string) {
    await this.save()
    return (await fetch(`/api/projects/${this.project.id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) })).json()
  }
  static async open(id: string) { return Store.fromBundle(await (await fetch(`/api/projects/${id}`)).json()) }
  static async create(seed: string, title: string) {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed, title }) })
    return Store.fromBundle(await r.json())
  }
}
