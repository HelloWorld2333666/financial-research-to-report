// Design briefs: the slide requests the design work is judged on (the three France benchmark slides), and the
// function that turns a brief into design candidates. The render page and the tests use the same entry point.
import type { Project } from '../types'
import { planSlide, type DesignCandidate, type DesignRequest } from './planner'
import { balanceRank, balanceTrend, debtTrend, navigation, riskNarrative } from './editorial'
import { balanceTable, debtCommentary, riskMatrix } from './proposals'

export interface Brief { title: string; request?: DesignRequest; compose?: (p: Project) => DesignCandidate[] }
export const BRIEFS: Record<string, Brief> = {
  debt: { title: 'Debt trend: France against Germany and Italy', compose: (p) => debtTrend(p) },
  balance: { title: 'Fiscal balance: France among seven countries', compose: (p) => balanceRank(p) },
  risk: { title: 'Executive risk assessment: debt, deficit, funding cost', compose: (p) => riskNarrative(p) },
  // Gate E proposals (burgundy and gold, reference-derived compositions)
  'v2-debt': { title: 'Debt trend: chart with a commentary column', compose: (p) => [debtCommentary(p)] },
  'v2-balance': { title: 'Fiscal balance: ranked table with a figures column', compose: (p) => [balanceTable(p)] },
  'v2-risk': { title: 'Credit risk: scorecard matrix', compose: (p) => [riskMatrix(p)] },
  'v2-divider': { title: 'Section divider in burgundy and gold', compose: (p) => navigation(p, 'divider', 1, undefined, undefined, 'burgundy') },
  'v2-agenda': { title: 'Agenda in burgundy and gold', compose: (p) => navigation(p, 'agenda', 1, undefined, undefined, 'burgundy') },
  // Gate C recipes
  'balance-trend': { title: 'Deficit trend: France against Germany (R3)', compose: (p) => balanceTrend(p) },
  agenda: { title: 'Agenda, fiscal position next (R9)', compose: (p) => navigation(p, 'agenda', 1) },
  divider: { title: 'Section divider: fiscal position (R9)', compose: (p) => navigation(p, 'divider', 1) },
  'pd1-debt': { title: 'Debt trend (PD1 planner)', request: { purpose: 'trend', metric: 'debt', focus: 'FR', peers: ['DE', 'IT'] } },
  'pd1-balance': { title: 'Fiscal balance, seven countries (PD1 planner)', request: { purpose: 'comparison', metric: 'deficit', focus: 'FR' } },
  'pd1-risk': { title: 'Executive risk assessment (PD1 planner)', request: { purpose: 'risk', focus: 'FR', peers: ['DE'] } },
}

export function composeBrief(p: Project, name: string): DesignCandidate[] {
  const b = BRIEFS[name]
  if (!b) throw new Error(`unknown brief ${name}`)
  if (b.compose) return b.compose(p)
  const r = planSlide(p, b.request!)
  if (r.error) throw new Error(r.error)
  return r.candidates
}
