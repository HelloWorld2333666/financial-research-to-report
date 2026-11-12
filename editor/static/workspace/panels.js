// Right-panel modes: Chat (simulated slide assistant + proposals), Data (datasets and evidence library),
// Design (deck-wide Design DNA) and History (undo stack).
import { useState, useRef, useEffect } from "preact/hooks";
import { html } from "./html.js";
import { useStore } from "./store.js";
import { Icon } from "./icons.js";
import { ChartView } from "./charts.js";
import { interpret } from "./simai.js";
import { chartSeries, compatibility, plottedPoints, elementsBySlide, uid, freeSpot, effectiveObs, unverifiedEdits, evLabel, sourceTitle, elementName, manualEditSummary } from "./model.js";

const now = () => new Date().toISOString();

// ------------------------------------------------------------------ chat
export function ChatPanel({ store, api, toast }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const slide = ui.slide, els = elementsBySlide(p)[slide] || [], idx = p.slides.findIndex((s) => s.id === slide);
  const msgs = p.threads?.[slide]?.messages || [];
  const chips = ui.selected.map((id) => els.find((e) => e.id === id)).filter(Boolean);
  const [text, setText] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length, slide]);
  const push = (m) => store.mutate((d) => { d.threads ||= {}; (d.threads[slide] ||= { messages: [] }).messages.push({ at: now(), ...m }); });

  const send = (t0) => {
    const t = (t0 ?? text).trim(); if (!t) return;
    push({ role: "user", text: t, chips: chips.map((c) => c.id) }); setText("");
    if (/\bverif/i.test(t)) {  // simulated verification request: lists what would be checked, changes nothing
      const m = manualEditSummary(store.get().project);
      return push({ role: "ai", text: `Verification request recorded (simulated; nothing was checked). It would compare ${m.total} manually edited value${m.total === 1 ? "" : "s"} and the selected objects against their original sources, then propose corrections for you to accept or reject.` });
    }
    const r = interpret(t, els, chips.map((c) => c.id));
    if (!r.changes) return push({ role: "ai", text: r.reply });
    const byId = new Map(p.elements.map((e, i) => [e.id, i]));
    const { patches } = store.propose((d) => r.changes.forEach((c) => Object.assign(d.elements[byId.get(c.id)], { x: c.x, y: c.y, w: c.w, h: c.h })));
    push({ role: "ai", text: r.reply, proposal: {
      id: uid("pr"), status: "pending", scope: chips.length ? "Selection" : "Slide", patches, changes: r.changes,
      items: r.changes.map((c) => ({ id: c.id, why: c.why, name: elementName(els.find((e) => e.id === c.id), p) })),
      base: Object.fromEntries(r.changes.map((c) => { const e = p.elements[byId.get(c.id)]; return [c.id, { i: byId.get(c.id), g: [e.x, e.y, e.w, e.h] }]; })),
      invariants: { geometry_only: patches.every((x) => x.path[0] === "elements" && ["x", "y", "w", "h"].includes(x.path[2])) },
    } });
  };
  const setStatus = (pid, status) => store.mutate((d) => { const m = d.threads[slide].messages.find((x) => x.proposal?.id === pid); m.proposal.status = status; });
  const apply = (pr) => {
    const cur = store.get().project;
    const stale = Object.entries(pr.base).some(([id, b]) => { const e = cur.elements[b.i]; return !e || e.id !== id || [e.x, e.y, e.w, e.h].join() !== b.g.join(); });
    store.ui({ preview: null });
    if (stale) { setStatus(pr.id, "stale"); return toast("The slide changed since this proposal was made. Ask again for a fresh proposal."); }
    store.applyTracked(`AI layout: ${pr.items.length} object(s)`, pr.patches); setStatus(pr.id, "applied"); toast("Applied. Everything stays editable (⌘Z to undo).");
  };
  const preview = ui.preview;
  const SUGGEST = ["Make the chart larger and the table narrower", "Move the commentary down", "Verify the edited values"];
  return html`<div class="pbody chat">
    <div class="chat-head"><div class="avatar ai"><${Icon} name="sparkle" size=${16} /></div><div><b>Slide ${idx + 1} assistant</b><div class="muted small">Simulated · rule-based · no model calls</div></div></div>
    <div class="thread">
      ${msgs.map((m) => html`<div class=${`msg ${m.role}`}>
        ${(m.chips || []).length ? html`<div class="chips">${m.chips.map((id) => { const e = p.elements.find((x) => x.id === id); return e && html`<span class="ctx">${elementName(e, p)}</span>`; })}</div>` : ""}
        <div class="bubble">${m.text}</div>
        ${m.proposal && html`<div class=${`proposal ${m.proposal.status}`}>
          <div class="hd"><${Icon} name="sparkle" size=${15} /> Layout proposal <span class="pill">${m.proposal.scope}</span><span class="grow"></span><span class=${`pill ${{ pending: "info", applied: "ok", stale: "warn" }[m.proposal.status] || ""}`}>${m.proposal.status}</span></div>
          <ul>${m.proposal.items.map((it) => html`<li><b>${it.name}</b> — ${it.why}</li>`)}</ul>
          ${m.proposal.invariants.geometry_only ? html`<div class="inv"><${Icon} name="check" size=${13} /> Only position and size change: text, numbers and sources stay as they are</div>` : ""}
          ${m.proposal.status === "pending" && html`<div class="btn-row">
            <button class="btn primary sm" onClick=${() => apply(m.proposal)}>Apply</button>
            <button class=${`btn sm ${preview?.id === m.proposal.id ? "on" : ""}`} onClick=${() => store.ui({ preview: preview?.id === m.proposal.id ? null : { id: m.proposal.id, changes: m.proposal.changes } })}><${Icon} name="eye" size=${14} /> ${preview?.id === m.proposal.id ? "Hide preview" : "Preview"}</button>
            <button class="btn sm ghost" onClick=${() => { store.ui({ preview: null }); setStatus(m.proposal.id, "rejected"); }}>Reject</button></div>`}
          ${m.proposal.status === "applied" && html`<div class="btn-row"><button class="btn sm ghost" onClick=${() => { const l = store.undo(); if (l) { setStatus(m.proposal.id, "undone"); toast(`Undid: ${l}`); } }}><${Icon} name="undo" size=${14} /> Undo</button></div>`}
        </div>`}
      </div>`)}
      ${!msgs.length ? html`<div class="chat-empty"><p class="muted">Ask about this slide, or select objects first to give context.</p></div>` : ""}
      <div ref=${end}></div>
    </div>
    <div class="suggest">${SUGGEST.map((s) => html`<button class="chip-btn" onClick=${() => send(s)}>${s}</button>`)}</div>
    <div class="composer">
      ${chips.length ? html`<div class="chips">${chips.map((e) => html`<span class="ctx"><${Icon} name="cursor" size=${12} /> ${elementName(e, p)}</span>`)}</div>` : ""}
      <textarea value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${chips.length ? "Ask about the selection…" : "Ask about this slide…"} rows="2"
        onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <div class="bar"><span class="pill">${chips.length ? "Selection" : "Whole slide"}</span><span class="grow"></span><button class="send" title="Send" onClick=${() => send()}><${Icon} name="send" size=${16} /></button></div>
    </div></div>`;
}

