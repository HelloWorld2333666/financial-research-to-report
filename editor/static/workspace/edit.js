// Manual editing operations. Each is one undoable commit on the patch store.
// Rule: source records (evidence values, dataset observations) are never overwritten. Edits to
// sourced figures go into a `working` layer {value, by, at, status}; "restore" deletes it.
import { uid, now, AUTHOR, parseNumber, elementsBySlide, freeSpot } from "./model.js";

const find = (d, id) => d.elements.find((e) => e.id === id);
const work = (value) => ({ value, by: AUTHOR, at: now(), status: "manual_unverified" });

// ------------------------------------------------------------------ rich text
const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN"]);
export function sanitize(node) {
  const out = document.createElement("div");
  const walk = (src, dst) => src.childNodes.forEach((n) => {
    if (n.nodeType === 3) dst.appendChild(document.createTextNode(n.textContent));
    else if (n.nodeType === 1) {
      const tag = n.tagName === "STRONG" ? "B" : n.tagName === "EM" ? "I" : n.tagName;
      if (!ALLOWED.has(tag)) return walk(n, dst);
      const el = document.createElement(tag === "SPAN" || tag === "P" ? "div" : tag);
      if (tag === "SPAN") { const s = n.getAttribute("style") || ""; if (/bold/.test(s)) { const b = document.createElement("b"); walk(n, b); dst.appendChild(b); return; } walk(n, dst); return; }
      walk(n, el); dst.appendChild(el);
    }
  });
  walk(node, out);
  const htmlStr = out.innerHTML.replace(/<div><br><\/div>/g, "<br>").trim();
  return { html: /<(b|i|u)>/.test(htmlStr) ? htmlStr : null, text: node.innerText.replace(/\n$/, "") };
}
export function setText(store, id, field, value) {
  store.commit("Edited text", (d) => {
    const e = find(d, id);
    if (field === "text" && typeof value === "object") { e.text = value.text; if (value.html) e.html = value.html; else delete e.html; }
    else e[field] = value;
  });
}

// ------------------------------------------------------------------ tables (type "table")
export function setTableCell(store, id, r, c, input, toast) {
  const n = parseNumber(input), raw = String(input).trim();
  store.commit("Edited table cell", (d) => {
    const t = find(d, id);
    if (r === "h") { t.columns[c] = raw; return; }
    const row = t.rows[r];
    if (c === -1) { row.label = raw; return; }
    while (row.cells.length <= c) row.cells.push({ text: "" });
    const cell = row.cells[c];
    if (cell.delta) return toast?.("This cell is computed from two other cells; edit those instead");
    if (cell.evidence_id) {
      if (raw === "") delete cell.working;
      else if (n === null) return toast?.("Sourced cells hold numbers; enter a number or clear to restore the source");
      else if (cell.working?.value !== n) cell.working = work(n);
    } else row.cells[c] = n === null ? { text: raw } : { value: n, ...(cell.fmt ? { fmt: cell.fmt } : {}) };
  });
}
export function restoreTableCell(store, id, r, c) { store.commit("Restored source value", (d) => { delete find(d, id).rows[r].cells[c].working; }); }
export const tableOps = {
  addRow: (store, id, at) => store.commit("Added row", (d) => { const t = find(d, id), n = Math.max(1, (t.columns?.length || 2) - 1);
    t.rows.splice(at ?? t.rows.length, 0, { label: "New row", cells: Array.from({ length: n }, () => ({ text: "" })) }); }),
  deleteRow: (store, id, r) => store.commit("Deleted row", (d) => { find(d, id).rows.splice(r, 1); }),
  moveRow: (store, id, r, dir) => store.commit("Moved row", (d) => { const t = find(d, id), j = r + dir; if (j < 0 || j >= t.rows.length) return; [t.rows[r], t.rows[j]] = [t.rows[j], t.rows[r]]; }),
  addCol: (store, id, at) => store.commit("Added column", (d) => { const t = find(d, id), ci = at ?? t.columns.length - 1;
    t.columns.splice(ci + 1, 0, "New column"); t.rows.forEach((r) => r.cells.splice(ci, 0, { text: "" }));
    if (t.col_widths) { t.col_widths.splice(ci + 1, 0, 0.15); const s = t.col_widths.reduce((a, b) => a + b, 0); t.col_widths = t.col_widths.map((w) => w / s); }
    if (t.col_fmt) t.col_fmt.splice(ci, 0, null); }),
  deleteCol: (store, id, ci) => store.commit("Deleted column", (d) => { const t = find(d, id);
    t.columns.splice(ci + 1, 1); t.rows.forEach((r) => r.cells.splice(ci, 1)); if (t.col_widths) t.col_widths.splice(ci + 1, 1); if (t.col_fmt) t.col_fmt.splice(ci, 1); }),
  sortBy: (store, id, ci, ev, desc) => store.commit("Sorted rows", (d) => { const t = find(d, id);
    const key = (r) => { const c = ci < 0 ? { text: r.label } : r.cells[ci] || {}; const v = c.working?.value ?? (c.evidence_id ? ev[c.evidence_id]?.value : c.value); return typeof v === "number" ? v : String(c.text ?? r.label ?? ""); };
    t.rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); }); }),
  setColFmt: (store, id, ci, fmt) => store.commit("Changed number format", (d) => { const t = find(d, id); t.col_fmt ||= []; t.col_fmt[ci] = fmt;
    t.rows.forEach((r) => { if (r.cells[ci]?.fmt) r.cells[ci].fmt = { ...r.cells[ci].fmt, ...fmt }; }); }),
  setColWidths: (store, id, widths) => store.commit("Resized columns", (d) => { find(d, id).col_widths = widths; }),
  /** Paste a TSV block (from Excel/Sheets) starting at row r, cell c. */
  pasteTSV: (store, id, r, c, tsv, toast) => {
    const grid = tsv.replace(/\r/g, "").split("\n").filter((l, i, a) => l || i < a.length - 1).map((l) => l.split("\t"));
    let refused = 0;
    store.commit(`Pasted ${grid.length}×${grid[0]?.length || 0} cells`, (d) => { const t = find(d, id);
      grid.forEach((line, i) => { const ri = r + i; if (!t.rows[ri]) t.rows.push({ label: "", cells: [] });
        line.forEach((val, j) => { const ci = c + j, row = t.rows[ri];
          if (ci === -1) { row.label = val; return; }
          while (row.cells.length <= ci) row.cells.push({ text: "" });
          const cell = row.cells[ci], n = parseNumber(val);
          if (cell.delta) { refused++; return; }
          if (cell.evidence_id) { if (n === null) { refused++; return; } cell.working = work(n); }
          else row.cells[ci] = n === null ? { text: val } : { value: n }; }); }); });
    if (refused) toast?.(`${refused} cell(s) skipped: computed cells, or text pasted into sourced number cells`);
  },
};

