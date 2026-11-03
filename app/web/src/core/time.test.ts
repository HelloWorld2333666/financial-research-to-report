import { describe, expect, it } from 'vitest'
import { localTime, zoneLabel } from './time'
import { summaryFor } from './wording'

describe('local time display', () => {
  it('shows a stored UTC instant in the viewer\'s zone, with the zone named', () => {
    const iso = '2026-11-03T17:16:05+00:00'
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    // independent of the zone the tests run in: compare with the Date's own local fields
    expect(localTime(iso)).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${zoneLabel(d)})`)
    expect(localTime(iso, { time: true })).toBe(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`)
    expect(localTime(iso, { zone: false })).not.toMatch(/UTC/)
  })
  it('labels offsets', () => {
    const at = (min: number) => ({ getTimezoneOffset: () => min }) as Date
    expect(zoneLabel(at(0))).toBe('UTC')
    expect(zoneLabel(at(-480))).toBe('UTC+8')
    expect(zoneLabel(at(210))).toBe('UTC-3:30')
  })
  it('passes through missing or unreadable values', () => {
    expect(localTime(undefined)).toBe('—')
    expect(localTime('not a time')).toBe('not a time')
  })
})

describe('proposal summary wording', () => {
  const s = 'Proposed adding Italy to “Gross debt, % of GDP”: 4 values retrieved live from Eurostat and confirmed by an independent re-fetch. Preview and apply; nothing has changed yet.'
  it('drops the pending instruction once applied or rejected, keeps it while open or undone', () => {
    expect(summaryFor(s, 'applied')).toBe('Proposed adding Italy to “Gross debt, % of GDP”: 4 values retrieved live from Eurostat and confirmed by an independent re-fetch.')
    expect(summaryFor(s, 'rejected')).not.toMatch(/nothing has changed/)
    expect(summaryFor(s, 'open')).toBe(s)
    expect(summaryFor(s, 'undone')).toBe(s)
  })
  it('covers the task and multi-card wordings', () => {
    expect(summaryFor('5 series. Apply to add them to the project\'s data; nothing has changed yet.', 'applied')).toBe('5 series.')
    expect(summaryFor('Four slides. Preview and apply each one; nothing has changed yet.', 'applied')).toBe('Four slides.')
    expect(summaryFor('Nothing pending here.', 'applied')).toBe('Nothing pending here.')
  })
})
