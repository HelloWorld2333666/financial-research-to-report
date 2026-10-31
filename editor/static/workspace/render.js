// Slide rendering (DOM). Each element is a memoised component: Immer keeps unchanged elements
// identical, so an edit re-renders only the elements it touched.
import { Component } from "preact";
import { html } from "./html.js";
import { ChartView } from "./charts.js";
import { renderLineChart } from "../bench/svgchart.js";
import { fmtValue, fmtDelta, chartSeries } from "./model.js";

const shallow = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k])); };
export function memo(fn) { return class extends Component { shouldComponentUpdate(n) { return !shallow(this.props, n); } render(p) { return fn(p); } }; }

const ROLE_CLASS = { title: "r-title", subtitle: "r-sub", kicker: "r-kicker", body: "r-body", rule: "r-rule" };

function boundIds(el) {  // slidemodel.bound_evidence_ids
  const ids = [];
  if (el.type === "metric") { ids.push(el.evidence_id); if (el.delta) ids.push(el.delta.from); }
  if (el.type === "table") el.rows.forEach((r) => r.cells.forEach((c) => { if (c.evidence_id) ids.push(c.evidence_id); if (c.delta) ids.push(c.delta.from, c.delta.to); }));
  if (el.type === "barchart") el.bars.forEach((b) => ids.push(b.evidence_id));
  return ids.filter(Boolean);
}
export const isBound = (el) => boundIds(el).length > 0 || el.type === "chart" || el.type === "datatable";

export function sourceLine(els, ctx) {
  const pages = {}, notes = new Set();
  for (const el of els) {
    [...boundIds(el), ...(el.refs?.evidence || [])].forEach((id) => { const e = ctx.ev[id]; if (e) (pages[e.source_id] ||= new Set()).add(e.page); });
    const dsIds = el.type === "chart" ? (ctx.charts[el.chart_id]?.series || []).map((s) => s.dataset) : el.type === "datatable" ? el.dataset_ids : [];
    dsIds.forEach((d) => ctx.datasets[d] && notes.add(ctx.datasets[d].source_note));
  }
  const cites = Object.entries(pages).map(([sid, set]) => {
    const s = ctx.sources[sid] || {}, p = [...set].filter(Boolean).sort((a, b) => a - b);
    return `China Re, ${s.title} (HKEX), PDF ${p.length > 1 ? "pp." : "p."} ${p.join(", ")}`;
  });
  return [...cites, ...notes].join("; ") || "none yet";
}

