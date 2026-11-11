// Compositions (PD2): visual arrangements of a slide's semantic objects in a visual language. The design spec says
// WHAT the slide holds (headline, focal figure, evidence chart, supporting points, footnote); a composition decides
// WHERE and HOW LARGE, on a 12-column grid, with every text box measured in its real typeface. Five kinds, each with
// parameters (side, chart share, emphasis): an evidence rail, a statement column, a wide chart, figure bands and a
// lead with a dark panel. They are arrangements, not filled templates: the objects decide what is drawn.
import type { FontMetricsProvider } from '@genoffice/pptx-render'
import type { DesignObject, DesignText, SlideDesign } from './spec'
import { languageOf, type Language, type TypeRole } from './language'
import { H, lineCount, W, type Box, type Laid } from './layout'

const px = (pt: number) => (pt * 96) / 72
const textOf = (o: DesignObject) => (o.kind === 'text' ? [o.text, ...(o.items ?? [])].filter((t) => t.text).map((t) => t.text).join('\n') : '')
const itemsOf = (o: DesignObject): DesignText[] => (o.kind === 'text' ? (o.items?.length ? o.items : [o.text]) : [])

export interface ComposedLaid extends Laid {
  /** the type role each text object is set in (build.ts styles it from the language) */
  roles: Record<string, keyof Language['type']>
  language: Language
  /** the slide background when the composition sets one (a divider is navy); otherwise the language's paper */
  background?: string
}

