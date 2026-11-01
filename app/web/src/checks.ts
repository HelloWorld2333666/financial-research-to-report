// End-to-end checks in the browser against the real service (/?checks=1). They cover Experiment 3's
// 16 checks plus the M1 acceptance behaviours (save/reopen, group/ungroup bindings, independent paste,
// versions). Results go to <pre id="checks">, read by app/server/tests/test_web_checks.py.
import { Store } from './core/store'
import { integrity } from './core/integrity'
import { checkText } from './core/claims'
import { findEl, textOf, walk } from './core/deck'

export async function runChecks() {
  const r: Record<string, { ok: boolean; detail: string }> = {}
  const check = (k: string, ok: unknown, detail: unknown = '') => { r[k] = { ok: !!ok, detail: String(detail).slice(0, 200) } }
  const safe = async (k: string, fn: () => Promise<void> | void) => { try { await fn() } catch (e: any) { check(k, false, 'threw: ' + (e?.message ?? e)) } }

  const s = await Store.create('france', 'Checks (France)')
  const ig = () => integrity(s.deck, s.project, s.sidecar)
  const shape = () => JSON.stringify({ e: s.deck.deck.slides.map((x: any) => x.elements.length), b: Object.keys(s.sidecar.bindings).length, u: s.undoStack.length })
  const byRole = (role: string, slide = 's_1') => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'text' && b.role === role && b.slide === slide)![0]
  const chartOn = (slide: string) => Object.entries(s.sidecar.bindings).find(([, b]) => b.kind === 'chart' && b.slide === slide)![0]
  const { slides: props } = await (await fetch('/api/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: s.project.id }) })).json()

  await safe('preview_renders_without_touching_live', () => {
    const before = shape(), pv = s.preview({ kind: 'slide.compose', proposal: props[0] }, (o) => o.slides)
    check('preview_renders_without_touching_live', pv.ok && shape() === before, `${JSON.stringify(pv.value)} ${shape()}`)
  })
  for (const p of props) s.exec({ kind: 'slide.compose', proposal: p }, { actor: 'ai', proposalId: `compose:${p.key}` })
  check('compose_four_slides_one_step_each', s.slides().length === 4 && s.undoStack.length === 4 && s.journal.every((j) => j.actor === 'ai'), `${s.slides().length} slides, ${s.undoStack.length} steps`)
  check('integrity_after_compose', ig().ok && ig().points > 0 && ig().cells > 0, JSON.stringify(ig()).slice(0, 160))
  await safe('generated_claims_all_supported', () => {
    const bad = Object.entries(s.sidecar.bindings).filter(([, b]) => b.kind === 'text' && ['title', 'body'].includes((b as any).role)).flatMap(([id, b]) => {
      const ch: any = Object.values(s.sidecar.bindings).find((x) => x.kind === 'chart' && x.slide === b.slide)
      return checkText(textOf(findEl(s.deck, id)!.el), s.project, 'France', ch ? s.project.datasets[ch.chart.series[0]]!.metric : null).filter((c) => c.status === 'mismatch')
    })
    check('generated_claims_all_supported', bad.length === 0, bad.map((c) => c.text).join(' | ') || 'none flagged')
  })
  const vd = checkText("France's debt ratio fell from 111.4% in 2022 to 112.0% in 2025", s.project)[0]
  check('claim_checker_flags_value_and_direction', vd?.status === 'mismatch' && /direction/.test(vd.detail) && /115.7/.test(vd.detail), vd?.detail)
  const yr = checkText('Interest costs reached 2.0% in 2025', s.project)[0]
  check('claim_checker_flags_wrong_year', yr?.status === 'mismatch', yr?.detail)

  await safe('table_working_edit_keeps_source', () => {
    s.exec({ kind: 'data.set', dataset: 'ds.fr.interest', date: '2025', value: 2.3 })
    const d = s.project.datasets['ds.fr.interest']!
    check('table_working_edit_keeps_source', d.working['2025']?.value === 2.3 && d.observations.find((o) => o.date === '2025')!.value === 2.2 && ig().ok, JSON.stringify(d.working))
    const t = checkText(textOf(findEl(s.deck, byRole('title', 's_2'))!.el), s.project)
    check('claim_flagged_stale_after_data_edit', t.some((c) => c.status === 'mismatch' && /2\.3/.test(c.detail)), t.map((c) => c.detail).join(' | '))
  })
  await safe('deleted_value_is_gap_not_zero', () => {
    s.exec({ kind: 'data.set', dataset: 'ds.fr.debt', date: '2023', value: null })
    const el = findEl(s.deck, chartOn('s_1'))!.el
    check('deleted_value_is_gap_not_zero', el.chart.series[0].values[el.chart.categories.indexOf('2023')] == null && ig().ok, JSON.stringify(el.chart.series[0].values))
  })
  await safe('add_series_one_step_and_undo', () => {
    const n = s.undoStack.length, id = chartOn('s_1')
    const ok = s.exec({ kind: 'chart.addSeries', id, dataset: s.project.datasets['ds.de.growth']! }).ok
    const after = (s.sidecar.bindings[id] as any).chart.series.length
    s.undo()
    check('add_series_one_step_and_undo', ok && after === 3 && s.undoStack.length === n && (s.sidecar.bindings[id] as any).chart.series.length === 2, `${after} → ${(s.sidecar.bindings[id] as any).chart.series.length}`)
  })
  await safe('text_edit_after_ai', () => {
    const t = byRole('title')
    s.exec({ kind: 'text.set', id: t, text: 'Manual title after AI' })
    check('text_edit_after_ai', textOf(findEl(s.deck, t)!.el) === 'Manual title after AI' && s.journal.at(-1)!.actor === 'user', s.journal.at(-1)!.summary)
    s.undo(); const undone = textOf(findEl(s.deck, t)!.el); s.redo()
    check('undo_redo', undone !== 'Manual title after AI' && textOf(findEl(s.deck, t)!.el) === 'Manual title after AI', undone.slice(0, 60))
  })
  await safe('invalid_ops_refused_atomically', () => {
    const before = shape(), x = s.exec({ kind: 'ops.raw', ops: [{ op: 'setFill', target: { slide: 0, el: 'e_doesnotexist' }, fill: '#c8102e' }] })
    check('invalid_ops_refused_atomically', !x.ok && shape() === before, x.error)
  })
  await safe('research_request_placeholder_bound', () => {
    const x = s.exec({ kind: 'placeholder.add', slide: 's_4', label: 'Rating history — pending', request: { schema: 'frr-research-request/0.1', options: ['upload PDF'] } }, { actor: 'research' })
    check('research_request_placeholder_bound', x.ok && Object.values(s.sidecar.bindings).filter((b) => b.kind === 'placeholder').length === 2 && s.journal.at(-1)!.actor === 'research', '')
  })

  // ---- M1 acceptance
  await safe('group_ungroup_keeps_bindings', () => {
    const ids = [byRole('kicker'), byRole('subtitle')]
    const g = s.exec({ kind: 'element.group', ids })
    const grouped = ids.every((id) => findEl(s.deck, id)?.group) && integrity(s.deck, s.project, s.sidecar).ok
    const group = [...walk(s.deck)].find((f) => f.el.type === 'group')!.durable!
    const u = s.exec({ kind: 'element.ungroup', id: group })
    check('group_ungroup_keeps_bindings', g.ok && grouped && u.ok && ids.every((id) => findEl(s.deck, id) && !findEl(s.deck, id)!.group) && ig().ok, `${g.error ?? ''} ${u.error ?? ''}`)
  })
  const refused = s.exec({ kind: 'element.group', ids: [chartOn('s_2'), byRole('title', 's_2')] })
  check('group_chart_refused_clearly', !refused.ok && /can't be grouped/.test(refused.error ?? ''), refused.error)
  await safe('pasted_chart_edits_alone', () => {
    const orig = chartOn('s_3'); s.copy([orig])
    const p = s.exec({ kind: 'clipboard.paste', slide: 's_3', items: s.clipboard })
    const copy = p.created![0]!
    const a = s.exec({ kind: 'chart.addSeries', id: copy, dataset: s.project.datasets['ds.de.debt']! })
    check('pasted_chart_edits_alone', p.ok && a.ok && findEl(s.deck, orig)!.el.chart.series.length === 2 && findEl(s.deck, copy)!.el.chart.series.length === 3 && ig().ok, `${p.error ?? ''} ${a.error ?? ''}`)
  })
  await safe('save_reopen_identical', async () => {
    s.threads = { project: { messages: [{ role: 'user', content: 'Analyze France' }] } }
    const saved = await s.save()
    const back = await Store.open(s.project.id)
    const texts = (x: Store) => Object.keys(x.sidecar.bindings).sort().map((id) => [id, textOf(findEl(x.deck, id)!.el)])
    const a = integrity(back.deck, back.project, back.sidecar)
    check('save_reopen_identical', saved.ok && a.ok && JSON.stringify(a) === JSON.stringify(ig()) && JSON.stringify(texts(back)) === JSON.stringify(texts(s))
      && JSON.stringify(back.journal) === JSON.stringify(s.journal) && JSON.stringify(back.threads) === JSON.stringify(s.threads), `${saved.error ?? ''} ${a.resolved}/${a.bindings}`)
  })
  await safe('versions_freeze_state', async () => {
    const v = await s.saveVersion('Before rename')
    s.exec({ kind: 'text.set', id: byRole('title', 's_3'), text: 'After the version' }); await s.save()
    const old = await (await fetch(`/api/projects/${s.project.id}/versions/${v.version}`)).json()
    const cur = await (await fetch(`/api/projects/${s.project.id}`)).json()
    check('versions_freeze_state', old.journal.length === cur.journal.length - 1, `${old.journal.length} vs ${cur.journal.length}`)
  })
  const fin = ig()
  check('final_integrity', fin.ok, `${fin.resolved}/${fin.bindings}, ${fin.points} points, ${fin.cells} cells, ${fin.unverified} unverified edits`)
  return r
}
