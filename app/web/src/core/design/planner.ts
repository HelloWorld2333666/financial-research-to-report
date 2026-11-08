// Slide planner (PD1): plans a slide before drawing it. From a purpose and the verified data it answers, per slide:
// the single message, the evidence behind it, the visual that carries it, what gets emphasis, how much belongs on
// the slide, the layout, the form (chart, table, KPI, text), and whether it fits the deck's profile. It returns two
// or three structurally different designs, each validated; the model may propose wording, never figures.
import type { Project } from '../types'
import { evidenceIndex, figures } from '../evidence'
import { checkText } from '../claims'
import { recommend, subtitleFor, type Intent } from '../recommend'
import type { VizSpec } from '../viz'
import { commonLatest, entityOf, firstCommon, ranked, sourceLine, value, Writer } from './insight'
import { profileOf } from './profiles'
import { balanceRank, debtTrend, riskNarrative } from './editorial'
import { designTexts, DESIGN_SCHEMA, newDesignId, validateDesign, type Audience, type Density, type DesignObject, type DesignText, type LayoutFamily, type LayoutParams, type SlideDesign } from './spec'

export type Purpose = 'trend' | 'comparison' | 'risk'
export interface DesignRequest {
  purpose: Purpose
  objective?: string
  /** ISO-2 code of the country the slide is about (default FR) */
  focus?: string
  /** ISO-2 codes of the comparison countries (default: every country with the metric) */
  peers?: string[]
  metric?: string
  audience?: Audience
  density?: Density
  /** a family the requester prefers; it is offered first, alternatives still follow */
  family?: LayoutFamily
  /** wording proposed by the model for the main message; kept only if every figure in it is in the evidence */
  claim?: string
  /** use the PD1 standard layouts only (no editorial compositions) */
  standard?: boolean
}
export interface DesignCandidate { label: string; design: SlideDesign; problems: string[] }
/** Bumped when planning rules change, so saved chat cards re-plan instead of showing a plan made under older rules. */
export const PLAN_VERSION = 2
export interface PlanResult { candidates: DesignCandidate[]; inputs: { dataset: string; entity: string; unit: string; source: string }[]; notes: string[]; error?: string }

const NOUN: Record<string, string> = { debt: 'government debt', deficit: 'government balance', interest: 'interest spending', yield: '10-year bond yield', growth: 'real GDP growth' }
const ORD = ['', '', 'second ', 'third ', 'fourth ', 'fifth ', 'sixth ', 'seventh ', 'eighth ', 'ninth ', 'tenth ']
const ds = (geo: string, metric: string) => `ds.${geo.toLowerCase()}.${metric}`
const possessive = (s: string) => (s.endsWith('s') ? `${s}'` : `${s}'s`)
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function visual(p: Project, intent: Intent, datasets: string[], extra: { at?: string; between?: [string, string]; title?: string } = {}): VizSpec | null {
  const r = recommend(p, { intent, datasets, ...extra })
  return r.recommended?.spec ?? null
}

function base(p: Project, req: DesignRequest, family: LayoutFamily, params: LayoutParams, objective: string, claim: DesignText, objects: DesignObject[], rationale: string[], w: Writer): SlideDesign {
  return { schema: DESIGN_SCHEMA, id: newDesignId(), objective, claim, audience: req.audience ?? 'executive', density: req.density ?? 'medium',
    layout: { family, params }, profile: profileOf(p).id, objects, rationale, ...(w.derivations.length ? { derivations: [...w.derivations] } : {}) }
}

/**
 * Keep the model's wording only if it can be checked: every clause carries a figure the plan already bound to
 * evidence, and the claim checker finds no contradiction (value, year, rise or fall). A statement without a
 * figure ("France has closed the gap") cannot be checked against the data, so the app keeps its own wording.
 */
