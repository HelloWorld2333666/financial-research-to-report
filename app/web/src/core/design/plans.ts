// Stage 4 (first step): slide plans written by the design model, resolved into frr-design/1.
//
// A plan is a SlideDesign in JSON with two differences: text never contains a typed figure, only tokens that the
// evidence Writer resolves, and a chart is a request (intent, family, datasets, periods) that the recommender turns into
// a valid frr-viz spec. Everything else (objects, slots, cells, composition, language) is the existing design vocabulary,
// and the result goes through validateDesign like any other design.
//
// Tokens:
//   {{num ds.xx.metric 2026 [long] [signed] [abs]}}   a dataset value
//   {{change ds.xx.metric 2023 2026}}                  end − start (pp for percentages)
//   {{gap ds.a ds.b 2026 [long]}}                       a − b at one period
//   {{spread ds.a ds.b 2026}}                           (a − b) × 100 in bp
//   {{ev ev.some.id}}                                   a sourced fact outside the datasets
import type { Project } from '../types'
import { recommend, type Intent } from '../recommend'
import type { VizSpec } from '../viz'
import { Writer } from './insight'
import { DESIGN_SCHEMA, newDesignId, validateDesign, type Composition, type DesignObject, type DesignText, type SlideDesign } from './spec'
import type { DesignCandidate } from './planner'
import { assetKeys, credits } from './assets'

export interface VizRequest { intent: Intent; family: string; datasets: string[]; at?: string; between?: [string, string]; title?: string; from?: string; to?: string; evidence?: string[]; params?: { years?: number; rates?: number[]; growth?: number[] } }
type PlanText = string | { text: string; lead?: string }
export interface PlanObject { id: string; kind: 'text' | 'kpi' | 'viz' | 'shape' | 'image' | 'map'; text?: PlanText; items?: PlanText[]; value?: string; context?: PlanText; request?: VizRequest; [k: string]: unknown }
export interface Plan { id: string; label?: string; objective: string; claim: string; language?: string; density?: 'low' | 'medium' | 'high'; composition: Composition; objects: PlanObject[]; rationale?: string[] }

const TOKEN = /\{\{\s*(num|change|gap|spread|ev)\s+([^}]*?)\s*\}\}/g

function fill(w: Writer, s: string): string {
  return s.replace(TOKEN, (_m, op: string, args: string) => {
    const a = args.split(/\s+/), has = (k: string) => a.includes(k)
    if (op === 'num') return w.num(a[0]!, a[1]!, { long: has('long'), signed: has('signed'), abs: has('abs') })
    if (op === 'change') return w.change(a[0]!, a[1]!, a[2]!)
    if (op === 'gap') return w.gap(a[0]!, a[1]!, a[2]!, { long: has('long') })
    if (op === 'spread') return w.spread(a[0]!, a[1]!, a[2]!)
    return w.ev(a[0]!)
  })
}
const text = (w: Writer, t: PlanText): DesignText => {
  const s = typeof t === 'string' ? { text: t } : t
  const out = w.text(fill(w, s.text))
  return s.lead ? { ...out, lead: s.lead } : out
}

function vizFor(p: Project, r: VizRequest): VizSpec {
  const rec = recommend(p, { intent: r.intent, datasets: r.datasets, ...(r.at ? { at: r.at } : {}), ...(r.between ? { between: r.between } : {}), ...(r.title ? { title: r.title } : {}), ...(r.evidence ? { evidence: r.evidence } : {}), ...(r.params ? { params: r.params } : {}) })
  const c = rec.candidates.find((x) => x.family === r.family && x.state === 'valid' && x.spec)
  if (!c?.spec) {
    const why = rec.error ?? rec.candidates.filter((x) => x.family === r.family).map((x) => x.refused ?? x.invalid?.reason ?? x.warnings.map((f) => f.reason).join(', ') ?? x.state).join('; ')
    throw new Error(`no valid ${r.family} for ${r.intent} of ${r.datasets.join(', ')}${why ? ` (${why})` : ''}`)
  }
  return r.from || r.to ? { ...c.spec, view: { ...c.spec.view, ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) } } : c.spec
}

/** The assets a plan uses (pictures, maps, flags, icons): load them with prepareAssets before resolving. */
export const planAssets = (p: Project, plan: Plan) => assetKeys(plan.objects, (ds) => p.datasets[ds]?.geo)

export function resolvePlan(p: Project, plan: Plan): DesignCandidate {
  const w = new Writer(p)
  // photographs, logos and map geometry are credited in the source line (licences and authors from the asset library)
  const credit = credits(planAssets(p, plan))
  if (credit) plan = { ...plan, objects: plan.objects.map((o) => (o.kind === 'text' && (o as any).role === 'source' && typeof o.text === 'string' && !o.text.includes(credit) ? { ...o, text: `${o.text.replace(/\.?\s*$/, '.')} Visuals: ${credit}.` } : o)) }
  const objects: DesignObject[] = plan.objects.map((o) => {
    const { request, text: t, items, value, context, ...rest } = o
    if (o.kind === 'text') return { ...rest, text: text(w, t ?? ''), ...(items ? { items: items.map((x) => text(w, x)) } : {}) } as DesignObject
    if (o.kind === 'kpi') return { ...rest, value: text(w, value ?? ''), ...(context ? { context: text(w, context) } : {}) } as DesignObject
    if (o.kind === 'viz') return { ...rest, viz: vizFor(p, request!) } as DesignObject
    return rest as DesignObject
  })
  const d: SlideDesign = { schema: DESIGN_SCHEMA, id: newDesignId(), objective: plan.objective, claim: text(w, plan.claim), audience: 'executive', density: plan.density ?? 'high',
    layout: { family: 'composed', params: {}, composition: plan.composition }, profile: 'institutional', language: plan.language ?? p.identity?.id ?? 'atlas', objects, rationale: plan.rationale ?? [],
    ...(w.derivations.length ? { derivations: [...w.derivations] } : {}) }
  return { label: plan.label ?? plan.id, design: d, problems: validateDesign(p, d) }
}
