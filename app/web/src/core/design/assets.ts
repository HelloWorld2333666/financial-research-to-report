// Visual assets for compositions: photographs, logos, flags, icons and maps.
//
// Assets come from the server's asset library (app/server/assets.py): allowlisted public sources whose licence is
// known, cached locally with provenance. A design names them by key ("flag:bh", "icon:ship", "commons:<File>",
// "geo:countries-50m"); `prepareAssets` loads them once, after which layout and build use them synchronously:
//   pictures   photographs, logos and flags become picture elements, cropped and treated (duotone, fades) to their box
//   icons      line icons become editable vector shapes (DrawingML paths), stroked in the visual language's colours
//   maps       country geometry becomes editable filled shapes per country, with routes, chokepoints and place names
// No picture carries a figure: every number on a slide stays a text object bound to evidence.
import type { Mark } from '../composite'
import type { Language } from './language'

export interface AssetMeta { key: string; kind: string; license: string; attribution: string; source_url: string; media_type: string; description?: string }
interface Loaded { meta: AssetMeta; img?: HTMLImageElement; svg?: string; json?: any }
export const ASSETS = new Map<string, Loaded>()
/** flag keys from statistical codes (Eurostat: EL, UK) become ISO keys, so plans can use the data's own geo codes */
export const normKey = (k: string) => k.replace(/^flag:el$/i, 'flag:gr').replace(/^flag:uk$/i, 'flag:gb').replace(/^flag:([A-Z]{2})$/, (_m, c: string) => `flag:${c.toLowerCase()}`)
export const hasAsset = (key: string) => ASSETS.has(normKey(key))
export const assetMeta = (key: string) => ASSETS.get(key)?.meta

type Pt = [number, number]
interface Box { x: number; y: number; w: number; h: number }

/** An SVG with only a viewBox gets an explicit size, so the browser rasterizes it sharply and in proportion. */
function sizedSvg(svg: string, scale = 4): string {
  const vb = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/.exec(svg)
  if (!vb) return svg
  const w = Number(vb[3]) * scale, h = Number(vb[4]) * scale
  return svg.replace(/<svg\b([^>]*)>/, (_m, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="${Math.round(w)}" height="${Math.round(h)}">`)
}
const decode = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image could not be decoded')); im.src = src })

/** Load assets by key (once). Returns the keys that could not be loaded, with the reason. */
export async function prepareAssets(keys: string[]): Promise<string[]> {
  const errs: string[] = []
  await Promise.all([...new Set(keys.map(normKey))].filter((k) => !ASSETS.has(k)).map(async (k) => {
    try {
      const r = await fetch(`/api/assets?key=${encodeURIComponent(k)}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error ?? `HTTP ${r.status}`)
      const meta = JSON.parse(decodeURIComponent(r.headers.get('X-Asset-Meta') ?? '%7B%7D')) as AssetMeta
      const L: Loaded = { meta }
      if (meta.media_type === 'application/json') L.json = await r.json()
      else if (meta.media_type === 'image/svg+xml') {
        L.svg = await r.text()
        if (meta.kind !== 'icon') L.img = await decode('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sizedSvg(L.svg)))
      } else L.img = await decode(URL.createObjectURL(await r.blob()))
      ASSETS.set(k, L)
    } catch (e: any) { errs.push(`${k}: ${e?.message ?? e}`) }
  }))
  return errs
}

/** The assets a plan or design refers to (images, maps, flags and icons in cells, nodes and marks, flags in charts). */
export function assetKeys(objects: any[], geoOf: (ds: string) => string | undefined = () => undefined): string[] {
  const out = new Set<string>()
  for (const o of objects ?? []) {
    if (o.kind === 'image' && o.asset) out.add(o.asset)
    if (o.kind === 'map') { out.add('geo:countries-50m'); for (const p of o.map?.points ?? []) if (p.icon) out.add(`icon:${p.icon}`) }
    if (o.mark) out.add(o.mark)
    if (o.cell?.flag) out.add(`flag:${String(o.cell.flag).toLowerCase()}`)
    if (o.cell?.icon) out.add(`icon:${o.cell.icon}`)
    if (o.cell?.logo) out.add(o.cell.logo)
    if (o.node?.icon) out.add(`icon:${o.node.icon}`)
    if (o.draw?.flags) for (const ds of [...(o.request?.datasets ?? []), ...vizDs(o.viz)]) { const g = geoOf(ds); if (g) out.add(`flag:${g.toLowerCase()}`) }
  }
  return [...out]
}
const vizDs = (v: any): string[] => (v ? JSON.stringify(v).match(/ds\.[a-z0-9_.]+/g) ?? [] : [])

