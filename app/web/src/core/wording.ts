// Proposal summaries are written by the server while nothing has happened yet, and end with what to do next
// ("Preview and apply; nothing has changed yet."). Once a card is applied or rejected that sentence is no
// longer true, so the card shows the summary without it (its state line says what happened instead).
const PENDING = /\s*(?:Preview and apply(?: each one)?|Apply to [^.;]+); nothing has changed yet\.\s*$/

export type CardState = 'open' | 'applied' | 'rejected' | 'undone'

/** The summary as it should read for a card in `state`: open or undone cards keep the instruction. */
export function summaryFor(text: string, state: CardState | string): string {
  return state === 'applied' || state === 'rejected' ? text.replace(PENDING, '') : text
}
