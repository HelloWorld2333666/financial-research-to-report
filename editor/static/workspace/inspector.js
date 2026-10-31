// Properties panel: one inspector per element type. Everything here is a manual edit (no AI needed).
import { html } from "./html.js";
import { useStore } from "./store.js";
import { Icon, ICON_LIBRARY } from "./icons.js";
import { TableGrid, DataTableGrid } from "./sheets.js";
import { TYPE_LABEL, elementName, boundValue, evLabel, sourceTitle, unverifiedEdits, fmtValue } from "./model.js";
import { setProp, setMetric, arrange, align, group, ungroup, del, setLock, chartOps } from "./edit.js";

const FONTS = ["Helvetica Neue", "Inter", "Georgia", "Avenir Next", "Arial", "Times New Roman"];
const Row = ({ label, children }) => html`<label class="prop"><span>${label}</span><div class="pv">${children}</div></label>`;
const Color = ({ value, onChange }) => html`<input type="color" class="swatch" value=${value || "#ffffff"} onInput=${(e) => onChange(e.target.value)} />`;
const Num = ({ value, onChange, min, max, step = 1, w = 64 }) => html`<input type="number" class="num" style=${`width:${w}px`} value=${value ?? ""} min=${min} max=${max} step=${step} onChange=${(e) => onChange(+e.target.value)} />`;
const Toggle = ({ on, onClick, icon, title }) => html`<button class=${`icon-btn ${on ? "on" : ""}`} title=${title} onClick=${(e) => { e.preventDefault(); onClick(); }}><${Icon} name=${icon} size=${16} /></button>`;
const Section = ({ title, children }) => html`<section class="psec"><h4>${title}</h4>${children}</section>`;