// ------------------------------------------------------------------ datasets (charts + data tables)
export function setObservation(store, dsId, date, input, toast) {
  const n = parseNumber(input), raw = String(input).trim();
  if (raw !== "" && n === null) return toast?.("Enter a number, or leave empty to mark the observation missing");
  store.commit("Edited observation", (d) => { const ds = d.datasets[dsId]; ds.working ||= {};
    const src = ds.observations.find((o) => String(o.date) === String(date));
    if (raw === "") ds.working[date] = { deleted: true, by: AUTHOR, at: now(), status: "manual_unverified" };
    else if (src && src.value === n) delete ds.working[date];  // typed the source value back: no edit
    else if (ds.working[date]?.value !== n || ds.working[date]?.deleted) ds.working[date] = work(n); });
}
export const restoreObservation = (store, dsId, date) => store.commit("Restored source value", (d) => { delete d.datasets[dsId].working?.[date]; });
export const restoreDataset = (store, dsIds) => store.commit("Restored original data", (d) => dsIds.forEach((id) => { if (d.datasets[id]) d.datasets[id].working = {}; }));
export const markVerified = (store, dsIds) => store.commit("Marked edits verified (simulated review)", (d) => dsIds.forEach((id) => Object.values(d.datasets[id].working || {}).forEach((w) => { w.status = "verified"; w.verified_at = now(); })));
export function addObservationDate(store, dsIds, date, toast) {
  if (!String(date).trim()) return;
  store.commit(`Added observation ${date}`, (d) => dsIds.forEach((id) => { const ds = d.datasets[id]; ds.working ||= {};
    if (!ds.observations.some((o) => String(o.date) === String(date)) && !ds.working[date]) ds.working[date] = { value: null, by: AUTHOR, at: now(), status: "manual_unverified" }; }));
  toast?.(`Added ${date}: empty until you enter values (shown as a gap, not estimated)`);
}
export const chartOps = {
  setSpec: (store, chartId, label, fn) => store.commit(label, (d) => fn(d.charts[chartId])),
  removeSeries: (store, chartId, i) => store.commit("Removed series", (d) => { d.charts[chartId].series.splice(i, 1); }),
  renameSeries: (store, chartId, i, name) => store.commit("Renamed series", (d) => { d.charts[chartId].series[i].label = name; }),
  addSeries: (store, chartId, dsId, label) => store.commit("Added series", (d) => { const s = d.charts[chartId].series;
    s.push({ dataset: dsId, label: label || d.datasets[dsId].entity, role: Math.max(-1, ...s.map((x) => x.role ?? 0)) + 1 }); }),
  /** A new manual series shares the chart's dates; values start empty (gaps) until typed. */
  addManualSeries: (store, chartId, name, template) => { const id = `ds.manual.${uid("s").slice(2)}`;
    store.commit("Added manual series", (d) => { const t = d.datasets[template] || {};
      d.datasets[id] = { title: `${name} (manual)`, entity: name, unit: t.unit, frequency: t.frequency || "annual", observation_type: t.observation_type || "end_of_period",
        definition: "Entered manually in the workspace.", origin: "manual", verification: "manual", source_note: "Manually entered data (no source)", observations: [], working: {} };
      const s = d.charts[chartId].series; s.push({ dataset: id, label: name, role: Math.max(-1, ...s.map((x) => x.role ?? 0)) + 1 }); });
    return id; },
};

