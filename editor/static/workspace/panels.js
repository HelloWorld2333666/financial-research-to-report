// Context panel modes: Chat (simulated slide assistant + proposals), Data (dataset selection →
// deterministic chart), Design (DNA tokens, chart editor, element properties).
import { useState, useRef, useEffect } from "preact/hooks";
import { html } from "./html.js";
import { useStore } from "./store.js";
import { ChartView } from "./charts.js";
import { interpret } from "./simai.js";
import { chartSeries, compatibility, plottedPoints, datasetPointsInRange, elementsBySlide, uid, freeSpot, fmtValue } from "./model.js";

const now = () => new Date().toISOString();
const label = (e) => ({ chart: "Chart", barchart: "Chart", datatable: "Table", table: "Table", metric: "Metric", text: e.role === "title" ? "Title" : "Text", panel: "Panel" }[e.type] || e.type);
const short = (e, p) => (e.type === "chart" ? p.charts[e.chart_id]?.title : e.title || e.label || e.text || e.id).toString().replace(/\s+/g, " ").slice(0, 28);

// ------------------------------------------------------------------ chat
export function ChatPanel({ store, api, toast }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const slide = ui.slide, els = elementsBySlide(p)[slide] || [];
  const msgs = p.threads?.[slide]?.messages || [];
  const chips = ui.selected.map((id) => els.find((e) => e.id === id)).filter(Boolean);
  const [text, setText] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length, slide]);
  const push = (m) => store.mutate((d) => { d.threads ||= {}; (d.threads[slide] ||= { messages: [] }).messages.push({ at: now(), ...m }); });

  const send = () => {
    const t = text.trim(); if (!t) return;
    push({ role: "user", text: t, chips: chips.map((c) => c.id) });
    setText("");
    const r = interpret(t, els, chips.map((c) => c.id));
    if (!r.changes) return push({ role: "ai", text: r.reply });
    const byId = new Map(p.elements.map((e, i) => [e.id, i]));
    const { patches } = store.propose((d) => r.changes.forEach((c) => Object.assign(d.elements[byId.get(c.id)], { x: c.x, y: c.y, w: c.w, h: c.h })));
    const touched = new Set(patches.map((x) => x.path[1]));
    const onlyGeometry = patches.every((x) => x.path[0] === "elements" && ["x", "y", "w", "h"].includes(x.path[2]));
    push({ role: "ai", text: r.reply, proposal: {
      id: uid("pr"), status: "pending", scope: chips.length ? "Selection" : "Slide", patches,
      items: r.changes.map((c) => ({ id: c.id, why: c.why, name: short(els.find((e) => e.id === c.id), p) })),
      base: Object.fromEntries(r.changes.map((c) => { const e = p.elements[byId.get(c.id)]; return [c.id, { i: byId.get(c.id), g: [e.x, e.y, e.w, e.h] }]; })),
      changes: r.changes,
      invariants: { geometry_only: onlyGeometry, objects: touched.size, same_slide: r.changes.every((c) => els.some((e) => e.id === c.id)) },
    } });
  };
  const setStatus = (pid, status) => store.mutate((d) => { const m = d.threads[slide].messages.find((x) => x.proposal?.id === pid); m.proposal.status = status; });
  const apply = (pr) => {
    const cur = store.get().project;
    const stale = Object.entries(pr.base).some(([id, b]) => { const e = cur.elements[b.i]; return !e || e.id !== id || [e.x, e.y, e.w, e.h].join() !== b.g.join(); });
    store.ui({ preview: null });
    if (stale) { setStatus(pr.id, "stale"); return toast("The slide changed since this proposal was made; regenerate it"); }
    store.applyTracked(`AI proposal: ${pr.items.length} object(s)`, pr.patches); setStatus(pr.id, "applied"); toast("Applied (⌘Z to undo)");
  };
  const preview = ui.preview;
  return html`<div class="pbody chat">
    <div class="hint">Slide ${p.slides.findIndex((s) => s.id === slide) + 1} conversation · <span class="chip ai">simulated assistant: rule-based, no model</span></div>
    <div class="thread">
      ${msgs.map((m) => html`<div class=${`msg ${m.role}`}>
        <div class="who">${m.role === "user" ? "You" : "Slide assistant (simulated)"}</div>
        ${(m.chips || []).map((id) => { const e = p.elements.find((x) => x.id === id); return e && html`<span class="ctx">▣ ${label(e)} · ${short(e, p)}</span>`; })}
        <div>${m.text}</div>
        ${m.proposal && html`<div class=${`proposal ${m.proposal.status}`}>
          <div class="hd">✦ Proposal · ${m.proposal.items.length} object(s) <span class="chip ai">${m.proposal.scope}</span><span class="grow"></span>
            <span class=${`chip ${{ pending: "info", applied: "ok", rejected: "", stale: "warn", undone: "" }[m.proposal.status]}`}>${m.proposal.status}</span></div>
          <ul>${m.proposal.items.map((it) => html`<li><b>${it.name}</b>: ${it.why}</li>`)}</ul>
          <div class="inv">${m.proposal.invariants.geometry_only && html`<span class="chip ok">✓ only position/size: no text, number or evidence change</span>`}
            ${m.proposal.invariants.same_slide && html`<span class="chip ok">✓ only this slide</span>`}</div>
          ${m.proposal.status === "pending" && html`<div class="row">
            <button class="primary" onClick=${() => apply(m.proposal)}>Apply</button>
            <button onClick=${() => { store.ui({ preview: null }); setStatus(m.proposal.id, "rejected"); }}>Reject</button>
            <button class=${preview?.id === m.proposal.id ? "on" : ""} onClick=${() => store.ui({ preview: preview?.id === m.proposal.id ? null : { id: m.proposal.id, changes: m.proposal.changes } })}>
              ${preview?.id === m.proposal.id ? "Hide preview" : "Preview on slide"}</button></div>`}
          ${m.proposal.status === "applied" && html`<div class="row"><button onClick=${() => { const l = store.undo(); if (l) { setStatus(m.proposal.id, "undone"); toast(`Undid: ${l}`); } }}>Undo</button></div>`}
        </div>`}
      </div>`)}
      <div ref=${end}></div>
    </div>
    <div class="composer">
      <div>${chips.length ? chips.map((e) => html`<span class="ctx">▣ ${label(e)} · ${short(e, p)}</span>`) : html`<span class="hint">Select objects on the slide to add them as context.</span>`}</div>
      <textarea value=${text} onInput=${(e) => setText(e.target.value)} placeholder="e.g. “Make the chart larger and the table narrower”"
        onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <div class="bar"><span class="scope">Scope: <b>${chips.length ? "Selection" : "Slide"}</b></span><span class="grow"></span><button class="ai" onClick=${send}>Send</button></div>
    </div></div>`;
}

