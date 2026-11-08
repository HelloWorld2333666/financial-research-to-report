// Editorial planner (PD2): the France benchmark slides, each as two materially different compositions in the
// institutional visual language. Content first: one message per slide, a focal figure or chart that carries it,
// supporting evidence without repetition, and a footnote. Every figure is written through the evidence Writer;
// every qualitative statement ("kept rising", "widened", "second-largest") is computed from the same data, and a
// slide is not proposed if the data do not support its sentence.
import type { Project } from '../types'
import { recommend, type Intent } from '../recommend'
import type { Family, VizSpec } from '../viz'
import { commonLatest, entityOf, firstCommon, ranked, sourceLine, value, Writer } from './insight'
import { DESIGN_SCHEMA, newDesignId, validateDesign, type Composition, type DesignObject, type DesignText, type SlideDesign } from './spec'
import type { DesignCandidate } from './planner'

const ds = (geo: string, metric: string) => `ds.${geo.toLowerCase()}.${metric}`
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const ORD = ['', 'largest', 'second-largest', 'third-largest', 'fourth-largest', 'fifth-largest', 'sixth-largest', 'seventh-largest']
const poss = (s: string) => (s.endsWith('s') ? `${s}'` : `${s}'s`)
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function spec(p: Project, intent: Intent, family: Family, datasets: string[], extra: { at?: string; between?: [string, string]; title?: string } = {}): VizSpec {
  const r = recommend(p, { intent, datasets, ...extra })
  const c = r.candidates.find((x) => x.family === family && x.state === 'valid' && x.spec)
  if (!c?.spec) throw new Error(`no valid ${family} for ${intent} of ${datasets.join(', ')}: ${r.candidates.find((x) => x.family === family)?.refused ?? 'not offered'}`)
  return c.spec
}

function design(p: Project, objective: string, claim: DesignText, composition: Composition, objects: DesignObject[], rationale: string[], w: Writer): SlideDesign {
  return { schema: DESIGN_SCHEMA, id: newDesignId(), objective, claim, audience: 'executive', density: 'medium', layout: { family: 'composed', params: {}, composition },
    profile: 'institutional', language: 'institutional', objects, rationale, ...(w.derivations.length ? { derivations: [...w.derivations] } : {}) }
}
const frame = (section: string): DesignObject[] => [{ id: 'masthead', kind: 'shape', role: 'masthead' }, { id: 'section', kind: 'text', role: 'section', text: { text: section } }]
const T = (id: string, role: any, t: DesignText, extra: Partial<DesignObject> = {}) => ({ id, kind: 'text', role, text: t, ...extra }) as DesignObject

