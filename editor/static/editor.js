/* Slide editor spike.
 * Model: one project JSON (see editor/slidemodel.py). Slide elements render as
 * absolutely positioned DOM nodes in a 1280×720 stage; annotations render in a
 * separate overlay that is never part of the export.
 * Libraries (MIT, vendored): Moveable (drag/resize/snap), Selecto (marquee
 * selection), html-to-image (PNG export).
 */
(() => {
  "use strict";
  const W = 1280, H = 720;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const uid = (p) => `${p}-${Math.random().toString(16).slice(2, 10)}`;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const projectName = new URLSearchParams(location.search).get("project") || "china_re_overview";

  const viewport = $("#viewport"), scaler = $("#stageScaler"), stage = $("#stage"), annotLayer = $("#annotLayer");
  const S = { project: null, saved: null, history: [], future: [], selected: [], mode: "select",
              scale: 1, editing: null, activeReq: null, previews: {}, integrity: [] };

  // ------------------------------------------------------------------ API
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" },
                                   body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || (data.errors || []).join("; ") || res.statusText);
    return data;
  }
  function status(msg) { $("#status").textContent = msg; $("#status").classList.toggle("dirty", isDirty()); }
  const isDirty = () => S.saved !== null && JSON.stringify(S.project) !== S.saved;

  // ------------------------------------------------------------------ history
  function commit(mutator, label) {
    const before = JSON.stringify(S.project);
    mutator(S.project);
    if (JSON.stringify(S.project) === before) return;
    S.history.push(before); if (S.history.length > 200) S.history.shift();
    S.future = [];
    render(); status(label || "Edited");
  }
  function pushSnapshot(before, label) {  // for changes already applied to the DOM/model
    if (before === JSON.stringify(S.project)) return;
    S.history.push(before); S.future = []; render(); status(label);
  }
  function undo() { if (!S.history.length) return; S.future.push(JSON.stringify(S.project)); S.project = JSON.parse(S.history.pop()); prune(); render(); status("Undo"); }
  function redo() { if (!S.future.length) return; S.history.push(JSON.stringify(S.project)); S.project = JSON.parse(S.future.pop()); prune(); render(); status("Redo"); }
  function prune() { S.selected = S.selected.filter((id) => byId(id)); }

  // ------------------------------------------------------------------ model helpers
  const els = () => S.project.elements;
  const byId = (id) => els().find((e) => e.id === id);
  const ev = (id) => S.project.evidence[id];
  function fmtValue(v, f = {}) {
    if (typeof v !== "number") return "n/a";
    const d = f.decimals ?? 0;
    const n = (v / (f.scale || 1)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return `${f.prefix || ""}${n}${f.suffix ?? ""}`;
  }
  function fmtDelta(toId, fromId, kind) {
    const a = ev(fromId)?.value, b = ev(toId)?.value;
    if (typeof a !== "number" || typeof b !== "number") return { text: "n/a", sign: 0 };
    const d = kind === "pp" ? b - a : (b / a - 1) * 100;
    const txt = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(kind === "pp" ? 2 : 1)}${kind === "pp" ? "pp" : "%"}`;
    return { text: txt, sign: Math.sign(d) };
  }
  function evTitle(id) {
    const e = ev(id); if (!e) return `Unknown evidence ${id}`;
    return `${id}\n${e.subject || ""} · ${e.period || ""}\nValue: ${e.value ?? "—"} ${e.unit || ""}\n` +
           `PDF p.${e.page}: "${e.excerpt || ""}"\n${e.verification}${e.verified_by ? " — " + e.verified_by : ""}`;
  }
  function boundIds(el) {
    const ids = [];
    if (el.type === "metric") { ids.push(el.evidence_id); if (el.delta) ids.push(el.delta.from); }
    if (el.type === "table") el.rows.forEach((r) => r.cells.forEach((c) => {
      if (c.evidence_id) ids.push(c.evidence_id); if (c.delta) ids.push(c.delta.from, c.delta.to); }));
    if (el.type === "barchart") el.bars.forEach((b) => ids.push(b.evidence_id));
    return ids.filter(Boolean);
  }
  const refCount = (el) => new Set([...boundIds(el), ...(el.refs?.evidence || []), ...(el.refs?.claims || []), ...(el.refs?.gaps || [])]).size;

  // ------------------------------------------------------------------ rendering
  const field = (path, html, cls = "") => `<div class="${cls}" data-field="${path}">${html}</div>`;
  function renderEl(el) {
    const st = el.style || {};
    const box = `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
    const cite = refCount(el) ? `<span class="cite no-export" title="Linked records: ${refCount(el)}">${refCount(el)}</span>` : "";
    const lock = (id) => `<span class="lock no-export">🔒</span>`;
    let inner = "", cls = "", extra = "";
    switch (el.type) {
      case "text":
        cls = "el-text";
        extra = `font-size:${st.fontSize || 12}px;font-weight:${st.fontWeight || 400};color:${st.color || "#0f2742"};` +
                `text-align:${st.align || "left"};background:${st.fill || "transparent"};letter-spacing:${st.letterSpacing || "normal"};` +
                `line-height:${st.lineHeight || 1.35};${st.fill ? "padding:6px 8px;border-radius:4px;" : ""}`;
        inner = field("text", esc(el.text), "txt");
        break;
      case "panel":
        cls = "el-panel";
        extra = `background:${st.fill || "#eef2f7"};border:${st.borderWidth || 0}px solid ${st.borderColor || "transparent"};` +
                `border-radius:${el.shape === "ellipse" ? "50%" : (st.radius ?? 4) + "px"};`;
        break;
      case "metric": {
        cls = "el-metric";
        extra = `background:${st.fill || "#fff"};border-color:${st.borderColor || "#d5dbe3"};`;
        const d = el.delta ? fmtDelta(el.evidence_id, el.delta.from, el.delta.kind) : null;
        inner = field("label", esc(el.label), "lbl") +
          `<div class="val bound" title="${esc(evTitle(el.evidence_id))}">${esc(fmtValue(ev(el.evidence_id)?.value, el.fmt))}${lock()}</div>` +
          (d ? `<div class="dlt bound" style="color:${d.sign < 0 ? "#b91c1c" : "#15803d"}" title="Computed from ${esc(el.delta.from)} → ${esc(el.evidence_id)}">${d.sign < 0 ? "▼" : "▲"} ${d.text}</div>` : "") +
          field("note", esc(el.note || ""), "note");
        break;
      }
      case "table": {
        cls = "el-table";
        extra = `background:${st.fill || "#fff"};border-color:${st.borderColor || "#d5dbe3"};`;
        const head = el.columns.map((c, i) => `<th data-field="columns.${i}">${esc(c)}</th>`).join("");
        const body = el.rows.map((r, ri) => `<tr><td data-field="rows.${ri}.label">${esc(r.label)}</td>` + r.cells.map((c, ci) => {
          if (c.evidence_id) return `<td class="bound" title="${esc(evTitle(c.evidence_id))}">${esc(fmtValue(ev(c.evidence_id)?.value, c.fmt))}</td>`;
          if (c.delta) { const d = fmtDelta(c.delta.to, c.delta.from, c.delta.kind);
            return `<td class="bound" title="Computed: ${esc(c.delta.to)} − ${esc(c.delta.from)}">${d.text}</td>`; }
          return `<td data-field="rows.${ri}.cells.${ci}.text">${esc(c.text)}</td>`;
        }).join("") + `</tr>`).join("");
        inner = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + field("footnote", esc(el.footnote || ""), "fn");
        break;
      }
      case "barchart": {
        cls = "el-bar";
        extra = `background:${st.fill || "#fff"};border-color:${st.borderColor || "#d5dbe3"};`;
        const vals = el.bars.map((b) => ev(b.evidence_id)?.value ?? 0), max = Math.max(...vals, 1);
        inner = field("title", esc(el.title), "ttl") + `<div class="rows">` + el.bars.map((b, i) =>
          `<div class="br"><div data-field="bars.${i}.label">${esc(b.label)}</div>` +
          `<div class="track"><div class="fill" style="width:${(vals[i] / max) * 100}%;background:${st.bar || "#0f2742"}"></div></div>` +
          `<div class="v bound" title="${esc(evTitle(b.evidence_id))}">${esc(fmtValue(vals[i], el.fmt))}</div></div>`).join("") + `</div>`;
        break;
      }
      case "sources":
        cls = "el-sources";
        extra = `font-size:${st.fontSize || 8.5}px;color:${st.color || "#5b6b7f"};`;
        inner = `<span data-field="prefix">${esc(el.prefix || "Sources:")}</span> ${esc(sourceLine())}`;
        break;
      case "gap": {
        cls = "el-gap";
        const rr = S.project.research_requests.find((r) => r.gap_id === el.gap_id && r.status === "open");
        extra = `background:${st.fill || "#fff7e6"};border-color:${st.borderColor || "#e0a100"};color:${st.color || "#6b4e00"};`;
        inner = `<div class="gl">Data gap${rr ? " · research request open" : ""}</div>` + field("text", esc(el.text), "txt");
        break;
      }
    }
    return `<div class="el ${cls}" data-id="${esc(el.id)}" style="${box}${extra}">${inner}${cite}</div>`;
  }
  function sourceLine() {
    const pages = {};
    els().forEach((el) => [...boundIds(el), ...(el.refs?.evidence || [])].forEach((id) => {
      const e = ev(id); if (e) (pages[e.source_id] ||= new Set()).add(e.page); }));
    return Object.entries(pages).map(([sid, set]) => {
      const s = S.project.sources[sid] || {};
      const p = [...set].sort((a, b) => a - b), parts = [];
      for (let i = 0; i < p.length; i++) { let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++;
        parts.push(i === j ? `${p[i]}` : `${p[i]}–${p[j]}`); i = j; }
      const date = s.published_date ? new Date(s.published_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
      return `China Re, ${s.title} (HKEX, ${date}), PDF ${p.length > 1 ? "pp." : "p."} ${parts.join(", ")}`;
    }).join("; ") + ".";
  }
  function renderAnnotations() {
    annotLayer.innerHTML = S.project.annotations.map((a, i) => {
      const r = a.kind === "region" ? a.rect : bbox(a.element_ids.map(byId).filter(Boolean));
      if (!r) return "";
      return `<div class="ann ${a.kind} ${a.status === "applied" ? "applied" : ""} ${S.activeReq === a.id ? "active" : ""}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">` +
             `<div class="badge" data-req="${a.id}" title="${esc(a.instruction || "(no instruction yet)")}">${i + 1}</div></div>`;
    }).join("");
  }
  function render() {
    stage.innerHTML = els().map(renderEl).join("");
    renderAnnotations();
    syncMoveable();
    renderSide();
    scheduleIntegrity();
    $("#projTitle").textContent = S.project.title || projectName;
  }
  function fit() {
    const pad = parseFloat(getComputedStyle(viewport).paddingLeft) * 2;
    const avail = viewport.clientWidth - pad;
    S.scale = Math.min(1, avail / W);
    scaler.style.transform = `scale(${S.scale})`;
    scaler.style.marginBottom = `${-(H * (1 - S.scale))}px`;
    scaler.style.marginRight = `${-(W * (1 - S.scale))}px`;
    moveable && moveable.updateRect();
  }

  // ------------------------------------------------------------------ selection + transform
  let moveable, selecto;
  const nodeOf = (id) => stage.querySelector(`.el[data-id="${CSS.escape(id)}"]`);
  function expandGroups(ids) {
    const groups = new Set(ids.map((id) => byId(id)?.group).filter(Boolean));
    return [...new Set([...ids, ...els().filter((e) => e.group && groups.has(e.group)).map((e) => e.id)])];
  }
  function select(ids) { S.selected = expandGroups(ids.filter((id) => byId(id))); syncMoveable(); renderSide(); }
  function syncMoveable() {
    if (!moveable) return;
    const targets = S.editing ? [] : S.selected.map(nodeOf).filter(Boolean);
    moveable.target = targets;
    moveable.elementGuidelines = $$(".el", stage).filter((n) => !targets.includes(n));
    moveable.updateRect();
  }
  function readGeom(node) {
    const el = byId(node.dataset.id);
    el.x = Math.round(parseFloat(node.style.left)); el.y = Math.round(parseFloat(node.style.top));
    el.w = Math.round(parseFloat(node.style.width)); el.h = Math.round(parseFloat(node.style.height));
  }
  function initTransform() {
    let before = null;
    moveable = new Moveable(viewport, {
      target: [], draggable: true, resizable: true, snappable: true, snapContainer: stage,
      snapThreshold: 5, isDisplaySnapDigit: true, snapGap: true,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      bounds: { left: 0, top: 0, right: 0, bottom: 0, position: "css" }, origin: false, keepRatio: false,
    });
    const start = () => { before = JSON.stringify(S.project); };
    const end = (label) => (e) => {
      const nodes = e.targets || (e.target ? [e.target] : []);
      if (!(e.isDrag || e.lastEvent)) return;
      nodes.forEach(readGeom); pushSnapshot(before, label);
    };
    moveable
      .on("dragStart", start).on("dragGroupStart", start).on("resizeStart", start).on("resizeGroupStart", start)
      .on("drag", (e) => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; })
      .on("dragGroup", (e) => e.events.forEach((ev) => { ev.target.style.left = `${ev.left}px`; ev.target.style.top = `${ev.top}px`; }))
      .on("resize", (e) => { Object.assign(e.target.style, { width: `${e.width}px`, height: `${e.height}px`, left: `${e.drag.left}px`, top: `${e.drag.top}px` }); })
      .on("resizeGroup", (e) => e.events.forEach((ev) => Object.assign(ev.target.style, { width: `${ev.width}px`, height: `${ev.height}px`, left: `${ev.drag.left}px`, top: `${ev.drag.top}px` })))
      .on("dragEnd", end("Moved")).on("dragGroupEnd", end("Moved group"))
      .on("resizeEnd", end("Resized")).on("resizeGroupEnd", end("Resized group"));

    selecto = new Selecto({
      container: viewport, dragContainer: viewport, selectableTargets: ["#stage .el"],
      hitRate: 0, selectByClick: true, selectFromInside: false, ratio: 0,
    });
    selecto.on("dragStart", (e) => {
      const t = e.inputEvent.target;
      if (S.mode !== "select" || S.editing || t.closest("#side, .badge")) return e.stop();
      if (moveable.isMoveableElement(t) || S.selected.some((id) => nodeOf(id)?.contains(t))) e.stop();
    }).on("selectEnd", (e) => {
      let ids = e.selected.map((n) => n.dataset.id);
      if (e.inputEvent?.shiftKey) {  // additive: shift-click toggles, shift-drag adds
        const set = new Set(S.selected);
        ids.forEach((id) => (e.isClick && set.has(id) ? set.delete(id) : set.add(id)));
        ids = [...set];
      }
      select(ids);
      if (e.isDragStart && S.selected.length) {
        e.inputEvent.preventDefault();
        moveable.waitToChangeTarget().then(() => moveable.dragStart(e.inputEvent));
      }
    });
  }

  // ------------------------------------------------------------------ inline text editing
  function setPath(obj, path, value) {
    const keys = path.split("."); let o = obj;
    keys.slice(0, -1).forEach((k) => { o = o[k]; }); o[keys.at(-1)] = value;
  }
  stage.addEventListener("dblclick", (e) => {
    const f = e.target.closest("[data-field]"), node = e.target.closest(".el");
    if (!f || !node || S.mode !== "select") return;
    S.editing = { id: node.dataset.id, path: f.dataset.field, node: f };
    syncMoveable();
    f.contentEditable = "true"; f.focus();
    const range = document.createRange(); range.selectNodeContents(f);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    f.addEventListener("blur", () => {
      const { id, path } = S.editing; S.editing = null; f.contentEditable = "false";
      const value = f.innerText.replace(/\n$/, "");
      commit((p) => setPath(p.elements.find((x) => x.id === id), path, value), "Edited text");
      syncMoveable();
    }, { once: true });
    f.addEventListener("keydown", (k) => { if (k.key === "Escape") f.blur(); });
  });

  // ------------------------------------------------------------------ region requests
  function slidePoint(ev) {
    const r = stage.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / S.scale, y: (ev.clientY - r.top) / S.scale };
  }
  viewport.addEventListener("pointerdown", (e) => {
    if (S.mode !== "region" || e.button !== 0 || e.target.closest(".badge")) return;
    e.preventDefault();
    const p0 = slidePoint(e), box = document.createElement("div");
    box.className = "ann drawing"; annotLayer.appendChild(box);
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    const rectOf = (p) => { const x0 = clamp(Math.min(p0.x, p.x), W), y0 = clamp(Math.min(p0.y, p.y), H);
      return { x: Math.round(x0), y: Math.round(y0), w: Math.round(clamp(Math.max(p0.x, p.x), W) - x0), h: Math.round(clamp(Math.max(p0.y, p.y), H) - y0) }; };
    const move = (m) => { const r = rectOf(slidePoint(m)); Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };
    const up = (u) => {
      viewport.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      box.remove(); const r = rectOf(slidePoint(u));
      if (r.w < 12 || r.h < 12) return;
      addRequest({ kind: "region", rect: r });
    };
    viewport.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
  function addRequest(spec) {
    const id = uid("req");
    commit((p) => p.annotations.push({ id, instruction: "", status: "open", created: new Date().toISOString(), ...spec }), "Added change request");
    S.activeReq = id; setMode("select"); showTab("requests");
    setTimeout(() => $(`textarea[data-req="${id}"]`)?.focus(), 30);
  }
  function scopeIds(a) {
    if (a.kind === "element") return a.element_ids.filter(byId);
    const r = a.rect;
    return els().filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y).map((e) => e.id);
  }
  annotLayer.addEventListener("click", (e) => {
    const b = e.target.closest(".badge"); if (!b) return;
    S.activeReq = b.dataset.req; showTab("requests"); renderAnnotations();
  });

  // ------------------------------------------------------------------ actions
  function bbox(list) {
    if (!list.length) return null;
    const x0 = Math.min(...list.map((e) => e.x)), y0 = Math.min(...list.map((e) => e.y));
    return { x: x0, y: y0, w: Math.max(...list.map((e) => e.x + e.w)) - x0, h: Math.max(...list.map((e) => e.y + e.h)) - y0 };
  }
  function insert(el) { commit((p) => p.elements.push(el), `Inserted ${el.type}`); select([el.id]); }
  function align(kind) {
    const sel = S.selected.map(byId); if (!sel.length) return;
    const b = sel.length > 1 ? bbox(sel) : { x: 0, y: 0, w: W, h: H };
    commit(() => sel.forEach((e) => {
      if (kind === "left") e.x = b.x; if (kind === "right") e.x = b.x + b.w - e.w;
      if (kind === "center") e.x = Math.round(b.x + (b.w - e.w) / 2);
      if (kind === "top") e.y = b.y; if (kind === "bottom") e.y = b.y + b.h - e.h;
      if (kind === "middle") e.y = Math.round(b.y + (b.h - e.h) / 2);
    }), `Aligned ${kind}`);
  }
  function distribute(axis) {
    const sel = S.selected.map(byId); if (sel.length < 3) return status("Select three or more elements to distribute");
    const [pos, size] = axis === "h" ? ["x", "w"] : ["y", "h"];
    sel.sort((a, b) => a[pos] - b[pos]);
    const total = sel.reduce((s, e) => s + e[size], 0), first = sel[0], last = sel.at(-1);
    const gap = (last[pos] + last[size] - first[pos] - total) / (sel.length - 1);
    commit(() => { let cur = first[pos]; sel.forEach((e) => { e[pos] = Math.round(cur); cur += e[size] + gap; }); }, "Distributed");
  }
  const actions = {
    "mode-select": () => setMode("select"), "mode-region": () => setMode("region"),
    "add-text": () => insert({ id: uid("t"), type: "text", x: 540, y: 320, w: 220, h: 48, text: "New text", style: { fontSize: 13, color: "#0f2742" }, refs: {} }),
    "add-panel": () => insert({ id: uid("p"), type: "panel", shape: "rect", x: 500, y: 280, w: 280, h: 160, style: { fill: "#eef2f7", radius: 4 }, refs: {} }),
    "add-ellipse": () => insert({ id: uid("e"), type: "panel", shape: "ellipse", x: 580, y: 300, w: 120, h: 120, style: { fill: "#dbe4f0" }, refs: {} }),
    "add-metric": openMetricDialog,
    duplicate: () => {
      if (!S.selected.length) return; const map = {}; const group = uid("g");
      const copies = S.selected.map(byId).map((e) => { const c = clone(e); c.id = map[e.id] = uid(e.type.slice(0, 2)); c.x += 16; c.y += 16;
        if (e.group) c.group = group; return c; });
      commit((p) => p.elements.push(...copies), "Duplicated"); select(Object.values(map));
    },
    delete: () => { if (!S.selected.length) return; const ids = new Set(S.selected);
      commit((p) => { p.elements = p.elements.filter((e) => !ids.has(e.id)); }, "Deleted"); select([]); },
    group: () => { if (S.selected.length < 2) return; const g = uid("g"); commit(() => S.selected.forEach((id) => { byId(id).group = g; }), "Grouped"); },
    ungroup: () => commit(() => S.selected.forEach((id) => { delete byId(id).group; }), "Ungrouped"),
    front: () => commit((p) => { const s = p.elements.filter((e) => S.selected.includes(e.id)); p.elements = p.elements.filter((e) => !S.selected.includes(e.id)).concat(s); }, "Brought to front"),
    back: () => commit((p) => { const s = p.elements.filter((e) => S.selected.includes(e.id)); p.elements = s.concat(p.elements.filter((e) => !S.selected.includes(e.id))); }, "Sent to back"),
    "align-left": () => align("left"), "align-center": () => align("center"), "align-right": () => align("right"),
    "align-top": () => align("top"), "align-middle": () => align("middle"), "align-bottom": () => align("bottom"),
    "dist-h": () => distribute("h"), "dist-v": () => distribute("v"),
    undo, redo, revert, save, export: exportPng,
  };
  function revert() {
    const saved = JSON.parse(S.saved);
    if (!S.selected.length) {
      if (!isDirty() || !confirm("Revert the whole slide to the last saved version?")) return;
      return commit((p) => Object.assign(p, saved), "Reverted to saved");
    }
    const ids = new Set(S.selected);
    commit((p) => {
      p.elements = p.elements.flatMap((e) => {
        if (!ids.has(e.id)) return [e];
        const old = saved.elements.find((s) => s.id === e.id);
        return old ? [old] : [];  // elements created since the save are removed
      });
    }, `Reverted ${ids.size} element(s) to saved`);
    prune(); syncMoveable();
  }
  function setMode(m) {
    S.mode = m; viewport.classList.toggle("region-mode", m === "region");
    $$("button.mode").forEach((b) => b.classList.toggle("on", b.dataset.act === `mode-${m}`));
    if (m === "region") select([]);
    status(m === "region" ? "Region request: drag a rectangle over the slide" : "Select mode");
  }
  async function save() {
    try { const r = await api("PUT", `/api/projects/${projectName}`, S.project);
      S.saved = JSON.stringify(S.project); S.integrity = r.integrity; renderIntegrity();
      status(`Saved to editor/${r.saved} (previous version kept in projects/.history)`);
    } catch (err) { status(`Save failed: ${err.message}`); }
  }
  async function exportPng() {
    const errs = S.integrity.filter((i) => i.level === "error");
    if (errs.length && !confirm(`${errs.length} data-integrity error(s). Export anyway?`)) return;
    const prevSel = S.selected; select([]);
    stage.classList.add("exporting");
    try {
      const url = await htmlToImage.toPng(stage, { pixelRatio: 2, width: W, height: H, cacheBust: true,
        filter: (n) => !(n.classList && n.classList.contains("no-export")) });
      const label = prompt("Export label (a-z, 0-9, -)", "slide") || "slide";
      const r = await api("POST", `/api/projects/${projectName}/export`, { png: url, label: label.toLowerCase().replace(/[^a-z0-9_-]/g, "-") });
      const a = document.createElement("a"); a.href = url; a.download = r.saved.split("/").pop(); a.click();
      status(`Exported 2560×1440 PNG → editor/${r.saved}`);
    } catch (err) { status(`Export failed: ${err.message}`); }
    finally { stage.classList.remove("exporting"); select(prevSel); }
  }
  function openMetricDialog() {
    const dlg = $("#metricDlg"), sel = $("#metricEv");
    sel.innerHTML = Object.entries(S.project.evidence).filter(([, e]) => e.kind === "metric_value" && e.verification === "verified")
      .map(([id, e]) => `<option value="${esc(id)}">${esc(e.subject)} · ${esc(e.metric_id)} · ${esc(e.period)} = ${esc(fmtValue(e.value, { decimals: 2 }))} ${esc(e.unit)}</option>`).join("");
    $("#metricLabel").value = "";
    dlg.returnValue = ""; dlg.showModal();
    dlg.addEventListener("close", () => {
      if (dlg.returnValue === "ok") {
        const id = sel.value, e = ev(id), thousand = /thousand/.test(e.unit), million = /million/.test(e.unit);
        const fmt = thousand ? { scale: 1e6, decimals: 1, prefix: "RMB ", suffix: "bn" } : million ? { scale: 1e3, decimals: 1, prefix: "RMB ", suffix: "bn" } : { decimals: 2, suffix: e.unit === "percent" ? "%" : "" };
        insert({ id: uid("m"), type: "metric", x: 540, y: 300, w: 195, h: 88, label: $("#metricLabel").value || e.metric_id, evidence_id: id, fmt, note: e.period, refs: {}, style: { fill: "#fff", borderColor: "#d5dbe3" } });
      } else if (dlg.returnValue === "research") {
        const d = prompt("Describe the missing metric (period, entity, definition):");
        if (d) commit((p) => p.research_requests.push({ id: uid("rr"), description: d, status: "open", source: "user", created: new Date().toISOString() }), "Research request added");
        showTab("requests");
      }
    }, { once: true });
  }

  // ------------------------------------------------------------------ side panel
  function showTab(t) { $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); $$(".pane").forEach((p) => p.classList.toggle("on", p.id === `pane-${t}`)); }
  function renderSide() { renderProps(); renderRequests(); }
  function refsHtml(el) {
    const parts = [];
    [...new Set([...boundIds(el), ...(el.refs?.evidence || [])])].forEach((id) => { const e = ev(id);
      parts.push(`<div class="ref"><code>${esc(id)}</code> <span class="tag ${e?.verification}">${esc(e?.verification || "missing")}</span><br>` +
        (e ? `${esc(e.subject || "")} · ${esc(e.period || "")}${e.value !== undefined ? ` · <b>${esc(e.value)}</b> ${esc(e.unit)}` : ""}<br>` +
        `<span class="ex">PDF p.${esc(e.page)}: “${esc(e.excerpt)}”</span>` : "") + `</div>`); });
    (el.refs?.claims || []).forEach((id) => { const c = S.project.claims[id];
      parts.push(`<div class="ref"><code>${esc(id)}</code> <span class="tag">${esc(c?.nature)}</span> <span class="tag ${c?.support === "supported" ? "verified" : "warning"}">${esc(c?.support)}</span><br>${esc(c?.statement)}</div>`); });
    (el.refs?.gaps || []).forEach((id) => { const g = S.project.gaps[id];
      parts.push(`<div class="ref"><code>${esc(id)}</code> <span class="tag open">${esc(g?.reason)}</span><br>${esc(g?.description)}</div>`); });
    if (el.detached_from) parts.push(`<div class="ref"><span class="tag warning">detached</span> was bound to <code>${esc(el.detached_from)}</code></div>`);
    return parts.join("") || `<p class="hint">No linked evidence, claims or gaps. Numbers typed here are flagged as unsourced.</p>`;
  }
  function renderProps() {
    const pane = $("#pane-props");
    if (!S.selected.length) {
      pane.innerHTML = `<p class="hint">Click an element to select it; shift-click or drag a marquee for several. Double-click text to edit it.
        Use <b>Region request</b> to draw a box and describe a change.</p>
        <h4>Slide</h4><p>${els().length} elements · ${S.project.annotations.length} change requests · ${S.project.research_requests.filter((r) => r.status === "open").length} open research requests</p>
        <p class="hint">Bound figures (🔒) are rendered from the evidence snapshot and cannot be typed over. Hover a figure to see its source page and excerpt.</p>`;
      return;
    }
    if (S.selected.length > 1) {
      pane.innerHTML = `<p><b>${S.selected.length} elements selected</b></p><p class="hint">Use the align/distribute buttons, Group, or drag together.</p>
        <button data-side="ask">Ask AI about this selection…</button>`;
      return;
    }
    const el = byId(S.selected[0]), st = el.style || {};
    const num = (k, v) => `<label><span>${k}</span><input type="number" data-geo="${k}" value="${v}"></label>`;
    const sty = (k, label, type = "text", opts) => opts
      ? `<label><span>${label}</span><select data-style="${k}">${opts.map((o) => `<option ${String(st[k]) === String(o) ? "selected" : ""}>${o}</option>`).join("")}</select></label>`
      : `<label><span>${label}</span><input type="${type}" data-style="${k}" value="${esc(st[k] ?? "")}"></label>`;
    let styleHtml = "";
    if (el.type === "text") styleHtml = sty("fontSize", "Font size", "number") + sty("fontWeight", "Weight", "", [400, 600, 700]) +
      sty("color", "Colour", "color") + sty("fill", "Background") + sty("align", "Align", "", ["left", "center", "right"]);
    if (el.type === "panel") styleHtml = sty("fill", "Fill", "color") + sty("borderColor", "Border", "color") + sty("borderWidth", "Border px", "number") + sty("radius", "Radius", "number");
    if (["metric", "table", "barchart", "gap"].includes(el.type)) styleHtml = sty("fill", "Fill", "color") + sty("borderColor", "Border", "color");
    if (el.type === "barchart") styleHtml += sty("bar", "Bar colour", "color");
    if (el.type === "sources") styleHtml = sty("fontSize", "Font size", "number") + sty("color", "Colour", "color");
    pane.innerHTML = `<p><b>${esc(el.type)}</b> <code>${esc(el.id)}</code>${el.group ? ` <span class="tag">group ${esc(el.group)}</span>` : ""}${el.created_by ? ` <span class="tag info">${esc(el.created_by)}</span>` : ""}</p>
      <h4>Position & size</h4><div class="geo">${num("x", el.x)}${num("y", el.y)}${num("w", el.w)}${num("h", el.h)}</div>
      <h4>Style</h4>${styleHtml || '<p class="hint">—</p>'}
      ${el.type === "metric" ? `<label><span>Decimals</span><input type="number" min="0" max="4" data-fmt="decimals" value="${el.fmt?.decimals ?? 0}"></label>
        <button data-side="detach" title="Replace the bound figure with plain text (flagged in Data integrity)">Detach value from evidence…</button>` : ""}
      <h4>Linked research records</h4>${refsHtml(el)}
      <h4>AI</h4><button data-side="ask">Ask AI about this element…</button>`;
  }
  $("#side").addEventListener("change", (e) => {
    const t = e.target, el = byId(S.selected[0]);
    if (t.dataset.geo && el) commit(() => { el[t.dataset.geo] = Math.max(t.dataset.geo === "w" || t.dataset.geo === "h" ? 4 : -2000, Math.round(+t.value)); }, "Changed geometry");
    if (t.dataset.style && el) commit(() => { el.style ||= {}; el.style[t.dataset.style] = t.type === "number" ? +t.value : t.value; }, "Changed style");
    if (t.dataset.fmt && el) commit(() => { el.fmt = { ...el.fmt, decimals: Math.max(0, Math.min(4, +t.value)) }; }, "Changed display format");
    if (t.dataset.req) commit((p) => { p.annotations.find((a) => a.id === t.dataset.req).instruction = t.value; }, "Updated instruction");
  });
  $("#side").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const act = b.dataset.side, rid = b.dataset.req;
    if (act === "ask") addRequest({ kind: "element", element_ids: [...S.selected] });
    if (act === "detach") {
      const el = byId(S.selected[0]);
      if (!confirm("Detach this figure from its evidence? It becomes plain text and is flagged in Data integrity.")) return;
      const shown = fmtValue(ev(el.evidence_id)?.value, el.fmt);
      commit((p) => { const i = p.elements.findIndex((x) => x.id === el.id);
        p.elements[i] = { id: el.id, type: "text", x: el.x, y: el.y, w: el.w, h: el.h, text: `${el.label}\n${shown}`,
          style: { fontSize: 14, fontWeight: 700, color: "#0f2742", fill: "#ffffff" }, refs: {}, detached_from: el.evidence_id }; }, "Detached value (flagged)");
    }
    if (act === "req-del") commit((p) => { p.annotations = p.annotations.filter((a) => a.id !== rid); }, "Deleted change request");
    if (act === "req-focus") { S.activeReq = rid; renderAnnotations(); select(scopeIds(S.project.annotations.find((a) => a.id === rid))); showTab("requests"); }
    if (act === "req-export") {
      try { const r = await api("POST", `/api/projects/${projectName}/requests/${rid}`, S.project);
        S.previews[rid] = { exported: r }; status(`Change request written to editor/${r.request}`);
        commit((p) => { p.annotations.find((a) => a.id === rid).status = "exported"; }, "Exported change request");
      } catch (err) { status(`Export failed: ${err.message}`); }
    }
    if (act === "req-load" || act === "req-paste") {
      try {
        const patch = act === "req-load" ? await api("GET", `/api/projects/${projectName}/requests/${rid}/patch`)
                                         : JSON.parse($(`textarea[data-patch="${rid}"]`).value);
        const r = await api("POST", "/api/patch/validate", { project: S.project, request_id: rid, patch });
        S.previews[rid] = { ...S.previews[rid], patch, result: r };
        status(r.ok ? "Patch is valid. Review it, then Apply." : `Patch rejected (${r.errors.length} problem(s))`);
      } catch (err) { S.previews[rid] = { ...S.previews[rid], result: { ok: false, errors: [err.message] } }; status(err.message); }
      renderRequests();
    }
    if (act === "req-apply") {
      const pv = S.previews[rid]; if (!pv?.result?.ok) return;
      const keepAnn = S.project.annotations;  // keep instruction edits made after validation
      commit((p) => { Object.assign(p, pv.result.project);
        p.annotations = keepAnn.map((a) => a.id === rid ? pv.result.project.annotations.find((x) => x.id === rid) : a); }, "Applied validated patch (undo with ⌘Z)");
      delete S.previews[rid];
    }
    if (act === "rr-close") commit((p) => { p.research_requests.find((r) => r.id === b.dataset.rr).status = "closed"; }, "Closed research request");
  });
  function renderRequests() {
    const anns = S.project.annotations, rrs = S.project.research_requests;
    $("#reqCount").textContent = anns.filter((a) => a.status !== "applied").length || "";
    $("#pane-requests").innerHTML = (anns.length ? anns.map((a, i) => {
      const scope = scopeIds(a), pv = S.previews[a.id] || {};
      const where = a.kind === "region" ? `Region x${a.rect.x} y${a.rect.y} ${a.rect.w}×${a.rect.h}` : `Element${scope.length > 1 ? "s" : ""}`;
      const res = pv.result ? (pv.result.ok
        ? `<p><span class="tag verified">valid</span> ${esc(pv.patch.summary || "")} · ${pv.patch.ops.length} op(s)${(pv.patch.research_requests || []).length ? `, ${pv.patch.research_requests.length} research request(s)` : ""}; integrity after: ${pv.result.integrity.filter((x) => x.level !== "info").length} issue(s)</p><button data-side="req-apply" data-req="${a.id}" class="primary">Apply patch</button>`
        : `<p><span class="tag error">rejected</span></p><pre>${esc(pv.result.errors.join("\n"))}</pre>`) : "";
      return `<div class="req ${a.status === "applied" ? "applied" : ""}">
        <b>#${i + 1}</b> ${where} <span class="tag ${a.status === "applied" ? "applied" : "open"}">${esc(a.status)}</span>
        <div class="hint">Scope: ${scope.map((s) => `<code>${esc(s)}</code>`).join(" ") || "none (empty area)"}</div>
        <textarea data-req="${a.id}" placeholder="Describe the change, e.g. “turn this into a 2×2 grid of cards”">${esc(a.instruction)}</textarea>
        ${a.patch_summary ? `<p class="hint">Applied: ${esc(a.patch_summary)}</p>` : ""}
        <div class="row"><button data-side="req-focus" data-req="${a.id}">Show scope</button>
          <button data-side="req-export" data-req="${a.id}" ${a.instruction ? "" : "disabled"}>Export for agent</button>
          <button data-side="req-load" data-req="${a.id}">Load agent patch</button>
          <button data-side="req-del" data-req="${a.id}">Delete</button></div>
        ${pv.exported ? `<p class="hint">Request: editor/${esc(pv.exported.request)}<br>Agent writes: editor/${esc(pv.exported.patch_expected_at)}<br>Suggested (not run automatically):</p><pre>${esc(pv.exported.suggested_command)} &gt; editor/${esc(pv.exported.patch_expected_at)}</pre>` : ""}
        <details><summary class="hint">Paste patch JSON</summary><textarea data-patch="${a.id}" placeholder='{"request_id": "${a.id}", "ops": [...]}'></textarea><button data-side="req-paste" data-req="${a.id}">Validate pasted patch</button></details>
        ${res}</div>`;
    }).join("") : `<p class="hint">No change requests yet. Choose <b>Region request</b> and drag over the slide, or select an element and use “Ask AI…”.</p>`) +
      `<h4>Research requests (${rrs.filter((r) => r.status === "open").length} open)</h4>` +
      (rrs.map((r) => `<div class="ref"><span class="tag ${r.status === "open" ? "open" : ""}">${esc(r.status)}</span> ${esc(r.description)}<br><span class="hint">${esc(r.source || "")}${r.gap_id ? " · " + esc(r.gap_id) : ""}</span>${r.status === "open" ? ` <button data-side="rr-close" data-rr="${r.id}">Close</button>` : ""}</div>`).join("") || `<p class="hint">None.</p>`);
  }
  let intTimer;
  function scheduleIntegrity() { clearTimeout(intTimer); intTimer = setTimeout(async () => {
    try { const r = await api("POST", "/api/integrity", S.project); S.integrity = r.integrity; renderIntegrity(); } catch (err) { /* server down */ } }, 250); }
  function renderIntegrity() {
    const issues = S.integrity, n = issues.filter((i) => i.level !== "info").length;
    $("#intCount").textContent = n ? `(${n})` : "✓";
    $("#pane-integrity").innerHTML = `<p class="hint">Checked by the local server (editor/slidemodel.py) after every change.</p>` +
      (issues.length ? issues.map((i) => `<div class="issue" data-el="${esc(i.element_id || "")}"><span class="tag ${i.level}">${i.level}</span> <code>${esc(i.code)}</code> ${i.element_id ? `<code>${esc(i.element_id)}</code>` : ""}<br>${esc(i.message)}</div>`).join("")
        : `<p><span class="tag verified">clean</span> All figures are bound to verified evidence, citations intact, no unsourced numbers.</p>`);
  }
  $("#pane-integrity").addEventListener("click", (e) => { const d = e.target.closest(".issue"); if (d?.dataset.el) select([d.dataset.el]); });
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

  // ------------------------------------------------------------------ keyboard + toolbar
  $("#toolbar").addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) actions[b.dataset.act]?.(); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable=true]");
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return save(); }
    if (typing) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); return actions.duplicate(); }
    if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); return e.shiftKey ? actions.ungroup() : actions.group(); }
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); return actions.delete(); }
    if (e.key === "Escape") return select([]);
    if (e.key === "v") return setMode("select");
    if (e.key === "r") return setMode("region");
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && S.selected.length) { e.preventDefault(); const k = e.shiftKey ? 10 : 1;
      commit(() => S.selected.forEach((id) => { const el = byId(id); el.x += arrows[e.key][0] * k; el.y += arrows[e.key][1] * k; }), "Nudged"); }
  });
  window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("resize", fit);

  // ------------------------------------------------------------------ boot
  (async function boot() {
    try { S.project = await api("GET", `/api/projects/${projectName}`); }
    catch (err) { status(`Could not load project ${projectName}: ${err.message}`); return; }
    S.saved = JSON.stringify(S.project);
    initTransform(); fit(); render(); status(`Loaded editor/projects/${projectName}.json`);
    window.__editor = { S, select, actions, undo, redo, save, render, fmtValue };  // for debugging/tests
  })();
})();
