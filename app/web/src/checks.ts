// End-to-end checks in the browser against the real service (/?checks=1). They cover Experiment 3's
// 16 checks plus the M1 acceptance behaviours (save/reopen, group/ungroup bindings, independent paste,
// versions), M2's editing checks and M3's provenance and export policy (server endpoints included). Results go to <pre id="checks">, read by app/server/tests/test_web_checks.py.
import { Store } from './core/store'
import { integrity } from './core/integrity'
import { checkText } from './core/claims'
import { findEl, textOf, walk } from './core/deck'
import { effectiveObs, evidenceValue, textNumbers } from './core/evidence'
import { loadFonts } from './core/fonts'

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
    // the table is re-projected; the only remaining mismatch is the sentence that cites the 2025 value (M3)
    const left = ig().mismatch
    check('table_working_edit_keeps_source', d.working['2025']?.value === 2.3 && d.observations.find((o) => o.date === '2025')!.value === 2.2 && left.length === 1 && left[0]!.startsWith('text says 2.2'), JSON.stringify(d.working) + ' ' + left.join(' | '))
    const t = checkText(textOf(findEl(s.deck, byRole('title', 's_2'))!.el), s.project)
    check('claim_flagged_stale_after_data_edit', t.some((c) => c.status === 'mismatch' && /2\.3/.test(c.detail)), t.map((c) => c.detail).join(' | '))
    s.exec({ kind: 'data.restore', dataset: 'ds.fr.interest', date: '2025' })
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
  // ---- M2 (fonts need a real browser: FontFace + canvas)
  await safe('fonts_measure_like_the_browser_draws', async () => {
    const m = await loadFonts(), c = document.createElement('canvas').getContext('2d')!
    const errs = (['400', '700'] as const).map((w) => { c.font = `${w === '700' ? 'bold ' : ''}20px Inter`; const draw = c.measureText("France's debt ratio rose from 111.4% to 115.7%").width
      return Math.abs(m.measure("France's debt ratio rose from 111.4% to 115.7%", { fontFamily: 'Inter', fontSizePx: 20, bold: w === '700', italic: false }) - draw) / draw })
    check('fonts_measure_like_the_browser_draws', errs.every((e) => e < 0.02), errs.map((e) => (e * 100).toFixed(2) + '%').join(', '))
  })
  await safe('rich_runs_and_combined_move', () => {
    const t = byRole('title', 's_2')
    const r1 = s.exec({ kind: 'text.set', id: t, paragraphs: [{ runs: [{ text: 'The deficit ' }, { text: 'narrowed', bold: false }, { text: ' in 2025' }] }] })
    const runs = findEl(s.deck, t)!.el.text.paragraphs[0].runs.map((x: any) => !!x.bold)
    const a = chartOn('s_2'), b = byRole('label', 's_2'), n = s.undoStack.length
    const bx = (id: string) => { const o = findEl(s.deck, id)!.el.transform.offset; return { x: o.x / 9525, y: o.y / 9525 + 10, w: o.cx / 9525, h: o.cy / 9525 } }
    const r2 = s.exec({ kind: 'elements.transform', items: [{ id: a, box: bx(a) }, { id: b, box: bx(b) }] })
    check('rich_runs_and_combined_move', r1.ok && JSON.stringify(runs) === '[true,false,true]' && r2.ok && s.undoStack.length === n + 1 && ig().ok, `${JSON.stringify(runs)} ${r2.error ?? ''}`)
  })
  // ---------------------------------------------------------------- M3: provenance and export policy
  const api = async (method: string, path: string, body?: any) => { const r = await fetch(`/api/projects/${s.project.id}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json() } }
  await safe('every_number_resolves_to_source', () => {
    const missing: string[] = []; let n = 0
    const sourced = (eid?: string) => !!eid && !!s.project.evidence[eid]?.retrieval?.query_url && /ec\.europa\.eu\/eurostat\/api/.test(s.project.evidence[eid].retrieval.query_url)
    for (const [id, b] of Object.entries(s.sidecar.bindings)) {
      const el = findEl(s.deck, id)?.el
      if (b.kind === 'chart') for (const d of b.chart.series) for (const o of effectiveObs(s.project.datasets[d])) { n++; if (!o.edited && !sourced(o.evidence_id)) missing.push(`${d} ${o.date}`) }
      if (b.kind === 'table') for (const d of b.table.datasets) for (const x of b.table.dates) { n++; const o = effectiveObs(s.project.datasets[d]).find((y) => y.date === x); if (!sourced(o?.evidence_id)) missing.push(`${d} ${x}`) }
      if (b.kind === 'text' && b.role !== 'source') for (const t of textNumbers(textOf(el), b.numbers, s.project)) {
        n++
        const ok = t.status === 'ok' && (t.ref?.evidence ? sourced(t.ref.evidence) : Object.values(s.project.derivations?.[t.ref!.derivation!]?.inputs ?? { x: '' }).every(sourced))
        if (!ok) missing.push(`${b.slide} "${t.text}" ${t.status}`)
      }
    }
    check('every_number_resolves_to_source', n > 50 && missing.length === 0, `${n} numbers; unresolved: ${missing.join(', ') || 'none'}`)
  })
  await safe('spread_derivation_inputs', () => {
    const d = Object.values(s.project.derivations ?? {}).find((x) => /spread/.test(x.id))!
    const [own, peer] = [evidenceValue(s.project, d.inputs.own!), evidenceValue(s.project, d.inputs.peer!)]
    const ok = d.formula === '(own - peer) * 100' && own.ds === 'ds.fr.yield' && peer.ds === 'ds.de.yield' && own.date === d.period && Math.round((own.value! - peer.value!) * 100) === d.value
      && s.project.evidence[d.inputs.own!].retrieval.query_url.includes('geo=FR') && s.project.evidence[d.inputs.peer!].retrieval.query_url.includes('geo=DE')
    check('spread_derivation_inputs', ok, `${d.id}: ${d.formula} with own=${own.value} (${own.ds}), peer=${peer.value} (${peer.ds}) = ${d.value} ${d.unit}`)
  })
  await safe('final_export_blocked_until_ack', async () => {
    s.exec({ kind: 'data.set', dataset: 'ds.de.interest', date: '2023', value: 1.0 })
    await s.save()
    const pol = (await api('GET', '/export')).j, keys = pol.acknowledge.map((a: any) => a.key)
    const refused = await api('POST', '/export', { mode: 'final', acknowledged: keys.filter((k: string) => k !== 'edits') })
    const draft = await api('POST', '/export', { mode: 'draft' })
    const final = await api('POST', '/export', { mode: 'final', acknowledged: keys })
    s.exec({ kind: 'data.verify', dataset: 'ds.de.interest', date: '2023' }); await s.save()
    const mine = (pl: any) => (pl.acknowledge.find((a: any) => a.key === 'edits')?.items ?? []).some((i: any) => i.dataset === 'ds.de.interest' && i.date === '2023')
    const before = mine(pol), after = mine((await api('GET', '/export')).j)
    s.exec({ kind: 'data.restore', dataset: 'ds.de.interest', date: '2023' }); await s.save()
    check('final_export_blocked_until_ack', keys.includes('edits') && keys.includes('placeholders') && refused.status === 409 && /manually edited/.test(refused.j.error)
      && draft.status === 201 && draft.j.draft_banner && final.status === 201 && final.j.acknowledged.some((a: any) => a.key === 'edits') && before && !after,
      `ack ${keys} → final w/o edits ${refused.status}; draft ${draft.status} banner=${draft.j.draft_banner}; final ${final.status}; listed before verify ${before}, after ${after}`)
  })
  await safe('stale_text_blocks_final_export', async () => {
    // pick a figure still written on a slide (earlier checks rewrite some text) and change the value under it
    const cited = Object.entries(s.sidecar.bindings).flatMap(([id, b]) => b.kind === 'text' ? textNumbers(textOf(findEl(s.deck, id)?.el), b.numbers, s.project).filter((t) => t.status === 'ok' && t.ref?.evidence) : [])[0]!
    const at = evidenceValue(s.project, cited.ref!.evidence!)
    s.exec({ kind: 'data.set', dataset: at.ds!, date: at.date!, value: 99.9 }); await s.save()
    const pol = (await api('GET', '/export')).j
    const res = await api('POST', '/export', { mode: 'final', acknowledged: pol.acknowledge.map((a: any) => a.key) })
    s.undo(); await s.save()
    check('stale_text_blocks_final_export', pol.blocking.some((b: any) => b.key === 'integrity' && b.items.some((i: any) => i.detail === `text says ${cited.text}, data now 99.9`)) && res.status === 409,
      `${pol.blocking.map((b: any) => b.text).join(' | ')} → ${res.status}`)
  })
  await safe('server_integrity_matches_client', async () => {
    await s.save()
    const srv = (await api('GET', '/integrity')).j, c = ig()
    check('server_integrity_matches_client', srv.ok === c.ok && srv.points === c.points && srv.cells === c.cells && srv.figures === c.figures && srv.sourced === c.sourced,
      `server ok=${srv.ok} ${srv.points}/${srv.cells}/${srv.sourced}of${srv.figures}; client ok=${c.ok} ${c.points}/${c.cells}/${c.sourced}of${c.figures}`)
  })
  const fin = ig()
  check('final_integrity', fin.ok, `${fin.resolved}/${fin.bindings}, ${fin.points} points, ${fin.cells} cells, ${fin.unverified} unverified edits`)
  return r
}