function Inner({ el, ctx, mini, line }) {
  const st = el.style || {}, ev = ctx.ev;
  const frame = `background:${st.fill || "#fff"};border-color:${st.borderColor || "#d5dbe3"};`;
  switch (el.type) {
    case "text": return html`<div class=${`el-text ${ROLE_CLASS[el.role] || ""}`} data-field="text" style=${el.role ? "" : `font-size:${st.fontSize || 12}px;font-weight:${st.fontWeight || 400};color:${st.color || "var(--dna-ink)"};letter-spacing:${st.letterSpacing || "normal"};${st.fill ? `background:${st.fill};padding:6px 8px;` : ""}`}>${el.text}</div>`;
    case "panel": return html`<div class=${`el-fill ${ROLE_CLASS[el.role] || ""}`} style=${el.role ? "" : `background:${st.fill || "#eef2f7"};border:${st.borderWidth || 0}px solid ${st.borderColor || "transparent"};border-radius:${st.radius ?? 4}px`}></div>`;
    case "metric": {
      const d = el.delta ? fmtDelta(ev, el.evidence_id, el.delta.from, el.delta.kind) : null;
      return html`<div class="el-metric" style=${frame}><div class="lbl">${el.label}</div><div class="val">${fmtValue(ev[el.evidence_id]?.value, el.fmt)}</div>
        ${d && html`<div class="dlt" style=${`color:${d.sign < 0 ? "#b91c1c" : "#15803d"}`}>${d.sign < 0 ? "▼" : "▲"} ${d.text}</div>`}<div class="note">${el.note}</div></div>`;
    }
    case "table": return html`<div class="el-table" style=${frame}><table><thead><tr>${el.columns.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>
      ${el.rows.map((r) => html`<tr><td>${r.label}</td>${r.cells.map((c) => html`<td>${c.evidence_id ? fmtValue(ev[c.evidence_id]?.value, c.fmt) : c.delta ? fmtDelta(ev, c.delta.to, c.delta.from, c.delta.kind).text : c.text}</td>`)}</tr>`)}
      </tbody></table><div class="fn">${el.footnote}</div></div>`;
    case "barchart": {
      const vals = el.bars.map((b) => ev[b.evidence_id]?.value ?? 0), max = Math.max(...vals, 1e-9);
      return html`<div class="el-bar" style=${frame}><div class="ttl">${el.title}</div><div class="rows">${el.bars.map((b, i) => html`<div class="br"><div>${b.label}</div><div class="track"><div class="fill" style=${`width:${(vals[i] / max) * 100}%`}></div></div><div class="v">${fmtValue(vals[i], el.fmt)}</div></div>`)}</div></div>`;
    }
    case "sources": return html`<div class="el-sources"><b>${el.prefix || "Sources:"}</b> ${line}</div>`;
    case "gap": return html`<div class="el-gap"><div class="gl">Data gap</div>${el.text}</div>`;
    case "pending": return html`<div class="el-pending"><div class="pt">⟳ ${el.title}</div><div>${el.text}</div><div class="pi">waiting for research · ${el.request_id}</div></div>`;
    case "chart": {
      const spec = ctx.charts[el.chart_id];
      if (!spec) return html`<div class="el-missing">Unknown chart ${el.chart_id}</div>`;
      const series = ctx.series(el.chart_id);
      if (mini) {  // thumbnails: static deterministic SVG, no chart engine instance
        const svg = renderLineChart({ x: series.x, xType: "category", unit: "", title: "", width: el.w, height: el.h,
          series: series.series.map((s, i) => ({ name: "", color: ctx.dna.series[(s.role ?? i) % ctx.dna.series.length], values: s.values })) }).svg;
        return html`<div class="el-chart" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
      }
      return html`<div class="el-chart"><${ChartView} spec=${spec} series=${series} dna=${ctx.dna} w=${el.w - 2} h=${el.h - 2} /></div>`;
    }
    case "datatable": {
      const dss = el.dataset_ids.map((d) => ctx.datasets[d]).filter(Boolean);
      const val = (ds, date) => ds.observations.find((o) => String(o.date) === String(date));
      return html`<div class="el-table dt"><div class="ttl">${el.title}</div><table><thead><tr><th></th>${el.dates.map((d) => html`<th>${d}</th>`)}</tr></thead><tbody>
        ${dss.map((ds) => html`<tr><td>${ds.entity}</td>${el.dates.map((d) => { const o = val(ds, d); const rev = ds.revisions?.some((r) => String(r.date) === String(d) && r.status === "pending_verification");
          return html`<td class=${o?.value == null ? "gap" : ""}>${o?.value == null ? "–" : fmtValue(o.value, el.fmt)}${rev ? html`<sup class="revmark" title="User revision pending verification (not shown)">†</sup>` : ""}</td>`; })}</tr>`)}
        </tbody></table><div class="fn">${dss[0]?.unit} · ${dss[0]?.frequency}, ${dss[0]?.observation_type?.replace(/_/g, " ")}${dss.some((d) => d.revisions?.length) ? " · † revision pending verification" : ""}</div></div>`;
    }
    default: return html`<div class="el-missing">${el.type}</div>`;
  }
}

export const ElementView = memo(({ el, ctx, mini, selected, line }) => html`
  <div class=${`el ${selected ? "is-sel" : ""} ${el.locked ? "locked" : ""}`} data-id=${el.id}
       style=${`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${el.rotation ? `transform:rotate(${el.rotation}deg);` : ""}`}>
    <${Inner} el=${el} ctx=${ctx} mini=${mini} line=${line} />
    ${!mini && isBound(el) ? html`<span class="lockbadge no-export" title="Figures come from verified evidence or datasets; they can't be typed over">🔒</span>` : ""}
  </div>`);

export const SlideView = memo(({ els, ctx, dnaStyle, mini, selected = "" }) => {
  const sel = new Set(selected.split(",").filter(Boolean));
  return html`<div class=${`slide ${mini ? "mini" : ""}`} style=${dnaStyle}>${els.map((el) => html`<${ElementView} key=${el.id} el=${el} ctx=${ctx} mini=${mini} selected=${sel.has(el.id)} line=${el.type === "sources" ? sourceLine(els, ctx) : undefined} />`)}</div>`;
});