/** One line crediting the photographs and logos used (public-domain and CC-licensed files are credited by name). */
export function credits(keys: string[]): string {
  const loaded = keys.filter((k) => k.startsWith('commons:')).map((k) => ASSETS.get(k)).filter(Boolean)
  const who = (m: AssetMeta) => m.attribution.replace(/ \/ Wikimedia Commons \(.*\)$/, '').replace(/^(Unknown author)+$/, '').trim()
  const photos = [...new Set(loaded.filter((a) => !a!.svg).map((a) => `photograph: ${who(a!.meta) || 'unattributed'} (${a!.meta.license.toLowerCase()}, via Wikimedia Commons)`))]
  const logos = loaded.filter((a) => !!a!.svg), lic = [...new Set(logos.map((a) => a!.meta.license.toLowerCase()))].join(', ')
  return [...photos, ...(logos.length ? [`logos: Wikimedia Commons (${lic})`] : []), ...(keys.some((k) => k.startsWith('geo:')) ? ['map: Natural Earth (public domain)'] : [])].join('; ')
}
export const provenance = (key: string) => { const m = ASSETS.get(key)?.meta; return m ? `${key} · ${m.attribution} · licence: ${m.license} · ${m.source_url}` : key }

// ------------------------------------------------------------------ pictures
export type Treatment = 'duotone' | 'fade-left' | 'fade-right' | 'fade-bottom' | 'edge-left' | 'tint' | 'darken'
export interface PictureOpts { fit?: 'cover' | 'contain'; focus?: Pt; treatment?: Treatment[]; scale?: number; L?: Language }
function mixHex(a: string, b: string, t: number) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, '0')).join('') }
const hexRgb = (h: string): [number, number, number] => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number] }

