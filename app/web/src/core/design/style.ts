// Chart styling from the design layer (PD1): legend, gridlines, bar gap, axis title and emphasis colours. A style
// changes how a chart looks, never which values it shows; it is re-applied whenever the chart is redrawn from data.
import type { ElementStyle, Project } from '../types'
import type { Realization, VizSpec } from '../viz'
import type { DesignProfile } from './profiles'

export function chartStylePatch(p: Project, r: Realization, style?: ElementStyle): Record<string, unknown> {
  if (!style) return {}
  const out: Record<string, unknown> = {}
  out.legendPos = style.legend ?? (r.series.length > 1 ? 'b' : 'none')
  if (style.gridlines != null) out.gridlines = style.gridlines
  if (style.gapWidthPct != null) out.gapWidthPct = style.gapWidthPct
  if (style.axisTitle != null) out.valAxisTitle = style.axisTitle
  if (style.colors?.length) out.colorScheme = style.colors.slice(0, Math.max(1, r.series.length))
  // one series across countries (a ranking): the focus country in the structure colour, the others in the peer colour
  if (style.emphasis && r.series.length === 1 && style.peer) {
    const focus = p.datasets[style.emphasis]?.entity, hi = style.colors?.[0] ?? r.colorScheme[0]
    out.pointColors = { 0: Object.fromEntries(r.categories.map((c, i) => [i, c === focus ? hi : style.peer])) }
  }
  return out
}

/** Series colours from a profile: by country (France, Germany, Italy, Spain keep their slot), then the remaining profile colours. */
export function profileColors(p: Project, spec: VizSpec, r: Realization, pr: DesignProfile): string[] {
  const S = pr.color.series
  if (r.series.length === 1) return [pr.color.structure]
  const dss = spec.view.datasets
  if (dss.length !== r.series.length) return r.series.map((_, i) => S[i % S.length]!)
  let spare = 4
  return dss.map((d) => { const k = ['fr', 'de', 'it', 'es'].indexOf(p.datasets[d]?.geo.toLowerCase() ?? ''); return S[k >= 0 ? k : spare++ % S.length]! })
}
