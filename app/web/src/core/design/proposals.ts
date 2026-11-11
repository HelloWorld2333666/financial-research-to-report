// Gate E proposals: the three France benchmark slides redesigned from principles observed in professional research
// reports (private reference library), in the burgundy and gold language, with the declarative 'columns' composition.
//   debt     chart with a commentary column: an exhibit titled with its finding, the chart large, three commentary
//            blocks with bold lead-ins separated by hairlines, a "so what" under a heavier rule
//   balance  a ranked table exhibit (rank, country, bar, earlier value, change) beside a tinted figures column
//   risk     a scorecard matrix: one numbered row per pressure, France and the peer side by side, the gap, the change,
//            a sparkline and a computed reading; a conclusion row under a heavier rule
// Every sentence is computed from the data and every figure is written through the evidence Writer; a brief throws
// when the data don't support its sentences.
import type { Project } from '../types'
import { recommend, type Intent } from '../recommend'
import type { Family, VizSpec } from '../viz'
import { commonLatest, entityOf, firstCommon, ranked, sourceLine, value, Writer } from './insight'
import { DESIGN_SCHEMA, newDesignId, validateDesign, type Composition, type DesignObject, type DesignText, type SlideDesign } from './spec'
import type { DesignCandidate } from './planner'

const ds = (geo: string, metric: string) => `ds.${geo.toLowerCase()}.${metric}`
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const ORD = ['', 'largest', 'second-largest', 'third-largest', 'fourth-largest', 'fifth-largest', 'sixth-largest', 'seventh-largest']
const HIGH = ['', 'highest', 'second-highest', 'third-highest', 'fourth-highest']
const poss = (s: string) => (s.endsWith('s') ? `${s}'` : `${s}'s`)
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function spec(p: Project, intent: Intent, family: Family, datasets: string[], extra: { at?: string; between?: [string, string]; title?: string } = {}): VizSpec {
  const r = recommend(p, { intent, datasets, ...extra })
  const c = r.candidates.find((x) => x.family === family && x.state === 'valid' && x.spec)
  if (!c?.spec) throw new Error(`no valid ${family} for ${intent} of ${datasets.join(', ')}`)
  return c.spec
}
const T = (id: string, role: any, t: DesignText, extra: Record<string, unknown> = {}) => ({ id, kind: 'text', role, text: t, ...extra }) as DesignObject
const lead = (t: DesignText, l: string): DesignText => ({ ...t, lead: l })
const window = (v: VizSpec, from: string, to: string): VizSpec => ({ ...v, view: { ...v.view, from, to } })

function make(p: Project, label: string, objective: string, claim: DesignText, composition: Composition, objects: DesignObject[], rationale: string[], w: Writer, language: string): DesignCandidate {
  const d: SlideDesign = { schema: DESIGN_SCHEMA, id: newDesignId(), objective, claim, audience: 'executive', density: 'high', layout: { family: 'composed', params: {}, composition },
    profile: 'institutional', language, objects, rationale, ...(w.derivations.length ? { derivations: [...w.derivations] } : {}) }
  return { label, design: d, problems: validateDesign(p, d) }
}

