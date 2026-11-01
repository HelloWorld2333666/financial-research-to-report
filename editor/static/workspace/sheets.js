// Spreadsheet-style editors: chart data sheet (bottom drawer), bar data sheet, table and data-table grids.
// Typing into a sourced cell creates a working edit; the source record stays as it was.
import { useState, useRef, useEffect } from "preact/hooks";
import { html } from "./html.js";
import { Icon } from "./icons.js";
import { effectiveObs, chartSeries, compatibility, boundValue, evLabel, sourceTitle, chartEdits } from "./model.js";
import { setObservation, restoreObservation, restoreDataset, markVerified, addObservationDate, chartOps, barOps, setTableCell, restoreTableCell, tableOps } from "./edit.js";

/** A cell input that commits on Enter/blur and reverts on Escape. Arrow/Enter move focus within the grid. */
function Cell({ value, onCommit, cls = "", title = "", placeholder = "", onPaste, onFocus, align = "right" }) {
  const [v, setV] = useState(value ?? ""); const focused = useRef(false), committed = useRef(null);
  useEffect(() => { committed.current = null; if (!focused.current) setV(value ?? ""); }, [value]);
  // Enter commits and moves focus; the blur that follows must not commit the same value again (one undo step per edit)
  const commit = () => { const s = String(v); if (s !== String(value ?? "") && s !== committed.current) { committed.current = s; onCommit(v); } };
  const move = (e, dr, dc) => { const td = e.target.closest("td"), tr = td.parentElement, idx = [...tr.children].indexOf(td);
    const target = dr ? tr[dr > 0 ? "nextElementSibling" : "previousElementSibling"]?.children[idx] : td[dc > 0 ? "nextElementSibling" : "previousElementSibling"];
    target?.querySelector("input")?.focus(); };
  return html`<input class=${`cell ${cls}`} value=${v} title=${title} placeholder=${placeholder} style=${`text-align:${align}`}
    onInput=${(e) => setV(e.target.value)} onFocus=${(e) => { focused.current = true; e.target.select(); onFocus?.(); }}
    onBlur=${() => { focused.current = false; commit(); }} onPaste=${onPaste}
    onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); move(e, e.shiftKey ? -1 : 1, 0); }
      else if (e.key === "Escape") { setV(value ?? ""); e.target.blur(); }
      else if (e.key === "Tab") { commit(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey) { e.preventDefault(); commit(); move(e, e.key === "ArrowDown" ? 1 : -1, 0); } }} />`;
}

const status = (n) => n ? html`<span class="pill warn"><${Icon} name="warn" size=${14} /> ${n} manually edited observation${n === 1 ? "" : "s"} — pending verification</span>` : html`<span class="pill ok"><${Icon} name="check" size=${14} /> Matches source data</span>`;