// ------------------------------------------------------------------ 1. debt trend: France against its peers
export function debtTrend(p: Project, focus = 'FR', peers = ['DE', 'IT']): DesignCandidate[] {
  const F = ds(focus, 'debt'), P = peers.map((g) => ds(g, 'debt')).filter((d) => p.datasets[d]), all = [F, ...P]
  const a = firstCommon(p, all)!, b = commonLatest(p, all)!, fe = entityOf(p, F), ref = P[0]!
  const dir = (d: string) => Math.sign(value(p, d, b)! - value(p, d, a)!)
  const peerDirs = P.map(dir), fDir = dir(F)
  const headline = fDir > 0 && peerDirs.every((x) => x < 0) ? `${poss(fe)} debt kept rising while ${list(P.map((d) => poss(entityOf(p, d))))} fell`
    : fDir > 0 ? `${poss(fe)} debt kept rising, to its highest level in the period` : `${poss(fe)} debt eased between ${a} and ${b}`
  const gapA = value(p, F, a)! - value(p, ref, a)!, gapB = value(p, F, b)! - value(p, ref, b)!
  const highest = all.reduce((x, y) => (value(p, y, b)! > value(p, x, b)! ? y : x))
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  const section = `${fe} · Sovereign credit`
  {
    const w = new Writer(p)
    const line = spec(p, 'trend', 'line', all, { title: 'Gross government debt, % of GDP' })
    const stand = w.text(`Gross government debt as a share of GDP, ${a}–${b}: ${fe} against ${list(P.map((d) => entityOf(p, d)))}. The gap to ${entityOf(p, ref)} ${gapB > gapA ? 'widened' : 'narrowed'}.`)
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', { text: headline }), T('standfirst', 'standfirst', stand),
      T('chart-label', 'label', { text: `Gross government debt, % of GDP` }, { group: 'chart' } as any), { id: 'primary', kind: 'viz', role: 'primary', viz: line, emphasis: F, group: 'chart', draw: { annotate: 'change' } },
      { id: 'hero', kind: 'kpi', role: 'kpi', variant: 'hero', value: w.text(w.num(F, b)), label: `${fe} · gross debt, ${b}, % of GDP` },
      { id: 'gap', kind: 'kpi', role: 'kpi', variant: 'stat', value: w.text(w.gap(F, ref, b)), label: `Gap to ${entityOf(p, ref)}, ${b}`, context: w.text(`${w.gap(F, ref, a)} in ${a}`) },
      T('note', 'note', { text: `The gap is ${poss(fe)} debt ratio minus ${poss(entityOf(p, ref))}, in percentage points of GDP. ${entityOf(p, highest)} carries the highest ratio of the ${words[all.length]}.` }),
      T('source', 'source', { text: sourceLine(p, all) })]
    add('Hero chart with an evidence rail', design(p, `Show how ${poss(fe)} debt developed against ${list(P.map((d) => entityOf(p, d)))}`, w.text(headline), { kind: 'rail', params: { side: 'right', chartCols: 8 } }, objs,
      ['Focal point: the France line, heavy navy with every point marked and its change annotated; peers quiet grey and soft gold', 'Rail: the 2025 level as the hero figure, the widening gap as the supporting figure; no table restating the chart',
        'Headline states the direction in words; figures sit in the standfirst and the rail, each bound to evidence', 'Composition: 8-column chart, 4-column rail, masthead and serif headline'], w))
  }
  {
    const w = new Writer(p)
    const gapLine = spec(p, 'trend', 'line', [F, ref], { title: 'Gross government debt, % of GDP' })
    const head2 = w.text(`The gap between ${fe} and ${entityOf(p, ref)} ${gapB > gapA ? 'widened' : 'narrowed'} to ${w.gap(F, ref, b, { long: false })} of GDP`)
    const stand = w.text(`Gross government debt, ${a}–${b}. ${fe} moved up while ${list(P.filter((d) => dir(d) < 0).map((d) => entityOf(p, d)))} moved down.`)
    const stats: DesignObject[] = all.map((d, i) => ({ id: `chg${i}`, kind: 'kpi', role: 'kpi', variant: 'stat', value: w.text(w.change(d, a, b)), label: `${entityOf(p, d)}, change since ${a}`, ...(i === 0 ? { context: w.text(`to ${w.num(d, b, { long: true })}`) } : {}) }) as DesignObject)
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', head2), T('standfirst', 'standfirst', stand),
      T('chart-label', 'label', { text: `Gross government debt, % of GDP: ${fe} and ${entityOf(p, ref)}` }, { group: 'chart' } as any),
      { id: 'primary', kind: 'viz', role: 'primary', viz: gapLine, emphasis: F, group: 'chart', draw: { annotate: 'gap', reference: ref } },
      ...stats, T('source', 'source', { text: sourceLine(p, all) })]
    add('Statement column with the gap bracketed', design(p, `Show how ${poss(fe)} debt developed against ${list(P.map((d) => entityOf(p, d)))}`, head2, { kind: 'statement', params: { side: 'left' } }, objs,
      ['Focal point: a tall serif statement of the widening gap, the message read before the chart', 'Evidence: France against Germany only, the gap bracketed and labelled at the start and the end (gold where it is widest)',
        'Supporting figures: the three changes, stacked as a ledger with hairlines', 'Composition: 5-column statement, 7-column chart at full height'], w))
  }
  return out
}

