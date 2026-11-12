// Workspace shell: top bar (insert tools) · left sidebar (Slides / Layers / Elements) · canvas with
// in-place editing, floating context toolbar and context menu · bottom data sheet · right panel
// (Chat / Data / Design / Properties / History). Patch store → memoised DOM slides → ChartSpec charts;
// the Python server stays the authority for validation and integrity.
import { render } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html } from "./html.js";
import { createStore, useStore } from "./store.js";
import { SlideView } from "./render.js";
import { Icon, ICON_LIBRARY } from "./icons.js";
import { ChatPanel, DataPanel, DesignPanel, HistoryPanel } from "./panels.js";
import { Inspector } from "./inspector.js";
import { ChartDataSheet, BarDataSheet } from "./sheets.js";
import { W, H, uid, evidenceMap, elementsBySlide, chartSeries, dnaVars, elementName, TYPE_LABEL, boundValue, manualEditSummary } from "./model.js";
import * as E from "./edit.js";

const params = new URLSearchParams(location.search), projectName = params.get("project") || "workspace_demo";
const direction = ["canva", "figma", "research"].includes(params.get("direction")) ? params.get("direction") : "research";
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (d.errors || []).join("; ") || r.statusText);
  return d;
}
let toastT;
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); }

function useCtx(store) {
  const p = useStore(store, (s) => s.project);
  return useMemo(() => {
    const cache = new Map();
    return { ev: evidenceMap(p), sources: p.sources, datasets: p.datasets || {}, charts: p.charts || {}, dna: p.design_dna,
             series: (id) => (cache.has(id) ? cache.get(id) : (cache.set(id, chartSeries(p, id)), cache.get(id))) };
  }, [p.evidence, p.research_results, p.sources, p.datasets, p.charts, p.design_dna]);
}

async function save(store) {
  try { const r = await api("PUT", `/api/projects/${projectName}`, store.get().project); store.markSaved(); toast(`Saved · ${r.saved.split("/").pop()}`); }
  catch (e) { toast(`Save failed: ${e.message}`); }
}

// ------------------------------------------------------------------ image upload (shared hidden input)
let uploadTarget = null;
function pickImage(store, replaceId) { uploadTarget = replaceId || null; document.getElementById("filepick").click(); }
async function onFile(store, file) {
  if (!file) return;
  const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  try {
    const { url } = await api("POST", "/api/assets", { name: file.name, data });
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
    const s = Math.min(1, 480 / img.width, 300 / img.height);
    if (uploadTarget) E.setProp(store, uploadTarget, "Replaced image", (x) => { x.src = url; x.alt = file.name; });
    else { const id = E.insert(store, store.get().project, store.get().ui.slide, "image", { src: url, alt: file.name, w: Math.round(img.width * s), h: Math.round(img.height * s) }); store.ui({ selected: [id], panel: "props" }); }
    toast(uploadTarget ? "Image replaced" : "Image added");
  } catch (e) { toast(`Upload failed: ${e.message}`); }
}

// ------------------------------------------------------------------ top bar
function Popover({ open, onClose, children, cls = "" }) {
  useEffect(() => { if (!open) return; const h = (e) => { if (!e.target.closest(".popover, .has-pop")) onClose(); }; setTimeout(() => addEventListener("mousedown", h)); return () => removeEventListener("mousedown", h); }, [open]);
  return open ? html`<div class=${`popover ${cls}`}>${children}</div>` : "";
}
function TopBar({ store, integrity, onExport }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const dirty = useStore(store, (s) => s.rev !== s.savedRev), canUndo = useStore(store, (s) => s.history.length > 0), canRedo = useStore(store, (s) => s.future.length > 0);
  const [pop, setPop] = useState(null);
  const warn = integrity.filter((i) => i.level !== "info"), edits = manualEditSummary(p);
  const ins = (kind, extra) => { const id = E.insert(store, p, ui.slide, kind, extra); store.ui({ selected: [id] }); setPop(null); };
  const Tool = ({ icon, label, onClick, popKey }) => html`<button class=${`tool ${popKey ? "has-pop" : ""} ${pop === popKey && popKey ? "on" : ""}`} title=${label} onClick=${onClick || (() => setPop(pop === popKey ? null : popKey))}><${Icon} name=${icon} size=${19} /><span>${label}</span></button>`;
  return html`<header id="top">
    <div class="tb-left"><div class="logo"><${Icon} name="slides" size=${16} color="#fff" /></div>
      <div class="titles"><input class="proj" value=${p.title} onChange=${(e) => store.commit("Renamed project", (d) => { d.title = e.target.value; })} />
        <div class="sub muted">${p.slides.length} slides · <span class=${dirty ? "warn-t" : ""}>${dirty ? "Unsaved changes" : "All changes saved"}</span></div></div></div>
    <div class="tb-mid">
      <${Tool} icon="text" label="Text" popKey="text" />
      <${Tool} icon="square" label="Shape" popKey="shape" />
      <${Tool} icon="arrow" label="Line" popKey="line" />
      <${Tool} icon="table" label="Table" onClick=${() => ins("table")} />
      <${Tool} icon="linechart" label="Chart" onClick=${() => store.ui({ panel: "data", panelOpen: true })} />
      <${Tool} icon="image" label="Image" onClick=${() => pickImage(store)} />
      <${Tool} icon="star" label="Icon" popKey="icon" />
      <${Popover} open=${pop === "text"} onClose=${() => setPop(null)} cls="pop-ins"><button class="pop-row big" onClick=${() => ins("heading")}>Add a heading</button><button class="pop-row" onClick=${() => ins("text")}>Add body text</button><//>
      <${Popover} open=${pop === "shape"} onClose=${() => setPop(null)} cls="pop-ins grid">${[["rect", "square", "Rectangle"], ["rounded", "square", "Rounded"], ["ellipse", "circle", "Ellipse"], ["callout", "chat", "Callout"]].map(([k, i, l]) => html`<button class="pop-tile" onClick=${() => ins(k)}><${Icon} name=${i} size=${22} /><span>${l}</span></button>`)}<//>
      <${Popover} open=${pop === "line"} onClose=${() => setPop(null)} cls="pop-ins grid">${[["line", "line", "Line"], ["arrow", "arrow", "Arrow"]].map(([k, i, l]) => html`<button class="pop-tile" onClick=${() => ins(k)}><${Icon} name=${i} size=${22} /><span>${l}</span></button>`)}<//>
      <${Popover} open=${pop === "icon"} onClose=${() => setPop(null)} cls="pop-ins grid">${ICON_LIBRARY.map((n) => html`<button class="pop-tile sm" onClick=${() => ins("icon", { icon: n })}><${Icon} name=${n} size=${22} /></button>`)}<//>
    </div>
    <div class="tb-right">
      <button class="icon-btn" disabled=${!canUndo} title="Undo (⌘Z)" onClick=${() => { const l = store.undo(); l && toast(`Undid: ${l}`); }}><${Icon} name="undo" /></button>
      <button class="icon-btn" disabled=${!canRedo} title="Redo (⇧⌘Z)" onClick=${() => { const l = store.redo(); l && toast(`Redid: ${l}`); }}><${Icon} name="redo" /></button>
      <span class="has-pop rel"><button class=${`status-pill ${warn.length ? "warn" : "ok"}`} onClick=${() => setPop(pop === "checks" ? null : "checks")}>
        <${Icon} name=${warn.length ? "warn" : "shield"} size=${15} /> ${edits.total ? `${edits.total} unverified edit${edits.total === 1 ? "" : "s"}` : warn.length ? `${warn.length} data notes` : "Data checks clear"}</button>
        <${Popover} open=${pop === "checks"} onClose=${() => setPop(null)} cls="checkpop"><h4>Data checks</h4>${warn.length ? warn.map((i) => html`<div class="issue"><span class=${`dot ${i.level}`}></span><div><div>${humanIssue(i)}</div><div class="muted small">${i.slide_id ? `Slide ${p.slides.findIndex((s) => s.id === i.slide_id) + 1}` : "Project"}${i.element_id ? ` · ${elementName(p.elements.find((e) => e.id === i.element_id) || { type: "text", text: i.element_id }, p)}` : ""}</div></div></div>`) : html`<p class="muted">Everything shown is sourced and verified.</p>`}<//></span>
      <button class="icon-btn" title="Focus mode (F)" onClick=${() => store.ui({ focus: !ui.focus })}><${Icon} name="expand" /></button>
      <button class="btn" onClick=${onExport}><${Icon} name="download" size=${16} /> Export</button>
      <button class="btn primary" onClick=${() => save(store)} title="Save (⌘S)">Save</button></div></header>`;
}
const ISSUE_TEXT = { sample_data_on_slide: "Shows sample (synthetic) data — not real statistics", manual_edits_unverified: null, cited_text_edited: "Wording of a verified statement was changed — needs re-verification",
  unsourced_number: null, pending_research: "Waiting for research", research_not_available: "Requested data not available", manual_series: "Manually entered series (no source)" };