// ------------------------------------------------------------------ 1. sovereign debt: chart with a commentary column
export function debtCommentary(p: Project, focus = 'FR', peers = ['DE', 'IT'], language = 'burgundy'): DesignCandidate {
  const F = ds(focus, 'debt'), P = peers.map((g) => ds(g, 'debt')).filter((d) => p.datasets[d]), all = [F, ...P]
  const a = firstCommon(p, all)!, b = commonLatest(p, all)!, fe = entityOf(p, F), ref = P[0]!, pe = entityOf(p, ref)
  const dir = (d: string) => Math.sign(value(p, d, b)! - value(p, d, a)!)
  const onlyRiser = dir(F) > 0 && P.every((d) => dir(d) < 0)
  const rank = [...all].sort((x, y) => value(p, y, b)! - value(p, x, b)!).indexOf(F) + 1
  const gapA = value(p, F, a)! - value(p, ref, a)!, gapB = value(p, F, b)! - value(p, ref, b)!
  const w = new Writer(p)
  const headline = onlyRiser ? `${poss(fe)} debt kept rising while ${list(P.map((d) => poss(entityOf(p, d))))} fell` : `${poss(fe)} debt ratio against ${list(P.map((d) => entityOf(p, d)))}, ${a}–${b}`
  const objs: DesignObject[] = [
    T('section', 'section', { text: `${fe} · Sovereign debt` }),
    T('headline', 'headline', { text: headline }),
    T('standfirst', 'standfirst', { text: `General government gross debt, ${a}–${b}: ${fe} against ${list(P.map((d) => entityOf(p, d)))}` }),
    T('ex', 'exhibit', { text: onlyRiser ? `${fe} is the only one of the ${words[all.length]} whose debt ratio rose` : `Debt ratios, ${a}–${b}` }, { slot: 'exhibit' }),
    T('ex-unit', 'unit', { text: `Gross government debt, % of GDP; bracket: gap to ${pe}, percentage points` }, { slot: 'exhibit' }),
    { id: 'chart', kind: 'viz', role: 'primary', viz: spec(p, 'trend', 'line', all, { title: 'Gross government debt, % of GDP' }), emphasis: F, slot: 'chart', draw: { annotate: 'gap', reference: ref } },
    T('side', 'exhibit', { text: 'What the data show' }, { slot: 'side' }),
    T('c1', 'lead', lead(w.text(`Debt went from ${w.num(F, a)} to ${w.num(F, b)} of GDP, ${w.change(F, a, b)} since ${a}.`), dir(F) > 0 ? `${fe} rose.` : `${fe} eased.`), { slot: 'notes' }),
    // peers' figures in charcoal: burgundy is kept for the focus country
    T('c2', 'lead', lead(w.text(P.map((d) => `${entityOf(p, d)} ${w.change(d, a, b)} to ${w.num(d, b)}`).join('; ') + '.'), P.every((d) => dir(d) < 0) ? 'Peers fell.' : 'Peers moved.'), { slot: 'notes', accent: 'ink' }),
    T('c3', 'lead', lead(w.text(`${poss(fe)} gap to ${pe} went from ${w.gap(F, ref, a)} to ${w.gap(F, ref, b)}.`), gapB > gapA ? 'The gap widened.' : 'The gap narrowed.'), { slot: 'notes' }),
    T('so', 'conclusion', { text: `${fe} has the ${HIGH[rank]} debt ratio of the ${words[all.length]}${onlyRiser ? ' and the only one still rising' : ''}` }, { slot: 'so' }),
    T('source', 'source', { text: sourceLine(p, all) }),
  ]
  return make(p, 'Chart with a commentary column (burgundy)', `Show how ${poss(fe)} debt developed against its peers`, { text: headline },
    { kind: 'columns', recipe: 'chart-commentary', params: { columns: [{ span: 7, slots: ['exhibit', 'chart'] }, { span: 5, slots: ['side', 'notes', 'so'] }] } }, objs,
    ['Reference principle: the exhibit is titled with its finding, and the chart takes the larger column at legible type sizes',
      'Commentary column: three blocks with bold lead-ins, one fact each, separated by hairlines; the "so what" under a heavier rule',
      'Colour hierarchy: titles and text in charcoal; burgundy only for France\'s line and figures; gold for the gap brackets'], w, language)
}