export function composeLayout(d: SlideDesign, m: FontMetricsProvider): ComposedLaid {
  const L = languageOf(d.language), c = d.layout.composition!, P = c.params ?? {}
  const M = L.frame.margin, G = 28, colW = (W - 2 * M - 11 * G) / 12, cols = (n: number) => n * colW + (n - 1) * G
  const boxes: Record<string, Box> = {}, sizes: Record<string, number> = {}, roles: Record<string, keyof Language['type']> = {}, decor: Laid['decor'] = [], notes: string[] = []
  const of = (pred: (o: DesignObject) => boolean) => d.objects.filter(pred)
  const one = (pred: (o: DesignObject) => boolean) => d.objects.find(pred)
  /** line height from the face's own metrics (a serif's ascenders and descenders are taller than a sans's) */
  const lineH = (t: TypeRole) => m.metrics({ fontFamily: t.font, fontSizePx: px(t.pt), bold: !!t.bold, italic: false }).lineHeight * ((t.lineSpacing ?? 100) / 100)
  const height = (text: string, t: TypeRole, w: number, paras = 1, gapPt = 0) => {
    const lines = lineCount(m, t.font, text, t.pt, w, !!t.bold || /Semibold/.test(t.font))
    // plus a quarter of the type size: the renderer's line model sets the first and last lines a little looser
    return Math.ceil(lines * lineH(t) + Math.max(0, paras - 1) * px(gapPt) + px(t.pt) * 0.25 + 2)
  }
  /** set a text object in a role at a box whose height is measured */
  const setText = (o: DesignObject, role: keyof Language['type'], x: number, y: number, w: number, gapPt = 6) => {
    // a bold lead-in ("France rose.") is part of the first line: measure it, and the block in bold to be safe
    const items = itemsOf(o), lead = items[0]?.lead ? items[0].lead + ' ' : '', t0 = L.type[role], t = lead ? { ...t0, bold: true } : t0
    const h = height(lead + items.map((i) => i.text).join('\n'), t, w, items.length, gapPt)
    boxes[o.id] = { x, y, w, h }; sizes[o.id] = t.pt; roles[o.id] = role
    return y + h
  }
  /** a figure (kpi) as value + caption (+ context), measured */
  const setFigure = (o: DesignObject, role: keyof Language['type'], x: number, y: number, w: number) => {
    if (o.kind !== 'kpi') return y
    const v = L.type[role], cap = L.type.caption
    const h = Math.ceil(lineH(v) * 1.04) + 4 + height(o.label, cap, w) + (o.context ? height(o.context.text, L.type.bodySmall, w) + 4 : 0) + 4
    boxes[o.id] = { x, y, w, h }; sizes[o.id] = v.pt; roles[o.id] = role
    return y + h
  }
  const rule = (id: string, b: Box, fill: string) => decor.push({ id, kind: 'rule', box: b, fill })

  // ---- frame: masthead band (navy, gold line), section label, footnote with a hairline above it
  const mast = one((o) => o.kind === 'shape' && o.role === 'masthead'), mh = L.frame.masthead?.height ?? 0
  if (mast && L.frame.masthead) {
    boxes[mast.id] = { x: 0, y: 0, w: W, h: mh }
    rule('mast-line', { x: 0, y: mh, w: W, h: L.frame.masthead.rule }, L.color.gold)
  }
  const section = one((o) => o.kind === 'text' && o.role === 'section')
  const ruled = L.frame.chrome === 'rule'
  // band chrome: the section label sits in the masthead; rule chrome: a small tracker above the title
  if (section) setText(section, ruled ? 'tracker' : 'section', M, ruled ? 24 : Math.round((mh - px(L.type.section.pt) * 1.2) / 2), cols(9))
  const source = one((o) => o.kind === 'text' && o.role === 'source')
  let footTop = H - L.frame.bottom
  if (source) {
    const h = height(textOf(source), L.type.footnote, W - 2 * M)
    footTop = H - 18 - h
    boxes[source.id] = { x: M, y: footTop, w: W - 2 * M, h }; sizes[source.id] = L.type.footnote.pt; roles[source.id] = 'footnote'
    rule('foot-line', { x: M, y: footTop - 10, w: W - 2 * M, h: 0.75 }, L.color.hair)
    footTop -= 10
  }
  const top0 = mh + (L.frame.masthead ? 34 : 48)

  const headline = one((o) => o.kind === 'text' && o.role === 'headline')!
  const stand = one((o) => o.kind === 'text' && o.role === 'standfirst')
  const kicker = one((o) => o.kind === 'text' && o.role === 'kicker')
  /** headline (two lines at most, else the smaller headline size) and standfirst, from y within width w */
  const header = (x: number, y: number, w: number, maxLines = 2, standW = w) => {
    if (kicker) y = setText(kicker, 'kicker', x, y, w) + 8
    let role: keyof Language['type'] = 'headline'
    const lines = lineCount(m, L.type.headline.font, textOf(headline), L.type.headline.pt, w, true)
    if (lines > maxLines) role = 'headlineSmall'
    if (lineCount(m, L.type[role].font, textOf(headline), L.type[role].pt, w, true) > maxLines + 1) notes.push('the headline runs long; shorten it')
    y = setText(headline, role, x, y, w)
    if (stand) y = setText(stand, 'standfirst', x, y + 8, standW)
    return y
  }
  const primary = one((o) => o.kind === 'viz' && o.role === 'primary')
  const chartLabel = (o: DesignObject | undefined) => o && one((x) => x.kind === 'text' && x.role === 'label' && x.group === (o as any).group && !!(o as any).group)
  const placeChart = (o: DesignObject, b: Box) => {
    const lab = chartLabel(o)
    if (lab) { const y = setText(lab, 'chartHeading', b.x, b.y, b.w); b = { x: b.x, y: y + 10, w: b.w, h: b.h - (y + 10 - b.y) } }
    boxes[o.id] = b; return b
  }
  const heroes = of((o) => o.kind === 'kpi' && o.variant === 'hero'), stats = of((o) => o.kind === 'kpi' && (o.variant === 'stat' || !o.variant))
  const railNotes = of((o) => o.kind === 'text' && o.role === 'note' && !(o as any).group)

  /** a column of focal figure, gold rule, supporting figures and notes */
  const rail = (x: number, y: number, w: number, bottom: number, onDark = false) => {
    for (const h of heroes) { y = setFigure(h, 'hero', x, y, w) + 14; rule(`rail-rule-${h.id}`, { x, y, w: 44, h: 2 }, L.color.gold); y += 22 }
    for (const s of stats) { y = setFigure(s, 'heroSmall', x, y, w) + 18 }
    // notes sit at the foot of the rail, aligned with the chart's baseline, not under the figures
    let nb = bottom
    for (const n of [...railNotes].reverse()) { const h = height(textOf(n), L.type.bodySmall, w); if (nb - h > y + 12) { setText(n, 'bodySmall', x, nb - h, w); nb -= h + 10 } else notes.push(`${n.id}: no room in the rail`) }
    if (y > bottom) notes.push('the rail is taller than the content area')
    void onDark
    return y
  }

  /** a matrix: cells laid in a grid (relative column widths), an optional header row, hairlines between rows, figures
   *  and text centred vertically, charts filling their cell, badges in the first column */
  const matrix = (objs: DesignObject[], b: Box) => {
    const mp = P.matrix ?? { widths: [1], header: true }, sum = mp.widths.reduce((a, v) => a + v, 0), gap = 18
    const colX: number[] = [], colW: number[] = []
    let ax = b.x
    mp.widths.forEach((wv) => { const cw = ((b.w - gap * (mp.widths.length - 1)) * wv) / sum; colX.push(ax); colW.push(cw); ax += cw + gap })
    const cells = objs.filter((o) => (o as any).cell) as (DesignObject & { cell: { r: number; c: number; badge?: string } })[]
    const R = Math.max(...cells.map((o) => o.cell.r)) + 1
    const roleIn = (o: DesignObject, r: number): keyof Language['type'] => r === 0 && mp.header ? 'cellHead' : o.kind === 'text' && o.accent === 'focus' ? 'cellFigure' : 'cell'
    const textH = (o: DesignObject, r: number, w: number) => o.kind === 'text' ? height(itemsOf(o).map((i) => i.text).join('\n'), L.type[roleIn(o, r)], w, itemsOf(o).length, 3) : o.kind === 'kpi' ? Math.ceil(lineH(L.type.cellFigure)) + height(o.label, L.type.caption, w) + 4 : 0
    const badgeW = (o: DesignObject) => ((o as any).cell?.badge ? 34 : 0)
    const headH = mp.header ? Math.max(0, ...cells.filter((o) => o.cell.r === 0).map((o) => textH(o, 0, colW[o.cell.c]!))) + 10 : 0
    const rows = R - (mp.header ? 1 : 0), rowH = (b.h - headH) / Math.max(1, rows)
    for (const o of cells) {
      const { r, c: ci } = o.cell, x0 = colX[ci]! + badgeW(o), w0 = colW[ci]! - badgeW(o)
      if (r === 0 && mp.header) { const h = textH(o, 0, w0); setText(o, 'cellHead', x0, b.y + headH - 10 - h, w0); continue }
      const top = b.y + headH + (r - (mp.header ? 1 : 0)) * rowH
      if (o.kind === 'viz') { boxes[o.id] = { x: x0, y: top + 12, w: w0, h: rowH - 24 }; continue }
      const h = Math.min(rowH - 8, textH(o, r, w0)), yy = top + (rowH - h) / 2
      if (o.kind === 'kpi') { setFigure(o, 'cellFigure', x0, yy, w0); continue }
      setText(o, roleIn(o, r), x0, yy, w0)
      if (o.cell.badge) decor.push({ id: `badge-${o.id}`, kind: 'badge', box: { x: colX[ci]! + 1, y: top + rowH / 2 - 12, w: 24, h: 24 }, fill: L.color.navy, text: o.cell.badge })
    }
    if (mp.header) rule('matrix-head-rule', { x: b.x, y: b.y + headH - 1, w: b.w, h: 1 }, L.color.ink)
    for (let i = 1; i < rows; i++) rule(`matrix-row-${i}`, { x: b.x, y: b.y + headH + i * rowH, w: b.w, h: 0.75 }, L.color.hair)
  }

  const k = c.kind
  let background: string | undefined
  const railLabel = one((o) => o.kind === 'text' && o.role === 'label' && (o as any).group === 'rail')
  if (k === 'rail' && (P.rail === 'tinted' || P.rail === 'dark')) {
    // R1: a full-height rail panel bleeding to the slide edge; the headline, chart and footnote keep to the chart columns
    const side = P.side ?? 'right', cc = P.chartCols ?? 8, chartW = cols(cc), top = mh + (L.frame.masthead?.rule ?? 0)
    const chartX = side === 'right' ? M : W - M - chartW
    const panel = side === 'right' ? { x: M + chartW + G, y: top, w: W - (M + chartW + G), h: H - top } : { x: 0, y: top, w: W - M - chartW - G, h: H - top }
    decor.push({ id: 'rail-panel', kind: 'rule', box: panel, fill: P.rail === 'dark' ? L.color.navyDeep : L.color.surface })
    if (source) {
      const h = height(textOf(source), L.type.footnote, chartW)
      boxes[source.id] = { x: chartX, y: H - 18 - h, w: chartW, h }
      const fl = decor.find((x) => x.id === 'foot-line'); if (fl) fl.box = { x: chartX, y: H - 18 - h - 10, w: chartW, h: 0.75 }
      footTop = H - 18 - h - 10
    }
    const y0 = header(chartX, top0, chartW, 2) + 30
    if (primary) placeChart(primary, { x: chartX, y: y0, w: chartW, h: footTop - 18 - y0 })
    const inset = 32, rx = panel.x + inset, rw = panel.w - inset - (side === 'right' ? Math.max(inset, M - 16) : inset)
    let ry = top0 + 4
    if (railLabel) ry = setText(railLabel, 'label', rx, ry, rw) + 22
    rail(rx, ry, rw, H - 40)
  } else if (k === 'rail') {
    const side = P.side ?? 'right', cc = P.chartCols ?? 8
    const y0 = header(M, top0, cols(11), 2, cols(9)) + 30
    const chartW = cols(cc), railW = cols(12 - cc) - 8, chartX = side === 'right' ? M : M + railW + G + 8, railX = side === 'right' ? M + chartW + G + 8 : M
    if (primary) placeChart(primary, { x: chartX, y: y0, w: chartW, h: footTop - 18 - y0 })
    if (side === 'right') rule('rail-divider', { x: railX - G / 2 - 4, y: y0 + 4, w: 0.75, h: footTop - 22 - y0 }, L.color.hair)
    let ry = y0 + 2
    if (railLabel) ry = setText(railLabel, 'label', railX, ry, railW) + 16
    rail(railX, ry, railW, footTop - 18)
  } else if (k === 'agenda') {
    // R9: a paper column with "Contents" in the display face; the sections on a navy panel, the current one in gold
    const lw = cols(4), panelX = M + lw + G
    decor.push({ id: 'agenda-panel', kind: 'rule', box: { x: panelX, y: 0, w: W - panelX, h: H }, fill: L.color.navyDeep })
    let y = setText(headline, 'headline', M, 300, lw - 12)
    if (stand) y = setText(stand, 'standfirst', M, y + 10, lw - 12)
    rule('agenda-rule', { x: M, y: 300 - 22, w: 44, h: 2 }, L.color.gold)
    const groups = [...new Set(d.objects.map((o) => (o as any).group).filter((g) => typeof g === 'string' && /^s\d+$/.test(g)))] as string[]
    const step = Math.min(84, (H - 160) / Math.max(1, groups.length)), y0 = (H - step * groups.length) / 2, nx = panelX + 88
    groups.forEach((g, i) => {
      const num = one((o) => o.kind === 'text' && o.role === 'label' && (o as any).group === g), name = one((o) => o.kind === 'text' && o.role !== 'label' && (o as any).group === g)
      const yy = y0 + i * step
      if (num) setText(num, 'navNumber', nx, yy, 64)
      if (name) setText(name, 'navItem', nx + 84, yy + 8, W - nx - 84 - M)
      if (i === (P.current ?? -1)) rule(`agenda-mark-${g}`, { x: panelX, y: yy + 4, w: 6, h: 34 }, L.color.gold)
    })
  } else if (k === 'divider') {
    // R9: a full navy slide; the section numeral in gold, its title in the display face, one line on what it answers
    background = L.color.navyDeep
    const num = one((o) => o.kind === 'text' && o.role === 'label' && !(o as any).group)
    let y = 236
    if (num) y = setText(num, 'hero', M, y, cols(3)) + 14
    rule('divider-rule', { x: M, y, w: 56, h: 2 }, L.color.gold)
    y = setText(headline, 'headline', M, y + 26, cols(8))
    if (stand) setText(stand, 'standfirst', M, y + 12, cols(7))
  } else if (k === 'columns') {
    // Gate E: columns of stacked blocks. Text blocks are measured in their own typefaces; charts and matrices share the
    // height that is left. Exhibit titles get a hairline under them (after their unit line); commentary blocks are
    // separated by hairlines; the conclusion sits under a heavier rule. The layout is the composition's params.
    let y = header(M, top0, cols(11), 2, cols(10)) + 14
    rule('title-rule', { x: M, y, w: W - 2 * M, h: 0.75 }, L.color.ink)
    const y0 = y + 22, bottom = footTop - 12
    const columns = P.columns?.length ? P.columns : [{ span: 12, slots: [...new Set(d.objects.map((o) => (o as any).slot).filter(Boolean))] as string[] }]
    let x = M
    const roleOf = (o: DesignObject): keyof Language['type'] => o.kind !== 'text' ? 'body'
      : o.role === 'exhibit' ? 'exhibit' : o.role === 'unit' ? 'unit' : o.role === 'lead' ? 'lead' : o.role === 'conclusion' ? 'conclusion' : o.role === 'label' ? 'label' : o.role === 'note' ? 'bodySmall' : 'body'
    const GAP = 16
    for (const col of columns) {
      const w = cols(col.span), cx = x
      x += w + G
      const last = col === columns[columns.length - 1]
      if (col.tint) {
        decor.push({ id: `col-tint-${cx}`, kind: 'rule', box: { x: cx - 22, y: y0 - 16, w: last ? W - (cx - 22) : w + 44, h: last ? H - (y0 - 16) : bottom - y0 + 28 }, fill: L.color.surface })
        if (last && source) {
          const sw = cx - 22 - 24 - M, h = height(textOf(source), L.type.footnote, sw)
          boxes[source.id] = { x: M, y: H - 18 - h, w: sw, h }
          const fl = decor.find((x) => x.id === 'foot-line'); if (fl) fl.box = { x: M, y: H - 18 - h - 10, w: sw, h: 0.75 }
        }
      }
      const ox = col.tint ? cx : cx, ow = w
      const objs = col.slots.flatMap((sl) => d.objects.filter((o) => (o as any).slot === sl))
      // measure: fixed heights, and which blocks fill
      const isMatrix = (o: DesignObject) => !!(o as any).cell
      const items: { o: DesignObject[]; h: number; fill: boolean; slot: string }[] = []
      for (const sl of col.slots) {
        const so = d.objects.filter((o) => (o as any).slot === sl)
        if (!so.length) continue
        if (so.some(isMatrix)) { items.push({ o: so, h: 0, fill: true, slot: sl }); continue }
        for (const o of so) {
          if (o.kind === 'viz') items.push({ o: [o], h: 0, fill: true, slot: sl })
          else if (o.kind === 'kpi') items.push({ o: [o], h: Math.ceil(lineH(L.type[o.variant === 'hero' ? 'hero' : 'heroSmall']) * 1.04) + 8 + height(o.label, L.type.caption, ow) + (o.context ? height(o.context.text, L.type.bodySmall, ow) + 4 : 0), fill: false, slot: sl })
          else if (o.kind === 'text') {
            const items0 = itemsOf(o), t = L.type[roleOf(o)], lead = items0[0]?.lead ? items0[0].lead + ' ' : ''
            const extra = o.role === 'exhibit' || o.role === 'conclusion' ? 12 : 0
            const tb = lead ? { ...t, bold: true } : t // a bold lead-in widens the first line: measure the block bold
            items.push({ o: [o], h: height(lead + items0.map((i) => i.text).join('\n'), tb, ow, items0.length, 6) + extra, fill: false, slot: sl })
          }
        }
      }
      const step = (i: number) => { const o = items[i]!.o[0]!, n = items[i + 1]?.o[0]; return o.kind === 'text' && o.role === 'exhibit' && n?.kind === 'text' && n.role === 'unit' ? 4 : GAP }
      const fixed = items.reduce((a, it) => a + it.h, 0) + items.slice(0, -1).reduce((a, _, i) => a + step(i), 0)
      const fills = items.filter((it) => it.fill).length
      const share = fills ? Math.max(60, (bottom - y0 - fixed) / fills) : 0
      if (!fills && y0 + fixed > bottom) notes.push(`column ${cx}: the blocks are taller than the slide`)
      const leads = items.filter((it) => it.o[0]!.kind === 'text' && (it.o[0] as any).role === 'lead').length
      const spare = fills ? 0 : Math.max(0, bottom - y0 - fixed), extraGap = leads > 1 ? Math.min(64, (spare * 0.8) / (leads - 1)) : 0
      let cy = y0
      items.forEach((it, i) => {
        const prev = items[i - 1]?.o[0], o = it.o[0]!
        // hairline between consecutive commentary blocks; heavier rule above the conclusion
        if (o.kind === 'text' && o.role === 'lead' && prev?.kind === 'text' && prev.role === 'lead') cy += extraGap
        if (o.kind === 'text' && o.role === 'lead' && prev?.kind === 'text' && prev.role === 'lead') rule(`lead-rule-${o.id}`, { x: ox, y: cy - (GAP + extraGap) / 2 - 0.5, w: ow, h: 0.75 }, L.color.hair)
        // with nothing to fill, the conclusion sits at the foot of its column, level with its neighbour's last row
        if (o.kind === 'text' && o.role === 'conclusion' && !fills && i === items.length - 1) cy = Math.max(cy, bottom - it.h)
        if (o.kind === 'text' && o.role === 'conclusion') { rule(`concl-rule-${o.id}`, { x: ox, y: cy, w: ow, h: 1.5 }, L.color.ink); cy += 10 }
        if (it.fill && it.o.some(isMatrix)) { matrix(it.o, { x: ox, y: cy, w: ow, h: share }); cy += share }
        else if (it.fill) { placeChart(o, { x: ox, y: cy, w: ow, h: share }); cy += share }
        else if (o.kind === 'kpi') { cy = setFigure(o, o.variant === 'hero' ? 'hero' : 'heroSmall', ox, cy, ow) }
        else if (o.kind === 'text') {
          cy = setText(o, roleOf(o), ox, cy, ow)
          if (o.kind === 'text' && o.role === 'conclusion') cy += 2
          // the exhibit's hairline goes under its unit line when one follows, else under the exhibit title
          const next = items[i + 1]?.o[0]
          if ((o.role === 'exhibit' && !(next?.kind === 'text' && next.role === 'unit')) || (o.role === 'unit' && prev?.kind === 'text' && prev.role === 'exhibit')) { rule(`ex-rule-${o.id}`, { x: ox, y: cy + 6, w: ow, h: 0.75 }, L.color.ink); cy += 12 }
        }
        cy += step(i)
      })
      if (cy - GAP > bottom + 2) notes.push(`column ${cx}: content runs past the foot of the slide`)
    }
  } else if (k === 'statement') {
    // the message carries the slide: a tall headline column, the chart beside it at full height
    const tc = 5, textW = cols(tc), chartX = M + textW + G + 24, chartW = W - M - chartX
    let y = header(M, top0 + 6, textW, 4) + 26
    for (const s of stats) { rule(`stat-rule-${s.id}`, { x: M, y, w: textW, h: 0.75 }, L.color.hair); y = setFigure(s, 'heroSmall', M, y + 14, textW) + 8 }
    for (const n of railNotes) y = setText(n, 'bodySmall', M, y + 6, textW) + 6
    if (y > footTop - 14) notes.push('the statement column is taller than the slide')
    if (primary) placeChart(primary, { x: chartX, y: top0 + 6, w: chartW, h: footTop - 18 - (top0 + 6) })
  } else if (k === 'wide') {
    // headline at left, the focal figure beside it, the chart across the full width below
    const hw = heroes.length ? cols(8) : cols(11)
    let y = header(M, top0, hw, 2)
    if (heroes[0]) { const fy = setFigure(heroes[0], 'heroMid', M + cols(9) + G, top0 + 4, cols(3)); y = Math.max(y, fy) }
    y += 26
    let bottom = footTop - 18
    if (railNotes.length) { const n = railNotes[0]!, h = height(textOf(n), L.type.bodySmall, cols(12)); boxes[n.id] = { x: M, y: bottom - h, w: cols(12), h }; sizes[n.id] = L.type.bodySmall.pt; roles[n.id] = 'bodySmall'; bottom -= h + 14 }
    if (primary) placeChart(primary, { x: M, y, w: cols(12), h: bottom - y })
  } else if (k === 'bands') {
    // one band per pressure: figure, explanation, small evidence chart; the first band can lead
    let y = header(M, top0, cols(11), 2, cols(10)) + 22
    const groups = [...new Set(d.objects.map((o) => (o as any).group).filter(Boolean))] as string[]
    const avail = footTop - 14 - y, weights = groups.map((_, i) => (P.emphasis === 'first' && i === 0 ? 1.3 : 1)), sum = weights.reduce((a, b) => a + b, 0)
    groups.forEach((gname, i) => {
      const bh = (avail * weights[i]!) / sum, by = y
      rule(`band-rule-${gname}`, { x: M, y: by, w: cols(12), h: i === 0 ? 1.5 : 0.75 }, i === 0 ? L.color.navy : L.color.hair)
      const fig = one((o) => o.kind === 'kpi' && (o as any).group === gname), lab = one((o) => o.kind === 'text' && o.role === 'label' && (o as any).group === gname)
      const body = one((o) => o.kind === 'text' && (o.role === 'body' || o.role === 'note') && (o as any).group === gname), spark = one((o) => o.kind === 'viz' && (o as any).group === gname)
      const lead = i === 0 && P.emphasis === 'first'
      if (lab) setText(lab, 'label', M, by + 14, cols(3))
      if (fig) setFigure(fig, lead ? 'heroMid' : 'heroSmall', M, by + 32, cols(3))
      if (body) setText(body, 'body', M + cols(3) + G, by + 36, cols(4))
      if (spark) boxes[spark.id] = { x: M + cols(7) + G + 24, y: by + 16, w: cols(5) - 24, h: bh - 30 }
      y += bh
    })
  } else if (k === 'lead_panel') {
    // the lead message and its chart on the paper; supporting pressures on a dark panel to the right
    const panel = one((o) => o.kind === 'shape' && o.role === 'panel')
    const lw = cols(7) + 20, px0 = M + lw + G + 16
    if (panel) boxes[panel.id] = { x: px0, y: mh + (L.frame.masthead?.rule ?? 0), w: W - px0, h: H - mh - (L.frame.masthead?.rule ?? 0) }
    let y = header(M, top0, lw, 3) + 26
    if (primary) placeChart(primary, { x: M, y, w: lw, h: footTop - 18 - y })
    let py = top0 + 4, pw = W - px0 - 2 * 40, pxx = px0 + 40
    const plabel = one((o) => o.kind === 'text' && o.role === 'label' && !(o as any).group && o.tone === 'onDark')
    if (plabel) py = setText(plabel, 'label', pxx, py, pw) + 18
    // each supporting figure centred in an equal share of the panel's height
    const slotTop = py, slot = (H - 48 - slotTop) / Math.max(1, stats.length)
    for (const [k, s] of stats.entries()) {
      const note = one((o) => o.kind === 'text' && o.role === 'note' && (o as any).group === (s as any).group && !!(s as any).group)
      const est = 120 + (note ? height(textOf(note), L.type.bodySmall, pw) : 0)
      py = Math.max(py, slotTop + k * slot + Math.max(0, (slot - est) / 2))
      py = setFigure(s, 'heroMid', pxx, py, pw)
      if (note) py = setText(note, 'bodySmall', pxx, py + 2, pw)
      rule(`panel-rule-${s.id}`, { x: pxx, y: py + 18, w: 36, h: 2 }, L.color.goldSoft); py += 40
    }
    if (py > H - 40) notes.push('the panel content is taller than the slide')
    // the footnote stays on the paper side
    if (source) { boxes[source.id] = { ...boxes[source.id]!, w: lw }; const h = height(textOf(source), L.type.footnote, lw); boxes[source.id]!.h = h; boxes[source.id]!.y = H - 18 - h }
    const fl = decor.find((x) => x.id === 'foot-line'); if (fl && source) { fl.box.w = lw; fl.box.y = boxes[source.id]!.y - 10 }
  }
  for (const o of d.objects) if (!boxes[o.id]) notes.push(`${o.id} has no place in a ${k} composition`)
  const content: Box = { x: M, y: top0, w: W - 2 * M, h: footTop - top0 }
  return { boxes, sizes, roles, language: L, decor, notes, ...(background ? { background } : {}), zones: { header: { x: 0, y: 0, w: W, h: top0 }, content, footer: { x: M, y: footTop, w: W - 2 * M, h: H - footTop } } }
}
