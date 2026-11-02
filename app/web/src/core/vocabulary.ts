// Visual vocabulary (VIS-01): the native GenOffice chart kinds this product offers. V1 replaces the
// kind lists with the renderer-independent spec (frr-viz/1); the exclusions stay.
// 3-D variants are excluded (decision D-V3): perspective distorts the comparison and the audit found
// crammed axes. Decks that already contain 3-D charts still open and render; we just never create one.
export const NATIVE_CHART_KINDS = ['bar', 'barStacked', 'barPercentStacked', 'line', 'area', 'pie', 'doughnut', 'scatter', 'radar', 'comboBarLine'] as const
export const EXCLUDED_CHART_KINDS: Record<string, string> = {
  pie3D: '3-D charts distort comparisons and are not offered; use a pie or doughnut',
  bar3D: '3-D charts distort comparisons and are not offered; use a column chart',
}

/** null when the kind may be created, otherwise the reason it may not. */
export function chartKindRefusal(kind: unknown): string | null {
  if (typeof kind !== 'string') return null // engine validation reports a missing kind
  return EXCLUDED_CHART_KINDS[kind] ?? null
}