const humanIssue = (i) => ISSUE_TEXT[i.code] || i.message.replace(/^number (\S+) in text is not found in any cited evidence$/, "Number $1 in text has no source");

// ------------------------------------------------------------------ left sidebar
function LeftSidebar({ store, ctx }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui), by = elementsBySlide(p);
  const dna = useMemo(() => dnaVars(p.design_dna), [p.design_dna]);
  const tab = ui.left;
  const addSlide = () => { const sid = uid("s"), n = p.slides.length + 1;
    store.commit("Added slide", (d) => { d.slides.splice(d.slides.findIndex((s) => s.id === ui.slide) + 1, 0, { id: sid, title: `Slide ${n}` });
      d.elements.push({ id: uid("t"), slide_id: sid, type: "text", role: "title", x: 40, y: 44, w: 1200, h: 40, text: "New slide title", style: {}, refs: {} },
        { id: uid("src"), slide_id: sid, type: "sources", x: 40, y: 664, w: 1200, h: 36, prefix: "Source:", style: {}, refs: {} }); });
    store.ui({ slide: sid, selected: [] }); };
  const dupSlide = (sid) => { const nid = uid("s"), groups = {};
    store.commit("Duplicated slide", (d) => { const i = d.slides.findIndex((s) => s.id === sid); d.slides.splice(i + 1, 0, { id: nid, title: `${d.slides[i].title} (copy)` });
      d.elements.filter((e) => e.slide_id === sid).map((e) => JSON.parse(JSON.stringify(e))).forEach((c) => { c.id = uid(c.type.slice(0, 3)); c.slide_id = nid; if (c.group) c.group = groups[c.group] ||= uid("g"); d.elements.push(c); }); });
    store.ui({ slide: nid, selected: [] }); };
  const delSlide = (sid) => { if (p.slides.length < 2 || !confirm("Delete this slide and its contents? (⌘Z restores it)")) return; const i = p.slides.findIndex((s) => s.id === sid);
    store.commit("Deleted slide", (d) => { d.slides = d.slides.filter((s) => s.id !== sid); d.elements = d.elements.filter((e) => e.slide_id !== sid); });
    store.ui({ slide: p.slides[i === 0 ? 1 : i - 1].id, selected: [] }); };
  const els = (by[ui.slide] || []).slice().reverse();
  return html`<aside id="left">
    <nav class="ltabs">${[["slides", "slides", "Slides"], ["layers", "layers", "Layers"], ["elements", "grid", "Elements"]].map(([k, i, l]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => store.ui({ left: k })} title=${l}><${Icon} name=${i} size=${17} /><span>${l}</span></button>`)}</nav>
    ${tab === "slides" ? html`<div class="lbody slides">${p.slides.map((s, i) => { const items = by[s.id] || [];
        return html`<div class=${`thumb ${s.id === ui.slide ? "on" : ""}`} data-slide=${s.id} onClick=${() => store.ui({ slide: s.id, selected: [], preview: null, sheet: null })}>
          <div class="n">${i + 1}</div><div class="f"><div class="miniwrap"><${SlideView} els=${items} ctx=${ctx} dnaStyle=${dna} mini=${true} /></div>
            <div class="th-acts"><button class="mini-btn" title="Duplicate slide" onClick=${(e) => { e.stopPropagation(); dupSlide(s.id); }}><${Icon} name="dup" size=${13} /></button>
              <button class="mini-btn" title="Delete slide" onClick=${(e) => { e.stopPropagation(); delSlide(s.id); }}><${Icon} name="trash" size=${13} /></button></div></div>
          <div class="t" onDblClick=${() => { const t = prompt("Slide title", s.title); if (t) store.commit("Renamed slide", (d) => { d.slides.find((x) => x.id === s.id).title = t; }); }}>${s.title}</div></div>`; })}
        <button class="add-slide" onClick=${addSlide}><${Icon} name="plus" size=${16} /> Add slide</button></div>`
    : tab === "layers" ? html`<div class="lbody layers">${els.map((e) => html`<div class=${`layer ${ui.selected.includes(e.id) ? "on" : ""} ${e.hidden ? "dim" : ""}`}
          onClick=${(ev) => store.ui((u) => ({ selected: ev.shiftKey ? [...new Set([...u.selected, e.id])] : [e.id] }))}>
          <${Icon} name=${{ text: "text", table: "table", datatable: "table", chart: "linechart", barchart: "bar", image: "image", icon: "star", line: "line", metric: "trend", panel: "square", shape: "square", sources: "text" }[e.type] || "square"} size=${15} />
          <span class="ln">${elementName(e, p)}</span>${e.group ? html`<span class="pill">group</span>` : ""}
          <button class="mini-btn" title=${e.hidden ? "Show" : "Hide"} onClick=${(ev) => { ev.stopPropagation(); E.setProp(store, e.id, e.hidden ? "Shown" : "Hidden", (x) => { x.hidden = !x.hidden; }); }}><${Icon} name="eye" size=${13} /></button>
          <button class="mini-btn" title=${e.locked ? "Unlock" : "Lock"} onClick=${(ev) => { ev.stopPropagation(); E.setLock(store, [e.id], !e.locked); }}><${Icon} name=${e.locked ? "lock" : "unlock"} size=${13} /></button></div>`)}
        <p class="muted small pad">Top of the list is in front. Use Front/Back or ⌘] / ⌘[ to reorder.</p></div>`
    : html`<div class="lbody elements">
        <h5>Text</h5><button class="lib big" onClick=${() => { const id = E.insert(store, p, ui.slide, "heading"); store.ui({ selected: [id] }); }}>Heading</button>
        <button class="lib" onClick=${() => { const id = E.insert(store, p, ui.slide, "text"); store.ui({ selected: [id] }); }}>Body text</button>
        <h5>Shapes and lines</h5><div class="lib-grid">${[["rect", "square"], ["rounded", "square"], ["ellipse", "circle"], ["callout", "chat"], ["line", "line"], ["arrow", "arrow"]].map(([k, i]) => html`<button class="pop-tile" title=${k} onClick=${() => { const id = E.insert(store, p, ui.slide, k); store.ui({ selected: [id] }); }}><${Icon} name=${i} size=${22} /></button>`)}</div>
        <h5>Icons</h5><div class="lib-grid">${ICON_LIBRARY.map((n) => html`<button class="pop-tile sm" onClick=${() => { const id = E.insert(store, p, ui.slide, "icon", { icon: n }); store.ui({ selected: [id] }); }}><${Icon} name=${n} size=${20} /></button>`)}</div>
        <h5>Exhibits</h5><button class="lib" onClick=${() => { const id = E.insert(store, p, ui.slide, "table"); store.ui({ selected: [id], panel: "props" }); }}><${Icon} name="table" size=${16} /> Editable table</button>
        <button class="lib" onClick=${() => store.ui({ panel: "data", panelOpen: true })}><${Icon} name="linechart" size=${16} /> Chart from data…</button>
        <button class="lib" onClick=${() => pickImage(store)}><${Icon} name="upload" size=${16} /> Upload image</button></div>`}
  </aside>`;
}

// ------------------------------------------------------------------ canvas
const textish = (t) => t?.closest?.("[data-field], [data-cell]");
function Canvas({ store, ctx, onReconstruct }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const els = elementsBySlide(p)[ui.slide] || [], dna = useMemo(() => dnaVars(p.design_dna), [p.design_dna]);
  const wrap = useRef(null), stage = useRef(null), mv = useRef(null), down = useRef(null), drop = useRef(null);
  const [fit, setFit] = useState(0.5), [menu, setMenu] = useState(null), [tb, setTb] = useState(null), [tick, setTick] = useState(0);
  const scale = ui.zoom || fit;
  useEffect(() => {
    const f = () => { const r = wrap.current.getBoundingClientRect(); setFit(Math.max(0.2, Math.min((r.width - 64) / W, (r.height - 72) / H))); setTick((t) => t + 1); };
    f(); const ro = new ResizeObserver(f); ro.observe(wrap.current); return () => ro.disconnect();
  }, []);
  // Moveable: transforms on the DOM during the gesture; one patch commit at the end. A layout effect, declared
  // before the selection effect below, so the instance exists when that effect first runs.
  useLayoutEffect(() => {
    const m = new Moveable(wrap.current, { draggable: true, resizable: true, rotatable: true, snappable: true, snapThreshold: 5, isDisplaySnapDigit: true, throttleRotate: 1,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true }, origin: false });
    const read = (n) => ({ x: Math.round(parseFloat(n.style.left)), y: Math.round(parseFloat(n.style.top)), w: Math.round(parseFloat(n.style.width)), h: Math.round(parseFloat(n.style.height)) });
    const commitNodes = (nodes, label) => store.commit(label, (d) => nodes.forEach((n) => Object.assign(d.elements.find((x) => x.id === n.dataset.id), read(n))));
    const track = (e) => { const ie = e.inputEvent; if (!ie) return; const hit = document.elementFromPoint(ie.clientX, ie.clientY)?.closest(".thumb");
      const sid = hit && hit.dataset.slide !== store.get().ui.slide ? hit.dataset.slide : null;
      document.querySelectorAll(".thumb.drop").forEach((t) => t.classList.toggle("drop", t.dataset.slide === sid)); if (sid) hit.classList.add("drop"); drop.current = sid; };
    const endDrop = (nodes) => { const sid = drop.current; drop.current = null; document.querySelectorAll(".thumb.drop").forEach((t) => t.classList.remove("drop"));
      if (!sid) return false; E.moveToSlide(store, nodes.map((n) => n.dataset.id), sid); store.ui({ selected: [] });
      toast(`Moved to slide ${store.get().project.slides.findIndex((s) => s.id === sid) + 1} (⌘Z to undo)`); return true; };
    m.on("dragStart", () => setTb(null)).on("dragGroupStart", () => setTb(null))
     .on("drag", (e) => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; track(e); })
     .on("dragGroup", (e) => { e.events.forEach((x) => { x.target.style.left = `${x.left}px`; x.target.style.top = `${x.top}px`; }); track(e); })
     .on("resize", (e) => Object.assign(e.target.style, { width: `${e.width}px`, height: `${e.height}px`, left: `${e.drag.left}px`, top: `${e.drag.top}px` }))
     .on("resizeGroup", (e) => e.events.forEach((x) => Object.assign(x.target.style, { width: `${x.width}px`, height: `${x.height}px`, left: `${x.drag.left}px`, top: `${x.drag.top}px` })))
     .on("rotate", (e) => { e.target.style.transform = e.transform; })
     .on("dragEnd", (e) => { if (e.isDrag && !endDrop([e.target])) commitNodes([e.target], "Moved"); })
     .on("dragGroupEnd", (e) => { if (e.isDrag && !endDrop(e.targets)) commitNodes(e.targets, "Moved group"); })
     .on("resizeEnd", (e) => e.lastEvent && commitNodes([e.target], "Resized"))
     .on("resizeGroupEnd", (e) => e.lastEvent && commitNodes(e.targets, "Resized group"))
     .on("rotateEnd", (e) => { const r = e.lastEvent?.rotation; if (r != null) E.setProp(store, e.target.dataset.id, "Rotated", (x) => { x.rotation = Math.round(((r % 360) + 360) % 360); }); });
    mv.current = m; if (window.__ws) window.__ws.moveable = m; return () => m.destroy();
  }, []);
  useLayoutEffect(() => {
    const m = mv.current; if (!m) return;
    const selEls = ui.selected.map((id) => els.find((e) => e.id === id)).filter(Boolean);
    const nodes = ui.editing ? [] : selEls.filter((e) => !e.locked).map((e) => stage.current.querySelector(`.el[data-id="${CSS.escape(e.id)}"]`)).filter(Boolean);
    m.target = nodes; m.keepRatio = selEls.length === 1 && ["icon", "image"].includes(selEls[0].type); m.rotatable = nodes.length === 1;
    m.elementGuidelines = [...stage.current.querySelectorAll(".slide .el")].filter((n) => !nodes.includes(n)); m.updateRect();
    // floating context toolbar position (screen coords relative to the canvas wrap)
    const rects = ui.selected.map((id) => stage.current.querySelector(`.el[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()).filter(Boolean);
    if (!rects.length) { setTb(null); return; }
    const wr = wrap.current.getBoundingClientRect(), top = Math.min(...rects.map((r) => r.top)) - wr.top + wrap.current.scrollTop, bottom = Math.max(...rects.map((r) => r.bottom)) - wr.top + wrap.current.scrollTop;
    const cx = (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2 - wr.left + wrap.current.scrollLeft;
    setTb({ cx, y: top > 64 ? top - 52 : bottom + 12 });
  }, [ui.selected, ui.editing, els, scale, ui.slide, tick]);

  const expand = (ids) => { const g = new Set(ids.map((id) => els.find((e) => e.id === id)?.group).filter(Boolean)); return [...new Set([...ids, ...els.filter((e) => e.group && g.has(e.group)).map((e) => e.id)])]; };
  const startEdit = (id, node) => {
    const el = els.find((e) => e.id === id); if (!el || !node || document.querySelector(".slide .editing")) return;  // one edit session at a time
    const cell = node.dataset.cell, field = node.dataset.field;
    node.classList.add("editing");
    (() => {  // set up synchronously, so keystrokes typed right after the double-click land in the editor
      const before = node.innerHTML; let cancelled = false;
      if (cell) {  // show the raw editable value (number without formatting)
        const [a, b] = cell.split(":");
        if (el.type === "table" && a !== "h" && b !== "-1") { const c = el.rows[+a].cells[+b] || {}; if (c.delta) { toast("Computed from two other cells; edit those instead"); node.classList.remove("editing"); store.ui({ editing: null }); return; }
          if (c.evidence_id || c.working || "value" in c) node.textContent = boundValue(ctx.ev, c).value ?? ""; }
        if (el.type === "datatable" && b !== "-1") { const o = (ctx.datasets[el.dataset_ids[+a]]?.working || {})[el.dates[+b]]; node.textContent = node.textContent === "–" ? "" : node.textContent.replace(/,/g, ""); if (o?.deleted) node.textContent = ""; }
        if (cell === "metric") { const v = boundValue(ctx.ev, el).value; node.textContent = v != null ? +(v / (el.fmt?.scale || 1)).toFixed(4) : ""; }
        node.querySelectorAll(".editmark").forEach((m) => m.remove());
      }
      node.contentEditable = "true"; node.classList.add("editing"); node.focus();
      const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const finish = () => {
        node.contentEditable = "false"; node.classList.remove("editing"); node.removeEventListener("keydown", key);
        const raw = node.innerText.replace(/\n$/, "").trim(), rich = field === "text" ? E.sanitize(node) : null;
        node.innerHTML = before;
        const remount = () => store.ui({ editing: null, remount: `${id}#${Date.now()}` });  // fresh DOM from the model (contentEditable detached Preact's nodes)
        if (cancelled) return remount();
        if (field === "text") E.setText(store, id, "text", rich);
        else if (field) E.setText(store, id, field, raw);
        else if (cell === "metric") E.setMetric(store, id, raw, toast);
        else if (cell.startsWith("bar:")) E.barOps.label(store, id, +cell.slice(4), raw);
        else { const [a, b] = cell.split(":");
          if (el.type === "datatable") { if (b === "-1") E.setProp(store, id, "Renamed row", (x) => { x.row_labels = { ...(x.row_labels || {}), [el.dataset_ids[+a]]: raw }; }); else E.setObservation(store, el.dataset_ids[+a], el.dates[+b], raw, toast); }
          else E.setTableCell(store, id, a === "h" ? "h" : +a, +b, raw, toast); }
        remount();
      };
      const key = (k) => {
        if (k.key === "Escape") { node.blur(); }  // Escape leaves editing and keeps the text (as in Canva / PowerPoint)
        else if (k.key === "Enter" && (cell || !k.shiftKey && field !== "text")) { k.preventDefault(); node.blur(); }
        else if (k.key === "Tab" && cell) { k.preventDefault(); const next = [...node.closest("table").querySelectorAll("[data-cell]")]; const i = next.indexOf(node); node.blur(); const n2 = next[i + (k.shiftKey ? -1 : 1)]; if (n2) setTimeout(() => startEdit(id, n2), 30); }
        else if (field === "text" && (k.metaKey || k.ctrlKey) && ["b", "i", "u"].includes(k.key.toLowerCase())) { k.preventDefault(); document.execCommand({ b: "bold", i: "italic", u: "underline" }[k.key.toLowerCase()]); }
        k.stopPropagation();
      };
      node.addEventListener("keydown", key);
      node.addEventListener("blur", finish, { once: true });
    })();
    if (node.isContentEditable) store.ui({ editing: id, selected: [id] });
  };
  window.__startEdit = (id, sel) => startEdit(id, stage.current.querySelector(`.el[data-id="${CSS.escape(id)}"] ${sel || "[data-field]"}`));

  const onDown = (ev) => {
    setMenu(null);
    if (ev.button === 2 || ev.target.closest(".moveable-control-box, .ctxbar, .ctxmenu") || mv.current.isMoveableElement(ev.target)) return;
    if (ev.target.closest("[contenteditable=true]")) return;
    const node = ev.target.closest(".slide .el");
    if (!node) { if (ev.target.closest("#canvasWrap")) store.ui({ selected: [] }); return; }
    const id = node.dataset.id, was = ui.selected.length === 1 && ui.selected[0] === id;
    down.current = { id, was, x: ev.clientX, y: ev.clientY, target: ev.target };
    if (ui.selected.includes(id) && !ev.shiftKey) return;
    const ids = expand(ev.shiftKey ? [...ui.selected, id] : [id]);
    if (!ev.shiftKey && !els.find((e) => e.id === id)?.locked) { const m = mv.current;
      m.target = ids.map((x) => stage.current.querySelector(`.el[data-id="${CSS.escape(x)}"]`)).filter(Boolean); m.updateRect(); m.dragStart(ev); }
    store.ui({ selected: ids });
  };
  const onClick = (ev) => {  // click an already-selected text/cell → edit in place (Canva-style)
    const d = down.current; down.current = null;
    if (!d || !d.was || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 3) return;
    const t = textish(document.elementFromPoint(ev.clientX, ev.clientY) || d.target); if (t && t.closest(".el")?.dataset.id === d.id) startEdit(d.id, t);
  };
  const onDbl = (ev) => { const node = ev.target.closest(".slide .el"); if (!node) return; const el = els.find((e) => e.id === node.dataset.id);
    const t = textish(document.elementFromPoint(ev.clientX, ev.clientY) || ev.target);
    if (t) return startEdit(node.dataset.id, t);
    if (el?.type === "chart" || el?.type === "barchart") store.ui({ sheet: el.id, selected: [el.id] });
    else if (el?.type === "image") store.ui({ panel: "props", panelOpen: true }); };
  const onCtx = (ev) => { const node = ev.target.closest(".slide .el"); ev.preventDefault();
    if (node && !ui.selected.includes(node.dataset.id)) store.ui({ selected: expand([node.dataset.id]) });
    const wr = wrap.current.getBoundingClientRect(); setMenu({ x: ev.clientX - wr.left + wrap.current.scrollLeft, y: ev.clientY - wr.top + wrap.current.scrollTop, onEl: !!node }); };
  const pv = ui.preview;
  return html`<div id="canvasWrap" ref=${wrap} onMouseDown=${onDown} onClick=${onClick} onDblClick=${onDbl} onContextMenu=${onCtx} onScroll=${() => setTick((t) => t + 1)}>
    <div class="stagebox" style=${`width:${W * scale}px;height:${H * scale}px`}>
      <div class="s1280" ref=${stage} style=${`transform:scale(${scale})`}>
        <${SlideView} els=${els} ctx=${ctx} dnaStyle=${dna} selected=${ui.selected.join(",")} editing=${ui.editing || ""} remount=${ui.remount || ""} />
        ${pv && html`<div class="ghosts">${pv.changes.map((c) => html`<div class="gbox" style=${`left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`}><span style=${`transform:scale(${1 / scale});transform-origin:0 100%`}>${c.why.length > 34 ? c.why.slice(0, 33) + "…" : c.why}</span></div>`)}</div>`}
      </div></div>
    ${tb && !ui.focus && html`<${ContextToolbar} store=${store} p=${p} ui=${ui} els=${els} pos=${tb} openMenu=${(x, y) => setMenu({ x, y, onEl: true })} />`}
    ${menu && html`<${ContextMenu} store=${store} p=${p} ui=${ui} els=${els} pos=${menu} close=${() => setMenu(null)} onReconstruct=${onReconstruct} />`}
    <div class="zoombar"><button class="icon-btn" onClick=${() => store.ui({ zoom: Math.max(0.25, +(scale - 0.1).toFixed(2)) })}>−</button>
      <button class="zl" onClick=${() => store.ui({ zoom: null })} title="Fit to screen">${Math.round(scale * 100)}%</button>
      <button class="icon-btn" onClick=${() => store.ui({ zoom: Math.min(2, +(scale + 0.1).toFixed(2)) })}>+</button>
      <span class="sep"></span><span class="muted small">Slide ${p.slides.findIndex((s) => s.id === ui.slide) + 1} / ${p.slides.length}</span></div>
  </div>`;
}

