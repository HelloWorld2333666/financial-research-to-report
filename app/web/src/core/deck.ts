// Deck queries by durable id. Parse-time ids change on every re-parse; durable ids (a16:creationId)
// survive re-parse, save/reopen and group/ungroup, so the store never holds parse-time ids.
import { elementDurableId, groupChildDurableId, slideDurableId, type OpenedPptx } from '@genoffice/pptx-engine'
import { buildRenderSlide, type FontMetricsProvider, type RenderSlide } from '@genoffice/pptx-render'

export interface Found { el: any; index: number; group?: any }

export const slideList = (deck: OpenedPptx) => deck.deck.slides.map((s, index) => ({ id: slideDurableId(s), index }))
export const slideIndex = (deck: OpenedPptx, id: string) => deck.deck.slides.findIndex((s) => slideDurableId(s) === id)

export function* walk(deck: OpenedPptx): Generator<Found & { durable: string | null }> {
  for (const [index, s] of deck.deck.slides.entries())
    for (const el of (s as any).elements) {
      yield { el, index, durable: elementDurableId(el) }
      if (el.type === 'group') for (const c of el.children ?? []) yield { el: c, index, group: el, durable: groupChildDurableId(el, c) }
    }
}

export function findEl(deck: OpenedPptx, durable: string): Found | null {
  for (const f of walk(deck)) if (f.durable === durable) return f
  return null
}

export function durableOfSource(deck: OpenedPptx, index: number, sourceId: string): string | null {
  for (const f of walk(deck)) if (f.index === index && f.el.id === sourceId) return f.durable
  return null
}

export const textOf = (el: any): string =>
  (el?.paragraphs || el?.text?.paragraphs || []).map((p: any) => (p.runs || []).map((r: any) => r.text ?? '').join('')).join('\n')

export function render(deck: OpenedPptx, index: number, fitWidthPx: number, metrics: FontMetricsProvider): RenderSlide {
  return buildRenderSlide(deck.deck.slides[index]!, deck.deck.size, { fitWidthPx, metrics, slideNo: index + 1 })
}

/** Canvas source ids for a set of durable ids (render nodes carry both). */
export function sourceIdsFor(slide: RenderSlide, durables: string[]): string[] {
  const out: string[] = [], want = new Set(durables)
  const visit = (nodes: any[]) => { for (const n of nodes) { if (n.durableId && want.has(n.durableId)) out.push(n.sourceId); if (n.children) visit(n.children) } }
  visit(slide.nodes as any[])
  return out
}