// ------------------------------------------------------------------ 2. fiscal balance: France's position among seven countries
export function balanceRank(p: Project, focus = 'FR'): DesignCandidate[] {
  const all = Object.values(p.datasets).filter((d) => d.metric === 'deficit').map((d) => d.id), F = ds(focus, 'deficit'), fe = entityOf(p, F), n = all.length
  const at = commonLatest(p, all)!, prev = String(Number(at) - 1)
  const asc = ranked(p, all, at, 'asc'), rank = asc.findIndex((x) => x.ds === F) + 1, worst = asc[0]!.ds, best = asc[asc.length - 1]!.ds
  const allDeficit = asc.every((x) => x.v < 0)
  if (!rank || !allDeficit) throw new Error('this brief is written for seven countries all in deficit')
  const section = `${fe} · Fiscal position`
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  const headline = rank === 1 ? `${fe} ran the largest deficit of the ${words[n]}` : `${fe} ran the ${ORD[rank]} deficit of the ${words[n]}`
  {
    const w = new Writer(p)
    const bars = spec(p, 'ranking', 'bar', all, { at, title: `Government balance, ${at}` })
    const larger = asc.slice(0, rank - 1).map((x) => poss(entityOf(p, x.ds)))
    const stand = w.text(`General government balance, % of GDP, ${at}. All ${words[n]} countries were in deficit; ${larger.length ? `only ${list(larger)} ${larger.length > 1 ? 'were' : 'was'} larger than ${poss(fe)}.` : `${poss(fe)} was the largest.`}`)
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', { text: headline }), T('standfirst', 'standfirst', stand),
      T('chart-label', 'label', { text: `Government balance, ${at}, % of GDP` }, { group: 'chart' } as any), { id: 'primary', kind: 'viz', role: 'primary', viz: bars, emphasis: F, group: 'chart' },
      { id: 'hero', kind: 'kpi', role: 'kpi', variant: 'hero', value: w.text(w.num(F, at)), label: `${fe} · government balance, ${at}, % of GDP` },
      { id: 'change', kind: 'kpi', role: 'kpi', variant: 'stat', value: w.text(w.change(F, prev, at)), label: `Change since ${prev}`, context: w.text(`from ${w.num(F, prev)}`) },
      T('note', 'note', { text: `Bars show each country's general government balance; a longer bar is a larger deficit. ${entityOf(p, worst)} ran the largest and ${entityOf(p, best)} the smallest.` }),
      T('source', 'source', { text: sourceLine(p, all) })]
    add('Ranked bars with an evidence rail', design(p, `Show ${poss(fe)} position among ${words[n]} countries' fiscal balances`, w.text(headline), { kind: 'rail', params: { side: 'right', chartCols: 8 } }, objs,
      ['Focal point: France\'s bar in navy on a tinted row; the other six in one quiet grey', 'Values written at the bar ends; no axis, no legend, no table repeating the bars',
        'Rail: France\'s balance as the hero figure, the two ends of the range as context', 'Composition: 8-column ranking, 4-column rail'], w))
  }
  {
    const w = new Writer(p)
    const bell = spec(p, 'change', 'dumbbell', all, { between: [prev, at], title: `Government balance, ${prev} and ${at}` })
    const narrowed = all.filter((d) => value(p, d, at)! > value(p, d, prev)!).map((d) => entityOf(p, d)), widened = all.filter((d) => value(p, d, at)! < value(p, d, prev)!).map((d) => entityOf(p, d))
    const fNarrow = value(p, F, at)! > value(p, F, prev)!
    const head2 = w.text(`${poss(fe)} deficit ${fNarrow ? 'narrowed' : 'widened'} in ${at} but remained the ${ORD[rank]} of the ${words[n]}`)
    const stand = w.text(`General government balance, % of GDP, ${prev} and ${at}. Deficits ${widened.length ? `widened in ${list(widened)}` : 'widened nowhere'} and narrowed in ${list(narrowed)}.`)
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', head2), T('standfirst', 'standfirst', stand),
      T('chart-label', 'label', { text: `Government balance, % of GDP: ${prev} → ${at}` }, { group: 'chart' } as any), { id: 'primary', kind: 'viz', role: 'primary', viz: bell, emphasis: F, group: 'chart' },
      { id: 'hero', kind: 'kpi', role: 'kpi', variant: 'hero', value: w.text(w.num(F, at)), label: `${fe}, ${at}`, context: w.text(`from ${w.num(F, prev)} in ${prev}`) },
      T('source', 'source', { text: sourceLine(p, all) })]
    add('Wide change chart under the headline', design(p, `Show ${poss(fe)} position among ${words[n]} countries' fiscal balances`, head2, { kind: 'wide' }, objs,
      ['Focal point: France\'s row, the only one in navy, moving from its ' + prev + ' ring to its ' + at + ' dot', 'One chart carries both rank and change; the standfirst names who widened and who narrowed (computed)',
        'The hero figure sits beside the headline, not in a card', 'Composition: headline and figure above, full-width chart below'], w))
  }
  return out
}