// ------------------------------------------------------------------ bar charts (type "barchart", evidence-bound bars) and metrics
export const barOps = {
  set: (store, id, i, input, toast) => { const n = parseNumber(input), raw = String(input).trim();
    if (raw !== "" && n === null) return toast?.("Enter a number, or clear to restore the source value");
    store.commit("Edited bar value", (d) => { const b = find(d, id).bars[i];
      if (b.evidence_id) { if (raw === "") delete b.working; else if (b.working?.value !== n) b.working = work(n); } else b.value = n ?? 0; }); },
  label: (store, id, i, label) => store.commit("Renamed bar", (d) => { find(d, id).bars[i].label = label; }),
  add: (store, id) => store.commit("Added bar", (d) => { find(d, id).bars.push({ label: "New category", value: 0 }); }),
  remove: (store, id, i) => store.commit("Removed bar", (d) => { find(d, id).bars.splice(i, 1); }),
  restore: (store, id, i) => store.commit("Restored source value", (d) => { delete find(d, id).bars[i].working; }),
};
export function setMetric(store, id, input, toast) {
  const n = parseNumber(input), raw = String(input).trim();
  if (raw !== "" && n === null) return toast?.("Enter a number, or clear to restore the source value");
  store.commit("Edited metric value", (d) => { const e = find(d, id); const scale = e.fmt?.scale || 1;
    if (raw === "") delete e.working; else e.working = work(n * scale); });
}