function ContextToolbar({ store, p, ui, els, pos, openMenu }) {
  const sel = ui.selected.map((id) => els.find((e) => e.id === id)).filter(Boolean); if (!sel.length) return "";
  const el = sel[0], one = sel.length === 1, st = el.style || {}, styleSet = (k, label) => (v) => E.setProp(store, el.id, label, (x) => { x.style = { ...(x.style || {}), [k]: v }; });
  const exec = (cmd) => (e) => { e.preventDefault(); if (ui.editing) document.execCommand(cmd); else styleSet({ bold: "fontWeight", italic: "italic", underline: "underline" }[cmd], cmd)(cmd === "bold" ? (+st.fontWeight >= 600 ? 400 : 700) : !st[cmd]); };
  const ask = (q) => { store.ui({ panel: "chat", panelOpen: true }); setTimeout(() => { const ta = document.querySelector(".composer textarea"); if (ta) { ta.value = q; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); } }, 50); };
  const B = ({ icon, title, onClick, on, label, primary }) => html`<button class=${`tbb ${on ? "on" : ""} ${primary ? "primary" : ""}`} title=${title} onMouseDown=${(e) => e.preventDefault()} onClick=${onClick}><${Icon} name=${icon} size=${16} />${label ? html`<span>${label}</span>` : ""}</button>`;
  let content;
  if (!one) content = html`${["left", "center", "right"].map((a) => html`<${B} icon=${{ left: "alignL", center: "alignC", right: "alignR" }[a]} title=${`Align ${a}`} onClick=${() => E.align(store, sel, a)} />`)}
    <span class="sep"></span><${B} icon="group" title="Group (⌘G)" label="Group" onClick=${() => E.group(store, ui.selected)} /><${B} icon="ungroup" title="Ungroup (⇧⌘G)" onClick=${() => E.ungroup(store, ui.selected)} />`;
  else if (el.type === "text" || (el.type === "shape" && el.text != null)) content = html`
    <select class="tb-font" value=${st.fontFamily || ""} onChange=${(e) => styleSet("fontFamily", "Changed font")(e.target.value || undefined)}><option value="">Deck font</option>${["Helvetica Neue", "Inter", "Georgia", "Avenir Next", "Arial"].map((f) => html`<option>${f}</option>`)}</select>
    <button class="tbb" title="Smaller" onMouseDown=${(e) => e.preventDefault()} onClick=${() => styleSet("fontSize", "Font size")(Math.max(6, (st.fontSize || ({ title: p.design_dna.title_size, body: 14, kicker: 10.5, subtitle: 12.5 }[el.role] || 13)) - 1))}>A−</button>
    <input class="tb-size" type="number" value=${st.fontSize || ({ title: p.design_dna.title_size, body: 14, kicker: 10.5, subtitle: 12.5 }[el.role] || 13)} onChange=${(e) => styleSet("fontSize", "Font size")(+e.target.value)} />
    <button class="tbb" title="Larger" onMouseDown=${(e) => e.preventDefault()} onClick=${() => styleSet("fontSize", "Font size")((st.fontSize || ({ title: p.design_dna.title_size, body: 14, kicker: 10.5, subtitle: 12.5 }[el.role] || 13)) + 1)}>A+</button>
    <span class="sep"></span><${B} icon="bold" title="Bold (⌘B)" on=${+st.fontWeight >= 600} onClick=${exec("bold")} /><${B} icon="italic" title="Italic (⌘I)" on=${st.italic} onClick=${exec("italic")} /><${B} icon="underline" title="Underline (⌘U)" on=${st.underline} onClick=${exec("underline")} />
    <label class="tb-color" title="Text colour"><span style=${`background:${st.color || p.design_dna.ink}`}></span><input type="color" value=${st.color || p.design_dna.ink} onInput=${(e) => styleSet("color", "Text colour")(e.target.value)} /></label>
    ${["left", "center", "right"].map((a) => html`<${B} icon=${{ left: "alignL", center: "alignC", right: "alignR" }[a]} title=${`Align ${a}`} on=${(st.align || "left") === a} onClick=${() => styleSet("align", "Aligned text")(a)} />`)}
    ${!ui.editing ? html`<span class="sep"></span><${B} icon="edit" title="Edit text (Enter)" label="Edit" onClick=${() => window.__startEdit(el.id, '[data-field="text"]')} />` : ""}`;
  else if (el.type === "chart" || el.type === "barchart") content = html`<${B} icon="table" title="Edit the data behind this chart" label="Edit data" primary onClick=${() => store.ui({ sheet: el.id })} />
    ${el.type === "chart" ? html`<span class="sep"></span><${B} icon="linechart" title="Line" on=${p.charts[el.chart_id]?.type === "line"} onClick=${() => E.chartOps.setSpec(store, el.chart_id, "Chart type: line", (c) => { c.type = "line"; })} /><${B} icon="bar" title="Bar" on=${p.charts[el.chart_id]?.type === "bar"} onClick=${() => E.chartOps.setSpec(store, el.chart_id, "Chart type: bar", (c) => { c.type = "bar"; })} />` : ""}
    <${B} icon="sliders" title="Chart style" onClick=${() => store.ui({ panel: "props", panelOpen: true })} /><${B} icon="sparkle" title="Ask AI about this chart" onClick=${() => ask("Verify the edited values")} />`;
  else if (el.type === "table" || el.type === "datatable") content = html`<${B} icon="table" title="Edit cells and structure" label="Edit table" primary onClick=${() => store.ui({ panel: "props", panelOpen: true })} />
    <${B} icon="sparkle" title="Ask AI to verify this table" label="Verify" onClick=${() => ask("Verify every value in this table against its source")} />`;
  else if (el.type === "image") content = html`<${B} icon="crop" title="Crop and adjust" label="Crop & adjust" onClick=${() => store.ui({ panel: "props", panelOpen: true })} /><${B} icon="upload" title="Replace image" onClick=${() => pickImage(store, el.id)} />`;
  else if (el.type === "shape" || el.type === "panel" || el.type === "icon" || el.type === "line") content = html`
    <label class="tb-color" title="Colour"><span style=${`background:${st.fill || st.color || "#dbe4f0"}`}></span><input type="color" value=${st.fill || st.color || "#dbe4f0"} onInput=${(e) => styleSet(el.type === "shape" || el.type === "panel" ? "fill" : "color", "Changed colour")(e.target.value)} /></label>
    ${el.type === "line" ? html`<${B} icon="arrow" title="Arrowhead" on=${el.arrow_end} onClick=${() => E.setProp(store, el.id, "Arrowhead", (x) => { x.arrow_end = !x.arrow_end; })} />` : ""}`;
  else if (el.type === "metric") content = html`<${B} icon="edit" title="Edit value" label="Edit value" onClick=${() => window.__startEdit(el.id, '[data-cell="metric"]')} />`;
  return html`<div class="ctxbar" style=${`left:${pos.cx}px;top:${pos.y}px`} onMouseDown=${(e) => e.stopPropagation()}>
    ${content}${content ? html`<span class="sep"></span>` : ""}
    <${B} icon="dup" title="Duplicate (⌘D)" onClick=${() => { E.copy(p, ui.selected); store.ui({ selected: E.paste(store, ui.slide) }); }} />
    <${B} icon=${el.locked ? "lock" : "unlock"} title=${el.locked ? "Unlock" : "Lock position"} on=${el.locked} onClick=${() => E.setLock(store, ui.selected, !el.locked)} />
    <${B} icon="trash" title="Delete (⌫)" onClick=${() => { E.del(store, ui.selected); store.ui({ selected: [] }); }} />
    <${B} icon="more" title="More" onClick=${(e) => { const r = e.currentTarget.getBoundingClientRect(), wr = document.getElementById("canvasWrap").getBoundingClientRect(); openMenu(r.left - wr.left, r.bottom - wr.top + 6); }} />
  </div>`;
}

