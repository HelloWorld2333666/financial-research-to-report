// Bindings sidecar: versioned, with a migration hook so older saved shapes keep opening
// (Phase 1 defect 8: old projects were not migrated).
import { SIDECAR_SCHEMA, type Binding, type Sidecar } from './types'

/** Accepts the current schema, the Experiment 3 shape ({bindings}) and a bare bindings map. */
export function migrateSidecar(raw: any): Sidecar {
  if (raw?.schema === SIDECAR_SCHEMA) return raw as Sidecar
  if (raw?.schema) throw new Error(`unsupported sidecar schema ${raw.schema}`)
  const bindings: Record<string, Binding> = raw?.bindings ?? (raw && typeof raw === 'object' ? raw : {})
  for (const [k, b] of Object.entries(bindings)) {
    if (!/^e_[0-9a-zA-Z]+$/.test(k)) throw new Error(`binding key ${k} is not a durable element id`)
    if (!b || typeof (b as any).kind !== 'string' || typeof (b as any).slide !== 'string') throw new Error(`binding ${k} is malformed`)
  }
  return { schema: SIDECAR_SCHEMA, bindings }
}
