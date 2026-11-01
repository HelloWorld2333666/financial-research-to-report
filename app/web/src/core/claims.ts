// Period-aware claim checker: every number in slide text must match the working value of the
// dataset for the entity, metric and year the sentence talks about. Experiment 2 showed why a
// value-presence check is not enough ("2% in 2025" used the 2024 value; "slightly increase" for a fall).
import { effectiveObs } from './evidence'
import type { Project } from './types'

export interface ClaimResult { text: string; status: 'supported' | 'mismatch' | 'unverifiable'; detail: string }

const METRIC_WORDS: [string, RegExp][] = [
  ['spread', /\bspread\b/i], ['debt', /\bdebt\b/i], ['deficit', /\bdeficit|surplus|fiscal balance\b/i],
  ['interest', /\binterest\b/i], ['growth', /\bgrowth|gdp grew|expanded|contracted\b/i], ['yield', /\byields?\b/i],
]
const UP = /\b(rose|risen|rising|increased?|increasing|up|higher|climbed|grew)\b/i
const DOWN = /\b(fell|fallen|falling|decreased?|declin\w*|down|lower|dropped|eased)\b/i

export function checkText(text: string, project: Project, defaultEntity = 'France', defaultMetric: string | null = null): ClaimResult[] {
  const out: ClaimResult[] = []
  const entities: Record<string, string> = {}
  for (const d of Object.values<any>(project.datasets)) entities[d.entity] = d.geo.toLowerCase()
  let entity = defaultEntity, metric: string | null = defaultMetric
  for (const clause of text.split(/(?<=[.;])\s+|\n|•/).map((s) => s.trim()).filter(Boolean)) {
    // the country after "over"/"vs" is a comparator, not the subject (spread over Germany)
    const peerName = Object.keys(entities).find((e) => new RegExp(`\\b(over|vs\\.?|versus|than)\\s+${e}`, 'i').test(clause))
    const ent = Object.keys(entities).find((e) => e !== peerName && new RegExp(`\\b${e}`, 'i').test(clause)); if (ent) entity = ent
    const m = METRIC_WORDS.find(([, re]) => re.test(clause)); if (m) metric = m[0]
    const years = [...clause.matchAll(/\b(19|20)\d{2}\b/g)].map((x) => x[0])
    const nums = [...clause.matchAll(/(?<![\d.])[−-]?\d+(?:\.\d+)?(?=\s*(%|pp|bp|per ?cent| of GDP))/g)].map((x) => ({ v: parseFloat(x[0].replace('−', '-')), unit: x[1] }))
    if (!nums.length) continue
    if (!metric || !years.length) { out.push({ text: clause, status: 'unverifiable', detail: `no ${!metric ? 'metric' : 'year'} identified` }); continue }
    const geo = entities[entity]
    const valGeo = (met: string, y: string, g: string = geo): number | null => effectiveObs(project.datasets[`ds.${g}.${met}`]).find((o) => o.date === y)?.value ?? null
    const val = (met: string, y: string): number | null => {
      if (met !== 'spread') return valGeo(met, y)
      const a = valGeo('yield', y), b = valGeo('yield', y, peerName ? entities[peerName] : 'de')
      return a == null || b == null ? null : (a - b) * 100
    }
    // pair numbers with years in order; a single year applies to every number in the clause
    const checks = nums.filter((n) => n.unit !== 'pp').map((n, i) => ({ n, y: years[Math.min(i, years.length - 1)] }))
    const bad: string[] = [], ok: string[] = []
    for (const { n, y } of checks) {
      const met = n.unit === 'bp' ? 'spread' : metric
      const want = val(met, y)
      if (want == null) { bad.push(`no verified ${entity} ${met} for ${y}`); continue }
      const tol = met === 'spread' ? 0.6 : 0.051
      const match = Math.abs(want - n.v) <= tol || (met === 'deficit' && Math.abs(Math.abs(want) - Math.abs(n.v)) <= tol)
      ;(match ? ok : bad).push(`${entity} ${met} ${y}: text ${n.v}${n.unit === 'bp' ? ' bp' : '%'}, data ${met === 'spread' ? want.toFixed(0) + ' bp' : want}`)
    }
    if (checks.length >= 2 && (UP.test(clause) || DOWN.test(clause))) {
      const [a, b] = [checks[0], checks[checks.length - 1]], va = val(metric, a.y), vb = val(metric, b.y)
      if (va != null && vb != null && a.y !== b.y) {
        const rising = vb > va, says = UP.test(clause) && !DOWN.test(clause) ? 'up' : DOWN.test(clause) && !UP.test(clause) ? 'down' : null
        if (says && (says === 'up') !== rising) bad.push(`direction: text says ${says}, data ${a.y}→${b.y} went ${rising ? 'up' : 'down'}`)
      }
    }
    out.push({ text: clause, status: bad.length ? 'mismatch' : 'supported', detail: (bad.length ? bad : ok).join('; ') })
  }
  return out
}