export function Inspector({ store, ctx, toast, openSheet, onUpload, onReconstruct }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const sel = ui.selected.map((id) => p.elements.find((e) => e.id === id)).filter(Boolean);
  if (!sel.length) return html`<div class="pbody empty-state"><${Icon} name="sliders" size=${28} /><p><b>Nothing selected</b></p><p class="muted">Select an object on the slide to edit its text, data, style and position. Double-click text or a table cell to edit it in place.</p></div>`;
  if (sel.length > 1) return html`<div class="pbody">
    <${Section} title=${`${sel.length} objects`}>
      <div class="btn-row">${["left", "center", "right", "top", "middle", "bottom"].map((a) => html`<button class="btn sm" onClick=${() => align(store, sel, a)}>${a[0].toUpperCase() + a.slice(1)}</button>`)}</div>
      <div class="btn-row"><button class="btn sm" onClick=${() => group(store, ui.selected)}><${Icon} name="group" size=${14} /> Group</button>
        <button class="btn sm" onClick=${() => ungroup(store, ui.selected)}><${Icon} name="ungroup" size=${14} /> Ungroup</button>
        <button class="btn sm" onClick=${() => arrange(store, ui.selected, "front")}><${Icon} name="front" size=${14} /> Front</button>
        <button class="btn sm danger" onClick=${() => { del(store, ui.selected); store.ui({ selected: [] }); }}><${Icon} name="trash" size=${14} /> Delete</button></div>
    <//></div>`;
  const el = sel[0], st = el.style || {}, set = (label, fn) => setProp(store, el.id, label, fn);
  const styleSet = (k, label) => (v) => set(label, (e) => { e.style = { ...(e.style || {}), [k]: v }; });
  return html`<div class="pbody props">
    <div class="ph"><span class="type-chip"><${Icon} name=${{ text: "text", table: "table", datatable: "table", chart: p.charts[el.chart_id]?.type === "bar" ? "bar" : "linechart", barchart: "bar", image: "image", icon: "star", line: "line", shape: "square", metric: "trend" }[el.type] || "square"} size=${15} /> ${TYPE_LABEL[el.type]}</span>
      <input class="name-in" value=${elementName(el, p)} onChange=${(e) => set("Renamed", (x) => { x.name = e.target.value; })} title="Layer name" /></div>
    ${typeSection(el, { p, ctx, store, set, styleSet, st, toast, openSheet, onUpload, onReconstruct })}
    <${Section} title="Position and size">
      <div class="geo">${["x", "y", "w", "h"].map((k) => html`<label class="g"><span>${k.toUpperCase()}</span><${Num} w=${58} value=${Math.round(el[k])} onChange=${(v) => set(`Changed ${k}`, (x) => { x[k] = k === "w" || k === "h" ? Math.max(2, v) : v; })} /></label>`)}
        <label class="g"><span>↻</span><${Num} w=${58} value=${el.rotation || 0} onChange=${(v) => set("Rotated", (x) => { x.rotation = v; })} /></label></div>
      <div class="btn-row">
        <button class="btn sm" onClick=${() => arrange(store, [el.id], "front")} title="Bring to front"><${Icon} name="front" size=${14} /> Front</button>
        <button class="btn sm" onClick=${() => arrange(store, [el.id], "back")} title="Send to back"><${Icon} name="back" size=${14} /> Back</button>
        <button class="btn sm" onClick=${() => setLock(store, [el.id], !el.locked)}><${Icon} name=${el.locked ? "unlock" : "lock"} size=${14} /> ${el.locked ? "Unlock" : "Lock"}</button>
        <button class="btn sm danger" onClick=${() => { del(store, [el.id]); store.ui({ selected: [] }); }}><${Icon} name="trash" size=${14} /> Delete</button></div>
      ${el.locked ? html`<p class="muted small">Locked objects can't be moved or deleted. Unlock to edit their position; content stays editable.</p>` : ""}
    <//>
  </div>`;
}

function textControls(st, styleSet) {
  return html`
    <${Row} label="Font"><select value=${st.fontFamily || ""} onChange=${(e) => styleSet("fontFamily", "Changed font")(e.target.value || undefined)}><option value="">Deck font</option>${FONTS.map((f) => html`<option>${f}</option>`)}</select><//>
    <${Row} label="Size"><${Num} value=${st.fontSize || ""} min=${6} max=${96} onChange=${styleSet("fontSize", "Changed font size")} /><span class="unit">px</span>
      <${Toggle} icon="bold" title="Bold" on=${+st.fontWeight >= 600} onClick=${() => styleSet("fontWeight", "Bold")(+st.fontWeight >= 600 ? 400 : 700)} />
      <${Toggle} icon="italic" title="Italic" on=${st.italic} onClick=${() => styleSet("italic", "Italic")(!st.italic)} />
      <${Toggle} icon="underline" title="Underline" on=${st.underline} onClick=${() => styleSet("underline", "Underline")(!st.underline)} /><//>
    <${Row} label="Colour"><${Color} value=${st.color || "#0f2742"} onChange=${styleSet("color", "Changed text colour")} />
      ${["left", "center", "right"].map((a) => html`<${Toggle} icon=${{ left: "alignL", center: "alignC", right: "alignR" }[a]} title=${`Align ${a}`} on=${(st.align || "left") === a} onClick=${() => styleSet("align", "Aligned text")(a)} />`)}<//>
    <${Row} label="Spacing"><select value=${st.lineHeight || ""} onChange=${(e) => styleSet("lineHeight", "Changed line spacing")(e.target.value || undefined)}><option value="">Auto</option>${[1.1, 1.25, 1.4, 1.6, 1.8].map((v) => html`<option>${v}</option>`)}</select>
      <span class="unit">Fill</span><${Color} value=${st.fill || "#ffffff"} onChange=${styleSet("fill", "Changed fill")} />${st.fill ? html`<button class="mini-btn" title="Remove fill" onClick=${() => styleSet("fill", "Removed fill")(undefined)}><${Icon} name="close" size=${12} /></button>` : ""}<//>`;
}