// ------------------------------------------------------------------ object commands
let clipboard = null;
export const hasClipboard = () => !!clipboard;
export function copy(p, ids) {
  const els = p.elements.filter((e) => ids.includes(e.id));
  clipboard = { els: JSON.parse(JSON.stringify(els)), charts: Object.fromEntries(els.filter((e) => e.type === "chart").map((e) => [e.chart_id, JSON.parse(JSON.stringify(p.charts[e.chart_id]))])), from: els[0]?.slide_id };
  return els.length;
}
export function paste(store, slide) {
  if (!clipboard) return [];
  const ids = [], groups = {}, off = clipboard.from === slide ? 16 : 0;
  store.commit(`Pasted ${clipboard.els.length} object(s)`, (d) => clipboard.els.forEach((e) => {
    const c = JSON.parse(JSON.stringify(e)); c.id = uid(e.type.slice(0, 3)); c.slide_id = slide; c.x += off; c.y += off;
    if (e.group) c.group = groups[e.group] ||= uid("g");
    if (e.type === "chart") { const cid = uid("ch"); d.charts[cid] = JSON.parse(JSON.stringify(clipboard.charts[e.chart_id])); c.chart_id = cid; }
    delete c.transfer_id; d.elements.push(c); ids.push(c.id); }));
  clipboard.from = slide;
  return ids;
}
export const del = (store, ids) => store.commit(`Deleted ${ids.length} object(s)`, (d) => { d.elements = d.elements.filter((e) => !ids.includes(e.id) || e.locked); });
export const group = (store, ids) => { const g = uid("g"); store.commit("Grouped", (d) => ids.forEach((id) => { find(d, id).group = g; })); };
export const ungroup = (store, ids) => store.commit("Ungrouped", (d) => ids.forEach((id) => { delete find(d, id).group; }));
export function arrange(store, ids, how) {
  store.commit({ front: "Brought to front", back: "Sent to back", forward: "Brought forward", backward: "Sent backward" }[how], (d) => {
    const sel = d.elements.filter((e) => ids.includes(e.id)), rest = d.elements.filter((e) => !ids.includes(e.id));
    if (how === "front") d.elements = [...rest, ...sel];
    else if (how === "back") d.elements = [...sel, ...rest];
    else { const arr = d.elements, idx = ids.map((id) => arr.findIndex((e) => e.id === id)).sort((a, b) => (how === "forward" ? b - a : a - b));
      idx.forEach((i) => { const j = how === "forward" ? i + 1 : i - 1; if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]; }); }
  });
}
export function align(store, els, how) {
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y)), x1 = Math.max(...els.map((e) => e.x + e.w)), y1 = Math.max(...els.map((e) => e.y + e.h));
  const one = els.length === 1, B = one ? { x0: 0, y0: 0, x1: 1280, y1: 720 } : { x0, y0, x1, y1 };
  store.commit(`Aligned ${how}`, (d) => els.forEach((s) => { const e = find(d, s.id); if (e.locked) return;
    if (how === "left") e.x = B.x0; if (how === "right") e.x = B.x1 - e.w; if (how === "center") e.x = Math.round((B.x0 + B.x1 - e.w) / 2);
    if (how === "top") e.y = B.y0; if (how === "bottom") e.y = B.y1 - e.h; if (how === "middle") e.y = Math.round((B.y0 + B.y1 - e.h) / 2); }));
}
export const moveToSlide = (store, ids, slide) => store.commit("Moved to another slide", (d) => ids.forEach((id) => { const e = find(d, id); e.slide_id = slide; delete e.group; }));
export const setLock = (store, ids, locked) => store.commit(locked ? "Locked" : "Unlocked", (d) => ids.forEach((id) => { find(d, id).locked = locked; }));
export const setProp = (store, id, label, fn) => store.commit(label, (d) => fn(find(d, id)));

export function insert(store, p, slide, kind, extra = {}) {
  const els = elementsBySlide(p)[slide] || [], id = uid(kind.slice(0, 3));
  const at = (w, h) => { const { overlaps, ...r } = freeSpot(els, [w, h], [Math.round(w * 0.7), Math.round(h * 0.7)]); return r; };
  const base = { id, slide_id: slide, refs: {}, style: {} };
  const el = {
    heading: () => ({ ...base, type: "text", ...at(560, 44), text: "New heading", style: { fontSize: 26, fontWeight: 700 } }),
    text: () => ({ ...base, type: "text", ...at(360, 80), text: "Click twice to edit this text.", style: { fontSize: 15 } }),
    rect: () => ({ ...base, type: "shape", shape: "rect", ...at(240, 140), style: { fill: "#e8eef7" } }),
    rounded: () => ({ ...base, type: "shape", shape: "rounded", ...at(240, 140), style: { fill: "#e8eef7", radius: 14 } }),
    ellipse: () => ({ ...base, type: "shape", shape: "ellipse", ...at(150, 150), style: { fill: "#e8eef7" } }),
    callout: () => ({ ...base, type: "shape", shape: "rounded", ...at(320, 110), text: "Key message", style: { fill: "#0f2742", radius: 10, text: { color: "#ffffff", fontSize: 16, fontWeight: 700 } } }),
    line: () => ({ ...base, type: "line", ...at(260, 2), h: 2, style: { width: 2 } }),
    arrow: () => ({ ...base, type: "line", ...at(240, 80), arrow_end: true, style: { width: 2.5 } }),
    icon: () => ({ ...base, type: "icon", icon: extra.icon || "star", ...at(64, 64), style: {} }),
    image: () => ({ ...base, type: "image", src: extra.src, alt: extra.alt || "", ...at(extra.w || 360, extra.h || 240), crop: { zoom: 1, ox: 50, oy: 50 }, filters: {} }),
    table: () => ({ ...base, type: "table", ...at(480, 170), title: "", columns: ["Item", "Column A", "Column B"], col_fmt: [{ decimals: 1 }, { decimals: 1 }],
      rows: [1, 2, 3].map((i) => ({ label: `Row ${i}`, cells: [{ text: "" }, { text: "" }] })), style: {} }),
  }[kind]();
  store.commit(`Inserted ${kind}`, (d) => { d.elements.push({ ...el, ...extra.el }); });
  return id;
}