// ------------------------------------------------------------------ chart data sheet (bottom drawer)
const ROW_H = 30;
export function ChartDataSheet({ store, p, el, onClose, toast }) {
  const spec = p.charts[el.chart_id], snap = spec.x?.mode === "snapshot", dsIds = spec.series.map((s) => s.dataset);
  const [compare, setCompare] = useState(false), [scroll, setScroll] = useState(0), [newDate, setNewDate] = useState(""), [newSeries, setNewSeries] = useState(null);
  const series = chartSeries(p, el.chart_id), edits = chartEdits(p, el.chart_id);
  const allDates = [...new Set(dsIds.flatMap((id) => effectiveObs(p.datasets[id]).map((o) => o.date)))].sort();
  const obsMap = Object.fromEntries(dsIds.map((id) => [id, new Map(effectiveObs(p.datasets[id]).map((o) => [o.date, o]))]));
  const rows = snap ? [] : allDates.filter((d) => (!spec.x?.from || d >= spec.x.from) && (!spec.x?.to || d <= spec.x.to));
  const compatible = Object.entries(p.datasets).filter(([id, d]) => !dsIds.includes(id) && effectiveObs(d).length && compatibility(p, [...dsIds, id]).ok);
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 8), last = Math.min(rows.length, first + 40);
  const cell = (id, date) => { const o = obsMap[id].get(date), cls = o?.edited ? (o.status === "verified" ? "verified" : "edited") : o?.value == null ? "missing" : "";
    const tip = o?.edited ? `Edited by ${o.by || "you"} · source value: ${o.source_value ?? "none (added)"} · ${o.status.replace(/_/g, " ")}` : o ? `Source value · ${p.datasets[id].source_note || ""}` : "No observation";
    return html`<td class="dc"><${Cell} value=${o?.value ?? ""} cls=${cls} title=${tip} placeholder="missing" onCommit=${(v) => setObservation(store, id, date, v, toast)} />
      ${compare && o?.edited ? html`<span class="src">src ${o.source_value ?? "–"}</span>` : ""}
      ${o?.edited ? html`<button class="mini-btn" title="Restore source value" onClick=${() => restoreObservation(store, id, date)}><${Icon} name="restore" size=${13} /></button>` : ""}</td>`; };
  const addSeries = (e) => { const v = e.target.value; e.target.value = "";
    if (v === "__manual") setNewSeries("");
    else if (v) chartOps.addSeries(store, el.chart_id, v); };
  const createSeries = () => { const name = (newSeries || "").trim(); if (!name) return;
    chartOps.addManualSeries(store, el.chart_id, name, dsIds[0]); setNewSeries(null); toast(`Added “${name}”: values start empty (gaps) until you type them`); };
  return html`<section class="sheet" aria-label="Chart data">
    <header class="sheet-head">
      <div class="sh-title"><${Icon} name=${spec.type === "bar" ? "bar" : "linechart"} /> <b>Edit data</b><span class="muted">${spec.title}</span></div>
      <div class="sh-tools">
        <span class="seg">${["line", "bar"].map((t) => html`<button class=${spec.type === t ? "on" : ""} onClick=${() => chartOps.setSpec(store, el.chart_id, `Chart type: ${t}`, (c) => { c.type = t; })}>${t === "line" ? "Line" : "Bar"}</button>`)}</span>
        ${snap ? html`<label class="inline">Date <select value=${spec.x.date} onChange=${(e) => chartOps.setSpec(store, el.chart_id, "Changed date", (c) => { c.x.date = e.target.value; })}>${allDates.map((d) => html`<option>${d}</option>`)}</select></label>`
          : html`<label class="inline">From <select value=${spec.x?.from} onChange=${(e) => chartOps.setSpec(store, el.chart_id, "Changed range", (c) => { c.x = { ...c.x, from: e.target.value }; })}>${allDates.map((d) => html`<option>${d}</option>`)}</select></label>
            <label class="inline">to <select value=${spec.x?.to} onChange=${(e) => chartOps.setSpec(store, el.chart_id, "Changed range", (c) => { c.x = { ...c.x, to: e.target.value }; })}>${allDates.map((d) => html`<option>${d}</option>`)}</select></label>
            <label class="inline"><input placeholder="Add date, e.g. 2027" value=${newDate} onInput=${(e) => setNewDate(e.target.value)} size="12" />
              <button class="btn sm" onClick=${() => { addObservationDate(store, dsIds, newDate, toast); setNewDate(""); }}><${Icon} name="plus" size=${14} /> Row</button></label>`}
        <select class="btn sm" onChange=${addSeries}><option value="">＋ Series…</option>${compatible.map(([id, d]) => html`<option value=${id}>${d.title}</option>`)}<option value="__manual">New manual series…</option></select>
        ${newSeries !== null ? html`<label class="inline"><input autofocus placeholder="New series name" value=${newSeries} onInput=${(e) => setNewSeries(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") createSeries(); if (e.key === "Escape") setNewSeries(null); }} size="14" />
          <button class="btn sm primary" onClick=${createSeries}>Add</button><button class="btn sm ghost" onClick=${() => setNewSeries(null)}>Cancel</button></label>` : ""}
        <label class="inline"><input type="checkbox" checked=${compare} onChange=${(e) => setCompare(e.target.checked)} /> Compare with source</label>
        <button class="icon-btn" title="Close data editor (Esc)" onClick=${onClose}><${Icon} name="close" /></button>
      </div>
    </header>
    <div class="sheet-status">${status(edits)}
      ${edits ? html`<button class="btn sm ghost" onClick=${() => restoreDataset(store, dsIds)}><${Icon} name="restore" size=${14} /> Restore original data</button>
        <button class="btn sm ghost" onClick=${() => { markVerified(store, dsIds); toast("Simulated: edits marked as verified. A real workflow would check them against the source."); }}><${Icon} name="shield" size=${14} /> Verify (simulated)</button>` : ""}
      <span class="muted small">${p.datasets[dsIds[0]]?.unit || ""} · ${p.datasets[dsIds[0]]?.frequency || ""} · empty cell = missing (shown as a gap, never estimated)</span></div>
    ${snap ? html`<div class="grid-wrap"><table class="grid"><thead><tr><th>Category</th><th>Value (${spec.x.date})</th><th>Source dataset</th><th></th></tr></thead><tbody>
        ${spec.series.map((s, i) => html`<tr><td><${Cell} align="left" value=${s.label} onCommit=${(v) => chartOps.renameSeries(store, el.chart_id, i, v)} /></td>${cell(s.dataset, String(spec.x.date))}
          <td class="muted small">${p.datasets[s.dataset]?.title}</td><td><button class="mini-btn" title="Remove category" onClick=${() => chartOps.removeSeries(store, el.chart_id, i)}><${Icon} name="trash" size=${14} /></button></td></tr>`)}
      </tbody></table></div>`
      : html`<div class="grid-wrap virt" onScroll=${(e) => setScroll(e.target.scrollTop)}><table class="grid"><thead><tr><th>Date</th>
        ${spec.series.map((s, i) => html`<th><div class="sh-col"><i class="sw" style=${`background:${p.design_dna.series[(s.role ?? i) % p.design_dna.series.length]}`}></i>
          <${Cell} align="left" value=${s.label} onCommit=${(v) => chartOps.renameSeries(store, el.chart_id, i, v)} />
          <button class="mini-btn" title="Remove series" onClick=${() => chartOps.removeSeries(store, el.chart_id, i)}><${Icon} name="close" size=${13} /></button></div></th>`)}</tr></thead>
        <tbody><tr style=${`height:${first * ROW_H}px`}></tr>
          ${rows.slice(first, last).map((d) => html`<tr key=${d} style=${`height:${ROW_H}px`}><td class="date">${d}</td>${dsIds.map((id) => cell(id, d))}</tr>`)}
          <tr style=${`height:${(rows.length - last) * ROW_H}px`}></tr></tbody></table></div>`}
    <footer class="sheet-foot muted small">${series.x.length} ${snap ? "categories" : "dates"} · plotted from the working data · original source records unchanged</footer>
  </section>`;
}

// ------------------------------------------------------------------ bar data sheet (evidence-bound horizontal bars)
export function BarDataSheet({ store, p, ev, el, onClose, toast }) {
  const vals = el.bars.map((b) => boundValue(ev, b)), edits = vals.filter((v) => v.edited).length;
  return html`<section class="sheet" aria-label="Chart data">
    <header class="sheet-head"><div class="sh-title"><${Icon} name="bar" /> <b>Edit data</b><span class="muted">${el.title}</span></div>
      <div class="sh-tools"><button class="btn sm" onClick=${() => barOps.add(store, el.id)}><${Icon} name="plus" size=${14} /> Category</button>
        <button class="icon-btn" title="Close data editor (Esc)" onClick=${onClose}><${Icon} name="close" /></button></div></header>
    <div class="sheet-status">${status(edits)}<span class="muted small">Values in source units (${vals[0]?.evidence?.unit || "as entered"}); display format ${el.fmt?.scale ? `÷ ${el.fmt.scale.toLocaleString()}` : "as is"}</span></div>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>Category</th><th>Working value</th><th>Source</th><th></th></tr></thead><tbody>
      ${el.bars.map((b, i) => { const v = vals[i]; return html`<tr>
        <td><${Cell} align="left" value=${b.label} onCommit=${(x) => barOps.label(store, el.id, i, x)} /></td>
        <td class="dc"><${Cell} value=${v.value ?? ""} cls=${v.edited ? "edited" : ""} onCommit=${(x) => barOps.set(store, el.id, i, x, toast)} />
          ${v.edited && b.evidence_id ? html`<button class="mini-btn" title="Restore source value" onClick=${() => barOps.restore(store, el.id, i)}><${Icon} name="restore" size=${13} /></button>` : ""}</td>
        <td class="small">${v.evidence ? html`<div>${evLabel(v.evidence)}</div><div class="muted">${v.source?.toLocaleString()} ${v.evidence.unit} · ${sourceTitle(p, v.evidence)} · <span class=${v.evidence.verification === "verified" ? "ok-t" : "warn-t"}>${v.evidence.verification}</span></div>` : html`<span class="warn-t">Manual value — no source</span>`}</td>
        <td><button class="mini-btn" title="Remove category" onClick=${() => barOps.remove(store, el.id, i)}><${Icon} name="trash" size=${14} /></button></td></tr>`; })}
    </tbody></table></div></section>`;
}

// ------------------------------------------------------------------ table editor (Properties panel)
const cellRaw = (ev, c) => (c.delta ? "(computed)" : c.evidence_id || c.working || "value" in c ? (boundValue(ev, c).value ?? "") : c.text ?? "");
export function TableGrid({ store, p, ev, el, toast }) {
  const [active, setActive] = useState({ r: 0, c: 0 }), [anchor, setAnchor] = useState(null);
  const nc = Math.max(0, ...el.rows.map((r) => r.cells.length)), cols = el.columns || [];
  const sel = anchor ? { r0: Math.min(anchor.r, active.r), r1: Math.max(anchor.r, active.r), c0: Math.min(anchor.c, active.c), c1: Math.max(anchor.c, active.c) } : { r0: active.r, r1: active.r, c0: active.c, c1: active.c };
  const inSel = (r, c) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
  const focus = (r, c, shift) => { if (shift) setAnchor((a) => a || active); else setAnchor(null); setActive({ r, c }); };
  const onPaste = (r, c) => (e) => { const t = e.clipboardData.getData("text/plain"); if (/[\t\n]/.test(t.trim())) { e.preventDefault(); tableOps.pasteTSV(store, el.id, r, c, t, toast); } };
  const onCopy = (e) => { if (!anchor) return; const lines = [];
    for (let r = sel.r0; r <= sel.r1; r++) { const row = []; for (let c = sel.c0; c <= sel.c1; c++) row.push(c === -1 ? el.rows[r].label : cellRaw(ev, el.rows[r].cells[c] || {})); lines.push(row.join("\t")); }
    e.clipboardData.setData("text/plain", lines.join("\n")); e.preventDefault(); toast(`Copied ${lines.length}×${sel.c1 - sel.c0 + 1} cells`); };
  const ac = el.rows[active.r]?.cells[active.c], acv = ac && boundValue(ev, ac), fmt = el.col_fmt?.[active.c] || ac?.fmt || {};
  const widths = el.col_widths || Array.from({ length: nc + 1 }, () => 1 / (nc + 1));
  const drag = (i) => (e) => { e.preventDefault(); let pending = null; const x0 = e.clientX, w0 = [...widths], total = e.target.closest("table").offsetWidth;
    const move = (m) => { const d = (m.clientX - x0) / total, w = [...w0]; w[i] = Math.max(0.06, w0[i] + d); w[i + 1] = Math.max(0.06, w0[i + 1] - d); pending = w; e.target.closest("table").querySelectorAll("col")[i].style.width = `${w[i] * 100}%`; };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); if (pending) tableOps.setColWidths(store, el.id, pending); };
    addEventListener("pointermove", move); addEventListener("pointerup", up); };
  return html`<div class="tg" onCopy=${onCopy}>
    <div class="tg-tools">
      <button class="btn sm" onClick=${() => tableOps.addRow(store, el.id, active.r + 1)} title="Insert row below"><${Icon} name="rows" size=${14} /> Row</button>
      <button class="btn sm" onClick=${() => tableOps.addCol(store, el.id, active.c)} title="Insert column right"><${Icon} name="cols" size=${14} /> Column</button>
      <button class="icon-btn" title="Move row up" onClick=${() => { tableOps.moveRow(store, el.id, active.r, -1); setActive({ ...active, r: Math.max(0, active.r - 1) }); }}>↑</button>
      <button class="icon-btn" title="Move row down" onClick=${() => { tableOps.moveRow(store, el.id, active.r, 1); setActive({ ...active, r: Math.min(el.rows.length - 1, active.r + 1) }); }}>↓</button>
      <button class="icon-btn" title="Sort by this column" onClick=${() => tableOps.sortBy(store, el.id, active.c, ev, false)}><${Icon} name="sort" size=${15} /></button>
      <span class="grow"></span>
      <button class="icon-btn danger" title="Delete row" disabled=${el.rows.length < 2} onClick=${() => { tableOps.deleteRow(store, el.id, active.r); setActive({ r: Math.max(0, active.r - 1), c: active.c }); }}><${Icon} name="rows" size=${15} />−</button>
      <button class="icon-btn danger" title="Delete column" disabled=${nc < 1 || active.c < 0} onClick=${() => { tableOps.deleteCol(store, el.id, active.c); setActive({ r: active.r, c: Math.max(0, active.c - 1) }); }}><${Icon} name="cols" size=${15} />−</button>
    </div>
    <div class="grid-wrap tall"><table class="grid editable"><colgroup>${widths.map((w) => html`<col style=${`width:${w * 100}%`} />`)}</colgroup>
      <thead><tr>${Array.from({ length: nc + 1 }, (_, i) => html`<th><div class="th-in"><${Cell} align="left" value=${cols[i] ?? ""} placeholder="Header" onCommit=${(v) => setTableCell(store, el.id, "h", i, v, toast)} />${i < nc ? html`<span class="col-resize" onPointerDown=${drag(i)}></span>` : ""}</div></th>`)}</tr></thead>
      <tbody>${el.rows.map((row, r) => html`<tr>
        <td class=${inSel(r, -1) ? "sel" : ""} onMouseDown=${(e) => focus(r, -1, e.shiftKey)}><${Cell} align="left" value=${row.label} onFocus=${() => !anchor && setActive({ r, c: -1 })} onPaste=${onPaste(r, -1)} onCommit=${(v) => setTableCell(store, el.id, r, -1, v, toast)} /></td>
        ${Array.from({ length: nc }, (_, c) => { const cc = row.cells[c] || {}, v = cc.evidence_id || cc.working || "value" in cc ? boundValue(ev, cc) : null;
          return html`<td class=${`${inSel(r, c) ? "sel" : ""} ${v?.edited ? "edited" : ""} ${cc.evidence_id && !v?.edited ? "sourced" : ""}`} onMouseDown=${(e) => focus(r, c, e.shiftKey)}>
            <${Cell} value=${cellRaw(ev, cc)} onFocus=${() => !anchor && setActive({ r, c })} onPaste=${onPaste(r, c)} onCommit=${(x) => setTableCell(store, el.id, r, c, x, toast)} /></td>`; })}</tr>`)}
      </tbody></table></div>
    <div class="cellinfo">${active.c >= 0 && ac ? (ac.delta ? html`<span class="muted">Computed change between two cells in this row.</span>` : acv?.evidence ? html`
      <div class="ci-title"><${Icon} name=${acv.edited ? "edit" : "shield"} size=${15} /> ${evLabel(acv.evidence)}</div>
      <div class="ci-row"><span>Source value</span><b>${acv.source} ${acv.evidence.unit === "percent" ? "%" : acv.evidence.unit}</b></div>
      <div class="ci-row"><span>Period</span><b>${acv.evidence.period}</b></div>
      <div class="ci-row"><span>Source</span><b>${sourceTitle(p, acv.evidence)}</b></div>
      <div class="ci-row"><span>Status</span>${acv.edited ? html`<b class="warn-t">Edited to ${acv.value} by you · pending verification</b>` : html`<b class="ok-t">${acv.evidence.verification}</b>`}</div>
      ${acv.edited ? html`<button class="btn sm" onClick=${() => restoreTableCell(store, el.id, active.r, active.c)}><${Icon} name="restore" size=${14} /> Restore source value</button>` : ""}
      <details class="adv"><summary>Advanced</summary><code>${ac.evidence_id}</code></details>`
      : acv?.manual ? html`<span class="warn-t">Manually entered number — no source attached.</span>` : html`<span class="muted">Text cell. Type a number to make it numeric.</span>`) : html`<span class="muted">Select a cell to see its source.</span>`}</div>
    ${active.c >= 0 ? html`<div class="fmt-row"><span class="muted small">Column format</span>
      <select value=${fmt.kind || "number"} onChange=${(e) => tableOps.setColFmt(store, el.id, active.c, { ...fmt, kind: e.target.value })}><option value="number">Number</option><option value="percent">Percent</option><option value="currency">Currency</option></select>
      <select value=${fmt.decimals ?? 1} onChange=${(e) => tableOps.setColFmt(store, el.id, active.c, { ...fmt, decimals: +e.target.value })}>${[0, 1, 2, 3].map((d) => html`<option value=${d}>${d} dp</option>`)}</select></div>` : ""}
    <p class="muted small">Tip: shift-click to select a range, ⌘C to copy; paste a block from Excel or Sheets into any cell.</p>
  </div>`;
}