// ------------------------------------------------------------------ 3. executive risk: debt, deficit, funding cost
export function riskNarrative(p: Project, focus = 'FR', peer = 'DE'): DesignCandidate[] {
  const D = ds(focus, 'debt'), B = ds(focus, 'deficit'), Y = ds(focus, 'yield'), PD = ds(peer, 'debt'), PB = ds(peer, 'deficit'), PY = ds(peer, 'yield'), I = ds(focus, 'interest')
  for (const x of [D, B, Y, PD, PB, PY, I]) if (!p.datasets[x]) throw new Error(`the risk brief needs ${x}`)
  const fe = entityOf(p, D), pe = entityOf(p, PD), at = commonLatest(p, [D, B, Y, PY])!, a = firstCommon(p, [D])!, b0 = firstCommon(p, [B])!
  const allDef = p.datasets[B]!.observations.every((o) => o.value == null || o.value < 0)
  const section = `${fe} · Credit risk`
  const out: DesignCandidate[] = []
  const add = (label: string, d: SlideDesign) => out.push({ label, design: d, problems: validateDesign(p, d) })
  const spark = (x: string, y: string, title: string) => spec(p, 'trend', 'line', [x, y], { title })
  {
    const w = new Writer(p)
    const headline = `Debt, deficit and funding cost: three pressures on ${poss(fe)} credit`
    const stand = w.text(`Verified Eurostat data, ${at}, with ${pe} as the reference peer. Each figure links to its source.`)
    const band = (g: string, title: string, fig: DesignObject, body: DesignText, sp: VizSpec, emph: string): DesignObject[] => [
      T(`${g}-label`, 'label', { text: title }, { group: g } as any), { ...fig, group: g } as DesignObject, T(`${g}-body`, 'body', body, { group: g } as any),
      { id: `${g}-chart`, kind: 'viz', role: 'secondary', viz: sp, emphasis: emph, group: g, draw: { mini: true } }]
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', { text: headline }), T('standfirst', 'standfirst', stand),
      ...band('debt', 'Debt', { id: 'debt-fig', kind: 'kpi', role: 'kpi', variant: 'band', value: w.text(w.num(D, at)), label: `Gross debt, ${at}, % of GDP` },
        w.text(`Up ${w.change(D, a, at)} since ${a}, against ${poss(pe)} ${w.num(PD, at)}.`), spark(D, PD, 'Gross debt, % of GDP'), D),
      ...band('deficit', 'Deficit', { id: 'deficit-fig', kind: 'kpi', role: 'kpi', variant: 'band', value: w.text(w.num(B, at)), label: `Government balance, ${at}, % of GDP` },
        w.text(`${allDef ? `In deficit every year since ${b0}` : 'In deficit'}; ${pe} ${w.num(PB, at)}. Deficits add to debt, other things equal.`), spark(B, PB, 'Government balance, % of GDP'), B),
      ...band('funding', 'Funding cost', { id: 'funding-fig', kind: 'kpi', role: 'kpi', variant: 'band', value: w.text(w.spread(Y, PY, at)), label: `10-year spread over ${pe}, ${at}` },
        w.text(`Yields ${w.num(Y, at)} against ${w.num(PY, at)}; interest spending ${w.num(I, at, { long: true })}.`), spark(Y, PY, '10-year government bond yield, %'), Y),
      T('source', 'source', { text: sourceLine(p, [D, B, Y, PD, PB, PY, I], ['spread derived from the two yields']) })]
    add('Three figure bands, debt leading', design(p, `Summarize ${poss(fe)} main sovereign credit pressures`, { text: headline }, { kind: 'bands', params: { emphasis: 'first' } }, objs,
      ['Hierarchy: debt leads (taller band, larger serif figure), deficit and funding cost follow at one size', 'Each band reads left to right: what, how much, why it matters, how it moved (France navy against Germany grey)',
        'No dashboard cards: figures sit on the paper, separated by hairlines', 'Every sentence states data; the one causal clause is an accounting identity'], w))
  }
  {
    const w = new Writer(p)
    const head = w.text(`${poss(fe)} debt reached ${w.num(D, at, { long: true })} in ${at}, ${w.change(D, a, at)} since ${a}`)
    const stand = w.text(`Two further pressures sit alongside it: a deficit in every year since ${b0} and a funding premium over ${pe}.`)
    if (!allDef) throw new Error('the lead-panel brief states a deficit in every year')
    const objs: DesignObject[] = [...frame(section), T('headline', 'headline', head), T('standfirst', 'standfirst', stand),
      T('chart-label', 'label', { text: `Gross government debt, % of GDP` }, { group: 'chart' } as any), { id: 'primary', kind: 'viz', role: 'primary', viz: spark(D, PD, 'Gross government debt, % of GDP'), emphasis: D, group: 'chart', draw: { annotate: 'change' } },
      { id: 'panel', kind: 'shape', role: 'panel' }, T('panel-label', 'label', { text: 'Supporting pressures' }, { tone: 'onDark' } as any),
      { id: 'deficit', kind: 'kpi', role: 'kpi', variant: 'stat', tone: 'onDark', group: 'deficit', value: w.text(w.num(B, at)), label: `Government balance, ${at}, % of GDP` },
      T('deficit-note', 'note', w.text(`${pe}: ${w.num(PB, at)}. Deficits add to debt, other things equal.`), { group: 'deficit', tone: 'onDark' } as any),
      { id: 'spread', kind: 'kpi', role: 'kpi', variant: 'stat', tone: 'onDark', group: 'spread', value: w.text(w.spread(Y, PY, at)), label: `10-year spread over ${pe}, ${at}` },
      T('spread-note', 'note', w.text(`Yields ${w.num(Y, at)} against ${w.num(PY, at)}; interest spending ${w.num(I, at, { long: true })}.`), { group: 'spread', tone: 'onDark' } as any),
      T('source', 'source', { text: sourceLine(p, [D, B, Y, PD, PB, PY, I], ['spread derived from the two yields']) })]
    add('Lead message with a dark supporting panel', design(p, `Summarize ${poss(fe)} main sovereign credit pressures`, head, { kind: 'lead_panel' }, objs,
      ['Hierarchy: debt is the lead (headline and chart on the paper); deficit and spread support it on a navy panel', 'High contrast separates the main pressure from the supporting ones',
        'The chart annotates France\'s change; Germany is the quiet reference', 'Composition: 7-column lead, full-height panel to the right'], w))
  }
  return out
}
