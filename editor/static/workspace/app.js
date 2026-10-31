// Workspace prototype shell: slide rail · canvas · one resizable Context panel (Chat / Data / Design).
// Architecture under test: patch store (store.js) → memoised DOM slides (render.js) → ChartSpec charts
// (charts.js); Python server remains the authority for validation and integrity.
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { html } from "./html.js";
import { createStore, useStore } from "./store.js";
import { SlideView } from "./render.js";
import { ChatPanel, DataPanel, DesignPanel } from "./panels.js";
import { W, H, evidenceMap, elementsBySlide, chartSeries, dnaVars } from "./model.js";

const params = new URLSearchParams(location.search), projectName = params.get("project") || "workspace_demo";
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (d.errors || []).join("; ") || r.statusText);
  return d;
}
let toastT;
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }

// Derived, identity-stable rendering context (changes only when data, charts or DNA change).
function useCtx(store) {
  const p = useStore(store, (s) => s.project);
  return useMemo(() => {
    const cache = new Map();
    return { ev: evidenceMap(p), sources: p.sources, datasets: p.datasets || {}, charts: p.charts || {}, dna: p.design_dna,
             series: (id) => (cache.has(id) ? cache.get(id) : (cache.set(id, chartSeries(p, id)), cache.get(id))) };
  }, [p.evidence, p.research_results, p.sources, p.datasets, p.charts, p.design_dna]);
}

function TopBar({ store, integrity }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const dirty = useStore(store, (s) => s.rev !== s.savedRev), canUndo = useStore(store, (s) => s.history.length > 0), canRedo = useStore(store, (s) => s.future.length > 0);
  const [open, setOpen] = useState(false);
  const n = integrity.filter((i) => i.level !== "info").length, idx = p.slides.findIndex((s) => s.id === ui.slide);
  return html`<header id="top"><div class="logo"></div><b class="proj">${p.title}</b>
    <span class="crumb">/ Slide ${idx + 1} · ${p.slides[idx]?.title}</span><span class="grow"></span>
    <button class="ghost" disabled=${!canUndo} title="Undo (⌘Z)" onClick=${() => { const l = store.undo(); l && toast(`Undid: ${l}`); }}>↶</button>
    <button class="ghost" disabled=${!canRedo} title="Redo (⇧⌘Z)" onClick=${() => { const l = store.redo(); l && toast(`Redid: ${l}`); }}>↷</button>
    <span class="seg"><button class=${ui.focus ? "" : "on"} onClick=${() => store.ui({ focus: false })}>Workspace</button><button class=${ui.focus ? "on" : ""} onClick=${() => store.ui({ focus: true })} title="Focus mode (F)">Focus</button></span>
    <span class="checks" onClick=${() => setOpen(!open)}><span class=${`chip ${n ? "warn" : "ok"}`}>${n ? `${n} data checks` : "✓ data checks"}</span>
      ${open && html`<div class="popover checkpop">${integrity.length ? integrity.map((i) => html`<div class="issue"><span class=${`chip ${i.level === "error" ? "err" : i.level === "warning" ? "warn" : ""}`}>${i.level}</span> <code>${i.code}</code>${i.slide_id ? html` <span class="hint">slide ${p.slides.findIndex((s) => s.id === i.slide_id) + 1}</span>` : ""}<br/>${i.message}</div>`) : html`<p>All clean.</p>`}</div>`}</span>
    <span class=${`chip ${dirty ? "warn" : "ok"}`}>${dirty ? "Unsaved" : "Saved"}</span>
    <button class="primary" onClick=${() => save(store)} title="Save (⌘S)">Save</button></header>`;
}

async function save(store) {
  try { const r = await api("PUT", `/api/projects/${projectName}`, store.get().project); store.markSaved(); toast(`Saved to editor/${r.saved}`); }
  catch (e) { toast(`Save failed: ${e.message}`); }
}

function Rail({ store, ctx }) {
  const p = useStore(store, (s) => s.project), slide = useStore(store, (s) => s.ui.slide), by = elementsBySlide(p);
  const dna = useMemo(() => dnaVars(p.design_dna), [p.design_dna]);
  return html`<aside id="rail"><h6>Slides</h6>${p.slides.map((s, i) => {
    const els = by[s.id] || [], sample = els.some((e) => (e.type === "chart" ? (ctx.charts[e.chart_id]?.series || []).map((x) => x.dataset) : e.dataset_ids || []).some((d) => ctx.datasets[d]?.origin === "synthetic"));
    return html`<div class=${`thumb ${s.id === slide ? "on" : ""}`} onClick=${() => store.ui({ slide: s.id, selected: [], preview: null })}>
      <div class="n">${i + 1}</div><div class="f"><div class="miniwrap"><${SlideView} els=${els} ctx=${ctx} dnaStyle=${dna} mini=${true} /></div></div>
      <div class="t">${s.title}${sample ? html` <span class="chip warn">SAMPLE</span>` : ""}</div></div>`; })}</aside>`;
}