// ------------------------------------------------------------------ data table editor (rows = datasets, columns = dates)
export function DataTableGrid({ store, p, el, toast }) {
  const dss = el.dataset_ids.filter((d) => p.datasets[d]), dates = [...new Set(dss.flatMap((d) => effectiveObs(p.datasets[d]).map((o) => o.date)))].sort();
  const set = (label, fn) => store.commit(label, (d) => fn(d.elements.find((e) => e.id === el.id)));
  const others = Object.entries(p.datasets).filter(([id, d]) => !dss.includes(id) && d.unit === p.datasets[dss[0]]?.unit && d.frequency === p.datasets[dss[0]]?.frequency);
  return html`<div class="tg"><div class="tg-tools">
      <select class="btn sm" onChange=${(e) => { const v = e.target.value; e.target.value = ""; if (v) set("Added row", (t) => { t.dataset_ids.push(v); }); }}><option value="">＋ Row (dataset)…</option>${others.map(([id, d]) => html`<option value=${id}>${d.title}</option>`)}</select>
      <select class="btn sm" onChange=${(e) => { const v = e.target.value; e.target.value = ""; if (v) set("Added column", (t) => { t.dates = [...new Set([...t.dates, v])].sort(); }); }}><option value="">＋ Column (date)…</option>${dates.filter((d) => !el.dates.includes(d)).map((d) => html`<option>${d}</option>`)}</select></div>
    <div class="grid-wrap"><table class="grid editable"><thead><tr><th>Row</th>${el.dates.map((d, ci) => html`<th><div class="th-in">${d}<button class="mini-btn" title="Remove column" onClick=${() => set("Removed column", (t) => { t.dates.splice(ci, 1); })}><${Icon} name="close" size=${12} /></button></div></th>`)}<th></th></tr></thead>
      <tbody>${dss.map((id, ri) => { const obs = new Map(effectiveObs(p.datasets[id]).map((o) => [o.date, o]));
        return html`<tr><td><${Cell} align="left" value=${el.row_labels?.[id] || p.datasets[id].entity} onCommit=${(v) => set("Renamed row", (t) => { t.row_labels = { ...(t.row_labels || {}), [id]: v }; })} /></td>
          ${el.dates.map((d) => { const o = obs.get(d); return html`<td class=${`dc ${o?.edited ? "edited" : ""}`}><${Cell} value=${o?.value ?? ""} placeholder="missing" title=${o?.edited ? `source value: ${o.source_value ?? "none"}` : "source value"} onCommit=${(v) => setObservation(store, id, d, v, toast)} />
            ${o?.edited ? html`<button class="mini-btn" title="Restore source value" onClick=${() => restoreObservation(store, id, d)}><${Icon} name="restore" size=${13} /></button>` : ""}</td>`; })}
          <td><button class="mini-btn" title="Remove row" onClick=${() => set("Removed row", (t) => { t.dataset_ids.splice(ri, 1); })}><${Icon} name="trash" size=${13} /></button></td></tr>`; })}</tbody></table></div>
    <p class="muted small">Cells edit the shared working data, so charts using the same series update too.</p></div>`;
}
