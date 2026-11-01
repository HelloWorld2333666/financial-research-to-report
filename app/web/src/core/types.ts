// Shared types for the workspace: Evidence Core project, bindings sidecar, journal and bundle.

export type Actor = 'user' | 'ai' | 'research'

export interface Observation { date: string; value: number | null; status?: string; evidence_id?: string }
export interface WorkingEntry { value?: number; deleted?: boolean; by: string; at: string; status: 'manual_unverified' | 'verified' }
export interface Dataset {
  id: string; title: string; entity: string; geo: string; metric: string; unit: string; frequency: string
  origin: string; verification: string; source_url: string; source_note: string
  observations: Observation[]; working: Record<string, WorkingEntry>
}
export interface DesignDNA { font: string; ink: string; accent: string; muted: string; rule: string; series: string[] }
export interface Project {
  schema: 'frr-project/1'; id: string; title: string; record_id?: string
  datasets: Record<string, Dataset>; evidence: Record<string, any>; gaps: any[]; design_dna: DesignDNA
}

export interface ChartSpec { type: 'line' | 'bar'; title: string; series: string[] }
export interface TableSpec { title: string; datasets: string[]; dates: string[] }
/** What an element on a slide is bound to. Keys of the sidecar are GenOffice durable element ids. */
export type Binding =
  | { kind: 'text'; slide: string; role: string; claims?: ClaimBinding[] }
  | { kind: 'chart'; slide: string; chart: ChartSpec }
  | { kind: 'table'; slide: string; table: TableSpec }
  | { kind: 'placeholder'; slide: string; label: string; request: any }
  | { kind: 'decor'; slide: string }
/** A number in generated text and the evidence (or derivation) it came from. Filled in M4. */
export interface ClaimBinding { text: string; evidence?: string[]; derivation?: { formula: string; inputs: string[] } }

export const SIDECAR_SCHEMA = 'frr-sidecar/1'
export interface Sidecar { schema: typeof SIDECAR_SCHEMA; bindings: Record<string, Binding> }

export interface JournalEntry { seq: number; at: string; kind: string; actor: Actor; summary: string; proposalId?: string; slides: string[] }

export const BUNDLE_SCHEMA = 'frr-bundle/1'
export interface Bundle {
  schema: typeof BUNDLE_SCHEMA; project: Project; sidecar: Sidecar; journal: JournalEntry[]
  threads: Record<string, any>; deck: string | null; slides?: number; meta?: any
}