function ContextMenu({ store, p, ui, els, pos, close, onReconstruct }) {
  const sel = ui.selected.map((id) => els.find((e) => e.id === id)).filter(Boolean), el = sel[0];
  const run = (f) => () => { f(); close(); };
  const ref = useRef(null);
  useLayoutEffect(() => {  // keep the menu inside the visible canvas area
    const m = ref.current, w = m?.parentElement; if (!m || !w) return;
    m.style.top = `${Math.max(w.scrollTop + 8, Math.min(pos.y, w.scrollTop + w.clientHeight - m.offsetHeight - 8))}px`;
    m.style.left = `${Math.max(w.scrollLeft + 8, Math.min(pos.x, w.scrollLeft + w.clientWidth - m.offsetWidth - 8))}px`;
  }, [pos.x, pos.y]);
  const I = ({ icon, label, kb, onClick, disabled }) => html`<button class="mi" disabled=${disabled} onClick=${run(onClick)}><${Icon} name=${icon} size=${15} /><span>${label}</span><span class="kb">${kb || ""}</span></button>`;
  return html`<div class="ctxmenu" ref=${ref} style=${`left:${pos.x}px;top:${pos.y}px`} onMouseDown=${(e) => e.stopPropagation()}>
    ${pos.onEl && sel.length ? html`
      ${el.type === "chart" || el.type === "barchart" ? html`<${I} icon="table" label="Edit data" onClick=${() => store.ui({ sheet: el.id })} />` : ""}
      ${el.type === "table" || el.type === "datatable" ? html`<${I} icon="table" label="Edit table" onClick=${() => store.ui({ panel: "props", panelOpen: true })} />` : ""}
      ${el.type === "image" ? html`<${I} icon="table" label="Reconstruct as editable table…" onClick=${() => onReconstruct(el)} />` : ""}
      <${I} icon="copy" label="Copy" kb="⌘C" onClick=${() => { E.copy(p, ui.selected); toast("Copied"); }} />
      <${I} icon="move" label="Cut" kb="⌘X" onClick=${() => { E.copy(p, ui.selected); E.del(store, ui.selected); store.ui({ selected: [] }); }} />
      <${I} icon="dup" label="Duplicate" kb="⌘D" onClick=${() => { E.copy(p, ui.selected); store.ui({ selected: E.paste(store, ui.slide) }); }} />
      <div class="msep"></div>
      ${sel.length > 1 ? html`<${I} icon="group" label="Group" kb="⌘G" onClick=${() => E.group(store, ui.selected)} />` : ""}
      ${sel.some((e) => e.group) ? html`<${I} icon="ungroup" label="Ungroup" kb="⇧⌘G" onClick=${() => E.ungroup(store, ui.selected)} />` : ""}
      <${I} icon="front" label="Bring to front" kb="⌥⌘]" onClick=${() => E.arrange(store, ui.selected, "front")} />
      <${I} icon="front" label="Bring forward" kb="⌘]" onClick=${() => E.arrange(store, ui.selected, "forward")} />
      <${I} icon="back" label="Send backward" kb="⌘[" onClick=${() => E.arrange(store, ui.selected, "backward")} />
      <${I} icon="back" label="Send to back" kb="⌥⌘[" onClick=${() => E.arrange(store, ui.selected, "back")} />
      <${I} icon=${el.locked ? "unlock" : "lock"} label=${el.locked ? "Unlock" : "Lock"} onClick=${() => E.setLock(store, ui.selected, !el.locked)} />
      <div class="msep"></div><div class="mlabel">Move to slide</div>
      ${p.slides.filter((s) => s.id !== ui.slide).map((s) => html`<${I} icon="slides" label=${`${p.slides.indexOf(s) + 1}. ${s.title}`} onClick=${() => { E.moveToSlide(store, ui.selected, s.id); store.ui({ selected: [] }); toast(`Moved to “${s.title}” (⌘Z to undo)`); }} />`)}
      <div class="msep"></div><${I} icon="trash" label="Delete" kb="⌫" onClick=${() => { E.del(store, ui.selected); store.ui({ selected: [] }); }} />`
    : html`<${I} icon="copy" label="Paste" kb="⌘V" disabled=${!E.hasClipboard()} onClick=${() => store.ui({ selected: E.paste(store, ui.slide) })} />
      <${I} icon="text" label="Add text" onClick=${() => store.ui({ selected: [E.insert(store, p, ui.slide, "text")] })} />`}
  </div>`;
}