// ------------------------------------------------------------------ 2. fiscal balance: a ranked table beside a figures column
export function balanceTable(p: Project, focus = 'FR', language = 'burgundy'): DesignCandidate {
  const all = Object.values(p.datasets).filter((d) => d.metric === 'deficit').map((d) => d.id), F = ds(focus, 'deficit'), fe = entityOf(p, F), n = all.length
  const at = commonLatest(p, all)!, prev = String(Number(at) - 1)
  const asc = ranked(p, all, at, 'asc'), rank = asc.findIndex((x) => x.ds === F) + 1
  if (!rank || n < 3 || !asc.every((x) => x.v < 0)) throw new Error('this brief is written for three or more countries, all in deficit')
  const larger = asc.slice(0, rank - 1).map((x) => entityOf(p, x.ds))
  const narrowed = all.filter((d) => value(p, d, at)! > value(p, d, prev)!).map((d) => entityOf(p, d))
  const widened = all.filter((d) => value(p, d, at)! < value(p, d, prev)!).map((d) => entityOf(p, d))
  const w = new Writer(p)
  const headline = `${fe} ran the ${ORD[rank]} deficit of the ${words[n]} in ${at}`
  const bell = spec(p, 'change', 'dumbbell', all, { between: [prev, at], title: `Government balance, ${prev} and ${at}` })
  const objs: DesignObject[] = [
    T('section', 'section', { text: `${fe} · Fiscal position` }),
    T('headline', 'headline', { text: headline }),
    T('standfirst', 'standfirst', { text: `General government balance, % of GDP, ${prev} and ${at}, ranked from the largest deficit` }),
    T('ex', 'exhibit', { text: larger.length ? `Only ${list(larger)} ran a larger deficit than ${fe}` : `${fe} ran the largest deficit` }, { slot: 'exhibit' }),
    T('ex-unit', 'unit', { text: `Government balance, % of GDP; change in percentage points (▼ wider deficit)` }, { slot: 'exhibit' }),
    { id: 'table', kind: 'viz', role: 'primary', viz: bell, emphasis: F, slot: 'table', draw: { form: 'rankTable' } },
    { id: 'hero', kind: 'kpi', role: 'kpi', variant: 'hero', value: w.text(w.num(F, at)), label: `${fe}, ${at}: the ${ORD[rank]} deficit of the ${words[n]}`, slot: 'fig' },
    { id: 'change', kind: 'kpi', role: 'kpi', variant: 'stat', value: w.text(w.change(F, prev, at)), label: `Change since ${prev}`, context: w.text(`from ${w.num(F, prev)}`), slot: 'fig' },
    T('c1', 'lead', lead({ text: `${narrowed.length ? `${list(narrowed)} narrowed ${narrowed.length > 1 ? 'their deficits' : 'its deficit'}` : 'No deficit narrowed'}${widened.length ? `; ${list(widened)} widened` : ''}.` },
      `${cap(words[narrowed.length]!)} of ${words[n]} narrowed.`), { slot: 'notes' }),
    T('so', 'conclusion', { text: `${cap(words[n - rank]!)} of the ${words[n]} ran smaller deficits than ${fe}` }, { slot: 'so' }),
    T('source', 'source', { text: sourceLine(p, all) }),
  ]
  return make(p, 'Ranked table with a figures column (burgundy)', `Show ${poss(fe)} position among ${words[n]} countries' fiscal balances`, { text: headline },
    { kind: 'columns', recipe: 'rank-table', params: { columns: [{ span: 8, slots: ['exhibit', 'table'] }, { span: 4, slots: ['fig', 'notes', 'so'], tint: true }] } }, objs,
    ['Reference principle: a row-based exhibit (table and bars in one), ranked in the message\'s direction, the focus row tinted, hairlines between rows',
      'Rank, level and change read across one row; the earlier year and the change are columns, not a second chart',
      'A tinted figures column carries the focal figure in burgundy serif, the change, one computed observation and the "so what"'], w, language)
}

