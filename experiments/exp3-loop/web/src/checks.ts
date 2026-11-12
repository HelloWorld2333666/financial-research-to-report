// Scripted regression checks (no model): /?checks=1 runs them on a fresh deck and writes JSON into
// <pre id="checks-result">. They drive the same engine functions the UI and proposal cards call.
import { savePptx, openPptx, elementDurableId } from '@genoffice/pptx-engine'
import * as E from './engine'
import { checkText } from './claims'

export async function runChecks() {
  const S = E.S, r: Record<string, { ok: boolean; detail: string }> = {}
  const check = (k: string, ok: any, detail: any = '') => { r[k] = { ok: !!ok, detail: String(detail).slice(0, 200) } }
  const state = () => JSON.stringify({ s: S.opened.deck.slides.map((x: any) => x.elements.length), b: Object.keys(S.bindings).length, u: S.undo.length })
  const deck = await (await fetch('/api/compose', { method: 'POST', body: JSON.stringify({ country: 'FR', peer: 'DE' }) })).json()

  const before = state(); const pv = E.preview(() => [E.applySlide(deck.slides[0])])
  check('preview_renders_without_touching_live', pv.slides.length === 1 && !pv.error && state() === before, `${pv.slides.length} slide(s), live ${state()}`)
  for (const s of deck.slides) E.step(`AI: add slide ${s.key}`, () => { E.applySlide(s) })
  check('compose_four_slides_one_step_each', S.opened.deck.slides.length === 4 && S.undo.length === 4, `${S.opened.deck.slides.length} slides, ${S.undo.length} steps`)
  let ig = E.integrity(); check('integrity_after_compose', ig.ok && ig.points > 0 && ig.cells > 0, `${ig.resolved}/${ig.bindings}, ${ig.points} pts, ${ig.cells} cells`)
  const claimsAll = () => Object.entries(S.bindings).filter(([, b]: any) => b.kind === 'text' && ['title', 'body'].includes(b.role)).flatMap(([d, b]: any) => { const f = E.findEl(d)!; const ch: any = Object.values(S.bindings).find((x: any) => x.kind === 'chart' && x.slide === b.slide); return checkText(E.textOf(f.el), S.project, 'France', ch ? S.project.datasets[ch.chart.series[0]].metric : null) })
  check('generated_claims_all_supported', claimsAll().every((c) => c.status !== 'mismatch'), claimsAll().filter((c) => c.status === 'mismatch').map((c) => c.text).join(' | ') || 'none flagged')

  const bad = checkText("France's debt ratio fell from 111.4% in 2022 to 112.0% in 2025", S.project)
  check('claim_checker_flags_value_and_direction', bad[0]?.status === 'mismatch' && /direction/.test(bad[0].detail) && /115.7/.test(bad[0].detail), bad[0]?.detail)
  const year = checkText('Interest costs reached 2.0% in 2025', S.project)
  check('claim_checker_flags_wrong_year', year[0]?.status === 'mismatch', year[0]?.detail)

  const fiscalTitle = Object.entries(S.bindings).find(([k, b]: any) => b.kind === 'text' && b.role === 'title' && /interest costs/.test(E.textOf(E.findEl(k)?.el)))
  E.step('edit interest', () => E.setWorking('ds.fr.interest', '2025', 2.3))
  const d = S.project.datasets['ds.fr.interest']
  check('table_working_edit_keeps_source', d.working['2025']?.value === 2.3 && d.observations.find((o: any) => o.date === '2025').value === 2.2 && E.integrity().ok, JSON.stringify(d.working))
  const stale = fiscalTitle ? checkText(E.textOf(E.findEl(fiscalTitle[0])!.el), S.project) : []
  check('claim_flagged_stale_after_data_edit', stale.some((c) => c.status === 'mismatch' && /2\.3/.test(c.detail)), stale.map((c) => c.status + ':' + c.detail).join(' | '))

  E.step('gap', () => E.setWorking('ds.fr.debt', '2023', null))
  const ch = Object.entries(S.bindings).find(([, b]: any) => b.kind === 'chart' && b.chart.series.includes('ds.fr.debt'))!
  const f = E.findEl(ch[0])!
  check('deleted_value_is_gap_not_zero', f.el.chart.series[0].values[f.el.chart.categories.indexOf('2023')] == null && E.integrity().ok, JSON.stringify(f.el.chart.series[0].values))

  const n0 = S.undo.length
  const extra = S.project.datasets['ds.it.debt'] || S.project.datasets['ds.de.growth']
  const add = E.step('add series', () => E.addSeries(ch[0], extra, {}))
  const series1 = (S.bindings[ch[0]] as any).chart.series.length
  E.undo()
  check('add_series_one_step_and_undo', add.ok && S.undo.length === n0 && (S.bindings[ch[0]] as any).chart.series.length === series1 - 1, `ok=${add.ok} series ${series1}→${(S.bindings[ch[0]] as any).chart.series.length}`)

  const title = Object.entries(S.bindings).find(([, b]: any) => b.kind === 'text' && b.role === 'title')![0]
  E.step('text', () => E.setText(title, 'Manual title after AI'))
  check('text_edit_after_ai', E.textOf(E.findEl(title)!.el) === 'Manual title after AI', E.textOf(E.findEl(title)!.el))
  E.undo(); const undone = E.textOf(E.findEl(title)!.el); E.redo()
  check('undo_redo', undone !== 'Manual title after AI' && E.textOf(E.findEl(title)!.el) === 'Manual title after AI', undone.slice(0, 60))

  const pre = state(); const badStep = E.step('invalid', () => E.txnPublic([{ op: 'setFill', target: { slide: 0, el: 'e_doesnotexist' }, fill: '#c8102e' }]))
  check('invalid_ops_refused_atomically', !badStep.ok && state() === pre, badStep.error)

  E.step('placeholder', () => E.addPlaceholder(E.slides()[3].id, 'Rating history — pending', { schema: 'frr-research-request/0.1', options: ['upload PDF'] }))
  check('research_request_placeholder_bound', Object.values(S.bindings).filter((b: any) => b.kind === 'placeholder').length === 2, '')

  const bytes = await savePptx(S.opened), reopened = await openPptx(bytes)
  const ids = new Set(reopened.deck.slides.flatMap((s: any) => s.elements.map((e: any) => elementDurableId(e))))
  const missing = Object.keys(S.bindings).filter((k) => !ids.has(k))
  check('save_reopen_bindings_resolve', missing.length === 0, `${(bytes.length / 1024).toFixed(0)} KB, missing ${missing.length}`)
  ig = E.integrity(); check('final_integrity', ig.ok, `${ig.resolved}/${ig.bindings}, unverified edits ${ig.unverified}`)
  return r
}
