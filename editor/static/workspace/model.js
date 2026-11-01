// Pure helpers over the project (mirrors editor/slidemodel.py and editor/charts.py where noted).

export const W = 1280, H = 720;
export const uid = (p) => `${p}-${Math.random().toString(16).slice(2, 10)}`;
export const now = () => new Date().toISOString();
export const AUTHOR = "you";

export function evidenceMap(p) {  // slidemodel.evidence_map
  const m = { ...p.evidence };
  (p.research_results || []).filter((r) => !r.reverted).forEach((r) => (r.response.evidence || []).forEach((e) => { m[e.id] ||= e; }));
  return m;
}

// ------------------------------------------------------------------ number formats
// fmt: {kind: "number"|"percent"|"currency", decimals, prefix, suffix, scale}
export function fmtValue(v, f = {}) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "–";
  const d = f.decimals ?? 1, s = f.scale || 1;
  const n = (v / s).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (f.kind === "percent") return `${n}%`;
  if (f.kind === "currency") return `${f.prefix ?? "RMB "}${n}${f.suffix ?? ""}`;
  return `${f.prefix || ""}${n}${f.suffix ?? ""}`;
}
export function fmtDelta(a, b, kind) {
  if (typeof a !== "number" || typeof b !== "number") return { text: "–", sign: 0 };
  const d = kind === "pp" ? b - a : (b / a - 1) * 100;
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(kind === "pp" ? 2 : 1)}${kind === "pp" ? "pp" : "%"}`, sign: Math.sign(d) };
}
export function parseNumber(s) {
  const t = String(s ?? "").trim().replace(/[,\s]/g, "").replace(/^RMB|^\$|^€/i, "").replace(/%$/, "").replace("−", "-");
  if (t === "" || !/^[-+]?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

// ------------------------------------------------------------------ evidence-bound values with working overrides
/** A table cell / bar / metric value: the working override if any, else the source evidence, else a manual value. */
export function boundValue(ev, item, evidenceKey = "evidence_id") {
  const src = item[evidenceKey] ? ev[item[evidenceKey]] : null;
  const source = typeof src?.value === "number" ? src.value : null;
  if (item.working && !item.working.deleted) return { value: item.working.value, source, edited: true, status: item.working.status || "manual_unverified", evidence: src };
  if (item[evidenceKey]) return { value: source, source, edited: false, status: src?.verification || "missing", evidence: src };
  if (typeof item.value === "number") return { value: item.value, source: null, edited: true, status: "manual_unverified", evidence: null, manual: true };
  return { value: null, source: null, edited: false, status: "empty" };
}
export const evLabel = (e) => (e ? (e.statement || `${e.subject || ""} ${e.period || ""}`).replace(/\.$/, "") : "Unknown source record");
export const sourceTitle = (p, e) => (e && p.sources?.[e.source_id] ? `${p.sources[e.source_id].title}${e.page ? `, p. ${e.page}` : ""}` : "");

// ------------------------------------------------------------------ datasets: source + working (mirrors charts.effective_observations)
export function effectiveObs(ds) {
  const out = new Map();
  for (const o of ds?.observations || []) out.set(String(o.date), { date: String(o.date), value: o.value, source_value: o.value, edited: false, status: o.status || "source" });
  for (const [date, w] of Object.entries(ds?.working || {})) {
    const base = out.get(String(date)) || { date: String(date), source_value: null };
    out.set(String(date), { ...base, value: w.deleted ? null : w.value, edited: true, status: w.deleted ? "removed" : w.status || "manual_unverified", by: w.by, at: w.at });
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
/** Unverified working edits on the observations a chart actually shows (its date, or its date range). */
export function chartEdits(p, chartId) {
  const spec = p.charts[chartId], x = spec?.x || {};
  const shown = (d) => (x.mode === "snapshot" ? d === String(x.date) : (x.from == null || d >= String(x.from)) && (x.to == null || d <= String(x.to)));
  return (spec?.series || []).reduce((n, s) => n + Object.entries(p.datasets[s.dataset]?.working || {}).filter(([d, w]) => shown(d) && (w.status || "manual_unverified") !== "verified").length, 0);
}
export const unverifiedEdits = (ds) => Object.values(ds?.working || {}).filter((w) => (w.status || "manual_unverified") !== "verified").length;

export function chartSeries(p, chartId) {
  const spec = p.charts[chartId], x = spec.x || {};
  if (x.mode === "snapshot") {
    const vals = spec.series.map((s) => effectiveObs(p.datasets[s.dataset]).find((o) => o.date === String(x.date))?.value ?? null);
    return { x: spec.series.map((s) => s.label), snapshot: true, series: [{ label: String(x.date), dataset: null, values: vals, roles: spec.series.map((s, i) => s.role ?? i) }] };
  }
  const lo = x.from, hi = x.to, inRange = (d) => (lo == null || d >= String(lo)) && (hi == null || d <= String(hi));
  const dates = new Set(), per = [];
  for (const s of spec.series) {
    const obs = new Map(effectiveObs(p.datasets[s.dataset]).filter((o) => inRange(o.date)).map((o) => [o.date, o.value]));
    obs.forEach((_, d) => dates.add(d)); per.push([s, obs]);
  }
  const xs = [...dates].sort();
  return { x: xs, series: per.map(([s, obs]) => ({ label: s.label, dataset: s.dataset, role: s.role, values: xs.map((d) => (obs.has(d) ? obs.get(d) : null)) })) };
}
export function compatibility(p, ids) {
  const found = ids.map((i) => p.datasets[i]).filter(Boolean), issues = [], out = {};
  for (const f of ["unit", "frequency", "observation_type"]) {
    const vals = [...new Set(found.map((d) => d[f]))];
    out[f] = vals.length === 1 ? vals[0] : null;
    if (vals.length > 1) issues.push(`mixed ${f.replace("_", " ")}: ${vals.join(", ")}`);
  }
  if (found.some((d) => !effectiveObs(d).length)) issues.push("a selected dataset has no observations yet (request research)");
  const gaps = found.flatMap((d) => effectiveObs(d).filter((o) => o.value === null).map((o) => `${d.entity} ${o.date}`));
  return { ...out, ok: found.length > 0 && !issues.length, issues, gaps };
}
export const plottedPoints = (series) => series.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);

/** Manual (unverified) edits across the project, for the status chip and the export policy. */
export function manualEditSummary(p) {
  let obs = 0, cells = 0;
  for (const ds of Object.values(p.datasets || {})) obs += unverifiedEdits(ds);
  for (const e of p.elements) {
    if (e.type === "table") e.rows.forEach((r) => r.cells.forEach((c) => { if ((c.working && c.working.status !== "verified") || "value" in c) cells++; }));
    if (e.type === "barchart") e.bars.forEach((b) => { if ((b.working && b.working.status !== "verified") || (!b.evidence_id && "value" in b)) cells++; });
    if (e.type === "metric" && e.working && e.working.status !== "verified") cells++;
  }
  return { obs, cells, total: obs + cells };
}

// Per-slide element lists with stable identity: unchanged slides keep the same array, so memoised
// thumbnails and slide views skip re-rendering.
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

export const TYPE_LABEL = { text: "Text", panel: "Panel", shape: "Shape", line: "Line", image: "Image", icon: "Icon", metric: "Metric card",
  table: "Table", datatable: "Data table", barchart: "Bar chart", chart: "Chart", sources: "Source note", gap: "Data gap", pending: "Pending research", timeline: "Timeline" };
export function elementName(e, p) {
  if (e.name) return e.name;
  const t = e.type === "chart" ? p.charts?.[e.chart_id]?.title : e.title || e.label || (e.html ? e.text : e.text) || (e.columns || [])[0];
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s ? (s.length > 34 ? s.slice(0, 33) + "…" : s) : (e.type === "chart" && p.charts?.[e.chart_id]?.type === "bar" ? "Bar chart" : TYPE_LABEL[e.type] || e.type);
}