// ------------------------------------------------------------------ 3. executive credit risk: a scorecard matrix
export function riskMatrix(p: Project, focus = 'FR', peer = 'DE', language = 'burgundy'): DesignCandidate {
  const m = (metric: string, name: string, unit: string, worse: 1 | -1, gapKind: 'gap' | 'spread') => ({ F: ds(focus, metric), P: ds(peer, metric), name, unit, worse, gapKind, metric })
  const rows = [m('debt', 'Gross debt', '% of GDP', 1, 'gap'), m('deficit', 'Government balance', '% of GDP', -1, 'gap'), m('yield', '10-year yield', '%', 1, 'spread'), m('interest', 'Interest spending', '% of GDP', 1, 'gap')]
  for (const r of rows) if (!p.datasets[r.F] || !p.datasets[r.P]) throw new Error(`the risk matrix needs ${r.F} and ${r.P}`)
  const dss = rows.flatMap((r) => [r.F, r.P]), at = commonLatest(p, dss)!, a = firstCommon(p, dss)!
  const fe = entityOf(p, rows[0]!.F), pe = entityOf(p, rows[0]!.P)
  const w = new Writer(p)
  const v = (d: string, t: string) => value(p, d, t)!
  const weaker = rows.filter((r) => r.worse * (v(r.F, at) - v(r.P, at)) > 0)
  const worsened = rows.filter((r) => r.worse * (v(r.F, at) - v(r.F, a)) > 0)
  const move = (r: typeof rows[0], d: string) => {
    const ch = v(d, at) - v(d, a)
    return r.metric === 'deficit' ? (ch < 0 ? 'widened' : ch > 0 ? 'narrowed' : 'held') : ch > 0 ? 'rose' : ch < 0 ? 'fell' : 'held'
  }
  const head = ['Measure', `${fe}, ${at}`, `${pe}, ${at}`, `Gap to ${pe}`, `${fe} since ${a}`, `${fe} against ${pe}, ${a}–${at}`, 'Reading']
  const objs: DesignObject[] = [
    T('section', 'section', { text: `${fe} · Credit risk` }),
    T('headline', 'headline', { text: weaker.length === rows.length ? `${fe} is weaker than ${pe} on all ${words[rows.length]} credit measures` : `${fe} is weaker than ${pe} on ${words[weaker.length]} of ${words[rows.length]} credit measures` }),
    T('standfirst', 'standfirst', { text: `Debt, deficit, funding cost and interest burden, ${at}, with ${pe} as the reference peer` }),
    T('ex', 'exhibit', { text: `${worsened.length === rows.length ? 'Every measure' : `${cap(words[worsened.length]!)} of ${words[rows.length]} measures`} moved against ${fe} since ${a}` }, { slot: 'exhibit' }),
    T('ex-unit', 'unit', { text: `Latest values, the gap to ${pe} (percentage points; basis points for the yield) and the change since ${a}` }, { slot: 'exhibit' }),
    ...head.map((h, c) => T(`h${c}`, 'cell', { text: h }, { slot: 'matrix', cell: { r: 0, c } })),
    ...rows.flatMap((r, i): DesignObject[] => {
      const R = i + 1
      const fMove = move(r, r.F), pMove = move(r, r.P)
      return [
        T(`r${R}-name`, 'cell', { text: r.unit, lead: r.name }, { slot: 'matrix', cell: { r: R, c: 0, badge: String(R) } }),
        T(`r${R}-f`, 'cell', w.text(w.num(r.F, at)), { accent: 'focus', slot: 'matrix', cell: { r: R, c: 1 } }),
        T(`r${R}-p`, 'cell', w.text(w.num(r.P, at)), { accent: 'ink', slot: 'matrix', cell: { r: R, c: 2 } }),
        // the Writer binds a figure to the text it is written into: write each one inside its own text
        T(`r${R}-gap`, 'cell', w.text(r.gapKind === 'spread' ? w.spread(r.F, r.P, at) : w.gap(r.F, r.P, at)), { accent: 'ink', slot: 'matrix', cell: { r: R, c: 3 } }),
        T(`r${R}-chg`, 'cell', w.text(w.change(r.F, a, at)), { slot: 'matrix', cell: { r: R, c: 4 } }),
        // every sparkline over the same window as the header says (a to at)
        { id: `r${R}-spark`, kind: 'viz', role: 'secondary', viz: window(spec(p, 'trend', 'line', [r.F, r.P], { title: `${r.name}, ${r.unit}` }), a, at), emphasis: r.F, slot: 'matrix', cell: { r: R, c: 5 }, draw: { spark: true } } as DesignObject,
        T(`r${R}-read`, 'cell', { text: `${cap(fMove)} since ${a}; ${poss(pe)} ${pMove}${pMove === fMove ? ' too' : ''}` }, { slot: 'matrix', cell: { r: R, c: 6 } }),
      ]
    }),
    T('so', 'conclusion', weaker.length === rows.length
      ? w.text(`${fe} carries more debt, a wider deficit, a higher yield and a heavier interest bill than ${pe}; the debt gap alone is ${w.gap(rows[0]!.F, rows[0]!.P, at)} of GDP`)
      : { text: `${fe} is weaker than ${pe} on ${list(weaker.map((r) => r.name.toLowerCase()))}` }, { slot: 'so' }),
    T('source', 'source', { text: sourceLine(p, dss, ['spread derived from the two yields']) }),
  ]
  const head2 = objs.find((o) => o.id === 'headline') as any
  return make(p, 'Scorecard matrix (burgundy)', `Summarize ${poss(fe)} credit pressures against ${pe}`, { text: head2.text.text },
    { kind: 'columns', recipe: 'risk-matrix', params: { columns: [{ span: 12, slots: ['exhibit', 'matrix', 'so'] }], matrix: { widths: [2.0, 1.15, 1.05, 1.1, 1.1, 2.1, 2.4], header: true } } }, objs,
    ['Reference principle: a scenario-style matrix, one numbered row per pressure, read left to right: level, peer, gap, change, trend, reading',
      'Figures for the focus country in burgundy serif; the peer in charcoal; sparklines carry the trend without repeating values',
      'A conclusion row under a heavier rule states what the matrix shows; every reading is computed from the data'], w, language)
}
