// Slide rendering (DOM). Each element is a memoised component: Immer keeps unchanged elements
// identical, so an edit re-renders only the elements it touched. data-* attributes mark the
// editable parts (text fields, table cells) for in-canvas editing.
import { Component } from "preact";
import { html } from "./html.js";
import { ChartView } from "./charts.js";
import { renderLineChart } from "../bench/svgchart.js";
import { iconPath } from "./icons.js";
import { fmtValue, fmtDelta, boundValue, effectiveObs } from "./model.js";

const shallow = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k])); };
export function memo(fn) { return class extends Component { shouldComponentUpdate(n) { return !shallow(this.props, n); } render(p) { return fn(p); } }; }

const ROLE_CLASS = { title: "r-title", subtitle: "r-sub", kicker: "r-kicker", body: "r-body", rule: "r-rule" };
const css = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}:${v}`).join(";");

export function textStyle(st = {}, role) {
  return css({ "font-family": st.fontFamily ? `"${st.fontFamily}",var(--dna-font)` : undefined,
    "font-size": st.fontSize ? `${st.fontSize}px` : role ? undefined : "13px", "font-weight": st.fontWeight, color: st.color,
    "text-align": st.align, "line-height": st.lineHeight, "font-style": st.italic ? "italic" : undefined,
    "text-decoration": st.underline ? "underline" : undefined, "letter-spacing": st.letterSpacing,
    background: st.fill, padding: st.fill || st.padding ? `${st.padding ?? 8}px` : undefined, "border-radius": st.fill ? "4px" : undefined });
}

function boundIds(el) {  // slidemodel.bound_evidence_ids
  const ids = [];
  if (el.type === "metric") { ids.push(el.evidence_id); if (el.delta) ids.push(el.delta.from); }
  if (el.type === "table") el.rows.forEach((r) => r.cells.forEach((c) => { if (c.evidence_id) ids.push(c.evidence_id); if (c.delta) ids.push(c.delta.from, c.delta.to); }));
  if (el.type === "barchart") el.bars.forEach((b) => ids.push(b.evidence_id));
  return ids.filter(Boolean);
}

export function sourceLine(els, ctx) {
  const pages = {}, notes = new Set();
  for (const el of els) {
    [...boundIds(el), ...(el.refs?.evidence || [])].forEach((id) => { const e = ctx.ev[id]; if (e) (pages[e.source_id] ||= new Set()).add(e.page); });
    const dsIds = el.type === "chart" ? (ctx.charts[el.chart_id]?.series || []).map((s) => s.dataset) : el.type === "datatable" ? el.dataset_ids : [];
    dsIds.forEach((d) => ctx.datasets[d] && notes.add(ctx.datasets[d].source_note || "Manually entered data (no source)"));
  }
  const cites = Object.entries(pages).map(([sid, set]) => {
    const s = ctx.sources[sid] || {}, p = [...set].filter(Boolean).sort((a, b) => a - b);
    return `China Re, ${s.title} (HKEX), PDF ${p.length > 1 ? "pp." : "p."} ${p.join(", ")}`;
  });
  return [...cites, ...notes].join("; ") || "none yet";
}

const Mark = ({ v }) => (v.edited ? html`<i class="editmark no-export" title=${v.manual ? "Manually entered value — no source" : `Edited · source value ${v.source ?? "–"} · pending verification`}></i>` : "");

function TableView({ el, ctx }) {
  const st = el.style || {}, widths = el.col_widths, n = 1 + Math.max(0, ...el.rows.map((r) => r.cells.length));
  const colStyle = (i) => (widths?.[i] ? `width:${widths[i] * 100}%` : "");
  const fmt = (c, ci) => c.fmt || el.col_fmt?.[ci] || {};
  return html`<div class="el-table" style=${css({ background: st.fill || "#fff", "border-color": st.borderColor || "#d5dbe3", "font-size": st.fontSize ? `${st.fontSize}px` : undefined })}>
    ${el.title ? html`<div class="ttl" data-field="title">${el.title}</div>` : ""}
    <table><colgroup>${Array.from({ length: n }, (_, i) => html`<col style=${colStyle(i)} />`)}</colgroup>
      <thead><tr style=${css({ background: st.headerFill, color: st.headerColor })}>${(el.columns || []).map((c, i) => html`<th data-cell=${`h:${i}`} style=${css({ "text-align": i ? st.align || "right" : "left" })}>${c}</th>`)}</tr></thead>
      <tbody>${el.rows.map((r, ri) => html`<tr>
        <td data-cell=${`${ri}:-1`}>${r.label}</td>
        ${r.cells.map((c, ci) => {
          let content, v = null;
          if (c.delta) {
            const a = boundValue(ctx.ev, { evidence_id: c.delta.from }).value, b = boundValue(ctx.ev, { evidence_id: c.delta.to }).value;
            const ra = el.rows[ri].cells.find((x) => x.evidence_id === c.delta.from), rb = el.rows[ri].cells.find((x) => x.evidence_id === c.delta.to);
            content = fmtDelta(ra ? boundValue(ctx.ev, ra).value : a, rb ? boundValue(ctx.ev, rb).value : b, c.delta.kind).text;
          } else if (c.evidence_id || "value" in c || c.working) { v = boundValue(ctx.ev, c); content = fmtValue(v.value, fmt(c, ci)); }
          else content = c.text ?? "";
          return html`<td data-cell=${`${ri}:${ci}`} class=${v?.edited ? "edited" : ""} style=${css({ "text-align": st.align || "right" })}>${content}${v ? html`<${Mark} v=${v} />` : ""}</td>`;
        })}</tr>`)}</tbody></table>
    ${el.footnote ? html`<div class="fn" data-field="footnote">${el.footnote}</div>` : ""}</div>`;
}

function DataTableView({ el, ctx }) {
  const dss = el.dataset_ids.map((d) => [d, ctx.datasets[d]]).filter(([, d]) => d), st = el.style || {};
  const edits = dss.some(([, d]) => Object.keys(d.working || {}).some((k) => el.dates.includes(k)));
  return html`<div class="el-table dt" style=${css({ background: st.fill || "#fff", "font-size": st.fontSize ? `${st.fontSize}px` : undefined })}>
    <div class="ttl" data-field="title">${el.title}</div>
    <table><thead><tr style=${css({ background: st.headerFill, color: st.headerColor })}><th></th>${el.dates.map((d) => html`<th>${d}</th>`)}</tr></thead><tbody>
      ${dss.map(([id, ds], ri) => { const obs = new Map(effectiveObs(ds).map((o) => [o.date, o]));
        return html`<tr><td data-cell=${`${ri}:-1`}>${el.row_labels?.[id] || ds.entity}</td>${el.dates.map((d, ci) => { const o = obs.get(String(d));
          return html`<td data-cell=${`${ri}:${ci}`} class=${`${o?.value == null ? "gap" : ""} ${o?.edited ? "edited" : ""}`}>${o?.value == null ? "–" : fmtValue(o.value, el.fmt)}${o?.edited ? html`<${Mark} v=${{ edited: true, source: o.source_value }} />` : ""}</td>`; })}</tr>`; })}
    </tbody></table><div class="fn">${dss[0]?.[1].unit} · ${dss[0]?.[1].frequency}${edits ? " · edited values pending verification" : ""}</div></div>`;
}

function Inner({ el, ctx, mini, line }) {
  const st = el.style || {}, ev = ctx.ev;
  switch (el.type) {
    case "text": return el.html
      ? html`<div class=${`el-text ${ROLE_CLASS[el.role] || ""}`} data-field="text" style=${textStyle(st, el.role)} dangerouslySetInnerHTML=${{ __html: el.html }}></div>`
      : html`<div class=${`el-text ${ROLE_CLASS[el.role] || ""}`} data-field="text" style=${textStyle(st, el.role)}>${el.text}</div>`;
    case "panel": return html`<div class=${`el-fill ${ROLE_CLASS[el.role] || ""}`} style=${el.role ? "" : css({ background: st.fill || "#eef2f7", border: `${st.borderWidth || 0}px solid ${st.borderColor || "transparent"}`, "border-radius": `${st.radius ?? 4}px`, opacity: st.opacity })}></div>`;
    case "shape": return html`<div class="el-shape" style=${css({ background: st.fill || "#dbe4f0", border: `${st.borderWidth ?? 0}px solid ${st.borderColor || "transparent"}`,
        "border-radius": el.shape === "ellipse" ? "50%" : `${st.radius ?? (el.shape === "rounded" ? 14 : 0)}px`, opacity: st.opacity })}>
        ${el.text != null ? html`<div class="el-text shape-text" data-field="text" style=${textStyle({ align: "center", ...st.text }, null)}>${el.text}</div>` : ""}</div>`;
    case "line": {
      const sw = st.width || 2, c = st.color || "var(--dna-ink)", [x1, y1, x2, y2] = el.flip ? [0, el.h, el.w, 0] : [0, 0, el.w, el.h];
      return html`<svg class="el-line" width=${el.w} height=${el.h} viewBox=${`0 0 ${el.w} ${el.h}`} style="overflow:visible">
        <defs><marker id=${`ah-${el.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill=${c} /></marker></defs>
        <line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${c} stroke-width=${sw} stroke-dasharray=${st.dash ? `${sw * 3} ${sw * 2}` : ""}
          marker-end=${el.arrow_end ? `url(#ah-${el.id})` : ""} marker-start=${el.arrow_start ? `url(#ah-${el.id})` : ""} /></svg>`;
    }
    case "image": {
      const cr = el.crop || { zoom: 1, ox: 50, oy: 50 }, f = el.filters || {};
      return html`<div class="el-image" style=${css({ "border-radius": `${st.radius || 0}px`, opacity: st.opacity })}>
        ${el.src ? html`<img src=${el.src} alt=${el.alt || ""} draggable="false" style=${css({ width: `${cr.zoom * 100}%`, height: `${cr.zoom * 100}%`, "object-fit": "cover",
          "object-position": `${cr.ox}% ${cr.oy}%`, left: `${-(cr.zoom - 1) * cr.ox}%`, top: `${-(cr.zoom - 1) * cr.oy}%`,
          filter: `brightness(${f.brightness ?? 100}%) contrast(${f.contrast ?? 100}%) saturate(${f.saturate ?? 100}%)` })} />` : html`<div class="imgph">Image</div>`}</div>`;
    }
    case "icon": return html`<svg class="el-icon" viewBox="0 0 20 20" fill="none" stroke=${st.color || "var(--dna-accent)"} stroke-width=${st.stroke || 1.6} stroke-linecap="round" stroke-linejoin="round"><path d=${iconPath(el.icon)} /></svg>`;
    case "metric": {
      const v = boundValue(ev, el), prev = el.delta ? boundValue(ev, { evidence_id: el.delta.from }).value : null, d = el.delta ? fmtDelta(prev, v.value, el.delta.kind) : null;
      return html`<div class="el-metric" style=${css({ background: st.fill || "#fff", "border-color": st.borderColor || "#d5dbe3" })}><div class="lbl" data-field="label">${el.label}</div>
        <div class="val" data-cell="metric">${fmtValue(v.value, el.fmt)}<${Mark} v=${v} /></div>
        ${d && html`<div class="dlt" style=${`color:${d.sign < 0 ? "#b91c1c" : "#15803d"}`}>${d.sign < 0 ? "▼" : "▲"} ${d.text}</div>`}<div class="note" data-field="note">${el.note}</div></div>`;
    }
    case "table": return html`<${TableView} el=${el} ctx=${ctx} />`;
    case "datatable": return html`<${DataTableView} el=${el} ctx=${ctx} />`;
    case "barchart": {
      const vals = el.bars.map((b) => boundValue(ev, b)), max = Math.max(...vals.map((v) => v.value ?? 0), 1e-9);
      return html`<div class="el-bar" style=${css({ background: st.fill || "#fff", "border-color": st.borderColor || "#d5dbe3" })}><div class="ttl" data-field="title">${el.title}</div>
        <div class="rows" style=${css({ gap: `${st.barGap ?? 6}px` })}>${el.bars.map((b, i) => html`<div class="br"><div data-cell=${`bar:${i}`}>${b.label}</div>
          <div class="track"><div class="fill" style=${css({ width: `${((vals[i].value ?? 0) / max) * 100}%`, background: st.bar || "var(--dna-ink)" })}></div></div>
          <div class=${`v ${vals[i].edited ? "edited" : ""}`}>${fmtValue(vals[i].value, el.fmt)}<${Mark} v=${vals[i]} /></div></div>`)}</div></div>`;
    }
    case "sources": return html`<div class="el-sources"><b>${el.prefix || "Sources:"}</b> ${line}</div>`;
    case "gap": return html`<div class="el-gap"><div class="gl">Data gap</div><div data-field="text">${el.text}</div></div>`;
    case "pending": return html`<div class="el-pending"><div class="pt">⟳ ${el.title}</div><div>${el.text}</div><div class="pi">waiting for research · ${el.request_id || el.transfer_id || ""}</div></div>`;
    case "chart": {
      const spec = ctx.charts[el.chart_id];
      if (!spec) return html`<div class="el-missing">Unknown chart ${el.chart_id}</div>`;
      const series = ctx.series(el.chart_id);
      if (mini) {  // thumbnails: static deterministic SVG, no chart engine instance
        const s = series.snapshot ? { ...series, series: [{ ...series.series[0], role: 0 }] } : series;
        const svg = renderLineChart({ x: s.x, xType: "category", unit: "", title: "", width: el.w, height: el.h,
          series: s.series.map((x, i) => ({ name: "", color: ctx.dna.series[(x.role ?? i) % ctx.dna.series.length], values: x.values })) }).svg;
        return html`<div class="el-chart" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
      }
      return html`<div class="el-chart"><${ChartView} spec=${spec} series=${series} dna=${ctx.dna} w=${el.w - 2} h=${el.h - 2} /></div>`;
    }
    default: return html`<div class="el-missing">${el.type}</div>`;
  }
}

export const ElementView = memo(({ el, ctx, mini, selected, line, editing }) => html`
  <div class=${`el t-${el.type} ${selected ? "is-sel" : ""} ${el.locked ? "locked" : ""} ${el.hidden ? "is-hidden" : ""} ${editing ? "is-editing" : ""}`} data-id=${el.id}
       style=${`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${el.rotation ? `transform:rotate(${el.rotation}deg);` : ""}`}>
    <${Inner} el=${el} ctx=${ctx} mini=${mini} line=${line} />
  </div>`);

export const SlideView = memo(({ els, ctx, dnaStyle, mini, selected = "", editing = "", remount = "" }) => {
  const rk = remount.split("#")[0];
  const sel = new Set(selected.split(",").filter(Boolean));
  return html`<div class=${`slide ${mini ? "mini" : ""}`} style=${dnaStyle}>${els.filter((e) => !(mini && e.hidden)).map((el) => html`<${ElementView} key=${el.id === rk ? remount : el.id} el=${el} ctx=${ctx} mini=${mini}
    selected=${sel.has(el.id)} editing=${editing === el.id} line=${el.type === "sources" ? sourceLine(els, ctx) : undefined} />`)}</div>`;
});