// ------------------------------------------------------------------ right panel
const TABS = [["chat", "chat", "Chat"], ["data", "data", "Data"], ["design", "palette", "Design"], ["props", "sliders", "Properties"], ["history", "clock", "History"]];
function RightPanel({ store, ctx, onReconstruct }) {
  const ui = useStore(store, (s) => s.ui);
  const drag = (e) => { e.preventDefault(); const x0 = e.clientX, w0 = ui.panelWidth;
    const move = (m) => store.ui({ panelWidth: Math.max(300, Math.min(600, w0 - (m.clientX - x0))) });
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up); };
  if (!ui.panelOpen) return html`<aside class="panel collapsed">${TABS.map(([k, i, l]) => html`<button class="icon-btn" title=${l} onClick=${() => store.ui({ panelOpen: true, panel: k })}><${Icon} name=${i} /></button>`)}</aside>`;
  return html`<aside class="panel" style=${`width:${ui.panelWidth}px`}><div class="resize" onPointerDown=${drag} title="Drag to resize"></div>
    <nav class="ptabs">${TABS.map(([k, i, l]) => html`<button class=${ui.panel === k ? "on" : ""} onClick=${() => store.ui({ panel: k })} title=${l}><${Icon} name=${i} size=${16} /><span>${l}</span></button>`)}
      <button class="icon-btn" title="Collapse panel" onClick=${() => store.ui({ panelOpen: false })}><${Icon} name="close" size=${15} /></button></nav>
    ${ui.panel === "chat" ? html`<${ChatPanel} store=${store} api=${api} toast=${toast} />` : ui.panel === "data" ? html`<${DataPanel} store=${store} api=${api} toast=${toast} />`
      : ui.panel === "design" ? html`<${DesignPanel} store=${store} />` : ui.panel === "history" ? html`<${HistoryPanel} store=${store} toast=${toast} />`
      : html`<${Inspector} store=${store} ctx=${ctx} toast=${toast} openSheet=${(id) => store.ui({ sheet: id })} onUpload=${(id) => pickImage(store, id)} onReconstruct=${onReconstruct} />`}
  </aside>`;
}