function modelClaim(p: Project, text: string | undefined, pool: DesignText[], notes: string[]): DesignText | null {
  if (!text?.trim()) return null
  const reject = (why: string) => { notes.push(`The proposed wording "${text.trim()}" was not used: ${why}. The app's wording, computed from the data, is used instead.`); return null }
  const refs = pool.flatMap((t) => t.numbers ?? [])
  const used = figures(text).map((f) => refs.find((r) => figures(r.text)[0]?.text === f.text))
  if (used.some((r) => !r)) return reject(`${figures(text).filter((_, i) => !used[i]).map((f) => f.text).join(', ')} is not a figure from the evidence on this slide`)
  const unchecked = text.split(/(?<=[.;:])\s+|,\s+(?:while|whereas|but)\s+/).map((c) => c.trim()).filter((c) => c && !figures(c).length)
  if (unchecked.length) return reject(`"${unchecked[0]}" states something without a figure, which the app cannot check against the data`)
  const bad = checkText(text, p).filter((c) => c.status === 'mismatch')
  if (bad.length) return reject(`the data contradict it (${bad.map((c) => c.detail).join('; ')})`)
  return { text: text.trim(), ...(used.length ? { numbers: used as any } : {}) }
}

// ------------------------------------------------------------------ trend: one metric over time, a focus country and peers
function planTrend(p: Project, req: DesignRequest, notes: string[]): DesignCandidate[] {
  const metric = req.metric ?? 'debt', focus = (req.focus ?? 'FR').toUpperCase()
  const peers = (req.peers?.length ? req.peers : Object.values(p.datasets).filter((d) => d.metric === metric).map((d) => d.geo)).map((g) => g.toUpperCase()).filter((g) => g !== focus)
  const dss = [ds(focus, metric), ...peers.map((g) => ds(g, metric))].filter((d) => p.datasets[d])
  if (!p.datasets[ds(focus, metric)]) throw new Error(`no verified ${metric} data for ${focus}`)
  const start = firstCommon(p, dss), end = commonLatest(p, dss)
  if (!start || !end || start === end) throw new Error('the series share fewer than two periods')
  const spec = visual(p, 'trend', dss, { title: cap(`${NOUN[metric] ?? metric}, ${p.datasets[dss[0]!]!.unit}`) })
  if (!spec) throw new Error('no valid trend visual for this data')
  const w = new Writer(p), F = dss[0]!, fe = entityOf(p, F)
  const dir = (d: string) => { const a = value(p, d, start)!, b = value(p, d, end)!; return b > a ? 'rose' : b < a ? 'fell' : 'was unchanged' }
  const peerBits = dss.slice(1).map((d) => `${possessive(entityOf(p, d))} ${w.num(d, end)}`)
  const claim = w.text(`${possessive(fe)} ${NOUN[metric] ?? metric} ${dir(F)} from ${w.num(F, start)} to ${w.num(F, end, { long: true })} between ${start} and ${end}` + (peerBits.length ? `; ${listJoin(peerBits)} in ${end}` : ''))
  const obs = dss.map((d) => w.text(`${entityOf(p, d)}: ${w.num(d, end, { long: true })} in ${end}, ${w.change(d, start, end)} since ${start}`))
  const rose = dss.filter((d) => dir(d) === 'rose').map((d) => entityOf(p, d)), fell = dss.filter((d) => dir(d) === 'fell').map((d) => entityOf(p, d))
  const take = w.text(rose.length && fell.length ? `Between ${start} and ${end}, ${listJoin(rose)} ${rose.length > 1 ? 'all ' : ''}moved up while ${listJoin(fell)} moved down` : `All ${words[dss.length] ?? dss.length} series ${rose.length ? 'rose' : 'fell'} between ${start} and ${end}`)
  const title = modelClaim(p, req.claim, [claim, ...obs], notes) ?? claim
  const kick = { id: 'kicker', kind: 'text' as const, role: 'kicker' as const, text: { text: `${fe} · ${metric} trend` } }
  const head = (sub = subtitleFor(p, spec)): DesignObject[] => [kick, { id: 'title', kind: 'text', role: 'title', text: title }, { id: 'subtitle', kind: 'text', role: 'subtitle', text: { text: sub } }]
  const source: DesignObject = { id: 'source', kind: 'text', role: 'source', text: { text: sourceLine(p, dss) } }
  const primary: DesignObject = { id: 'primary', kind: 'viz', role: 'primary', viz: spec, emphasis: F }
  const objective = req.objective ?? `Explain how ${possessive(fe)} ${NOUN[metric] ?? metric} developed against ${listJoin(dss.slice(1).map((d) => entityOf(p, d)))}`
  const why = (layout: string, emphasis: string) => [
    `Message: ${title.text}`, `Evidence: ${dss.length} verified Eurostat series, ${start}–${end}`, `Visual: ${spec.family} (the recommender's choice for a trend over ${dss.length} series)`,
    `Emphasis: ${emphasis}`, `Amount: ${dss.length} series and ${dss.length} short observations (${req.density ?? 'medium'} density)`, `Layout: ${layout}`,
    'Form: a chart, because the message is a change over time', `Fit: ${profileOf(p).name} profile, same header, type scale and source line as the rest of the deck`]
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  // beside the hero chart: the focus country's latest figure as a KPI, then one note per peer (no repetition)
  const focusKpi: DesignObject = { id: 'kpi1', kind: 'kpi', role: 'kpi', value: w.text(w.num(F, end)), label: `${cap(NOUN[metric] ?? metric)}, ${fe}, ${end} (${p.datasets[F]!.unit})`, context: w.text(`${w.change(F, start, end)} since ${start}`) }
  const peerObs = obs.slice(1)
  add('Hero chart with observations beside it', base(p, req, 'analytical_hero', { heroShare: 0.68, support: 'side', takeaway: 'none' }, objective, title,
    [...head(), primary, focusKpi, ...(peerObs.length ? [{ id: 'observations', kind: 'text' as const, role: 'observations' as const, text: peerObs[0]!, items: peerObs }] : []), source], why('analytical hero: the chart takes two thirds of the width, observations beside it', `${fe} in the structure colour; peers in their own colours`), w))
  add('Full-width chart, one note per country', base(p, req, 'analytical_hero', { heroShare: 1, support: 'below', takeaway: 'none' }, objective, title,
    [...head(take.text), primary, ...obs.slice(0, 3).map((t, i): DesignObject => ({ id: `observations${i ? i + 1 : ''}`, kind: 'text', role: 'observations', text: t, items: [t] })), source],
    why('analytical hero: full-width chart, the direction of each series as the subtitle, one note per country below', 'the direction of each series, stated once under the title'), w))
  const table = { title: `${cap(NOUN[metric] ?? metric)}: ${start} and ${end}`, datasets: dss, dates: [start, end] }
  const changes = dss.map((d) => w.text(`${entityOf(p, d)}: ${w.change(d, start, end)} since ${start}`))
  add('Chart and table side by side', base(p, req, 'comparative', { arrangement: 'chart_table', split: 0.6, takeaway: 'bottom' }, objective, title,
    [...head(), primary, { id: 'caption2', kind: 'text', role: 'caption', text: { text: table.title } },
      { id: 'secondary', kind: 'table', role: 'secondary', table }, { id: 'observations', kind: 'text', role: 'observations', text: changes[0]!, items: changes },
      { id: 'takeaway', kind: 'text', role: 'takeaway', text: take }, source],
    why('comparative: the trend chart with a table of the start and end values', 'the end-point values, readable exactly in the table'), w))
  return out
}