function Canvas({ store, ctx }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const els = elementsBySlide(p)[ui.slide] || [], dna = useMemo(() => dnaVars(p.design_dna), [p.design_dna]);
  const wrap = useRef(null), stage = useRef(null), mv = useRef(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const fit = () => { const r = wrap.current.getBoundingClientRect(); setScale(Math.max(0.2, Math.min((r.width - 48) / W, (r.height - 48) / H)));
      requestAnimationFrame(() => mv.current?.updateRect()); };  // the stage can move without a re-render (panel resize, centring)
    fit(); const ro = new ResizeObserver(fit); ro.observe(wrap.current); return () => ro.disconnect();
  }, []);
  // Moveable: transforms on the DOM during the gesture; one patch commit at the end.
  useEffect(() => {
    const m = new Moveable(wrap.current, { draggable: true, resizable: true, snappable: true, snapThreshold: 5, isDisplaySnapDigit: true,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      bounds: { left: 0, top: 0, right: 0, bottom: 0, position: "css" }, origin: false });
    const commitNodes = (nodes, label) => store.commit(label, (d) => nodes.forEach((n) => { const e = d.elements.find((x) => x.id === n.dataset.id);
      Object.assign(e, { x: Math.round(parseFloat(n.style.left)), y: Math.round(parseFloat(n.style.top)), w: Math.round(parseFloat(n.style.width)), h: Math.round(parseFloat(n.style.height)) }); }));
    m.on("drag", (e) => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; })
     .on("dragGroup", (e) => e.events.forEach((x) => { x.target.style.left = `${x.left}px`; x.target.style.top = `${x.top}px`; }))
     .on("resize", (e) => Object.assign(e.target.style, { width: `${e.width}px`, height: `${e.height}px`, left: `${e.drag.left}px`, top: `${e.drag.top}px` }))
     .on("resizeGroup", (e) => e.events.forEach((x) => Object.assign(x.target.style, { width: `${x.width}px`, height: `${x.height}px`, left: `${x.drag.left}px`, top: `${x.drag.top}px` })))
     .on("dragEnd", (e) => e.isDrag && commitNodes([e.target], "Moved"))
     .on("dragGroupEnd", (e) => e.isDrag && commitNodes(e.targets, "Moved group"))
     .on("resizeEnd", (e) => e.lastEvent && commitNodes([e.target], "Resized"))
     .on("resizeGroupEnd", (e) => e.lastEvent && commitNodes(e.targets, "Resized group"));
    mv.current = m; if (window.__ws) window.__ws.moveable = m; return () => m.destroy();
  }, []);
  useEffect(() => {
    const m = mv.current, nodes = ui.selected.map((id) => stage.current.querySelector(`.el[data-id="${CSS.escape(id)}"]`)).filter((n) => n && !els.find((e) => e.id === n.dataset.id)?.locked);
    m.target = nodes; m.elementGuidelines = [...stage.current.querySelectorAll(".slide .el")].filter((n) => !nodes.includes(n)); m.updateRect();
  });
  const expand = (ids) => { const g = new Set(ids.map((id) => els.find((e) => e.id === id)?.group).filter(Boolean)); return [...new Set([...ids, ...els.filter((e) => e.group && g.has(e.group)).map((e) => e.id)])]; };
  const onDown = (ev) => {
    if (ev.target.closest(".moveable-control-box") || mv.current.isMoveableElement(ev.target)) return;
    const node = ev.target.closest(".slide .el");
    if (!node) { if (ev.target.closest("#canvasWrap")) store.ui({ selected: [] }); return; }
    const id = node.dataset.id; if (ui.selected.includes(id) && !ev.shiftKey) return;
    const ids = expand(ev.shiftKey ? [...ui.selected, id] : [id]);
    if (!ev.shiftKey && !els.find((e) => e.id === id)?.locked) {  // hand the gesture to Moveable now, so press-and-drag works in one motion
      const m = mv.current; m.target = ids.map((x) => stage.current.querySelector(`.el[data-id="${CSS.escape(x)}"]`)).filter(Boolean);
      m.updateRect(); m.dragStart(ev);
    }
    store.ui({ selected: ids });
  };
  const onDbl = (ev) => {  // plain-text editing for text elements (rich text is roadmap stage 1)
    const node = ev.target.closest(".slide .el"), f = ev.target.closest('[data-field="text"]'); if (!node || !f) return;
    f.contentEditable = "true"; f.focus(); mv.current.target = [];
    f.addEventListener("blur", () => { f.contentEditable = "false"; const t = f.innerText.replace(/\n$/, "");
      store.commit("Edited text", (d) => { d.elements.find((x) => x.id === node.dataset.id).text = t; }); }, { once: true });
  };
  const pv = ui.preview;
  return html`<div id="canvasWrap" ref=${wrap} onMouseDown=${onDown} onDblClick=${onDbl}>
    <div class="stagebox" style=${`width:${W * scale}px;height:${H * scale}px`}>
      <div class="s1280" ref=${stage} style=${`transform:scale(${scale})`}>
        <${SlideView} els=${els} ctx=${ctx} dnaStyle=${dna} selected=${ui.selected.join(",")} />
        ${pv && html`<div class="ghosts">${pv.changes.map((c) => html`<div class="gbox" style=${`left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`}><span style=${`transform:scale(${1 / scale});transform-origin:0 100%`}>${c.why.length > 34 ? c.why.slice(0, 33) + "…" : c.why}</span></div>`)}</div>`}
      </div></div>
    <span class="zoom">${Math.round(scale * 100)}% · 1280×720</span></div>`;
}

