// Shared types for the workspace: Evidence Core project, bindings sidecar, journal and bundle.

export type Actor = 'user' | 'ai' | 'research'

export interface Observation { date: string; value: number | null; status?: string; evidence_id?: string }
export interface WorkingEntry { value?: number; deleted?: boolean; by: string; at: string; status: 'manual_unverified' | 'verified'; verified_by?: string; verified_at?: string }
export interface Dataset {
  id: string; title: string; entity: string; geo: string; metric: string; unit: string; frequency: string
  origin: string; verification: string; source_url: string; source_note: string
  observations: Observation[]; working: Record<string, WorkingEntry>
}
export interface DesignDNA { font: string; ink: string; accent: string; muted: string; rule: string; series: string[] }
export interface Project {
  schema: 'frr-project/1'; id: string; title: string; record_id?: string
  datasets: Record<string, Dataset>; evidence: Record<string, any>; derivations?: Record<string, Derivation>; gaps: any[]; design_dna: DesignDNA
}
/** A number computed from evidence (schema 0.2 Derivation): formula over named inputs (evidence or derivation ids). */
export interface Derivation { id: string; statement: string; formula: string; inputs: Record<string, string>; value: number; unit: string; period?: string; rounding?: number }

export interface ChartSpec { type: 'line' | 'bar'; title: string; series: string[] }
export interface TableSpec { title: string; datasets: string[]; dates: string[] }
/** What an element on a slide is bound to. Keys of the sidecar are GenOffice durable element ids. */
export type Binding =
  | { kind: 'text'; slide: string; role: string; numbers?: NumberRef[] }
  | { kind: 'chart'; slide: string; chart: ChartSpec }
  | { kind: 'table'; slide: string; table: TableSpec }
  | { kind: 'placeholder'; slide: string; label: string; request: any }
  | { kind: 'decor'; slide: string }
/** A number as written in slide text and the one evidence item or derivation it came from (schema 0.2 NumberRef). */
export interface NumberRef { text: string; evidence?: string; derivation?: string }

export const SIDECAR_SCHEMA = 'frr-sidecar/1'
export interface Sidecar { schema: typeof SIDECAR_SCHEMA; bindings: Record<string, Binding> }

export interface JournalEntry { seq: number; at: string; kind: string; actor: Actor; summary: string; proposalId?: string; slides: string[] }

export const BUNDLE_SCHEMA = 'frr-bundle/1'
export interface Bundle {
  schema: typeof BUNDLE_SCHEMA; project: Project; sidecar: Sidecar; journal: JournalEntry[]
  threads: Record<string, any>; deck: string | null; slides?: number; meta?: any
}