// ------------------------------------------------------------------ comparison: one metric across countries at the latest common period
function planComparison(p: Project, req: DesignRequest, notes: string[]): DesignCandidate[] {
  const metric = req.metric ?? 'deficit', focus = (req.focus ?? 'FR').toUpperCase()
  const geos = (req.peers?.length ? [focus, ...req.peers] : Object.values(p.datasets).filter((d) => d.metric === metric).map((d) => d.geo)).map((g) => g.toUpperCase())
  const dss = [...new Set(geos)].map((g) => ds(g, metric)).filter((d) => p.datasets[d])
  if (dss.length < 3) throw new Error(`a comparison needs at least three countries with ${metric} data (the project has ${dss.length})`)
  const at = commonLatest(p, dss)
  if (!at) throw new Error('the countries share no period')
  const prev = String(Number(at) - 1), hasPrev = dss.every((d) => value(p, d, prev) != null)
  const spec = visual(p, 'ranking', dss, { at, title: cap(`${NOUN[metric] ?? metric}, ${at} (${p.datasets[dss[0]!]!.unit})`) })
  if (!spec) throw new Error('no valid ranking visual for this data')
  const w = new Writer(p), F = ds(focus, metric), fe = entityOf(p, F)
  const asc = ranked(p, dss, at, 'asc'), rank = asc.findIndex((x) => x.ds === F) + 1, n = dss.length
  const worst = metric === 'deficit' ? 'weakest' : 'lowest', best = metric === 'deficit' ? 'strongest' : 'highest'
  const top = asc[asc.length - 1]!, bottom = asc[0]!
  const claim = p.datasets[F] && rank
    ? w.text(`${possessive(fe)} ${at} ${NOUN[metric] ?? metric} of ${w.num(F, at, { long: true })} was the ${ORD[rank] ?? rank + 'th '}${worst} of the ${words[n] ?? n} countries; ${entityOf(p, top.ds)} had the ${best} at ${w.num(top.ds, at)}`)
    : w.text(`${entityOf(p, bottom.ds)} had the ${worst} ${NOUN[metric] ?? metric} in ${at} (${w.num(bottom.ds, at)}); ${entityOf(p, top.ds)} the ${best} (${w.num(top.ds, at)})`)
  const neg = asc.filter((x) => x.v < 0).length
  const obs = [
    metric === 'deficit' ? w.text(neg === n ? `All ${words[n] ?? n} countries ran a deficit in ${at}` : neg === 0 ? `None of the ${words[n] ?? n} countries ran a deficit in ${at}`
      : `${cap(words[neg] ?? String(neg))} of the ${words[n] ?? n} countries ran a deficit in ${at}; ${words[n - neg] ?? n - neg} had a surplus or balance`) : null,
    w.text(`Range: from ${w.num(bottom.ds, at)} (${entityOf(p, bottom.ds)}) to ${w.num(top.ds, at)} (${entityOf(p, top.ds)})`),
    hasPrev && p.datasets[F] ? w.text(`${fe}: ${w.num(F, prev)} in ${prev}, ${w.num(F, at)} in ${at} (${w.change(F, prev, at)})`) : null,
  ].filter(Boolean) as DesignText[]
  const title = modelClaim(p, req.claim, [claim, ...obs], notes) ?? claim
  const head: DesignObject[] = [{ id: 'kicker', kind: 'text', role: 'kicker', text: { text: `${words[n] ?? n} countries · ${NOUN[metric] ?? metric}` } },
    { id: 'title', kind: 'text', role: 'title', text: title }, { id: 'subtitle', kind: 'text', role: 'subtitle', text: { text: subtitleFor(p, spec) } }]
  const source: DesignObject = { id: 'source', kind: 'text', role: 'source', text: { text: sourceLine(p, dss) } }
  const primary: DesignObject = { id: 'primary', kind: 'viz', role: 'primary', viz: spec, emphasis: p.datasets[F] ? F : undefined }
  const objective = req.objective ?? `Compare the latest ${NOUN[metric] ?? metric} of ${n} countries`
  const why = (layout: string) => [`Message: ${title.text}`, `Evidence: ${n} verified Eurostat series at ${at}`, `Visual: ${spec.family} ranked (signs kept: deficits extend left of zero)`,
    `Emphasis: ${p.datasets[F] ? `${fe} in the structure colour, the others in a neutral peer colour` : 'none'}`, `Amount: one ranked chart and ${obs.length} notes`, `Layout: ${layout}`,
    'Form: a ranked bar chart, because the message is an order; no small multiples (seven tiny panels would be unreadable)', `Fit: ${profileOf(p).name} profile`]
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  const order = asc.map((x) => x.ds)
  if (hasPrev) {
    const table = { title: `${cap(NOUN[metric] ?? metric)}: ${prev} and ${at}`, datasets: order, dates: [prev, at] }
    add('Ranked bars with a table of the last two years', base(p, req, 'comparative', { arrangement: 'chart_table', split: 0.58, takeaway: 'none' }, objective, title,
      [...head, primary, { id: 'caption2', kind: 'text', role: 'caption', text: { text: table.title } },
        { id: 'secondary', kind: 'table', role: 'secondary', table }, { id: 'observations', kind: 'text', role: 'observations', text: obs[0]!, items: obs.slice(0, 2) }, source], why('comparative: ranked bars and the exact values for two years'), w))
  }
  const focusKpi: DesignObject[] = p.datasets[F] && rank ? [{ id: 'kpi1', kind: 'kpi', role: 'kpi', value: w.text(w.num(F, at)), label: `${cap(NOUN[metric] ?? metric)}, ${fe}, ${at} (${p.datasets[F]!.unit})`,
    context: w.text(`the ${ORD[rank] ?? ''}${worst} of the ${words[n] ?? n}`) }] : []
  add('Ranked bars as the hero, notes beside', base(p, req, 'analytical_hero', { heroShare: 0.64, support: 'side', takeaway: 'none' }, objective, title,
    [...head, primary, ...focusKpi, { id: 'observations', kind: 'text', role: 'observations', text: obs[0]!, items: obs }, source], why('analytical hero: the ranked chart takes most of the slide'), w))
  return out
}