function Panel({ store }) {
  const ui = useStore(store, (s) => s.ui);
  const drag = (e) => { e.preventDefault(); const x0 = e.clientX, w0 = ui.panelWidth;
    const move = (m) => store.ui({ panelWidth: Math.max(300, Math.min(560, w0 - (m.clientX - x0))) });
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up); };
  const TABS = [["chat", "Chat", "⌘J"], ["data", "Data", "⌘E"], ["design", "Design", ""]];
  if (!ui.panelOpen) return html`<aside class="panel collapsed">${TABS.map(([k, l]) => html`<button title=${l} onClick=${() => store.ui({ panelOpen: true, panel: k })}>${{ chat: "✦", data: "▦", design: "◐" }[k]}</button>`)}</aside>`;
  return html`<aside class="panel" style=${`width:${ui.panelWidth}px`}><div class="resize" onPointerDown=${drag} title="Drag to resize"></div>
    <div class="ptabs">${TABS.map(([k, l, kb]) => html`<button class=${ui.panel === k ? "on" : ""} title=${kb} onClick=${() => store.ui({ panel: k })}>${l}</button>`)}
      <button disabled title="Layers panel: roadmap stage 1">Layers</button><span class="grow"></span><button class="ghost" title="Collapse panel" onClick=${() => store.ui({ panelOpen: false })}>⇥</button></div>
    ${ui.panel === "chat" ? html`<${ChatPanel} store=${store} api=${api} toast=${toast} />` : ui.panel === "data" ? html`<${DataPanel} store=${store} api=${api} toast=${toast} />` : html`<${DesignPanel} store=${store} toast=${toast} />`}
  </aside>`;
}

function App({ store }) {
  const ctx = useCtx(store), focus = useStore(store, (s) => s.ui.focus), rev = useStore(store, (s) => s.rev);
  const [integrity, setIntegrity] = useState([]);
  useEffect(() => { const t = setTimeout(() => api("POST", "/api/integrity", store.get().project).then((r) => setIntegrity(r.integrity)).catch(() => {}), 400); return () => clearTimeout(t); }, [rev]);
  useEffect(() => {
    const key = (e) => {
      const typing = e.target.closest?.("input, textarea, select, [contenteditable=true]"), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "s") { e.preventDefault(); return save(store); }
      if (typing) return;
      if (mod && k === "z") { e.preventDefault(); const l = e.shiftKey ? store.redo() : store.undo(); return l && toast(`${e.shiftKey ? "Redid" : "Undid"}: ${l}`); }
      if (mod && k === "j") { e.preventDefault(); return store.ui({ panelOpen: true, panel: "chat" }); }
      if (mod && k === "e") { e.preventDefault(); return store.ui({ panelOpen: true, panel: "data" }); }
      if (k === "f" && !mod) return store.ui((u) => ({ focus: !u.focus }));
      if (k === "escape") return store.ui({ selected: [], preview: null, focus: false });
      const ar = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k], sel = store.get().ui.selected;
      if (ar && sel.length) { e.preventDefault(); const s = e.shiftKey ? 10 : 1;
        store.commit("Nudged", (d) => sel.forEach((id) => { const el = d.elements.find((x) => x.id === id); if (!el.locked) { el.x += ar[0] * s; el.y += ar[1] * s; } })); }
      if ((k === "backspace" || k === "delete") && sel.length) { e.preventDefault(); store.commit("Deleted", (d) => { d.elements = d.elements.filter((x) => !sel.includes(x.id) || x.locked); }); store.ui({ selected: [] }); }
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, []);
  return html`${!focus && html`<${TopBar} store=${store} integrity=${integrity} />`}
    <div id="main" class=${focus ? "focus" : ""}>${!focus && html`<${Rail} store=${store} ctx=${ctx} />`}
      <div id="center"><${Canvas} store=${store} ctx=${ctx} />
        ${focus && html`<div class="floatbar"><span class="hint">Focus mode</span><button onClick=${() => store.ui({ focus: false })}>Exit (F)</button></div>`}</div>
      ${!focus && html`<${Panel} store=${store} />`}</div>`;
}

(async () => {
  let project;
  try { project = await api("GET", `/api/projects/${projectName}`); } catch (e) { document.body.textContent = `Could not load ${projectName}: ${e.message}`; return; }
  const store = createStore(project);
  window.__ws = { store, api };  // debugging and benchmarks
  render(html`<${App} store=${store} />`, document.getElementById("app"));
  if (params.get("scenario")) import("./scenario.js").then((m) => m.run(params.get("scenario"), store));
})();