/** A picture for a box: cropped (cover) or fitted (contain), treated in the language's colours, as a data URL. */
export function picture(key: string, w: number, h: number, o: PictureOpts = {}): { dataUrl: string; w: number; h: number; descr: string } | null {
  key = normKey(key)
  const a = ASSETS.get(key)
  if (!a?.img || typeof document === 'undefined' || w < 1 || h < 1) return null
  const im = a.img
  let sx0 = 0, sy0 = 0, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height
  if (a.meta.kind === 'commons' && a.svg) { // a logo: its transparent margins trimmed, so logos of different files read at one size
    const t = document.createElement('canvas'); t.width = iw; t.height = ih
    const tg = t.getContext('2d', { willReadFrequently: true })!; tg.drawImage(im, 0, 0, iw, ih)
    const px = tg.getImageData(0, 0, iw, ih).data
    let x0 = iw, y0 = ih, x1 = -1, y1 = -1
    for (let y = 0; y < ih; y += 2) for (let x = 0; x < iw; x += 2) if (px[(y * iw + x) * 4 + 3]! > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 > x0 && y1 > y0) { sx0 = Math.max(0, x0 - 2); sy0 = Math.max(0, y0 - 2); iw = Math.min(iw - sx0, x1 - x0 + 5); ih = Math.min(ih - sy0, y1 - y0 + 5) }
  }
  const contain = (o.fit ?? (a.meta.kind === 'commons' && !a.svg ? 'cover' : 'contain')) === 'contain'
  let dw = w, dh = h
  if (contain) { const k = Math.min(w / iw, h / ih); dw = iw * k; dh = ih * k }
  const s = Math.min(o.scale ?? 2, 2600 / Math.max(dw, dh)), cw = Math.max(1, Math.round(dw * s)), ch = Math.max(1, Math.round(dh * s))
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch
  const g = cv.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  if (contain) g.drawImage(im, sx0, sy0, iw, ih, 0, 0, cw, ch)
  else { // cover: the largest source rectangle of the box's proportion, centred on the focus point
    const k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k, [fx, fy] = o.focus ?? [0.5, 0.5]
    const sx = Math.min(Math.max(0, fx * iw - sw / 2), iw - sw), sy = Math.min(Math.max(0, fy * ih - sh / 2), ih - sh)
    g.drawImage(im, sx, sy, sw, sh, 0, 0, cw, ch)
  }
  const L = o.L, T = o.treatment ?? []
  if (L && T.includes('duotone')) { // luminance mapped from the deep panel colour to a pale tint of the structure colour
    const d = g.getImageData(0, 0, cw, ch), A = hexRgb(L.color.navyDeep), B = hexRgb('#E6F0F4')
    for (let i = 0; i < d.data.length; i += 4) {
      const y = (0.2126 * d.data[i]! + 0.7152 * d.data[i + 1]! + 0.0722 * d.data[i + 2]!) / 255, t = Math.pow(y, 0.9)
      d.data[i] = A[0] + (B[0] - A[0]) * t; d.data[i + 1] = A[1] + (B[1] - A[1]) * t; d.data[i + 2] = A[2] + (B[2] - A[2]) * t
    }
    g.putImageData(d, 0, 0)
  }
  if (L && T.includes('tint')) { g.globalAlpha = 0.28; g.fillStyle = L.color.navy; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1 }
  if (L && T.includes('darken')) { g.globalAlpha = 0.35; g.fillStyle = '#000000'; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1 }
  for (const side of ['left', 'right', 'bottom'] as const) if (L && T.includes(`fade-${side}`)) {
    // the deep panel colour fading into the picture: text set over the faded side stays legible
    const [r, gg, b] = hexRgb(L.color.navyDeep)
    const gr = side === 'bottom' ? g.createLinearGradient(0, ch, 0, ch * 0.35) : side === 'left' ? g.createLinearGradient(0, 0, cw * 0.72, 0) : g.createLinearGradient(cw, 0, cw * 0.28, 0)
    gr.addColorStop(0, `rgba(${r},${gg},${b},0.97)`); gr.addColorStop(0.45, `rgba(${r},${gg},${b},0.82)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch)
  }
  if (L && T.includes('edge-left')) { // a short blend from the deep panel colour: the picture meets the title field without a seam
    const [r, gg, b] = hexRgb(L.color.navyDeep), gr = g.createLinearGradient(0, 0, cw * 0.28, 0)
    gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch)
  }
  const jpeg = a.meta.media_type === 'image/jpeg' && !a.svg
  return { dataUrl: cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), w: dw, h: dh, descr: provenance(key) }
}

// ------------------------------------------------------------------ icons (SVG line icons → editable vector paths)
/** Flatten an SVG path's d attribute into polylines (absolute coordinates). Curves and arcs are sampled. */
export function flattenPath(d: string, steps = 10): Pt[][] {
  const tok = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? []
  const runs: Pt[][] = []
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], run: Pt[] = [], lastC: Pt | null = null, lastQ: Pt | null = null
  const num = () => Number(tok[i++])
  const flush = () => { if (run.length > 1) runs.push(run); run = [] }
  const to = (p: Pt) => { run.push(p); cur = p }
  const cubic = (p1: Pt, p2: Pt, p: Pt) => { const p0 = cur; for (let k = 1; k <= steps; k++) { const t = k / steps, u = 1 - t; to([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p[1]]) } }
  const quad = (p1: Pt, p: Pt) => { const p0 = cur; for (let k = 1; k <= steps; k++) { const t = k / steps, u = 1 - t; to([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p[1]]) } }
  const arc = (rx: number, ry: number, phi: number, fa: number, fs: number, p: Pt) => {
    const [x1, y1] = cur, [x2, y2] = p
    if (!rx || !ry || (x1 === x2 && y1 === y2)) { to(p); return }
    rx = Math.abs(rx); ry = Math.abs(ry)
    const f = (phi * Math.PI) / 180, cf = Math.cos(f), sf = Math.sin(f)
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cf * dx + sf * dy, yp = -sf * dx + cf * dy
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
    const sgn = fa === fs ? -1 : 1, num0 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    const co = sgn * Math.sqrt(Math.max(0, num0 / (rx * rx * yp * yp + ry * ry * xp * xp)))
    const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx
    const cx = cf * cxp - sf * cyp + (x1 + x2) / 2, cy = sf * cxp + cf * cyp + (y1 + y2) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a }
    const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI
    const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * steps))
    for (let k = 1; k <= n; k++) { const t = t1 + (dt * k) / n; to([cx + rx * Math.cos(t) * cf - ry * Math.sin(t) * sf, cy + rx * Math.cos(t) * sf + ry * Math.sin(t) * cf]) }
  }
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i]!)) cmd = tok[i++]!
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), o = (p: Pt): Pt => (rel ? [cur[0] + p[0], cur[1] + p[1]] : p)
    let nc: Pt | null = null, nq: Pt | null = null
    if (C === 'M') { flush(); const p = o([num(), num()]); start = p; to(p); cmd = rel ? 'l' : 'L' }
    else if (C === 'L') to(o([num(), num()]))
    else if (C === 'H') { const x = num(); to([rel ? cur[0] + x : x, cur[1]]) }
    else if (C === 'V') { const y = num(); to([cur[0], rel ? cur[1] + y : y]) }
    else if (C === 'C') { const p1 = o([num(), num()]), p2 = o([num(), num()]), p = o([num(), num()]); cubic(p1, p2, p); nc = p2 }
    else if (C === 'S') { const p1: Pt = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur, p2 = o([num(), num()]), p = o([num(), num()]); cubic(p1, p2, p); nc = p2 }
    else if (C === 'Q') { const p1 = o([num(), num()]), p = o([num(), num()]); quad(p1, p); nq = p1 }
    else if (C === 'T') { const p1: Pt = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur, p = o([num(), num()]); quad(p1, p); nq = p1 }
    else if (C === 'A') { const rx = num(), ry = num(), phi = num(), fa = num(), fs = num(), p = o([num(), num()]); arc(rx, ry, phi, fa, fs, p) }
    else if (C === 'Z') { to(start); flush(); run = [start]; cur = start }
    else i++ // unknown token: skip
    lastC = nc; lastQ = nq
  }
  flush()
  return runs
}
const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const ring = (cx: number, cy: number, rx: number, ry: number, n = 28): Pt[] => Array.from({ length: n + 1 }, (_, k) => [cx + rx * Math.cos((2 * Math.PI * k) / n), cy + ry * Math.sin((2 * Math.PI * k) / n)] as Pt)

/** An SVG line icon (24 x 24, stroked, e.g. Lucide) as polylines in its own coordinates. */
export function iconRuns(svg: string): Pt[][] {
  const out: Pt[][] = []
  for (const m of svg.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)\/?>/g)) {
    const a = attrs(m[2]!), n = (k: string) => Number(a[k] ?? 0)
    if (m[1] === 'path') out.push(...flattenPath(a.d ?? '', 6))
    else if (m[1] === 'circle') out.push(ring(n('cx'), n('cy'), n('r'), n('r')))
    else if (m[1] === 'ellipse') out.push(ring(n('cx'), n('cy'), n('rx'), n('ry')))
    else if (m[1] === 'line') out.push([[n('x1'), n('y1')], [n('x2'), n('y2')]])
    else if (m[1] === 'rect') {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height'), r = Math.min(n('rx') || n('ry'), w / 2, h / 2)
      if (!r) out.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]])
      else out.push(flattenPath(`M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`, 6)[0]!)
    } else {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number), run: Pt[] = []
      for (let k = 0; k + 1 < pts.length; k += 2) run.push([pts[k]!, pts[k + 1]!])
      if (m[1] === 'polygon' && run.length) run.push(run[0]!)
      out.push(run)
    }
  }
  return out.filter((r) => r.length > 1)
}

const bboxOf = (runs: Pt[][]): Box => {
  const xs = runs.flat().map((q) => q[0]), ys = runs.flat().map((q) => q[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(0.5, Math.max(...xs) - x), h: Math.max(0.5, Math.max(...ys) - y) }
}

/** An icon as one editable vector shape at `box` (a square), stroked in `color`. Null when the icon is not loaded. */
export function iconMarks(key: string, box: Box, color: string, weight = 1.9): Mark[] | null {
  const svg = ASSETS.get(key)?.svg
  if (!svg) return null
  const k = Math.min(box.w, box.h) / 24, ox = box.x + (box.w - 24 * k) / 2, oy = box.y + (box.h - 24 * k) / 2
  const runs = iconRuns(svg).map((r) => r.map(([x, y]) => [ox + x * k, oy + y * k] as Pt))
  if (!runs.length) return null
  return [{ name: `frr-icon ${key.slice(5)}`, kind: 'path', paths: runs, box: bboxOf(runs), stroke: color, width: weight * k, descr: provenance(key) } as Mark]
}

// ------------------------------------------------------------------ maps (Natural Earth country geometry → editable shapes)
export type Tone = 'focus' | 'strong' | 'mid' | 'soft' | 'context'
export interface MapSpec {
  /** the visible area: [west, south, east, north] in degrees; the map covers its box (the view is cropped, not distorted) */
  view: [number, number, number, number]
  theme?: 'light' | 'dark'
  /** countries shaded by a tone (an assessment tier or a highlighted group), by ISO 3166 alpha-2 code */
  regions?: { geo: string; tone: Tone }[]
  /** chokepoints, ports or places: a marker and an optional name (words only) */
  points?: { id: string; lon: number; lat: number; label?: string; kind?: 'chokepoint' | 'place'; side?: 'left' | 'right' | 'above' | 'below' }[]
  /** routes through waypoints: a main route, a disrupted one (dashed, accent) or a diversion (dashed, light) */
  routes?: { id: string; path: [number, number][]; style?: 'main' | 'disrupted' | 'diverted' }[]
  /** place names (countries, seas): words only */
  labels?: { lon: number; lat: number; text: string; kind?: 'country' | 'sea' }[]
  /** a key for the tones used: words only */
  legend?: { tone: Tone | 'disrupted' | 'diverted' | 'main'; text: string }[]
  /** the corner the key sits in (default lower left): put it over open sea or empty land */
  legendAt?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
}
// ISO 3166-1 numeric (the world-atlas feature ids) → alpha-2, every country in the geometry
const ISO: Record<string, string> = Object.fromEntries('004AF 008AL 010AQ 012DZ 016AS 020AD 024AO 028AG 031AZ 032AR 036AU 040AT 044BS 048BH 050BD 051AM 052BB 056BE 060BM 064BT 068BO 070BA 072BW 076BR 084BZ 086IO 090SB 092VG 096BN 100BG 104MM 108BI 112BY 116KH 120CM 124CA 132CV 136KY 140CF 144LK 148TD 152CL 156CN 158TW 170CO 174KM 178CG 180CD 184CK 188CR 191HR 192CU 196CY 203CZ 204BJ 208DK 212DM 214DO 218EC 222SV 226GQ 231ET 232ER 233EE 234FO 238FK 239GS 242FJ 246FI 248AX 250FR 258PF 260TF 262DJ 266GA 268GE 270GM 275PS 276DE 288GH 296KI 300GR 304GL 308GD 316GU 320GT 324GN 328GY 332HT 334HM 336VA 340HN 344HK 348HU 352IS 356IN 360ID 364IR 368IQ 372IE 376IL 380IT 384CI 388JM 392JP 398KZ 400JO 404KE 408KP 410KR 414KW 417KG 418LA 422LB 426LS 428LV 430LR 434LY 438LI 440LT 442LU 446MO 450MG 454MW 458MY 462MV 466ML 470MT 478MR 480MU 484MX 492MC 496MN 498MD 499ME 500MS 504MA 508MZ 512OM 516NA 520NR 524NP 528NL 531CW 533AW 534SX 540NC 548VU 554NZ 558NI 562NE 566NG 570NU 574NF 578NO 580MP 583FM 584MH 585PW 586PK 591PA 598PG 600PY 604PE 608PH 612PN 616PL 620PT 624GW 626TL 630PR 634QA 642RO 643RU 646RW 652BL 654SH 659KN 660AI 662LC 663MF 666PM 670VC 674SM 678ST 682SA 686SN 688RS 690SC 694SL 702SG 703SK 704VN 705SI 706SO 710ZA 716ZW 724ES 728SS 729SD 732EH 740SR 748SZ 752SE 756CH 760SY 762TJ 764TH 768TG 776TO 780TT 784AE 788TN 792TR 795TM 796TC 800UG 804UA 807MK 818EG 826GB 831GG 832JE 833IM 834TZ 840US 850VI 854BF 858UY 860UZ 862VE 876WF 882WS 887YE 894ZM'.split(' ').map((x) => [x.slice(0, 3), x.slice(3)]))
/** statistical codes that differ from ISO alpha-2 (Eurostat writes Greece EL and the UK UK) */
const ALIAS: Record<string, string> = { EL: 'GR', UK: 'GB' }

/** The map's projection for a box: equirectangular, scaled by the cosine of the middle latitude, covering the box. */
export function projector(view: MapSpec['view'], box: Box) {
  const [w0, s0, e0, n0] = view, k = Math.cos((((s0 + n0) / 2) * Math.PI) / 180)
  const vw = (e0 - w0) * k, vh = n0 - s0, sc = Math.max(box.w / vw, box.h / vh)
  const ox = box.x + (box.w - vw * sc) / 2, oy = box.y + (box.h - vh * sc) / 2
  return (lon: number, lat: number): Pt => [ox + (lon - w0) * k * sc, oy + (n0 - lat) * sc]
}

function decodeTopo(topo: any): { id: string; name: string; rings: Pt[][] }[] {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate
  const arcs: Pt[][] = topo.arcs.map((a: number[][]) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx!; y += dy!; return [x * sx + tx, y * sy + ty] as Pt }) })
  const arc = (i: number) => (i < 0 ? [...arcs[~i]!].reverse() : arcs[i]!)
  const ringOf = (ids: number[]) => { const out: Pt[] = []; ids.forEach((i, k) => { const a = arc(i); out.push(...(k ? a.slice(1) : a)) }); return out }
  return topo.objects.countries.geometries.map((g: any) => ({ id: String(g.id ?? ''), name: g.properties?.name ?? '',
    rings: g.type === 'Polygon' ? g.arcs.map(ringOf) : g.type === 'MultiPolygon' ? g.arcs.flatMap((p: number[][]) => p.map(ringOf)) : [] }))
}
let GEO: ReturnType<typeof decodeTopo> | null = null

/** Sutherland–Hodgman: a closed ring clipped to a rectangle. */
function clip(ring: Pt[], b: Box): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, c: Pt) => Pt][] = [
    [(p) => p[0] >= b.x, (a, c) => [b.x, a[1] + ((c[1] - a[1]) * (b.x - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.x + b.w, (a, c) => [b.x + b.w, a[1] + ((c[1] - a[1]) * (b.x + b.w - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.y, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y - a[1])) / (c[1] - a[1]), b.y]],
    [(p) => p[1] <= b.y + b.h, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y + b.h - a[1])) / (c[1] - a[1]), b.y + b.h]],
  ]
  let out = ring
  for (const [inside, cut] of edges) {
    const src = out; out = []
    for (let i = 0; i < src.length; i++) {
      const p = src[i]!, q = src[(i + 1) % src.length]!
      if (inside(q)) { if (!inside(p)) out.push(cut(p, q)); out.push(q) } else if (inside(p)) out.push(cut(p, q))
    }
    if (!out.length) break
  }
  return out
}
const thin = (r: Pt[], tol: number) => { const out: Pt[] = []; for (const p of r) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= tol) out.push(p) } return out }
/** Catmull-Rom through the waypoints: a route reads as a sea lane, not a polyline. */
const smooth = (pts: Pt[], n = 8): Pt[] => {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]!]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!
    for (let k = 1; k <= n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]) }
  }
  return out
}

/** Map colours from the visual language: paper land and a pale sea (light), or the deep panel colour (dark). */
export function mapColors(L: Language, theme: 'light' | 'dark' = 'light') {
  const dark = theme === 'dark'
  return {
    sea: dark ? L.color.navyDeep : '#E4ECF0', land: dark ? mixHex(L.color.navyDeep, '#FFFFFF', 0.12) : '#FFFFFF', border: dark ? mixHex(L.color.navyDeep, '#FFFFFF', 0.25) : '#BCC8CF', label: dark ? L.color.onDarkMuted : L.color.muted,
    sea_label: dark ? '#6F9AB0' : '#7E98A6',
    // a ramp of the structure colour: the focus group darkest, context barely tinted (large countries stay light enough to read over)
    tone: { focus: dark ? '#FFFFFF' : L.color.navy, strong: dark ? L.color.goldSoft : L.color.gold, mid: dark ? '#6E9DB3' : '#8DB1C2', soft: dark ? '#2F6A86' : '#CADDE6', context: dark ? '#1C536E' : '#F1F3F4' } as Record<Tone, string>,
    route: dark ? '#FFFFFF' : L.color.navyDeep, disrupted: (L as any).alert ?? '#B4232F', diverted: dark ? L.color.goldSoft : L.color.gold, point: dark ? '#FFFFFF' : L.color.navyDeep,
  }
}

/** A map as editable shapes: sea, one filled shape per country (tone by region), routes, markers and names. */
export function mapMarks(spec: MapSpec, box: Box, L: Language): Mark[] | null {
  const topo = ASSETS.get('geo:countries-50m')?.json
  if (!topo) return null
  GEO ??= decodeTopo(topo)
  const P = projector(spec.view, box), C = mapColors(L, spec.theme), tone = new Map((spec.regions ?? []).map((r) => [ALIAS[r.geo.toUpperCase()] ?? r.geo.toUpperCase(), r.tone]))
  const out: Mark[] = [{ name: 'frr-map sea', kind: 'rect', box, fill: C.sea } as Mark]
  const pad: Box = { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }
  for (const c of GEO) {
    const iso = ISO[c.id] ?? '', t = tone.get(iso)
    // a ring crossing the 180th meridian (Fiji, Chukotka) is unwrapped into continuous longitudes, so it never draws a
    // line across the whole map; the part beyond ±180 then falls outside any regional view and is clipped away
    const unwrap = (r: Pt[]) => { let off = 0; return r.map(([lon, lat], i) => { if (i) { const d = lon - r[i - 1]![0]; if (d > 180) off -= 360; else if (d < -180) off += 360 } return [lon + off, lat] as Pt }) }
    const rings = c.rings.map((r) => thin(clip(unwrap(r).map(([lon, lat]) => P(lon, lat)), pad), 0.9)).filter((r) => r.length > 2)
    if (!rings.length) continue
    out.push({ name: `frr-map ${iso || c.name}`, kind: 'path', paths: rings, box: bboxOf(rings), stroke: C.border, width: 0.6, fill: t ? C.tone[t] : C.land, closed: true, descr: `${c.name} (Natural Earth, public domain)` } as Mark)
  }
  const inBox = (p: Pt, m = 0) => p[0] >= box.x + m && p[0] <= box.x + box.w - m && p[1] >= box.y + m && p[1] <= box.y + box.h - m
  for (const r of spec.routes ?? []) { // the part of a route inside the map, in runs (a route may leave and re-enter)
    const runs: Pt[][] = [[]]
    for (const p of smooth(r.path.map(([lon, lat]) => P(lon, lat)))) { if (inBox(p)) runs[runs.length - 1]!.push(p); else if (runs[runs.length - 1]!.length) runs.push([]) }
    const keep = runs.filter((x) => x.length > 1)
    if (!keep.length) continue
    const st = r.style ?? 'main'
    out.push({ name: `frr-route ${r.id}`, kind: 'path', paths: keep, box: bboxOf(keep), stroke: st === 'disrupted' ? C.disrupted : st === 'diverted' ? C.diverted : C.route, width: st === 'main' ? 2.4 : 2.2, dash: st !== 'main' } as Mark)
  }
  const tp = 9.5, font = L.fonts.text
  // a name takes a colour that contrasts with the shape under it (a pale focus country on a dark map needs dark text)
  const inside = (q: Pt, rings: Pt[][]) => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i]!, [xj, yj] = r[j]!; if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c } return c }
  const lum = (h: string) => { const [r, g, b] = hexRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
  const under = (q: Pt) => { const m = [...out].reverse().find((k) => k.kind === 'path' && (k as any).fill && (k as any).closed && inside(q, (k as any).paths)); return (m as any)?.fill as string | undefined }
  for (const l of spec.labels ?? []) {
    if (!inBox(P(l.lon, l.lat), 12)) continue
    const [x, y] = P(l.lon, l.lat), sea = l.kind === 'sea', w = l.text.length * (sea ? 6.2 : 6.6) + 16
    const bg = sea ? C.sea : under([x, y]) ?? C.sea, color = sea ? C.sea_label : lum(bg) > 0.6 ? L.color.muted : L.color.onDarkMuted
    out.push({ name: `frr-map label ${l.text}`, kind: 'text', box: { x: x - w / 2, y: y - 8, w, h: 16 }, text: sea ? l.text : l.text.toUpperCase(), size: sea ? 9.5 : 8, color, align: 'ctr', font, track: sea ? 0 : 1.2, bold: !sea } as Mark)
  }
  for (const p of spec.points ?? []) {
    if (!inBox(P(p.lon, p.lat), 6)) continue
    const [x, y] = P(p.lon, p.lat), ch = (p.kind ?? 'chokepoint') === 'chokepoint', r = ch ? 8 : 4
    if (ch) out.push({ name: `frr-point ${p.id} ring`, kind: 'ellipse', box: { x: x - r - 4, y: y - r - 4, w: 2 * r + 8, h: 2 * r + 8 }, fill: 'none', stroke: C.disrupted, strokeW: 1.25 } as Mark)
    out.push({ name: `frr-point ${p.id}`, kind: 'ellipse', box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r }, fill: ch ? C.disrupted : C.point, stroke: spec.theme === 'dark' ? L.color.navyDeep : '#FFFFFF', strokeW: 1.5 } as Mark)
    if (p.label) {
      const w = p.label.length * 6.9 + 10, side = p.side ?? 'right', gap = r + 8
      const b = side === 'left' ? { x: x - gap - w, y: y - 9, w, h: 18 } : side === 'above' ? { x: x - w / 2, y: y - gap - 18, w, h: 18 } : side === 'below' ? { x: x - w / 2, y: y + gap, w, h: 18 } : { x: x + gap, y: y - 9, w, h: 18 }
      out.push({ name: `frr-point ${p.id} label`, kind: 'text', box: b, text: p.label, size: tp + 0.5, color: spec.theme === 'dark' ? '#FFFFFF' : L.color.ink, bold: true, align: side === 'left' ? 'r' : side === 'right' ? 'l' : 'ctr', font } as Mark)
    }
  }
  if (spec.legend?.length) { // a key in the lower-left corner, on a paper card
    const rows = spec.legend, lh = 20, w = Math.max(...rows.map((r) => r.text.length * 5.6)) + 50, h = rows.length * lh + 16
    const at = spec.legendAt ?? 'bottom-left', x0 = at.endsWith('left') ? box.x + 14 : box.x + box.w - w - 14, y0 = at.startsWith('bottom') ? box.y + box.h - h - 14 : box.y + 14
    out.push({ name: 'frr-map legend', kind: 'rect', box: { x: x0, y: y0, w, h }, fill: spec.theme === 'dark' ? L.color.navyDeep : '#FFFFFF', stroke: C.border, strokeW: 0.75 } as Mark)
    rows.forEach((r, i) => {
      const y = y0 + 8 + i * lh + lh / 2
      if (r.tone === 'main' || r.tone === 'disrupted' || r.tone === 'diverted') out.push({ name: `frr-map key ${i}`, kind: 'path', paths: [[[x0 + 10, y], [x0 + 32, y]]], box: { x: x0 + 10, y, w: 22, h: 0.5 }, stroke: r.tone === 'disrupted' ? C.disrupted : r.tone === 'diverted' ? C.diverted : C.route, width: 2.2, dash: r.tone !== 'main' } as Mark)
      else out.push({ name: `frr-map key ${i}`, kind: 'rect', box: { x: x0 + 12, y: y - 6, w: 18, h: 12 }, fill: C.tone[r.tone], stroke: C.border, strokeW: 0.5 } as Mark)
      out.push({ name: `frr-map key ${i} text`, kind: 'text', box: { x: x0 + 40, y: y - 8, w: w - 46, h: 16 }, text: r.text, size: 9, color: spec.theme === 'dark' ? '#FFFFFF' : L.color.ink, font } as Mark)
    })
  }
  return out.map((m) => ({ ...m, box: { x: Math.round(m.box.x * 10) / 10, y: Math.round(m.box.y * 10) / 10, w: Math.round(m.box.w * 10) / 10, h: Math.round(m.box.h * 10) / 10 } }))
}