// ------------------------------------------------------------------ risk: an executive summary of verified pressures
function planRisk(p: Project, req: DesignRequest, notes: string[]): DesignCandidate[] {
  const focus = (req.focus ?? 'FR').toUpperCase(), peer = (req.peers?.[0] ?? 'DE').toUpperCase(), fe = entityOf(p, ds(focus, 'debt'))
  const has = (m: string, g = focus) => !!p.datasets[ds(g, m)]
  // claim parts are formatted when the claim is written, so their evidence attaches to the claim
  const w = new Writer(p), kpis: DesignObject[] = [], narrative: DesignText[] = [], claimParts: (() => string)[] = [], used: string[] = []
  if (has('debt')) {
    const D = ds(focus, 'debt'), s = firstCommon(p, [D])!, e = commonLatest(p, [D])!
    kpis.push({ id: `kpi${kpis.length + 1}`, kind: 'kpi', role: 'kpi', value: w.text(w.num(D, e)), label: `Gross debt, ${e} (% of GDP)`, context: w.text(`${w.change(D, s, e)} since ${s}`) })
    const pd = has('debt', peer) ? ds(peer, 'debt') : null
    narrative.push(w.text(`Debt: ${w.num(D, e, { long: true })} in ${e}, ${w.change(D, s, e)} since ${s}` + (pd && value(p, pd, e) != null ? `, against ${possessive(entityOf(p, pd))} ${w.num(pd, e)}` : '')))
    claimParts.push(() => `debt at ${w.num(D, e, { long: true })}`); used.push(D, ...(pd ? [pd] : []))
  }
  if (has('deficit')) {
    const B = ds(focus, 'deficit'), e = commonLatest(p, [B])!, s = firstCommon(p, [B])!, pb = has('deficit', peer) ? ds(peer, 'deficit') : null
    const allNeg = Object.values(p.datasets[B]!.observations).every((o) => o.value == null || o.value < 0)
    kpis.push({ id: `kpi${kpis.length + 1}`, kind: 'kpi', role: 'kpi', value: w.text(w.num(B, e)), label: `Government balance, ${e} (% of GDP)`, ...(pb && value(p, pb, e) != null ? { context: w.text(`${entityOf(p, pb)}: ${w.num(pb, e)}`) } : {}) })
    narrative.push(w.text(`Deficits: the balance was ${w.num(B, e, { long: true })} in ${e}${allNeg ? `, in deficit every year since ${s}` : ''}; deficits add to the debt stock, other things equal`))
    claimParts.push(() => `a deficit of ${w.num(B, e, { abs: true })}`); used.push(B, ...(pb ? [pb] : []))
  }
  if (has('yield') && has('yield', peer)) {
    const Y = ds(focus, 'yield'), PY = ds(peer, 'yield'), e = commonLatest(p, [Y, PY])!
    kpis.push({ id: `kpi${kpis.length + 1}`, kind: 'kpi', role: 'kpi', value: w.text(w.spread(Y, PY, e)), label: `10-year spread over ${entityOf(p, PY)}, ${e} (bp)`, context: w.text(`yields ${w.num(Y, e)} vs ${w.num(PY, e)}`) })
    const I = has('interest') ? ds(focus, 'interest') : null, ie = I ? commonLatest(p, [I]) : null
    narrative.push(w.text(`Funding cost: the 10-year yield was ${w.num(Y, e)} in ${e}, ${w.spread(Y, PY, e)} above ${possessive(entityOf(p, PY))}` + (I && ie ? `; interest spending reached ${w.num(I, ie, { long: true })} in ${ie}` : '')))
    claimParts.push(() => `a ${w.spread(Y, PY, e)} spread over ${entityOf(p, PY)}`); used.push(Y, PY, ...(I ? [I] : []))
  }
  if (has('interest') && kpis.length < 4 && (req.density ?? 'medium') !== 'low') {
    const I = ds(focus, 'interest'), e = commonLatest(p, [I])!, pv = String(Number(e) - 1)
    kpis.push({ id: `kpi${kpis.length + 1}`, kind: 'kpi', role: 'kpi', value: w.text(w.num(I, e)), label: `Interest spending, ${e} (% of GDP)`, ...(value(p, I, pv) != null ? { context: w.text(`${w.num(I, pv)} in ${pv}`) } : {}) })
    if (!used.includes(I)) used.push(I)
  }
  if (kpis.length < 2) throw new Error(`a risk summary needs at least two verified measures for ${fe} (debt, deficit, yields)`)
  const claim = w.text(`${cap(words[claimParts.length] ?? String(claimParts.length))} pressures in the verified data: ${listJoin(claimParts.map((f) => f()))}`)
  const title = { text: `${fe}: sovereign credit risk assessment` }
  const evidenceSpec = has('deficit') && has('deficit', peer) ? visual(p, 'trend', [ds(focus, 'deficit'), ds(peer, 'deficit')], { title: 'Government balance, % of GDP' })
    : has('debt') ? visual(p, 'trend', [ds(focus, 'debt')], { title: 'Gross debt, % of GDP' }) : null
  const head: DesignObject[] = [{ id: 'kicker', kind: 'text', role: 'kicker', text: { text: `${fe} · credit risk` } }, { id: 'title', kind: 'text', role: 'title', text: title },
    { id: 'subtitle', kind: 'text', role: 'subtitle', text: { text: 'Executive summary · Eurostat data, each figure linked to its evidence' } }]
  const claimFinal = modelClaim(p, req.claim, [claim, ...narrative], notes) ?? claim
  const datasets = [...new Set([...used, ...(evidenceSpec ? evidenceSpec.view.datasets : [])])]
  const source: DesignObject = { id: 'source', kind: 'text', role: 'source', text: { text: sourceLine(p, datasets, kpis.some((k) => k.kind === 'kpi' && (k.value.numbers ?? []).some((r) => r.derivation?.includes('spread'))) ? ['spread derived from the two yields'] : []) } }
  const items = narrative.slice(0, req.density === 'high' ? 4 : 3)
  const objective = req.objective ?? `Summarize ${possessive(fe)} most significant sovereign credit pressures with supporting evidence`
  const why = (layout: string) => [`Message: ${claimFinal.text}`, `Evidence: ${datasets.length} verified series; ${kpis.length} KPIs, each one bound figure`, `Visual: ${evidenceSpec ? `a ${evidenceSpec.family} of the balance as supporting evidence` : 'none'}`,
    'Emphasis: the claim first, then the KPIs; explanation in plain sentences', `Amount: ${kpis.length} KPIs and ${items.length} explanations`, `Layout: ${layout}`,
    'Form: KPIs for levels, sentences for causes; no judgement beyond what the data states', `Fit: ${profileOf(p).name} profile`]
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  const takeaway: DesignObject = { id: 'takeaway', kind: 'text', role: 'takeaway', text: claimFinal }
  const narr: DesignObject = { id: 'narrative', kind: 'text', role: 'narrative', text: items[0]!, items }
  const ev: DesignObject[] = evidenceSpec ? [{ id: 'secondary', kind: 'viz', role: 'secondary', viz: evidenceSpec, emphasis: ds(focus, 'deficit') }] : []
  add('Claim, KPI row, explanation and evidence chart', base(p, req, 'executive_insight', { kpiPlacement: 'row', takeaway: 'top' }, objective, claimFinal, [...head, takeaway, ...kpis, narr, ...ev, source], why('executive insight: claim band, a row of KPIs, explanation beside the evidence chart'), w))
  add('KPI column beside the explanation', base(p, req, 'executive_insight', { kpiPlacement: 'column', takeaway: 'top' }, objective, claimFinal, [...head, takeaway, ...kpis.slice(0, 3), narr, ...ev, source], why('executive insight: KPIs stacked on the left, explanation and evidence on the right'), w))
  return out
}