function typeSection(el, { p, ctx, store, set, styleSet, st, toast, openSheet, onUpload, onReconstruct }) {
  switch (el.type) {
    case "text": return html`<${Section} title="Text">
      ${el.cited_text_original != null && el.cited_text_original !== el.text ? html`<div class="note-box warn"><${Icon} name="warn" size=${15} /><div><b>Wording changed from the verified text.</b> The linked claims are kept; this wording needs re-verification.
        <div class="btn-row"><button class="btn sm" onClick=${() => set("Restored verified wording", (x) => { x.text = x.cited_text_original; delete x.html; })}>Restore verified wording</button></div></div></div>` : ""}
      ${el.role ? html`<p class="muted small">Uses the deck's <b>${el.role}</b> style. Changes here override it for this text only.</p>` : ""}
      ${textControls(st, styleSet)}
      <p class="muted small">Double-click the text on the slide to type. Select words and press ⌘B / ⌘I / ⌘U for inline styling.</p><//>`;
    case "shape": case "panel": return html`<${Section} title="Shape">
      ${el.role ? html`<p class="muted small">Styled by the deck (${el.role}).</p>` : ""}
      <${Row} label="Fill"><${Color} value=${st.fill} onChange=${styleSet("fill", "Changed fill")} /><span class="unit">Opacity</span><${Num} w=${56} value=${Math.round((st.opacity ?? 1) * 100)} min=${0} max=${100} onChange=${(v) => styleSet("opacity", "Changed opacity")(v / 100)} /><//>
      <${Row} label="Border"><${Color} value=${st.borderColor || "#cccccc"} onChange=${styleSet("borderColor", "Changed border")} /><${Num} w=${50} value=${st.borderWidth ?? 0} min=${0} max=${12} onChange=${styleSet("borderWidth", "Changed border width")} /><span class="unit">px</span><//>
      ${el.type === "shape" ? html`<${Row} label="Corners">${el.shape === "ellipse" ? html`<span class="muted small">Ellipse</span>` : html`<${Num} value=${st.radius ?? 0} min=${0} max=${200} onChange=${styleSet("radius", "Changed corners")} /><span class="unit">px</span>`}<//>
        <${Row} label="Label">${el.text != null ? html`<button class="btn sm" onClick=${() => set("Removed label", (x) => { delete x.text; })}>Remove label</button>` : html`<button class="btn sm" onClick=${() => set("Added label", (x) => { x.text = "Label"; })}>Add label</button>`}<//>` : ""}<//>`;
    case "line": return html`<${Section} title="Line">
      <${Row} label="Stroke"><${Color} value=${st.color || "#0f2742"} onChange=${styleSet("color", "Changed line colour")} /><${Num} w=${50} value=${st.width || 2} min=${1} max=${16} onChange=${styleSet("width", "Changed line width")} /><span class="unit">px</span>
        <${Toggle} icon="more" title="Dashed" on=${st.dash} onClick=${() => styleSet("dash", "Dashed line")(!st.dash)} /><//>
      <${Row} label="Ends"><${Toggle} icon="arrow" title="Arrow at end" on=${el.arrow_end} onClick=${() => set("Arrowhead", (x) => { x.arrow_end = !x.arrow_end; })} />
        <button class="btn sm" onClick=${() => set("Arrowhead", (x) => { x.arrow_start = !x.arrow_start; })}>${el.arrow_start ? "Remove start arrow" : "Start arrow"}</button>
        <button class="btn sm" onClick=${() => set("Flipped direction", (x) => { x.flip = !x.flip; })}>Flip</button><//><//>`;
    case "image": { const cr = el.crop || { zoom: 1, ox: 50, oy: 50 }, f = el.filters || {}, setCrop = (k, label) => (v) => set(label, (x) => { x.crop = { ...cr, [k]: v }; }), setF = (k) => (v) => set("Adjusted image", (x) => { x.filters = { ...f, [k]: v }; });
      return html`<${Section} title="Image">
        <div class="btn-row"><button class="btn sm" onClick=${() => onUpload(el.id)}><${Icon} name="upload" size=${14} /> Replace</button><button class="btn sm" onClick=${() => onReconstruct(el)}><${Icon} name="table" size=${14} /> Reconstruct as editable table…</button></div>
        <${Row} label="Crop zoom"><input type="range" min="1" max="3" step="0.05" value=${cr.zoom} onInput=${(e) => setCrop("zoom", "Cropped image")(+e.target.value)} /><//>
        <${Row} label="Position X"><input type="range" min="0" max="100" value=${cr.ox} onInput=${(e) => setCrop("ox", "Repositioned image")(+e.target.value)} /><//>
        <${Row} label="Position Y"><input type="range" min="0" max="100" value=${cr.oy} onInput=${(e) => setCrop("oy", "Repositioned image")(+e.target.value)} /><//>
        ${[["brightness", "Brightness"], ["contrast", "Contrast"], ["saturate", "Saturation"]].map(([k, l]) => html`<${Row} label=${l}><input type="range" min="40" max="160" value=${f[k] ?? 100} onInput=${(e) => setF(k)(+e.target.value)} /><//>`)}
        <${Row} label="Corners"><${Num} value=${st.radius || 0} min=${0} max=${200} onChange=${styleSet("radius", "Changed corners")} /><span class="unit">px</span><//>
        <p class="muted small">Numbers inside a picture are not data. Use “Reconstruct as editable table” to re-enter them as structured, verifiable values.</p><//>`; }
    case "icon": return html`<${Section} title="Icon"><div class="icon-grid">${ICON_LIBRARY.map((n) => html`<button class=${`icon-btn ${el.icon === n ? "on" : ""}`} onClick=${() => set("Changed icon", (x) => { x.icon = n; })}><${Icon} name=${n} /></button>`)}</div>
      <${Row} label="Colour"><${Color} value=${st.color || "#c8102e"} onChange=${styleSet("color", "Changed icon colour")} /><${Num} w=${50} value=${st.stroke || 1.6} min=${0.5} max=${4} step=${0.1} onChange=${styleSet("stroke", "Changed stroke")} /><//><//>`;
    case "metric": { const v = boundValue(ctx.ev, el), sc = el.fmt?.scale || 1;
      return html`<${Section} title="Metric">
        <${Row} label="Label"><input value=${el.label} onChange=${(e) => set("Edited label", (x) => { x.label = e.target.value; })} /><//>
        <${Row} label="Value"><input value=${v.value != null ? +(v.value / sc).toFixed(4) : ""} onChange=${(e) => setMetric(store, el.id, e.target.value, toast)} /><span class="unit">${el.fmt?.suffix || ""}</span><//>
        ${v.evidence ? html`<div class="srcbox"><div class="ci-title"><${Icon} name=${v.edited ? "edit" : "shield"} size=${15} /> ${evLabel(v.evidence)}</div>
          <div class="muted small">Source value ${fmtValue(v.source, el.fmt)} · ${sourceTitle(p, v.evidence)} · ${v.edited ? html`<span class="warn-t">edited · pending verification</span>` : html`<span class="ok-t">${v.evidence.verification}</span>`}</div>
          ${v.edited ? html`<button class="btn sm" onClick=${() => setMetric(store, el.id, "", toast)}><${Icon} name="restore" size=${14} /> Restore source value</button>` : ""}</div>` : ""}
        <${Row} label="Note"><input value=${el.note || ""} onChange=${(e) => set("Edited note", (x) => { x.note = e.target.value; })} /><//>
        <${Row} label="Decimals"><${Num} value=${el.fmt?.decimals ?? 1} min=${0} max=${4} onChange=${(d) => set("Changed decimals", (x) => { x.fmt = { ...x.fmt, decimals: d }; })} /><//><//>`; }
    case "table": return html`<${Section} title="Table data"><${TableGrid} store=${store} p=${p} ev=${ctx.ev} el=${el} toast=${toast} /><//>
      <${Section} title="Table style">
        <${Row} label="Title"><input value=${el.title || ""} placeholder="(none)" onChange=${(e) => set("Edited title", (x) => { x.title = e.target.value; })} /><//>
        <${Row} label="Header"><${Color} value=${st.headerFill || "#ffffff"} onChange=${styleSet("headerFill", "Header fill")} /><span class="unit">Text</span><${Color} value=${st.headerColor || "#5b6b7f"} onChange=${styleSet("headerColor", "Header text colour")} /><//>
        <${Row} label="Body"><${Color} value=${st.fill || "#ffffff"} onChange=${styleSet("fill", "Table fill")} /><span class="unit">Border</span><${Color} value=${st.borderColor || "#d5dbe3"} onChange=${styleSet("borderColor", "Table border")} /><//>
        <${Row} label="Font size"><${Num} value=${st.fontSize || 11} min=${7} max=${20} onChange=${styleSet("fontSize", "Table font size")} /><span class="unit">px</span>
          ${["left", "center", "right"].map((a) => html`<${Toggle} icon=${{ left: "alignL", center: "alignC", right: "alignR" }[a]} title=${`Align numbers ${a}`} on=${(st.align || "right") === a} onClick=${() => styleSet("align", "Aligned cells")(a)} />`)}<//>
        <${Row} label="Footnote"><input value=${el.footnote || ""} onChange=${(e) => set("Edited footnote", (x) => { x.footnote = e.target.value; })} /><//><//>`;
    case "datatable": return html`<${Section} title="Table data"><${DataTableGrid} store=${store} p=${p} el=${el} toast=${toast} /><//>
      <${Section} title="Table style"><${Row} label="Title"><input value=${el.title || ""} onChange=${(e) => set("Edited title", (x) => { x.title = e.target.value; })} /><//>
        <${Row} label="Decimals"><${Num} value=${el.fmt?.decimals ?? 1} min=${0} max=${4} onChange=${(d) => set("Changed decimals", (x) => { x.fmt = { ...x.fmt, decimals: d }; })} /><//>
        <${Row} label="Header"><${Color} value=${st.headerFill || "#ffffff"} onChange=${styleSet("headerFill", "Header fill")} /><span class="unit">Font</span><${Num} value=${st.fontSize || 12} min=${7} max=${20} onChange=${styleSet("fontSize", "Table font size")} /><//><//>`;
    case "barchart": return html`<${Section} title="Chart">
      <button class="btn primary wide" onClick=${() => openSheet(el.id)}><${Icon} name="table" size=${15} /> Edit data</button>
      <${Row} label="Title"><input value=${el.title} onChange=${(e) => set("Edited title", (x) => { x.title = e.target.value; })} /><//>
      <${Row} label="Bars"><${Color} value=${st.bar || "#0f2742"} onChange=${styleSet("bar", "Bar colour")} /><span class="unit">Gap</span><${Num} w=${50} value=${st.barGap ?? 6} min=${0} max=${30} onChange=${styleSet("barGap", "Bar spacing")} /><//>
      <${Row} label="Decimals"><${Num} value=${el.fmt?.decimals ?? 1} min=${0} max=${3} onChange=${(d) => set("Changed decimals", (x) => { x.fmt = { ...x.fmt, decimals: d }; })} /><//><//>`;
    case "chart": { const spec = p.charts[el.chart_id], sst = spec.style || {}, cs = (label, fn) => chartOps.setSpec(store, el.chart_id, label, fn), ss = (k, label) => (v) => cs(label, (c) => { c.style = { ...(c.style || {}), [k]: v }; });
      const edits = spec.series.reduce((n, s) => n + unverifiedEdits(p.datasets[s.dataset]), 0);
      return html`<${Section} title="Chart">
        <button class="btn primary wide" onClick=${() => openSheet(el.id)}><${Icon} name="table" size=${15} /> Edit data</button>
        ${edits ? html`<div class="note-box warn"><${Icon} name="warn" size=${15} /><div>${edits} manually edited observation${edits === 1 ? "" : "s"} — pending verification.</div></div>` : ""}
        <${Row} label="Type"><span class="seg">${["line", "bar"].map((t) => html`<button class=${spec.type === t ? "on" : ""} onClick=${() => cs(`Chart type: ${t}`, (c) => { c.type = t; })}>${t === "line" ? "Line" : "Bar"}</button>`)}</span><//>
        <${Row} label="Title"><input value=${spec.title} onChange=${(e) => cs("Chart title", (c) => { c.title = e.target.value; })} /><//>
        <${Row} label="Labels"><select value=${spec.labels || "end"} onChange=${(e) => cs("Chart labels", (c) => { c.labels = e.target.value; })}><option value="end">End of line</option><option value="legend">Legend</option><option value="none">None</option></select><//>
        <${Row} label="Y axis"><input placeholder="Axis title / unit" value=${sst.y_title || ""} onChange=${(e) => ss("y_title", "Axis title")(e.target.value)} />
          <label class="chk"><input type="checkbox" checked=${!!spec.y?.zero} onChange=${(e) => cs("Y axis from zero", (c) => { c.y = { ...c.y, zero: e.target.checked }; })} /> from 0</label><//>
        ${spec.type === "line" ? html`<${Row} label="Lines"><${Num} w=${50} value=${sst.line_width || 1.8} min=${0.5} max=${6} step=${0.1} onChange=${ss("line_width", "Line width")} /><span class="unit">px</span>
          <label class="chk"><input type="checkbox" checked=${!!sst.markers} onChange=${(e) => ss("markers", "Markers")(e.target.checked)} /> markers</label><//>`
          : html`<${Row} label="Bars"><span class="unit">Spacing</span><${Num} w=${56} value=${sst.bar_gap ?? 30} min=${0} max=${80} onChange=${ss("bar_gap", "Bar spacing")} /><span class="unit">%</span><//>`}
        <${Row} label="Values"><label class="chk"><input type="checkbox" checked=${sst.data_labels ?? spec.x?.mode === "snapshot"} onChange=${(e) => ss("data_labels", "Data labels")(e.target.checked)} /> show data labels</label><//>
        <${Row} label="Colours"><span class="muted small">From Design DNA series colours</span><//>
      <//>
      <${Section} title="Data sources">${spec.series.map((s, i) => { const d = p.datasets[s.dataset]; return html`<div class="srow"><i class="sw" style=${`background:${p.design_dna.series[(s.role ?? i) % p.design_dna.series.length]}`}></i>
        <div><div>${d?.title}</div><div class="muted small">${d?.unit} · ${d?.frequency} · ${d?.origin === "synthetic" ? html`<span class="warn-t">SAMPLE data</span>` : d?.origin === "manual" ? html`<span class="warn-t">manual, no source</span>` : d?.verification}${unverifiedEdits(d) ? html` · <span class="warn-t">${unverifiedEdits(d)} edited</span>` : ""}</div></div></div>`; })}<//>`; }
    default: return "";
  }
}