// ------------------------------------------------------------------ data
const GROUPS = [["annual", "Annual"], ["quarterly", "Quarterly"], ["monthly", "Monthly"], ["daily", "Daily"]];
export function DataPanel({ store, api, toast }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const [type, setType] = useState("line"), [q, setQ] = useState("");
  const checked = ui.checked.filter((id) => p.datasets[id]);
  const toggle = (id) => store.ui((u) => ({ checked: u.checked.includes(id) ? u.checked.filter((x) => x !== id) : [...u.checked, id] }));
  const c = compatibility(p, checked);
  const spec = { type, title: checked.map((i) => p.datasets[i].entity).join(", ") + ` · ${p.datasets[checked[0]]?.title.split("·")[1]?.trim() || ""}`,
    labels: "end", y: { zero: type === "bar" }, missing: "gap", series: checked.map((d, i) => ({ dataset: d, label: p.datasets[d].entity, role: i })) };
  const previewSeries = checked.length && c.ok ? chartSeries({ ...p, charts: { ...p.charts, __p: spec } }, "__p") : null;
  const insert = () => {
    const id = uid("ch"), els = elementsBySlide(p)[ui.slide] || [], { overlaps, ...spot } = freeSpot(els, [560, 320], [440, 260], [340, 200]), eid = uid("el");
    store.commit("Inserted chart from datasets", (d) => { d.charts[id] = { ...spec, title: `${spec.title} (${p.datasets[checked[0]].origin === "synthetic" ? "SAMPLE" : "verified"})` };
      d.elements.push({ id: eid, slide_id: ui.slide, type: "chart", chart_id: id, ...spot, style: {}, refs: {} }); });
    store.ui({ selected: [eid], panel: "design" }); toast(overlaps ? "No free space on this slide: chart placed over content; move or resize it (⌘Z to undo)" : "Chart inserted: rendered from the datasets (⌘Z to undo)");
  };
  const request = async (id) => {
    const ds = p.datasets[id], els = elementsBySlide(p)[ui.slide] || [];
    try {
      const r = await api("POST", "/api/research/create", { project: p, slide_id: ui.slide, region: (({ overlaps, ...r }) => r)(freeSpot(els, [420, 120], [300, 90])),
        instruction: `Research ${ds.title} (${ds.unit}, ${ds.frequency}). Return verified observations with source, date and excerpt; do not estimate missing values.` });
      store.commit("Research request created", (d) => { d.research_requests = r.project.research_requests; d.elements = r.project.elements; });
      toast("Research Request created with a pending placeholder (no engine runs in this prototype)");
    } catch (e) { toast(e.message); }
  };
  const list = Object.entries(p.datasets).filter(([, d]) => !q || `${d.title} ${d.unit}`.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="pbody data">
    <input class="search" placeholder="Search datasets…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="ds">${GROUPS.map(([f, name]) => { const rows = list.filter(([, d]) => d.frequency === f); return rows.length ? html`<div class="grp">${name}</div>${rows.map(([id, d]) => html`
      <label class=${checked.includes(id) ? "checked" : ""}><input type="checkbox" checked=${checked.includes(id)} disabled=${!d.observations.length} onChange=${() => toggle(id)} />
        <span>${d.title}<br/><span class="meta">${d.unit} · ${d.observation_type.replace(/_/g, " ")} · ${d.observations.length ? `${d.observations[0].date}–${d.observations.at(-1).date}` : "no data yet"}</span></span>
        ${d.observations.length ? html`<span class=${`chip ${d.origin === "synthetic" ? "warn" : "ok"}`}>${d.origin === "synthetic" ? "SAMPLE" : "✓"}</span>` : html`<button class="small" onClick=${(e) => { e.preventDefault(); request(id); }}>Request research</button>`}
      </label>`)}` : ""; })}</div>
    ${checked.length ? html`<div class=${`check ${c.ok ? "" : "bad"}`}><b>${checked.length} selected · ${c.ok ? "compatible" : "not comparable"}</b>
      ${c.ok ? html`<div>✓ same unit (${c.unit}), frequency (${c.frequency}) and observation type</div>` : c.issues.map((i) => html`<div class="warnline">✕ ${i}</div>`)}
      ${c.gaps.map((g) => html`<div class="hint">! missing ${g}: shown as a gap, not interpolated</div>`)}</div>` : html`<p class="hint">Tick datasets to build an exhibit. Only compatible series (same unit, frequency and observation type) can share a chart.</p>`}
    ${previewSeries && html`<div class="previewbox"><${ChartView} spec=${spec} series=${previewSeries} dna=${p.design_dna} w=${352} h=${180} /></div>
      <div class="row"><span class="seg">${["line", "bar"].map((t) => html`<button class=${type === t ? "on" : ""} onClick=${() => setType(t)}>${t}</button>`)}</span><span class="grow"></span>
        <span class="hint">${plottedPoints(previewSeries)} points from data</span><button class="primary" onClick=${insert}>Insert on slide</button></div>`}
  </div>`;
}

// ------------------------------------------------------------------ design
export function DesignPanel({ store, toast }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const sel = ui.selected.length === 1 ? p.elements.find((e) => e.id === ui.selected[0]) : null;
  if (sel?.type === "chart" && p.charts[sel.chart_id]) return html`<${ChartEditor} store=${store} p=${p} el=${sel} ui=${ui} />`;
  if (sel) return html`<${ElementProps} store=${store} el=${sel} />`;
  const d = p.design_dna, set = (k, v) => store.commit(`Design DNA: ${k}`, (x) => { x.design_dna[k] = v; });
  return html`<div class="pbody design">
    <h5>Design DNA · whole deck</h5>
    <p class="hint">Tokens apply by role (title, kicker, body, chart series), so slides restyle without becoming identical. Charts re-render from data; values never change.</p>
    <label class="field"><span>Font</span><select value=${d.font} onChange=${(e) => set("font", e.target.value)}>${["Helvetica Neue", "Georgia", "Avenir Next", "Arial"].map((f) => html`<option>${f}</option>`)}</select></label>
    <label class="field"><span>Title size</span><input type="range" min="18" max="32" value=${d.title_size} onChange=${(e) => set("title_size", +e.target.value)} /><b>${d.title_size}px</b></label>
    <label class="field"><span>Ink</span><input type="color" value=${d.ink} onChange=${(e) => set("ink", e.target.value)} /></label>
    <label class="field"><span>Accent</span><input type="color" value=${d.accent} onChange=${(e) => set("accent", e.target.value)} /></label>
    <label class="field"><span>Series</span>${d.series.slice(0, 3).map((c, i) => html`<input type="color" value=${c} onChange=${(e) => store.commit("Design DNA: series colour", (x) => { x.design_dna.series[i] = e.target.value; })} />`)}</label>
    <div class="row"><button onClick=${() => store.commit("Design DNA: institutional preset", (x) => { Object.assign(x.design_dna, { font: "Helvetica Neue", ink: "#0f2742", accent: "#c8102e", title_size: 24, series: ["#1f4e9c", "#c8102e", "#2e8b57", "#b8860b"] }); })}>Reset to house style</button>
      <button onClick=${() => store.commit("Design DNA: alternative preset", (x) => { Object.assign(x.design_dna, { font: "Georgia", ink: "#1b1f3b", accent: "#0b7a75", title_size: 26, series: ["#0b7a75", "#d1495b", "#edae49", "#00798c"] }); })}>Try alternative style</button></div>
  </div>`;
}

function ElementProps({ store, el }) {
  const num = (k) => html`<label class="field small"><span>${k.toUpperCase()}</span><input type="number" value=${Math.round(el[k] || 0)} onChange=${(e) => store.commit(`Changed ${k}`, (d) => { d.elements.find((x) => x.id === el.id)[k] = +e.target.value; })} /></label>`;
  return html`<div class="pbody design"><h5>${label(el)} <code>${el.id}</code></h5>
    <div class="geo">${["x", "y", "w", "h"].map(num)}${num("rotation")}</div>
    <label class="field"><span>Locked</span><input type="checkbox" checked=${!!el.locked} onChange=${(e) => store.commit(e.target.checked ? "Locked" : "Unlocked", (d) => { d.elements.find((x) => x.id === el.id).locked = e.target.checked; })} /></label>
    ${el.role && html`<p class="hint">Style role <b>${el.role}</b>: typography and colour come from Design DNA.</p>`}
    ${el.type === "datatable" && html`<p class="hint">Cells read from datasets (${el.dataset_ids.join(", ")}); they can't be typed over.</p>`}
  </div>`;
}

function ChartEditor({ store, p, el, ui }) {
  const spec = p.charts[el.chart_id], series = chartSeries(p, el.chart_id), set = (label, fn) => store.commit(label, (d) => fn(d.charts[el.chart_id]));
  const plotted = plottedPoints(series), stored = datasetPointsInRange(p, el.chart_id);
  const all = [...new Set(spec.series.flatMap((s) => p.datasets[s.dataset].observations.map((o) => String(o.date))))].sort();
  // first and last observations plus every gap, in date order, with "…" where rows are skipped
  const keep = new Set(series.x.length > 12 ? [...series.x.slice(0, 2), ...series.x.slice(-8)] : series.x);
  series.x.forEach((d, i) => { if (series.series.some((s) => s.values[i] === null)) keep.add(d); });
  const rows = []; series.x.forEach((d, i) => { if (!keep.has(d)) return; if (rows.length && rows.at(-1) !== "…" && !keep.has(series.x[i - 1])) rows.push("…"); rows.push(d); });
  return html`<div class="pbody design">
    <div class="row"><b>${spec.type === "line" ? "Line" : "Bar"} chart</b><code>${el.chart_id}</code><span class="grow"></span><span class="chip ok" title="Visual edits re-render from the dataset; plotted values cannot be edited here">🔒 values locked</span></div>
    <div class=${`check ${plotted === stored ? "" : "bad"}`}>${plotted === stored ? "✓" : "✕"} ${plotted} plotted points = ${stored} dataset observations in range · gaps kept, nothing interpolated</div>
    <div class="seg tabs2">${["data", "style"].map((t) => html`<button class=${ui.chartTab === t ? "on" : ""} onClick=${() => store.ui({ chartTab: t })}>${t === "data" ? "Data" : "Style"}</button>`)}</div>
    ${ui.chartTab === "data" ? html`
      ${spec.series.map((s, i) => { const d = p.datasets[s.dataset]; return html`<div class="srow"><i style=${`background:${p.design_dna.series[(s.role ?? i) % p.design_dna.series.length]}`}></i>${d.title}
        <span class="grow"></span><span class=${`chip ${d.origin === "synthetic" ? "warn" : "ok"}`}>${d.origin === "synthetic" ? "SAMPLE" : d.verification}</span></div>`; })}
      <div class="meta">${p.datasets[spec.series[0].dataset].unit} · ${p.datasets[spec.series[0].dataset].frequency} · ${p.datasets[spec.series[0].dataset].observation_type.replace(/_/g, " ")}</div>
      <div class="tablebox"><table class="grid"><thead><tr><th>Date</th>${series.series.map((s) => html`<th>${s.label}</th>`)}</tr></thead><tbody>
        ${rows.map((d) => d === "…" ? html`<tr><td colspan="9" class="hint">…</td></tr>` : html`<tr><td>${d}</td>${series.series.map((s) => {
          const v = s.values[series.x.indexOf(d)], rev = p.datasets[s.dataset].revisions?.find((r) => String(r.date) === d && r.status === "pending_verification");
          return html`<td class=${v === null ? "gap" : rev ? "rev" : ""} title=${rev ? `User revision ${rev.value} (${rev.reason}) pending verification; plotted value is the original` : ""}>${v === null ? "missing" : v}${rev ? " †" : ""}</td>`; })}</tr>`)}
      </tbody></table></div>
      ${spec.series.flatMap((s) => (p.datasets[s.dataset].revisions || []).map((r) => html`<div class="check revbox"><div>† ${p.datasets[s.dataset].entity} ${r.date}: user revision ${r.value} (“${r.reason}”), <b>${r.status.replace(/_/g, " ")}</b>. The original observation stays plotted until the revision is verified.</div></div>`))}
      <p class="hint">${p.datasets[spec.series[0].dataset].source_note}</p>` : html`
      <label class="field"><span>Type</span><span class="seg">${["line", "bar"].map((t) => html`<button class=${spec.type === t ? "on" : ""} onClick=${() => set(`Chart type: ${t}`, (c) => { c.type = t; })}>${t}</button>`)}</span></label>
      <label class="field"><span>Labels</span><span class="seg">${[["end", "End of line"], ["legend", "Legend"]].map(([k, l]) => html`<button class=${spec.labels === k ? "on" : ""} onClick=${() => set(`Labels: ${l}`, (c) => { c.labels = k; })}>${l}</button>`)}</span></label>
      <label class="field"><span>Y from zero</span><input type="checkbox" checked=${!!spec.y?.zero} onChange=${(e) => set("Y axis", (c) => { c.y = { ...c.y, zero: e.target.checked }; })} /></label>
      <label class="field"><span>From</span><select value=${spec.x?.from} onChange=${(e) => set("Chart range", (c) => { c.x = { ...c.x, from: e.target.value }; })}>${all.map((d) => html`<option>${d}</option>`)}</select></label>
      <label class="field"><span>To</span><select value=${spec.x?.to} onChange=${(e) => set("Chart range", (c) => { c.x = { ...c.x, to: e.target.value }; })}>${all.map((d) => html`<option>${d}</option>`)}</select></label>
      <label class="field"><span>Title</span><input value=${spec.title} onChange=${(e) => set("Chart title", (c) => { c.title = e.target.value; })} /></label>
      <p class="hint">Colours come from Design DNA series roles. Range changes select different observations; they never alter values.</p>`}
  </div>`;
}