function editorial(p: Project, req: DesignRequest, notes: string[]): DesignCandidate[] {
  const focus = (req.focus ?? 'FR').toUpperCase(), peers = (req.peers ?? []).map((g) => g.toUpperCase()).filter((g) => g !== focus)
  try {
    const c = req.purpose === 'trend' && (req.metric ?? 'debt') === 'debt' ? debtTrend(p, focus, peers.length ? peers : undefined)
      : req.purpose === 'comparison' && (req.metric ?? 'deficit') === 'deficit' && !req.peers?.length ? balanceRank(p, focus)
      : req.purpose === 'risk' ? riskNarrative(p, focus, peers[0] ?? 'DE') : []
    if (c.length && req.claim?.trim()) notes.push(`The proposed wording "${req.claim.trim()}" was not used: these compositions state only directions, ranks and figures computed from the data.`)
    return c.filter((x) => !x.problems.length).length ? c : []
  } catch (e: any) {
    notes.push(`Editorial layouts not used (${String(e?.message ?? e)}); the standard layouts follow.`)
    return []
  }
}

/** Plan a slide: candidates in the order offered (a preferred family first), each with its validation problems. */
export function planSlide(p: Project, req: DesignRequest): PlanResult {
  const notes: string[] = []
  try {
    // PD2: the editorial compositions in the visual language come first; the PD1 layouts remain the fallback when
    // the data don't fit an editorial brief (another metric, a comparison with surpluses, missing peers)
    let c: DesignCandidate[] = req.standard ? [] : editorial(p, req, notes)
    if (!c.length) c = req.purpose === 'trend' ? planTrend(p, req, notes) : req.purpose === 'comparison' ? planComparison(p, req, notes) : planRisk(p, req, notes)
    if (req.family) c = [...c.filter((x) => x.design.layout.family === req.family), ...c.filter((x) => x.design.layout.family !== req.family)]
    // every dataset the slide shows (charts, tables) or cites (figures in its text, through evidence and derivations)
    const idx = evidenceIndex(p), dss = new Set(c.flatMap((x) => x.design.objects.flatMap((o) => (o.kind === 'viz' ? o.viz.view.datasets : o.kind === 'table' ? o.table.datasets : []))))
    for (const x of c) {
      const derived = new Map((x.design.derivations ?? []).map((d) => [d.id, d]))
      for (const { t } of designTexts(x.design)) for (const n of t.numbers ?? []) {
        const evs = n.evidence ? [n.evidence] : Object.values((derived.get(n.derivation!) ?? p.derivations?.[n.derivation!])?.inputs ?? {})
        for (const e of evs) { const at = idx.get(e); if (at) dss.add(at.ds) }
      }
    }
    return { candidates: c, notes, inputs: [...dss].map((d) => ({ dataset: d, entity: p.datasets[d]?.entity ?? d, unit: p.datasets[d]?.unit ?? '', source: p.datasets[d]?.source_note ?? '' })) }
  } catch (e: any) {
    return { candidates: [], inputs: [], notes, error: String(e?.message ?? e) }
  }
}
