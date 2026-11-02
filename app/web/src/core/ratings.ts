// Credit rating scale (VIS V3, rating timeline). Ratings are ORDINAL: a notch index orders them for drawing;
// it is never averaged or used as a quantity. The common notch follows the usual equivalence of the long-term
// scales (S&P / Fitch: AA-; Moody's: Aa3; Morningstar DBRS: AA (low)). Symbols outside the table are refused.
export const NOTCHES = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D']
const MOODYS = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C']

/** 0 = AAA … 21 = D, or null for a symbol the table doesn't know. */
export function notch(symbol: string | null | undefined): number | null {
  if (!symbol) return null
  const s = symbol.trim().replace(/\s+/g, ' ')
  const sp = NOTCHES.indexOf(s.toUpperCase().replace(/\s/g, ''))
  if (sp >= 0 && /^[A-D][A-D+\- ]*$/.test(s)) return sp
  const m = MOODYS.indexOf(s)
  if (m >= 0) return m
  // Morningstar DBRS: "AA (high)", "AA", "AA (low)"; "BBB (high)" …
  const d = /^(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)(?: \(([Hh]igh|[Ll]ow)\))?$/.exec(s)
  if (d) {
    const base = NOTCHES.indexOf(d[1]!)
    if (base < 0) return null
    const hi = d[2]?.toLowerCase() === 'high', lo = d[2]?.toLowerCase() === 'low'
    if ((hi || lo) && ['AAA', 'CC', 'C', 'D'].includes(d[1]!)) return null
    return base + (hi ? -1 : lo ? 1 : 0)
  }
  return null
}
