// Pure helpers over the project (mirrors editor/slidemodel.py and editor/charts.py where noted).

export const W = 1280, H = 720;
export const uid = (p) => `${p}-${Math.random().toString(16).slice(2, 10)}`;

export function evidenceMap(p) {  // slidemodel.evidence_map
  const m = { ...p.evidence };
  (p.research_results || []).filter((r) => !r.reverted).forEach((r) => (r.response.evidence || []).forEach((e) => { m[e.id] ||= e; }));
  return m;
}
export function fmtValue(v, f = {}) {
  if (typeof v !== "number") return "n/a";
  const d = f.decimals ?? 0;
  return `${f.prefix || ""}${(v / (f.scale || 1)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${f.suffix ?? ""}`;
}
export function fmtDelta(ev, toId, fromId, kind) {
  const a = ev[fromId]?.value, b = ev[toId]?.value;
  if (typeof a !== "number" || typeof b !== "number") return { text: "n/a", sign: 0 };
  const d = kind === "pp" ? b - a : (b / a - 1) * 100;
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(kind === "pp" ? 2 : 1)}${kind === "pp" ? "pp" : "%"}`, sign: Math.sign(d) };
}

// Per-slide element lists with stable identity: unchanged slides keep the same array, so memoised
// thumbnails and slide views skip re-rendering (the measured bottleneck of the old editor).
const slideCache = new WeakMap();
export function elementsBySlide(p) {
  if (slideCache.has(p.elements)) return slideCache.get(p.elements);
  const first = p.slides[0].id, out = {};
  for (const e of p.elements) (out[e.slide_id || first] ||= []).push(e);
  const prev = elementsBySlide.prev || {};
  for (const k of Object.keys(out)) {
    const a = out[k], b = prev[k];
    if (b && a.length === b.length && a.every((x, i) => x === b[i])) out[k] = b;
  }
  elementsBySlide.prev = out; slideCache.set(p.elements, out);
  return out;
}

// ------------------------------------------------------------------ datasets / charts (mirrors charts.py)
export function chartSeries(p, chartId) {
  const spec = p.charts[chartId], lo = spec.x?.from, hi = spec.x?.to;
  const inRange = (d) => (lo == null || String(d) >= String(lo)) && (hi == null || String(d) <= String(hi));
  const dates = new Set(), per = [];
  for (const s of spec.series) {
    const ds = p.datasets[s.dataset] || { observations: [] }, obs = new Map();
    ds.observations.forEach((o) => { if (inRange(o.date)) { obs.set(String(o.date), o.value); dates.add(String(o.date)); } });
    per.push([s, obs]);
  }
  const x = [...dates].sort();
  return { x, series: per.map(([s, obs]) => ({ label: s.label, dataset: s.dataset, role: s.role, values: x.map((d) => (obs.has(d) ? obs.get(d) : null)) })) };
}
export function compatibility(p, ids) {
  const found = ids.map((i) => p.datasets[i]).filter(Boolean), issues = [], out = {};
  for (const f of ["unit", "frequency", "observation_type"]) {
    const vals = [...new Set(found.map((d) => d[f]))];
    out[f] = vals.length === 1 ? vals[0] : null;
    if (vals.length > 1) issues.push(`mixed ${f.replace("_", " ")}: ${vals.join(", ")}`);
  }
  if (found.some((d) => !d.observations.length)) issues.push("a selected dataset has no observations yet (request research)");
  const gaps = found.flatMap((d) => d.observations.filter((o) => o.value === null).map((o) => `${d.entity} ${o.date}`));
  return { ...out, ok: found.length > 0 && !issues.length, issues, gaps };
}
export const plottedPoints = (series) => series.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);
export function datasetPointsInRange(p, chartId) {
  const spec = p.charts[chartId], lo = spec.x?.from, hi = spec.x?.to;
  return spec.series.reduce((n, s) => n + (p.datasets[s.dataset]?.observations || [])
    .filter((o) => o.value !== null && (lo == null || String(o.date) >= String(lo)) && (hi == null || String(o.date) <= String(hi))).length, 0);
}

// ------------------------------------------------------------------ design DNA → CSS custom properties
export function dnaVars(d) {
  return `--dna-font:"${d.font}",Helvetica,Arial,sans-serif;--dna-ink:${d.ink};--dna-accent:${d.accent};--dna-muted:${d.muted};` +
    `--dna-title:${d.title_size}px;--dna-panel:${d.panel};--dna-rule:${d.rule}`;
}

// ------------------------------------------------------------------ geometry
export const intersects = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
/** First free rectangle in the content area, trying each size in turn; `overlaps` marks a forced placement. */
export function freeSpot(els, ...sizes) {
  for (const [w, h] of sizes) for (let y = 120; y <= 650 - h; y += 8) for (let x = 40; x <= 1240 - w; x += 16) {
    const r = { x, y, w, h }; if (!els.some((e) => intersects(e, r, 8))) return r;
  }
  const [w, h] = sizes[0];
  return { x: 40, y: 120, w, h, overlaps: true };
}
export const bbox = (els) => { const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y }; };