// ------------------------------------------------------------------ data library
const GROUPS = [["annual", "Annual"], ["quarterly", "Quarterly"], ["monthly", "Monthly"], ["daily", "Daily"]];
export function DataPanel({ store, api, toast }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const [type, setType] = useState("line"), [q, setQ] = useState(""), [tab, setTab] = useState("datasets");
  const checked = ui.checked.filter((id) => p.datasets[id]);
  const toggle = (id) => store.ui((u) => ({ checked: u.checked.includes(id) ? u.checked.filter((x) => x !== id) : [...u.checked, id] }));
  const c = compatibility(p, checked);
  const spec = { type, title: checked.map((i) => p.datasets[i].entity).join(", ") + ` · ${p.datasets[checked[0]]?.title.split("·")[1]?.trim() || ""}`,
    labels: "end", y: { zero: type === "bar" }, missing: "gap", series: checked.map((d, i) => ({ dataset: d, label: p.datasets[d].entity, role: i })) };
  const previewSeries = checked.length && c.ok ? chartSeries({ ...p, charts: { ...p.charts, __p: spec } }, "__p") : null;
  const insert = () => {
    const id = uid("ch"), els = elementsBySlide(p)[ui.slide] || [], { overlaps, ...spot } = freeSpot(els, [560, 320], [440, 260], [340, 200]), eid = uid("el");
    store.commit("Inserted chart from datasets", (d) => { d.charts[id] = { ...spec, x: {}, title: `${spec.title}${p.datasets[checked[0]].origin === "synthetic" ? " (SAMPLE)" : ""}` };
      d.elements.push({ id: eid, slide_id: ui.slide, type: "chart", chart_id: id, ...spot, style: {}, refs: {} }); });
    store.ui({ selected: [eid], panel: "props" }); toast(overlaps ? "No free space: chart placed over content. Move or resize it." : "Chart inserted from the datasets. Use Edit data to change values.");
  };
  const request = async (id) => {
    const ds = p.datasets[id], els = elementsBySlide(p)[ui.slide] || [];
    try {
      const r = await api("POST", "/api/research/create", { project: p, slide_id: ui.slide, region: (({ overlaps, ...x }) => x)(freeSpot(els, [420, 120], [300, 90])),
        instruction: `Research ${ds.title} (${ds.unit}, ${ds.frequency}). Return verified observations with source, date and excerpt; do not estimate missing values.` });
      store.commit("Research request created", (d) => { d.research_requests = r.project.research_requests; d.elements = r.project.elements; });
      toast("Research request created with a placeholder on this slide (no research engine runs in this prototype)");
    } catch (e) { toast(e.message); }
  };
  const list = Object.entries(p.datasets).filter(([, d]) => !q || `${d.title} ${d.unit}`.toLowerCase().includes(q.toLowerCase()));
  const evs = Object.entries(p.evidence).filter(([, e]) => e.kind === "metric_value" && (!q || evLabel(e).toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  return html`<div class="pbody data">
    <input class="search" placeholder="Search data…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="seg full">${[["datasets", "Datasets"], ["evidence", "Source figures"]].map(([k, l]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === "evidence" ? html`<div class="evlist">${evs.map(([id, e]) => html`<div class="evrow" title=${`Advanced: ${id}`}>
        <div class="ev-main"><div>${evLabel(e)}</div><div class="muted small">${e.period} · ${sourceTitle(p, e)}</div></div>
        <div class="ev-val"><b>${typeof e.value === "number" ? e.value.toLocaleString() : "–"}</b><div class="muted small">${e.unit}</div></div>
        <span class=${`pill ${e.verification === "verified" ? "ok" : "warn"}`}>${e.verification}</span></div>`)}
        <p class="muted small">Hand-verified figures from China Re's public filings. Hover a row for its technical id.</p></div>` : html`
    <div class="ds">${GROUPS.map(([f, name]) => { const rows = list.filter(([, d]) => d.frequency === f); return rows.length ? html`<div class="grp">${name}</div>${rows.map(([id, d]) => { const obs = effectiveObs(d), ed = unverifiedEdits(d);
      return html`<label class=${checked.includes(id) ? "checked" : ""}><input type="checkbox" checked=${checked.includes(id)} disabled=${!obs.length} onChange=${() => toggle(id)} />
        <span><span class="dt">${d.title}</span><span class="meta">${d.unit} · ${d.observation_type.replace(/_/g, " ")} · ${obs.length ? `${obs[0].date}–${obs.at(-1).date}` : "no data yet"}${ed ? html` · <span class="warn-t">${ed} edited</span>` : ""}</span></span>
        ${obs.length ? html`<span class=${`pill ${d.origin === "synthetic" || d.origin === "manual" ? "warn" : "ok"}`}>${d.origin === "synthetic" ? "Sample" : d.origin === "manual" ? "Manual" : "Verified"}</span>` : html`<button class="btn sm" onClick=${(e) => { e.preventDefault(); request(id); }}>Request research</button>`}
      </label>`; })}` : ""; })}</div>
    ${checked.length ? html`<div class=${`note-box ${c.ok ? "ok" : "bad"}`}><${Icon} name=${c.ok ? "check" : "warn"} size=${15} /><div><b>${checked.length} selected · ${c.ok ? "can share one chart" : "can't share one chart"}</b>
      ${c.ok ? html`<div class="small">Same unit (${c.unit}), frequency (${c.frequency}) and observation type.</div>` : c.issues.map((i) => html`<div class="small">${i}</div>`)}
      ${c.gaps.map((g) => html`<div class="small muted">Missing ${g}: shown as a gap, not estimated</div>`)}</div></div>` : html`<p class="muted small">Tick datasets to build a chart. Series must share unit, frequency and observation type.</p>`}
    ${previewSeries && html`<div class="previewbox"><${ChartView} spec=${spec} series=${previewSeries} dna=${p.design_dna} w=${336} h=${180} /></div>
      <div class="btn-row"><span class="seg">${["line", "bar"].map((t) => html`<button class=${type === t ? "on" : ""} onClick=${() => setType(t)}>${t === "line" ? "Line" : "Bar"}</button>`)}</span><span class="grow"></span>
        <span class="muted small">${plottedPoints(previewSeries)} points</span><button class="btn primary sm" onClick=${insert}><${Icon} name="plus" size=${14} /> Insert on slide</button></div>`}`}
  </div>`;
}

// ------------------------------------------------------------------ design DNA
const PRESETS = { "House style": { font: "Helvetica Neue", ink: "#0f2742", accent: "#c8102e", title_size: 24, series: ["#1f4e9c", "#c8102e", "#2e8b57", "#b8860b"] },
  "Editorial": { font: "Georgia", ink: "#1b1f3b", accent: "#0b7a75", title_size: 26, series: ["#0b7a75", "#d1495b", "#edae49", "#00798c"] },
  "Modern": { font: "Avenir Next", ink: "#111827", accent: "#4f46e5", title_size: 25, series: ["#4f46e5", "#0ea5e9", "#f59e0b", "#10b981"] } };
export function DesignPanel({ store }) {
  const p = useStore(store, (s) => s.project), d = p.design_dna, set = (k, v) => store.commit(`Design DNA: ${k}`, (x) => { x.design_dna[k] = v; });
  return html`<div class="pbody design">
    <section class="psec"><h4>Deck style</h4><p class="muted small">Applies to every slide by role (titles, kickers, body text, chart series). Slides keep their own layouts; chart values never change.</p>
      <div class="presets">${Object.entries(PRESETS).map(([name, v]) => html`<button class=${`preset ${d.font === v.font && d.accent === v.accent ? "on" : ""}`} onClick=${() => store.commit(`Design DNA: ${name}`, (x) => { Object.assign(x.design_dna, v); })}>
        <span class="pv-font" style=${`font-family:"${v.font}";color:${v.ink}`}>Aa</span><span class="pv-sw">${v.series.slice(0, 3).map((c) => html`<i style=${`background:${c}`}></i>`)}<i style=${`background:${v.accent}`}></i></span><span class="pv-name">${name}</span></button>`)}</div></section>
    <section class="psec"><h4>Typography</h4>
      <label class="prop"><span>Font</span><div class="pv"><select value=${d.font} onChange=${(e) => set("font", e.target.value)}>${["Helvetica Neue", "Inter", "Georgia", "Avenir Next", "Arial"].map((f) => html`<option>${f}</option>`)}</select></div></label>
      <label class="prop"><span>Title size</span><div class="pv"><input type="range" min="18" max="34" value=${d.title_size} onChange=${(e) => set("title_size", +e.target.value)} /><b class="small">${d.title_size}px</b></div></label></section>
    <section class="psec"><h4>Colour</h4>
      <label class="prop"><span>Ink</span><div class="pv"><input type="color" class="swatch" value=${d.ink} onChange=${(e) => set("ink", e.target.value)} /></div></label>
      <label class="prop"><span>Accent</span><div class="pv"><input type="color" class="swatch" value=${d.accent} onChange=${(e) => set("accent", e.target.value)} /></div></label>
      <label class="prop"><span>Series</span><div class="pv">${d.series.slice(0, 4).map((c, i) => html`<input type="color" class="swatch" value=${c} onChange=${(e) => store.commit("Design DNA: series colour", (x) => { x.design_dna.series[i] = e.target.value; })} />`)}</div></label></section>
  </div>`;
}

// ------------------------------------------------------------------ history
export function HistoryPanel({ store, toast }) {
  const hist = useStore(store, (s) => s.history), fut = useStore(store, (s) => s.future);
  const back = (n) => { for (let i = 0; i < n; i++) store.undo(); toast(`Went back ${n} step${n === 1 ? "" : "s"}`); };
  return html`<div class="pbody history"><section class="psec"><h4>This session</h4>
    ${fut.length ? html`<div class="hist future">${fut.map((h, i) => html`<button class="hrow muted" onClick=${() => { for (let k = 0; k < fut.length - i; k++) store.redo(); }}><${Icon} name="redo" size=${14} /> ${h.label}</button>`)}</div>` : ""}
    <div class="hist">${[...hist].reverse().map((h, i) => html`<button class=${`hrow ${i === 0 ? "cur" : ""}`} onClick=${() => i && back(i)} title=${i ? "Go back to this point" : "Current state"}>
      <${Icon} name=${h.label.startsWith("AI") ? "sparkle" : "edit"} size=${14} /> <span class="hl">${h.label}</span><span class="grow"></span><span class="muted small">${h.patches.length}</span></button>`)}
      ${!hist.length ? html`<p class="muted small">No edits yet. Every manual edit and accepted AI proposal appears here and can be undone.</p>` : ""}</div></section>
    <p class="muted small">Every save also keeps the previous version on the server (projects/.history).</p></div>`;
}
