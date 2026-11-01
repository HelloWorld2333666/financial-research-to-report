// Deck session: a GenOffice OpenedPptx plus render helpers. M1 adds the store, commands and bindings.
import { createBlankPptx, openPptx, slideDurableId, type OpenedPptx } from '@genoffice/pptx-engine'
import { buildRenderSlide, HeuristicMetrics, type FontMetricsProvider, type RenderSlide } from '@genoffice/pptx-render'

export interface Session { deck: OpenedPptx; metrics: FontMetricsProvider }

export async function blankSession(): Promise<Session> {
  return { deck: await openPptx(await createBlankPptx()), metrics: new HeuristicMetrics() }
}

export const slideIds = (s: Session) => s.deck.deck.slides.map((x) => slideDurableId(x))

export function renderSlide(s: Session, index: number, fitWidthPx: number): RenderSlide {
  return buildRenderSlide(s.deck.deck.slides[index]!, s.deck.deck.size, { fitWidthPx, metrics: s.metrics, slideNo: index + 1 })
}