function Sheet({ store, ctx }) {
  const p = useStore(store, (s) => s.project), id = useStore(store, (s) => s.ui.sheet);
  const el = id && p.elements.find((e) => e.id === id); if (!el) return "";
  const close = () => store.ui({ sheet: null });
  return el.type === "chart" ? html`<${ChartDataSheet} store=${store} p=${p} el=${el} onClose=${close} toast=${toast} />` : html`<${BarDataSheet} store=${store} p=${p} ev=${ctx.ev} el=${el} onClose=${close} toast=${toast} />`;
}

// ------------------------------------------------------------------ dialogs
function ExportDialog({ store, integrity, close }) {
  const p = useStore(store, (s) => s.project), ui = useStore(store, (s) => s.ui);
  const [mode, setMode] = useState("draft"), [ack, setAck] = useState({}), [busy, setBusy] = useState(false);
  const m = manualEditSummary(p), cats = [];
  if (m.total) cats.push(["edits", `${m.total} manually edited value${m.total === 1 ? "" : "s"} not yet verified (${m.obs} chart/data observations, ${m.cells} table, bar or metric values)`]);
  const sample = integrity.filter((i) => i.code === "sample_data_on_slide").length; if (sample) cats.push(["sample", `${sample} exhibit${sample === 1 ? "" : "s"} showing SAMPLE (synthetic) data`]);
  const wording = integrity.filter((i) => i.code === "cited_text_edited").length; if (wording) cats.push(["wording", `${wording} verified statement${wording === 1 ? "" : "s"} reworded`]);
  const nums = integrity.filter((i) => i.code === "unsourced_number").length; if (nums) cats.push(["numbers", `${nums} number${nums === 1 ? "" : "s"} in text without a source`]);
  const ready = mode === "draft" || cats.every(([k]) => ack[k]);
  const go = async () => {
    setBusy(true); store.ui({ selected: [], editing: null }); await new Promise((r) => setTimeout(r, 80));
    const slideNode = document.querySelector("#canvasWrap .slide"); let banner = null;
    if (mode === "draft" && cats.length) { banner = document.createElement("div"); banner.className = "draft-banner"; banner.textContent = "DRAFT — contains unverified edits or sample data"; slideNode.appendChild(banner); }
    try {
      const url = await htmlToImage.toPng(slideNode, { pixelRatio: 2, width: W, height: H, filter: (n) => !(n.classList && n.classList.contains("no-export")) });
      const idx = p.slides.findIndex((s) => s.id === ui.slide) + 1;
      const r = await api("POST", `/api/projects/${projectName}/export`, { png: url, label: `${mode}-slide-${idx}` });
      store.mutate((d) => { (d.export_log ||= []).push({ at: new Date().toISOString(), mode, slide: ui.slide, file: r.saved, acknowledged: mode === "final" ? cats.map(([k, t]) => t) : [] }); });
      const a = document.createElement("a"); a.href = url; a.download = r.saved.split("/").pop(); a.click();
      toast(`Exported ${mode} PNG · ${r.saved.split("/").pop()}`); close();
    } catch (e) { toast(`Export failed: ${e.message}`); } finally { banner?.remove(); setBusy(false); }
  };
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && close()}><div class="modal">
    <div class="mh"><h3>Export slide</h3><button class="icon-btn" onClick=${close}><${Icon} name="close" /></button></div>
    <div class="seg full">${[["draft", "Draft"], ["final", "Final report"]].map(([k, l]) => html`<button class=${mode === k ? "on" : ""} onClick=${() => setMode(k)}>${l}</button>`)}</div>
    ${mode === "draft" ? html`<p class="muted">Drafts can contain anything you are experimenting with. ${cats.length ? "A small “DRAFT” banner is added because this deck has unverified content." : ""}</p>`
      : html`<p class="muted">A final export certifies nothing on its own. Resolve or explicitly acknowledge each item below; acknowledgements are recorded with the export.</p>
        ${cats.length ? cats.map(([k, t]) => html`<label class="ack"><input type="checkbox" checked=${!!ack[k]} onChange=${(e) => setAck({ ...ack, [k]: e.target.checked })} /><span>${t}</span></label>`) : html`<div class="note-box ok"><${Icon} name="check" size=${15} /><div>Nothing to acknowledge: all values are sourced and verified.</div></div>`}`}
    <div class="mf"><span class="muted small">PNG · 2560×1440 · current slide</span><span class="grow"></span><button class="btn" onClick=${close}>Cancel</button>
      <button class="btn primary" disabled=${!ready || busy} onClick=${go}>${busy ? "Exporting…" : mode === "final" ? "Export final" : "Export draft"}</button></div></div></div>`;
}

function ReconstructDialog({ store, image, close }) {
  const [rows, setRows] = useState(4), [cols, setCols] = useState(3);
  const make = () => { const p = store.get().project, id = uid("tab");
    store.commit("Reconstructed as editable table", (d) => { d.elements.push({ id, slide_id: image.slide_id, type: "table", x: Math.min(1240 - 420, image.x + image.w + 16), y: image.y, w: 420, h: 40 + rows * 26,
      title: "Reconstructed from image — enter and verify values", reconstructed_from: image.id, columns: ["Item", ...Array.from({ length: cols - 1 }, (_, i) => `Column ${i + 1}`)],
      rows: Array.from({ length: rows }, (_, r) => ({ label: `Row ${r + 1}`, cells: Array.from({ length: cols - 1 }, () => ({ text: "" })) })), style: {}, refs: {} }); });
    store.ui({ selected: [id], panel: "props", panelOpen: true }); close(); toast("Empty editable table created next to the image. Values you type are marked as manual until verified."); };
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && close()}><div class="modal">
    <div class="mh"><h3>Reconstruct as editable table</h3><button class="icon-btn" onClick=${close}><${Icon} name="close" /></button></div>
    <p>Numbers inside an image are pixels, not data. This prototype does <b>not</b> read them automatically (no OCR or AI extraction runs).</p>
    <p class="muted">It creates an empty, structured table beside the image so you can re-enter the figures. Every value you type is marked “manual — pending verification” until it is checked against a source.</p>
    <div class="btn-row"><label class="inline">Rows <input type="number" class="num" value=${rows} min="1" max="30" onChange=${(e) => setRows(+e.target.value)} /></label>
      <label class="inline">Columns <input type="number" class="num" value=${cols} min="2" max="10" onChange=${(e) => setCols(+e.target.value)} /></label></div>
    <div class="mf"><span class="grow"></span><button class="btn" onClick=${close}>Cancel</button><button class="btn primary" onClick=${make}>Create table</button></div></div></div>`;
}

// ------------------------------------------------------------------ app
function App({ store }) {
  const ctx = useCtx(store), focus = useStore(store, (s) => s.ui.focus), rev = useStore(store, (s) => s.rev), sheet = useStore(store, (s) => s.ui.sheet);
  const [integrity, setIntegrity] = useState([]), [dialog, setDialog] = useState(null);
  useEffect(() => { const t = setTimeout(() => api("POST", "/api/integrity", store.get().project).then((r) => setIntegrity(r.integrity)).catch(() => {}), 500); return () => clearTimeout(t); }, [rev]);
  useEffect(() => {
    const key = (e) => {
      const typing = e.target.closest?.("input, textarea, select, [contenteditable=true]"), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), s = store.get(), sel = s.ui.selected;
      if (mod && k === "s") { e.preventDefault(); return save(store); }
      if (typing) return;
      if (mod && k === "z") { e.preventDefault(); const l = e.shiftKey ? store.redo() : store.undo(); return l && toast(`${e.shiftKey ? "Redid" : "Undid"}: ${l}`); }
      if (mod && k === "c" && sel.length) { e.preventDefault(); return toast(`Copied ${E.copy(s.project, sel)} object(s)`); }
      if (mod && k === "x" && sel.length) { e.preventDefault(); E.copy(s.project, sel); E.del(store, sel); return store.ui({ selected: [] }); }
      if (mod && k === "v") { e.preventDefault(); return store.ui({ selected: E.paste(store, s.ui.slide) }); }
      if (mod && k === "d" && sel.length) { e.preventDefault(); E.copy(s.project, sel); return store.ui({ selected: E.paste(store, s.ui.slide) }); }
      if (mod && k === "g" && sel.length) { e.preventDefault(); return e.shiftKey ? E.ungroup(store, sel) : sel.length > 1 && E.group(store, sel); }
      if (mod && (e.key === "]" || e.key === "[") && sel.length) { e.preventDefault(); return E.arrange(store, sel, e.key === "]" ? (e.altKey ? "front" : "forward") : (e.altKey ? "back" : "backward")); }
      if (mod && k === "j") { e.preventDefault(); return store.ui({ panelOpen: true, panel: "chat" }); }
      if (k === "enter" && sel.length === 1) { e.preventDefault(); return window.__startEdit(sel[0]); }
      if (k === "f" && !mod) return store.ui((u) => ({ focus: !u.focus }));
      if (k === "escape") return store.ui((u) => (u.sheet ? { sheet: null } : { selected: [], preview: null, focus: false }));
      const ar = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (ar && sel.length) { e.preventDefault(); const st = e.shiftKey ? 10 : 1;
        store.commit("Nudged", (d) => sel.forEach((id) => { const el = d.elements.find((x) => x.id === id); if (!el.locked) { el.x += ar[0] * st; el.y += ar[1] * st; } })); }
      if ((k === "backspace" || k === "delete") && sel.length) { e.preventDefault(); E.del(store, sel); store.ui({ selected: [] }); }
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, []);
  const onReconstruct = (img) => setDialog({ kind: "reconstruct", image: img });
  return html`${!focus && html`<${TopBar} store=${store} integrity=${integrity} onExport=${() => setDialog({ kind: "export" })} />`}
    <div id="main" class=${focus ? "focus" : ""}>${!focus && html`<${LeftSidebar} store=${store} ctx=${ctx} />`}
      <div id="center"><${Canvas} store=${store} ctx=${ctx} onReconstruct=${onReconstruct} />${sheet && html`<${Sheet} store=${store} ctx=${ctx} />`}
        ${focus && html`<div class="floatbar"><span class="muted small">Focus mode</span><button class="btn sm" onClick=${() => store.ui({ focus: false })}>Exit (F)</button></div>`}</div>
      ${!focus && html`<${RightPanel} store=${store} ctx=${ctx} onReconstruct=${onReconstruct} />`}</div>
    ${dialog?.kind === "export" && html`<${ExportDialog} store=${store} integrity=${integrity} close=${() => setDialog(null)} />`}
    ${dialog?.kind === "reconstruct" && html`<${ReconstructDialog} store=${store} image=${dialog.image} close=${() => setDialog(null)} />`}
    <input type="file" id="filepick" accept="image/*" hidden onChange=${(e) => { onFile(store, e.target.files[0]); e.target.value = ""; }} />`;
}

(async () => {
  document.body.classList.add(`dir-${direction}`);
  let project;
  try { project = await api("GET", `/api/projects/${projectName}`); } catch (e) { document.body.textContent = `Could not load ${projectName}: ${e.message}`; return; }
  const store = createStore(project);
  store.ui({ left: { canva: "elements", figma: "layers" }[direction] || "slides", panel: { figma: "props", canva: "design" }[direction] || "chat",
             panelWidth: direction === "figma" ? 320 : 380, zoom: null, editing: null, sheet: null });
  window.__ws = { store, api, E };
  render(html`<${App} store=${store} />`, document.getElementById("app"));
  if (params.get("scenario")) import("./scenario.js").then((m) => m.run(params.get("scenario"), store));
})();
