/* Financial slide preview & AI layout editor.
 *
 * Model: one project JSON (editor/slidemodel.py, editor/research.py,
 * editor/transfer.py) holding a few slides. The active slide's elements render
 * as absolutely positioned DOM nodes in a 1280×720 stage; change requests
 * render in an overlay that is never exported. Dragging modules onto another
 * slide's thumbnail (or "New slide") opens the transfer menu: a literal move or
 * copy, or an adaptive mode that stores a Transfer Request for a later AI step.
 * Libraries (MIT, vendored): Moveable (drag/resize/snap), Selecto (marquee),
 * html-to-image (PNG export). Interaction patterns (selection-anchored
 * toolbar, insert rail, inspector) follow Presenton's editor; no code reused.
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
  const ctxbar = $("#ctxbar"), popover = $("#popover"), strip = $("#strip");
  const S = { project: null, saved: null, history: [], future: [], selected: [], mode: "select", scale: 1, slide: null,
              editing: null, activeReq: null, previews: {}, research: {}, transfers: {}, integrity: [], evidence: {}, sources: {},
              draft: null, dropTarget: null };

  // ------------------------------------------------------------------ API + feedback
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || (data.errors || []).join("; ") || res.statusText);
    return data;
  }
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }
  const isDirty = () => S.saved !== null && JSON.stringify(S.project) !== S.saved;
  function status(msg) {
    const c = $("#saveState"); const d = isDirty();
    c.textContent = d ? "Unsaved changes" : "Saved"; c.className = `chip ${d ? "dirty" : "ok"}`;
    if (msg) toast(msg);
  }
  function hint(msg) { const h = $("#hintbar"); h.textContent = msg || ""; h.classList.toggle("on", !!msg); }

  // ------------------------------------------------------------------ history
  function commit(mutator, label) {
    const before = JSON.stringify(S.project);
    mutator(S.project);
    if (JSON.stringify(S.project) === before) return false;
    S.history.push(before); if (S.history.length > 200) S.history.shift();
    S.future = []; render(); status(label); return true;
  }
  function replaceProject(next, label) { commit((p) => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, next); }, label); }
  function pushSnapshot(before, label) { if (before === JSON.stringify(S.project)) return; S.history.push(before); S.future = []; render(); status(label); }
  function undo() { if (!S.history.length) return; S.future.push(JSON.stringify(S.project)); S.project = JSON.parse(S.history.pop()); prune(); render(); status("Undo"); }
  function redo() { if (!S.future.length) return; S.history.push(JSON.stringify(S.project)); S.project = JSON.parse(S.future.pop()); prune(); render(); status("Redo"); }
  function prune() { S.selected = S.selected.filter((id) => byId(id)); }

  // ------------------------------------------------------------------ model helpers
  const els = () => S.project.elements;
  const byId = (id) => els().find((e) => e.id === id);
  const slides = () => S.project.slides;
  const slideOf = (x) => x.slide_id || slides()[0].id;
  const slideEls = (sid = S.slide) => els().filter((e) => slideOf(e) === sid);
  const slideIndex = (sid) => slides().findIndex((s) => s.id === sid);
  const slideName = (sid) => { const i = slideIndex(sid); return i < 0 ? `deleted slide ${sid}` : `Slide ${i + 1} · ${slides()[i].title}`; };
  const ev = (id) => S.evidence[id];
  function refreshEvidence() {  // bundle snapshot + accepted (non-reverted) research responses, as in slidemodel.evidence_map
    S.evidence = { ...S.project.evidence }; S.sources = { ...S.project.sources };
    (S.project.research_results || []).filter((r) => !r.reverted).forEach((r) => {
      (r.response.evidence || []).forEach((e) => { if (!S.evidence[e.id]) S.evidence[e.id] = e; });
      (r.response.sources || []).forEach((s) => { if (!S.sources[s.id]) S.sources[s.id] = s; });
    });
  }
  const isFixture = (id) => S.sources[ev(id)?.source_id]?.origin === "fixture";
  function fmtValue(v, f = {}) {
    if (typeof v !== "number") return "n/a";
    const d = f.decimals ?? 0;
    return `${f.prefix || ""}${(v / (f.scale || 1)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${f.suffix ?? ""}`;
  }
  function fmtDelta(toId, fromId, kind) {
    const a = ev(fromId)?.value, b = ev(toId)?.value;
    if (typeof a !== "number" || typeof b !== "number") return { text: "n/a", sign: 0 };
    const d = kind === "pp" ? b - a : (b / a - 1) * 100;
    return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(kind === "pp" ? 2 : 1)}${kind === "pp" ? "pp" : "%"}`, sign: Math.sign(d) };
  }
  function autoFmt(e) {
    if (/thousand/.test(e.unit)) return { scale: 1e6, decimals: 1, prefix: "RMB ", suffix: "bn" };
    if (/million/.test(e.unit)) return { scale: 1e3, decimals: 1, prefix: "RMB ", suffix: "bn" };
    return { decimals: e.unit === "percent" ? 2 : 1, suffix: e.unit === "percent" ? "%" : "" };
  }
  function evTitle(id) {
    const e = ev(id); if (!e) return `Unknown evidence ${id}`;
    return `${id}${isFixture(id) ? "  [TEST FIXTURE]" : ""}\n${e.subject || ""} · ${e.period || ""}\nValue: ${e.value ?? "—"} ${e.unit || ""}\n` +
           `PDF p.${e.page}: "${e.excerpt || ""}"\n${e.verification}${e.verified_by ? " — " + e.verified_by : ""}`;
  }
  function boundIds(el) {
    const ids = [];
    if (el.type === "metric") { ids.push(el.evidence_id); if (el.delta) ids.push(el.delta.from); }
    if (el.type === "table") el.rows.forEach((r) => r.cells.forEach((c) => { if (c.evidence_id) ids.push(c.evidence_id); if (c.delta) ids.push(c.delta.from, c.delta.to); }));
    if (el.type === "barchart") el.bars.forEach((b) => ids.push(b.evidence_id));
    return ids.filter(Boolean);
  }
  const allRefs = (el) => [...new Set([...boundIds(el), ...(el.refs?.evidence || [])])];
  const refCount = (el) => new Set([...allRefs(el), ...(el.refs?.claims || []), ...(el.refs?.gaps || [])]).size;
  function bbox(list) {
    if (!list.length) return null;
    const x0 = Math.min(...list.map((e) => e.x)), y0 = Math.min(...list.map((e) => e.y));
    return { x: x0, y: y0, w: Math.max(...list.map((e) => e.x + e.w)) - x0, h: Math.max(...list.map((e) => e.y + e.h)) - y0 };
  }
  const rr = (id) => S.project.research_requests.find((r) => r.id === id);
  const tr = (id) => S.project.transfer_requests.find((t) => t.id === id);

  // ------------------------------------------------------------------ rendering
  const field = (path, html, cls = "") => `<div class="${cls}" data-field="${path}">${html}</div>`;
  function renderEl(el) {
    const st = el.style || {};
    const box = `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
    const n = refCount(el);
    const cite = n ? `<span class="cite no-export" title="Linked research records: ${n}">${n}</span>` : "";
    const lock = `<span class="lock no-export">🔒</span>`;
    const frame = `background:${st.fill || "#fff"};border-color:${st.borderColor || "#d5dbe3"};`;
    let inner = "", cls = "", extra = "";
    switch (el.type) {
      case "text":
        cls = "el-text";
        extra = `font-size:${st.fontSize || 12}px;font-weight:${st.fontWeight || 400};color:${st.color || "#0f2742"};text-align:${st.align || "left"};` +
                `background:${st.fill || "transparent"};letter-spacing:${st.letterSpacing || "normal"};line-height:${st.lineHeight || 1.35};${st.fill ? "padding:6px 8px;border-radius:4px;" : ""}`;
        inner = field("text", esc(el.text), "txt"); break;
      case "panel":
        extra = `background:${st.fill || "#eef2f7"};border:${st.borderWidth || 0}px solid ${st.borderColor || "transparent"};border-radius:${el.shape === "ellipse" ? "50%" : (st.radius ?? 4) + "px"};`;
        break;
      case "metric": {
        cls = "el-metric"; extra = frame;
        const d = el.delta ? fmtDelta(el.evidence_id, el.delta.from, el.delta.kind) : null;
        inner = field("label", esc(el.label), "lbl") +
          `<div class="val bound" title="${esc(evTitle(el.evidence_id))}">${esc(fmtValue(ev(el.evidence_id)?.value, el.fmt))}${lock}</div>` +
          (d ? `<div class="dlt bound" style="color:${d.sign < 0 ? "#b91c1c" : "#15803d"}" title="Computed from ${esc(el.delta.from)} → ${esc(el.evidence_id)}">${d.sign < 0 ? "▼" : "▲"} ${d.text}</div>` : "") +
          field("note", esc(el.note || ""), "note");
        break;
      }
      case "table": {
        cls = "el-table"; extra = frame;
        const head = el.columns.map((c, i) => `<th data-field="columns.${i}">${esc(c)}</th>`).join("");
        const body = el.rows.map((r, ri) => `<tr><td data-field="rows.${ri}.label">${esc(r.label)}</td>` + r.cells.map((c, ci) => {
          if (c.evidence_id) return `<td class="bound" title="${esc(evTitle(c.evidence_id))}">${esc(fmtValue(ev(c.evidence_id)?.value, c.fmt))}</td>`;
          if (c.delta) { const d = fmtDelta(c.delta.to, c.delta.from, c.delta.kind); return `<td class="bound" title="Computed: ${esc(c.delta.to)} − ${esc(c.delta.from)}">${d.text}</td>`; }
          return `<td data-field="rows.${ri}.cells.${ci}.text">${esc(c.text)}</td>`;
        }).join("") + `</tr>`).join("");
        inner = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + field("footnote", esc(el.footnote || ""), "fn");
        break;
      }
      case "barchart": {
        const compact = (el.h - 44) / Math.max(1, el.bars.length) < 20;  // short regions: tighter rows instead of clipping
        cls = `el-bar${compact ? " compact" : ""}`; extra = frame;
        const vals = el.bars.map((b) => ev(b.evidence_id)?.value ?? 0), max = Math.max(...vals, 1e-9);
        inner = field("title", esc(el.title), "ttl") + `<div class="rows">` + el.bars.map((b, i) =>
          `<div class="br"><div data-field="bars.${i}.label">${esc(b.label)}</div><div class="track"><div class="fill" style="width:${(vals[i] / max) * 100}%;background:${st.bar || "#0f2742"}"></div></div>` +
          `<div class="v bound" title="${esc(evTitle(b.evidence_id))}">${esc(fmtValue(vals[i], el.fmt))}</div></div>`).join("") + `</div>`;
        break;
      }
      case "timeline":
        cls = "el-timeline"; extra = frame;
        inner = field("title", esc(el.title), "ttl") + `<div class="tl">` + el.events.map((e, i) =>
          `<div class="ev" title="${esc(evTitle(e.evidence_id))}"><div class="d" data-field="events.${i}.label">${esc(e.label)}</div><div data-field="events.${i}.text">${esc(e.text)}</div></div>`).join("") + `</div>`;
        break;
      case "sources":
        cls = "el-sources"; extra = `font-size:${st.fontSize || 8.5}px;color:${st.color || "#5b6b7f"};`;
        inner = `<span data-field="prefix">${esc(el.prefix || "Sources:")}</span> ${esc(sourceLine(slideOf(el)))}`; break;
      case "gap": {
        cls = "el-gap";
        const open = S.project.research_requests.find((r) => r.gap_id === el.gap_id && r.status === "open");
        extra = `background:${st.fill || "#fff7e6"};border-color:${st.borderColor || "#e0a100"};color:${st.color || "#6b4e00"};`;
        inner = `<div class="gl">Data gap${open ? " · research request open" : ""}</div>` + field("text", esc(el.text), "txt"); break;
      }
      case "pending": {
        const na = el.state === "not_available", adapt = el.state === "pending_adaptation";
        cls = `el-pending ${na ? "na" : ""} ${adapt ? "adapt" : ""}`;
        inner = `<div class="pt">${esc(el.title)}</div><div class="pi">${esc(el.text)}</div>` +
                `<div class="pi">${adapt ? `Status: waiting for AI adaptation · ${esc(el.transfer_id)}` : `${na ? "Status: not available · " : "Status: waiting for research · "}${esc(el.request_id)}`}</div>`;
        break;
      }
    }
    const flag = el.transfer_id && el.type !== "pending" ? `<span class="xflag no-export" title="Moved here for AI adaptation (${esc(el.transfer_id)})">✦ pending adaptation</span>` : "";
    if (flag) cls += " flagged";
    return `<div class="el ${cls}" data-id="${esc(el.id)}" style="${box}${extra}">${inner}${cite}${flag}</div>`;
  }
  function sourceLine(sid) {  // per slide: cites only what that slide shows
    const pages = {};
    slideEls(sid).forEach((el) => allRefs(el).forEach((id) => { const e = ev(id); if (e) (pages[e.source_id] ||= new Set()).add(e.page); }));
    const cites = Object.entries(pages).map(([sid, set]) => {
      const s = S.sources[sid] || {};
      if (s.origin === "fixture") return `${s.title}`;
      const p = [...set].filter((x) => x).sort((a, b) => a - b), parts = [];
      for (let i = 0; i < p.length; i++) { let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++; parts.push(i === j ? `${p[i]}` : `${p[i]}–${p[j]}`); i = j; }
      const date = s.published_date ? new Date(s.published_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
      return `China Re, ${s.title} (HKEX, ${date}), PDF ${p.length > 1 ? "pp." : "p."} ${parts.join(", ")}`;
    });
    return cites.length ? cites.join("; ") + "." : "none yet (no evidence on this slide)";
  }
  function annSlide(a) { if (a.kind === "element" && !a.slide_id) { const e = a.element_ids.map(byId).find(Boolean); if (e) return slideOf(e); } return slideOf(a); }
  function renderAnnotations() {
    const anns = S.project.annotations.map((a, i) => {
      if (annSlide(a) !== S.slide) return "";
      const r = a.kind === "region" ? a.rect : bbox(a.element_ids.map(byId).filter(Boolean));
      if (!r) return "";
      return `<div class="ann ${a.kind} ${a.status === "applied" ? "applied" : ""} ${S.activeReq === a.id ? "active" : ""}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">` +
             `<div class="badge" data-req="${a.id}" title="${esc(a.instruction || "(no instruction yet)")}">${i + 1}</div></div>`;
    });
    const d = S.draft ? `<div class="ann draft" style="left:${S.draft.rect.x}px;top:${S.draft.rect.y}px;width:${S.draft.rect.w}px;height:${S.draft.rect.h}px"></div>` : "";
    annotLayer.innerHTML = anns.join("") + d;
  }
  function render() {
    refreshEvidence();
    if (slideIndex(S.slide) < 0) S.slide = slides()[0].id;  // e.g. after undoing a slide insertion
    stage.innerHTML = slideEls().map(renderEl).join("");
    renderAnnotations(); syncMoveable(); renderStrip(); renderSide(); scheduleIntegrity(); renderCounts();
    $("#projTitle").textContent = S.project.title || projectName;
  }
  function renderStrip() {
    $("#thumbs").innerHTML = slides().map((s, i) => {
      const items = slideEls(s.id), pend = items.filter((e) => e.type === "pending" || e.transfer_id).length;
      return `<div class="thumb ${s.id === S.slide ? "on" : ""}" data-slide="${esc(s.id)}" title="${esc(s.title)} (double-click to rename)">
        <div class="tnum">${i + 1}</div><div class="tframe"><div class="slide mini">${items.map(renderEl).join("")}</div></div>
        <div class="tmeta"><span class="ttitle">${esc(s.title)}</span>${pend ? `<span class="chip ai" title="Pending placeholders or adaptations">${pend}</span>` : ""}</div>
        <div class="tacts"><button data-slide-act="up" title="Move up" ${i ? "" : "disabled"}>↑</button><button data-slide-act="down" title="Move down" ${i < slides().length - 1 ? "" : "disabled"}>↓</button>
          <button data-slide-act="duplicate" title="Duplicate slide">⧉</button><button data-slide-act="delete" title="Delete slide" ${slides().length > 1 ? "" : "disabled"}>✕</button></div></div>`;
    }).join("");
  }
  function setSlide(sid) {
    if (slideIndex(sid) < 0) return;
    S.slide = sid; S.selected = []; S.editing = null;
    const u = new URL(location.href); u.searchParams.set("slide", String(slideIndex(sid) + 1)); history.replaceState(null, "", u);
    render();
  }
  function renderCounts() {
    const openLayout = S.project.annotations.filter((a) => a.status !== "applied").length;
    const openResearch = S.project.research_requests.filter((r) => ["pending_research", "partially_fulfilled", "not_available", "open"].includes(r.status)).length;
    const openTransfers = S.project.transfer_requests.filter((t) => t.status === "pending_adaptation").length;
    $("#reqCount").textContent = openLayout + openResearch + openTransfers || "";
    const oc = $("#openCount"); oc.hidden = !openResearch; oc.textContent = `${openResearch} research request${openResearch === 1 ? "" : "s"} open`;
  }
  function fit() {
    const pad = 64, availW = viewport.clientWidth - pad, availH = viewport.clientHeight - pad;
    S.scale = Math.max(0.2, Math.min(1.25, availW / W, availH / H));
    scaler.style.transform = `scale(${S.scale})`;
    scaler.style.margin = `${Math.max(32, (viewport.clientHeight - H * S.scale) / 2)}px ${Math.max(32, (viewport.clientWidth - W * S.scale) / 2)}px`;
    scaler.style.marginRight = `${Math.max(32, (viewport.clientWidth - W * S.scale) / 2) - W * (1 - S.scale)}px`;
    scaler.style.marginBottom = `${Math.max(32, (viewport.clientHeight - H * S.scale) / 2) - H * (1 - S.scale)}px`;
    $("#zoom").textContent = `${Math.round(S.scale * 100)}% · 1280×720`;
    if (moveable) moveable.updateRect();
    placeCtxbar(); placePopover();
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
    moveable.updateRect(); placeCtxbar();
  }
  function readGeom(node) {
    const el = byId(node.dataset.id);
    el.x = Math.round(parseFloat(node.style.left)); el.y = Math.round(parseFloat(node.style.top));
    el.w = Math.round(parseFloat(node.style.width)); el.h = Math.round(parseFloat(node.style.height));
  }
  function initTransform() {
    let before = null;
    moveable = new Moveable(viewport, {
      target: [], draggable: true, resizable: true, snappable: true, snapContainer: stage, snapThreshold: 5,
      isDisplaySnapDigit: true, snapGap: true,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      bounds: { left: 0, top: 0, right: 0, bottom: 0, position: "css" }, origin: false, keepRatio: false,
    });
    const start = () => { before = JSON.stringify(S.project); ctxbar.hidden = true; };
    const dragStart = start;
    const end = (label) => (e) => {
      const nodes = e.targets || (e.target ? [e.target] : []), drop = S.dropTarget;
      clearDrop();
      if (drop && e.isDrag) { render(); openTransfer([...S.selected], drop.slide); return; }  // cross-slide drop: geometry untouched
      if (e.isDrag || e.lastEvent) { nodes.forEach(readGeom); pushSnapshot(before, label); }
      placeCtxbar();
    };
    moveable
      .on("dragStart", dragStart).on("dragGroupStart", dragStart).on("resizeStart", start).on("resizeGroupStart", start)
      .on("drag", (e) => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; trackDrop(); })
      .on("dragGroup", (e) => { e.events.forEach((x) => { x.target.style.left = `${x.left}px`; x.target.style.top = `${x.top}px`; }); trackDrop(); })
      .on("resize", (e) => Object.assign(e.target.style, { width: `${e.width}px`, height: `${e.height}px`, left: `${e.drag.left}px`, top: `${e.drag.top}px` }))
      .on("resizeGroup", (e) => e.events.forEach((x) => Object.assign(x.target.style, { width: `${x.width}px`, height: `${x.height}px`, left: `${x.drag.left}px`, top: `${x.drag.top}px` })))
      .on("dragEnd", end("Moved")).on("dragGroupEnd", end("Moved group"))
      .on("resizeEnd", end("Resized")).on("resizeGroupEnd", end("Resized group"));

    selecto = new Selecto({ container: viewport, dragContainer: viewport, selectableTargets: ["#stage .el"], hitRate: 0, selectByClick: true, selectFromInside: false, ratio: 0 });
    selecto.on("dragStart", (e) => {
      const t = e.inputEvent.target;
      if (S.mode !== "select" || S.editing || t.closest("#ctxbar, #popover, .badge, #zoom")) return e.stop();
      if (moveable.isMoveableElement(t) || S.selected.some((id) => nodeOf(id)?.contains(t))) e.stop();
    }).on("selectEnd", (e) => {
      let ids = e.selected.map((n) => n.dataset.id);
      if (e.inputEvent?.shiftKey) { const set = new Set(S.selected); ids.forEach((id) => (e.isClick && set.has(id) ? set.delete(id) : set.add(id))); ids = [...set]; }
      select(ids);
      if (e.isDragStart && S.selected.length) { e.inputEvent.preventDefault(); moveable.waitToChangeTarget().then(() => moveable.dragStart(e.inputEvent)); }
    });
  }

  // ------------------------------------------------------------------ cross-slide drop targets (slide strip)
  const lastPt = { x: -1, y: -1 };  // pointer position, tracked here rather than relying on Moveable's inputEvent
  ["pointermove", "mousemove", "touchmove"].forEach((t) => window.addEventListener(t, (e) => {
    const p = e.touches ? e.touches[0] : e; if (p) { lastPt.x = p.clientX; lastPt.y = p.clientY; }
    if (strip.classList.contains("armed")) trackDrop();  // the dragged module is clamped to the slide; the pointer is not
  }, { capture: true, passive: true }));
  ["pointerup", "mouseup", "touchend"].forEach((t) => window.addEventListener(t, () => setTimeout(clearDrop, 0), true));  // after Moveable's dragEnd
  function trackDrop() {
    strip.classList.add("armed");
    if (lastPt.x < 0) return;
    const hit = document.elementFromPoint(lastPt.x, lastPt.y), thumb = hit?.closest(".thumb"), fresh = hit?.closest("#newSlideDrop");
    S.dropTarget = fresh ? { slide: null } : thumb && thumb.dataset.slide !== S.slide ? { slide: thumb.dataset.slide } : null;
    $$(".thumb").forEach((n) => n.classList.toggle("drop", !!S.dropTarget && n.dataset.slide === S.dropTarget.slide));
    $("#newSlideDrop").classList.toggle("drop", !!fresh);
    viewport.classList.toggle("dropping", !!S.dropTarget);
  }
  function clearDrop() {
    S.dropTarget = null; $("#strip").classList.remove("armed"); viewport.classList.remove("dropping");
    $$(".thumb.drop, #newSlideDrop.drop").forEach((n) => n.classList.remove("drop"));
  }

  // ------------------------------------------------------------------ contextual toolbar (anchored to the selection)
  function selectionScreenRect() {
    const nodes = S.selected.map(nodeOf).filter(Boolean); if (!nodes.length) return null;
    const v = viewport.getBoundingClientRect(), rs = nodes.map((n) => n.getBoundingClientRect());
    const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
    return { left: l - v.left + viewport.scrollLeft, top: t - v.top + viewport.scrollTop, right: r - v.left + viewport.scrollLeft, bottom: b - v.top + viewport.scrollTop };
  }
  function placeCtxbar() {
    const sel = S.selected.filter(byId);  // selection may still name an element deleted in this commit
    if (!sel.length || S.editing || S.mode !== "select" || !popover.hidden) { ctxbar.hidden = true; return; }
    const multi = sel.length > 1, el = byId(sel[0]);
    const grouped = sel.some((id) => byId(id)?.group);
    const kind = multi ? `${sel.length} selected` : ({ barchart: "Chart", pending: el.transfer_id && !el.request_id ? "Adaptation placeholder" : "Research placeholder" }[el.type] || el.type[0].toUpperCase() + el.type.slice(1));
    ctxbar.innerHTML = `<span class="lbl">${esc(kind)}${!multi && boundIds(el).length ? " · source-bound 🔒" : ""}</span><span class="sep"></span>` +
      (multi ? `<button data-act="align-left" title="Align left">⇤</button><button data-act="align-center" title="Align centres">↔</button><button data-act="align-right" title="Align right">⇥</button>` +
               `<button data-act="align-top" title="Align top">⤒</button><button data-act="align-middle" title="Align middles">↕</button><button data-act="align-bottom" title="Align bottom">⤓</button>` +
               `<button data-act="dist-h" title="Distribute horizontally">⋯</button><button data-act="dist-v" title="Distribute vertically">⋮</button><span class="sep"></span>` +
               `<button data-act="group" title="Group (⌘G)">Group</button>` : "") +
      (grouped ? `<button data-act="ungroup" title="Ungroup (⇧⌘G)">Ungroup</button>` : "") +
      `<button data-act="duplicate" title="Duplicate (⌘D)">Duplicate</button><button data-act="front" title="Bring to front">Front</button><button data-act="back" title="Send to back">Back</button>` +
      `<button data-act="delete" title="Delete (⌫)">Delete</button><span class="sep"></span>` +
      `<button data-act="to-slide" title="Move, copy or adapt on another slide (or drag onto a slide thumbnail)">⇢ Slide…</button>` +
      `<button data-act="ask-ai" class="ai" title="Describe a change for these elements">✦ Ask AI</button>`;
    ctxbar.hidden = false;
    const r = selectionScreenRect(); if (!r) { ctxbar.hidden = true; return; }
    const w = ctxbar.offsetWidth, h = ctxbar.offsetHeight, gap = 10;
    let top = r.top - h - gap; if (top < viewport.scrollTop + 4) top = r.bottom + gap;  // flip below if no room
    const left = Math.max(viewport.scrollLeft + 6, Math.min((r.left + r.right) / 2 - w / 2, viewport.scrollLeft + viewport.clientWidth - w - 6));
    Object.assign(ctxbar.style, { left: `${left}px`, top: `${top}px` });
  }
  viewport.addEventListener("scroll", () => { placeCtxbar(); placePopover(); });

  // ------------------------------------------------------------------ inline text editing
  function setPath(obj, path, value) { const k = path.split("."); let o = obj; k.slice(0, -1).forEach((x) => { o = o[x]; }); o[k.at(-1)] = value; }
  stage.addEventListener("dblclick", (e) => {
    const f = e.target.closest("[data-field]"), node = e.target.closest(".el");
    if (!f || !node || S.mode !== "select") return;
    S.editing = { id: node.dataset.id, path: f.dataset.field }; syncMoveable();
    f.contentEditable = "true"; f.focus();
    const range = document.createRange(); range.selectNodeContents(f); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    f.addEventListener("blur", () => {
      const { id, path } = S.editing; S.editing = null; f.contentEditable = "false";
      commit((p) => setPath(p.elements.find((x) => x.id === id), path, f.innerText.replace(/\n$/, "")), "Edited text"); syncMoveable();
    }, { once: true });
    f.addEventListener("keydown", (k) => { if (k.key === "Escape") f.blur(); });
  });

  // ------------------------------------------------------------------ AI region: draw → describe → classify → create
  function slidePoint(ev) { const r = stage.getBoundingClientRect(); return { x: (ev.clientX - r.left) / S.scale, y: (ev.clientY - r.top) / S.scale }; }
  viewport.addEventListener("pointerdown", (e) => {
    if (S.mode !== "region" || e.button !== 0 || e.target.closest(".badge, #popover, #ctxbar")) return;
    e.preventDefault();
    const p0 = slidePoint(e), box = document.createElement("div"); box.className = "ann drawing"; annotLayer.appendChild(box);
    const c = (v, m) => Math.max(0, Math.min(m, v));
    const rectOf = (p) => { const x0 = c(Math.min(p0.x, p.x), W), y0 = c(Math.min(p0.y, p.y), H);
      return { x: Math.round(x0), y: Math.round(y0), w: Math.round(c(Math.max(p0.x, p.x), W) - x0), h: Math.round(c(Math.max(p0.y, p.y), H) - y0) }; };
    const move = (m) => { const r = rectOf(slidePoint(m)); Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };
    const up = (u) => {
      viewport.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); box.remove();
      const r = rectOf(slidePoint(u)); if (r.w < 12 || r.h < 12) return;
      openPopover({ kind: "region", rect: r });
    };
    viewport.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
  function scopeIds(a) {
    if (a.kind === "element") return a.element_ids.filter(byId);
    const r = a.rect; return slideEls(annSlide(a)).filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y).map((e) => e.id);
  }
  const INTENTS = { layout: "Edit layout", existing_data: "Use existing data", research: "Add research-backed content" };
  function openPopover(target) {
    const rect = target.rect || bbox(target.element_ids.map(byId));
    S.draft = { ...target, rect, instruction: "", intent: "layout", cls: null, touched: false };
    setMode("select", true); renderAnnotations();
    const scope = target.kind === "region" ? scopeIds({ kind: "region", rect, slide_id: S.slide }) : target.element_ids;
    popover.innerHTML = `<h4>✦ Describe the change</h4>
      <p class="hint">${target.kind === "region" ? `Region ${rect.w}×${rect.h}px` : "Selected elements"} · ${scope.length ? `covers ${scope.length} element(s)` : "empty area"}</p>
      <textarea id="popText" placeholder="e.g. “Reorganize these three blocks into two columns” or “Add a bar chart of revenue by region; research FY2025 figures”"></textarea>
      <div class="intent" id="popIntent">Type an instruction; the editor will suggest how to handle it.</div>
      <div class="seg" id="popSeg">${Object.entries(INTENTS).map(([k, v]) => `<button data-intent="${k}" class="${k === "layout" ? "on" : ""}">${v}</button>`).join("")}</div>
      <div class="pop-actions"><button id="popCancel">Cancel</button><button id="popOk" class="primary" disabled>Create request</button></div>`;
    popover.hidden = false; ctxbar.hidden = true; placePopover();
    const ta = $("#popText"); ta.focus();
    let t; ta.addEventListener("input", () => { S.draft.instruction = ta.value; $("#popOk").disabled = !ta.value.trim(); clearTimeout(t); t = setTimeout(classifyDraft, 250); });
    ta.addEventListener("keydown", (k) => { if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) submitPopover(); if (k.key === "Escape") closePopover(); });
    $("#popSeg").addEventListener("click", (e) => { const b = e.target.closest("button[data-intent]"); if (!b) return; S.draft.touched = true; setIntent(b.dataset.intent); });
    $("#popCancel").addEventListener("click", closePopover);
    $("#popOk").addEventListener("click", submitPopover);
  }
  function setIntent(k) { S.draft.intent = k; $$("#popSeg button").forEach((b) => b.classList.toggle("on", b.dataset.intent === k)); }
  async function classifyDraft() {
    if (!S.draft || !S.draft.instruction.trim()) return;
    try {
      const c = await api("POST", "/api/classify", { project: S.project, instruction: S.draft.instruction });
      if (!S.draft) return; S.draft.cls = c;
      const n = Object.values(c.matched_evidence).flat().length;
      const label = { layout: `<span class="chip info">Layout edit</span> rearranges or restyles what is already on the slide`,
        existing_data: `<span class="chip ok">Uses existing data</span> ${n} verified evidence item(s) available; no new research needed`,
        research: `<span class="chip ai">Needs research</span> ${esc(c.reasons[0] || "")}${c.related_gaps.length ? ` · known gap: ${esc(c.related_gaps.join(", "))}` : ""}` }[c.intent];
      $("#popIntent").innerHTML = `Suggested: ${label}`;
      if (!S.draft.touched) setIntent(c.intent);
    } catch (err) { $("#popIntent").textContent = `Could not classify: ${err.message}`; }
  }
  async function submitPopover() {
    const d = S.draft; if (!d || !d.instruction.trim()) return;
    if (d.intent === "research") {
      try {
        const r = await api("POST", "/api/research/create", { project: S.project, instruction: d.instruction, region: d.rect, slide_id: S.slide });
        closePopover(); replaceProject(r.project, "Research request created; placeholder added");
        S.activeReq = r.request.id; select([r.request.placeholder_element_id]); showTab("requests"); renderSide();
      } catch (err) { toast(`Could not create research request: ${err.message}`); }
      return;
    }
    const id = uid("req");
    const ann = { id, slide_id: S.slide, instruction: d.instruction.trim(), status: "open", created: new Date().toISOString(), kind: d.kind, intent: d.intent,
                  ...(d.kind === "region" ? { rect: d.rect } : { element_ids: d.element_ids }) };
    if (d.intent === "existing_data" && d.cls) ann.uses_evidence = [...new Set(Object.values(d.cls.matched_evidence).flat())];
    closePopover(); commit((p) => p.annotations.push(ann), "Layout change request added");
    S.activeReq = id; showTab("requests"); renderSide();
  }
  function closePopover() { S.draft = null; popover.hidden = true; renderAnnotations(); placeCtxbar(); }
  function placePopover() {
    if (popover.hidden || !S.draft) return;
    const sr = stage.getBoundingClientRect(), v = viewport.getBoundingClientRect(), r = S.draft.rect;
    const right = sr.left - v.left + viewport.scrollLeft + (r.x + r.w) * S.scale, top = sr.top - v.top + viewport.scrollTop + r.y * S.scale;
    const leftEdge = sr.left - v.left + viewport.scrollLeft + r.x * S.scale;
    let left = right + 12; if (left + popover.offsetWidth > viewport.scrollLeft + viewport.clientWidth - 8) left = Math.max(viewport.scrollLeft + 8, leftEdge - popover.offsetWidth - 12);
    const t = Math.max(viewport.scrollTop + 8, Math.min(top, viewport.scrollTop + viewport.clientHeight - popover.offsetHeight - 8));
    Object.assign(popover.style, { left: `${left}px`, top: `${t}px` });
  }
  annotLayer.addEventListener("click", (e) => { const b = e.target.closest(".badge"); if (!b) return; S.activeReq = b.dataset.req; showTab("requests"); renderAnnotations(); renderSide(); });

  // ------------------------------------------------------------------ insert + arrange actions
  function insert(el) { el.slide_id = S.slide; commit((p) => p.elements.push(el),`Inserted ${el.type === "barchart" ? "chart" : el.type}`); select([el.id]); }
  const centre = (w, h) => ({ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h });
  function align(kind) {
    const sel = S.selected.map(byId); if (!sel.length) return;
    const b = sel.length > 1 ? bbox(sel) : { x: 0, y: 0, w: W, h: H };
    commit(() => sel.forEach((e) => {
      if (kind === "left") e.x = b.x; if (kind === "right") e.x = b.x + b.w - e.w; if (kind === "center") e.x = Math.round(b.x + (b.w - e.w) / 2);
      if (kind === "top") e.y = b.y; if (kind === "bottom") e.y = b.y + b.h - e.h; if (kind === "middle") e.y = Math.round(b.y + (b.h - e.h) / 2);
    }), `Aligned ${kind}`);
  }
  function distribute(axis) {
    const sel = S.selected.map(byId); if (sel.length < 3) return toast("Select three or more elements to distribute");
    const [pos, size] = axis === "h" ? ["x", "w"] : ["y", "h"];
    sel.sort((a, b) => a[pos] - b[pos]);
    const total = sel.reduce((s, e) => s + e[size], 0), first = sel[0], last = sel.at(-1), gap = (last[pos] + last[size] - first[pos] - total) / (sel.length - 1);
    commit(() => { let cur = first[pos]; sel.forEach((e) => { e[pos] = Math.round(cur); cur += e[size] + gap; }); }, "Distributed");
  }
  const actions = {
    "mode-select": () => setMode("select"), "mode-region": () => setMode("region"),
    "add-text": () => insert({ id: uid("t"), type: "text", ...centre(240, 48), text: "New text", style: { fontSize: 13, color: "#0f2742" }, refs: {} }),
    "add-panel": () => insert({ id: uid("p"), type: "panel", shape: "rect", ...centre(320, 180), style: { fill: "#eef2f7", radius: 4 }, refs: {} }),
    "add-ellipse": () => insert({ id: uid("e"), type: "panel", shape: "ellipse", ...centre(120, 120), style: { fill: "#dbe4f0" }, refs: {} }),
    "add-chart": () => openPicker("chart"), "add-table": () => openPicker("table"), "add-metric": () => openPicker("metric"),
    "ask-ai": () => S.selected.length && openPopover({ kind: "element", element_ids: [...S.selected] }),
    "to-slide": () => { if (!S.selected.length) return; const other = slides().find((s) => s.id !== S.slide); openTransfer([...S.selected], other ? other.id : null); },
    duplicate: () => {
      if (!S.selected.length) return; const ids = []; const group = uid("g");
      const copies = S.selected.map(byId).filter((e) => e.type !== "pending").map((e) => { const c = clone(e); c.id = uid(e.type.slice(0, 2)); c.x += 16; c.y += 16; if (e.group) c.group = group; ids.push(c.id); return c; });
      commit((p) => p.elements.push(...copies), "Duplicated"); select(ids);
    },
    delete: () => {
      if (!S.selected.length) return;
      if (S.selected.some((id) => byId(id)?.type === "pending") && !confirm("Delete the research placeholder? The research request stays in the Requests tab.")) return;
      const ids = new Set(S.selected); commit((p) => { p.elements = p.elements.filter((e) => !ids.has(e.id)); }, "Deleted"); select([]);
    },
    group: () => { if (S.selected.length < 2) return; const g = uid("g"); commit(() => S.selected.forEach((id) => { byId(id).group = g; }), "Grouped"); placeCtxbar(); },
    ungroup: () => { commit(() => S.selected.forEach((id) => { delete byId(id).group; }), "Ungrouped"); placeCtxbar(); },
    front: () => commit((p) => { const s = p.elements.filter((e) => S.selected.includes(e.id)); p.elements = p.elements.filter((e) => !S.selected.includes(e.id)).concat(s); }, "Brought to front"),
    back: () => commit((p) => { const s = p.elements.filter((e) => S.selected.includes(e.id)); p.elements = s.concat(p.elements.filter((e) => !S.selected.includes(e.id))); }, "Sent to back"),
    "align-left": () => align("left"), "align-center": () => align("center"), "align-right": () => align("right"),
    "align-top": () => align("top"), "align-middle": () => align("middle"), "align-bottom": () => align("bottom"),
    "dist-h": () => distribute("h"), "dist-v": () => distribute("v"),
    undo, redo, revert, save, export: exportPng,
  };
  function revert() {
    const saved = JSON.parse(S.saved);
    if (!S.selected.length) { if (!isDirty() || !confirm("Revert the whole slide to the last saved version?")) return; return replaceProject(saved, "Reverted to saved"); }
    const ids = new Set(S.selected);
    commit((p) => { p.elements = p.elements.flatMap((e) => { if (!ids.has(e.id)) return [e]; const old = saved.elements.find((s) => s.id === e.id); return old ? [old] : []; }); }, `Reverted ${ids.size} element(s) to saved`);
    prune(); syncMoveable();
  }
  function setMode(m, quiet) {
    S.mode = m; viewport.classList.toggle("region-mode", m === "region");
    $$("#rail .tool").forEach((b) => b.classList.toggle("on", b.dataset.act === `mode-${m}`));
    if (m === "region") { select([]); hint("Drag a rectangle over the slide, then describe what you want there"); } else hint("");
    placeCtxbar();
  }
  async function save() {
    try { const r = await api("PUT", `/api/projects/${projectName}`, S.project); S.saved = JSON.stringify(S.project); S.integrity = r.integrity; renderIntegrity(); status(`Saved to editor/${r.saved}`); }
    catch (err) { toast(`Save failed: ${err.message}`); }
  }
  async function exportPng(label) {
    const errs = S.integrity.filter((i) => i.level === "error");
    if (errs.length && !confirm(`${errs.length} data-integrity error(s), e.g. ${errs[0].message}. Export anyway?`)) return;
    const pending = slideEls().filter((e) => e.type === "pending").length;
    if (pending && !confirm(`${pending} pending placeholder(s) are on this slide and will appear in the PNG. Export anyway?`)) return;
    const prev = S.selected; select([]); ctxbar.hidden = true; stage.classList.add("exporting");
    try {
      const url = await htmlToImage.toPng(stage, { pixelRatio: 2, width: W, height: H, cacheBust: true, filter: (n) => !(n.classList && n.classList.contains("no-export")) });
      const def = `slide-${slideIndex(S.slide) + 1}`;
      const name = (typeof label === "string" ? label : prompt("Export label (a-z, 0-9, -). Exports the slide shown.", def)) || def;
      const r = await api("POST", `/api/projects/${projectName}/export`, { png: url, label: name.toLowerCase().replace(/[^a-z0-9_-]/g, "-") });
      const a = document.createElement("a"); a.href = url; a.download = r.saved.split("/").pop(); a.click();
      status(`Exported 2560×1440 PNG → editor/${r.saved}`);
    } catch (err) { toast(`Export failed: ${err.message}`); }
    finally { stage.classList.remove("exporting"); select(prev); }
  }

  // ------------------------------------------------------------------ evidence picker (chart / table / metric from verified data)
  function openPicker(kind) {
    const dlg = $("#pickDlg"), list = $("#pickList"), multi = kind !== "metric";
    $("#pickTitle").textContent = { chart: "Insert bar chart", table: "Insert table", metric: "Insert metric card" }[kind];
    const items = Object.entries(S.evidence).filter(([, e]) => e.kind === "metric_value" && e.verification === "verified");
    const groups = {}; items.forEach(([id, e]) => (groups[e.metric_id] ||= []).push([id, e]));
    const draw = (q = "") => {
      const ql = q.toLowerCase();
      list.innerHTML = Object.entries(groups).map(([m, arr]) => {
        const rows = arr.filter(([id, e]) => !ql || `${id} ${e.subject} ${e.period} ${m}`.toLowerCase().includes(ql));
        if (!rows.length) return "";
        return `<div class="grp">${esc(m)}</div>` + rows.map(([id, e]) => `<label><input type="${multi ? "checkbox" : "radio"}" name="pk" value="${esc(id)}">` +
          `<span>${esc(e.subject)} · ${esc(e.period)}${isFixture(id) ? " · TEST FIXTURE" : ""}</span><span class="v">${esc(fmtValue(e.value, autoFmt(e)))}</span></label>`).join("");
      }).join("") || `<p class="hint" style="padding:8px">No verified figures match. Use “Data missing → research request”.</p>`;
    };
    draw(); $("#pickFilter").value = ""; $("#pickLabel").value = ""; $("#pickWarn").textContent = ""; $("#pickOk").disabled = true;
    const chosen = () => $$("#pickList input:checked").map((i) => i.value);
    const check = () => {
      const ids = chosen(), metas = ids.map(ev);
      const mixed = ["metric_id", "unit", "period"].filter((f) => new Set(metas.map((m) => m[f])).size > 1);
      const warn = kind === "chart" && mixed.length ? `Not comparable: the selection mixes ${mixed.join(", ")}. Choose figures with one metric, unit and period.` : "";
      $("#pickWarn").textContent = warn; $("#pickOk").disabled = !ids.length || !!warn;
      if (!$("#pickLabel").dataset.touched && metas[0]) $("#pickLabel").value = kind === "metric" ? metas[0].subject : `${metas[0].metric_id.replace("m.", "").replace(/_/g, " ")}, ${metas[0].period}`;
    };
    list.onchange = check; $("#pickFilter").oninput = (e) => { draw(e.target.value); check(); };
    $("#pickLabel").oninput = (e) => { e.target.dataset.touched = "1"; };
    delete $("#pickLabel").dataset.touched;
    dlg.returnValue = ""; dlg.showModal();
    dlg.addEventListener("close", () => {
      const ids = chosen(), title = $("#pickLabel").value.trim();
      if (dlg.returnValue === "research") { toast("Draw a region where the new content should go, then describe it"); setMode("region"); return; }
      if (dlg.returnValue !== "ok" || !ids.length) return;
      const f = autoFmt(ev(ids[0]));
      if (kind === "metric") insert({ id: uid("m"), type: "metric", ...centre(195, 88), label: title || ev(ids[0]).subject, evidence_id: ids[0], fmt: f, note: ev(ids[0]).period, refs: {}, style: { fill: "#fff", borderColor: "#d5dbe3" } });
      if (kind === "chart") insert({ id: uid("c"), type: "barchart", ...centre(420, 60 + ids.length * 40), title, fmt: { ...f, prefix: "" }, refs: {},
        bars: ids.map((id) => ({ label: ev(id).subject, evidence_id: id })), style: { fill: "#fff", borderColor: "#d5dbe3", bar: "#0f2742" } });
      if (kind === "table") insert({ id: uid("tb"), type: "table", ...centre(420, 60 + ids.length * 26), columns: [title || "Item", "Period", "Value"], footnote: "", refs: {},
        rows: ids.map((id) => ({ label: ev(id).subject, cells: [{ text: ev(id).period }, { evidence_id: id, fmt: f }] })), style: { fill: "#fff", borderColor: "#d5dbe3" } });
    }, { once: true });
  }

  // ------------------------------------------------------------------ slides: add / duplicate / delete / reorder / rename
  async function slideOp(op, sid, extra = {}) {
    const at = slideIndex(sid);
    try {
      const r = await api("POST", "/api/slides", { project: S.project, op, slide_id: sid, ...extra });
      replaceProject(r.project, { add: "Added slide", duplicate: "Duplicated slide", delete: "Deleted slide" }[op]);
      setSlide(op === "delete" ? slides()[Math.min(at, slides().length - 1)].id : r.slide_id);
    } catch (err) { toast(err.message); }
  }
  $("#strip").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-slide-act]"), thumb = e.target.closest(".thumb");
    if (e.target.closest("#newSlideDrop")) return slideOp("add", null, { after: S.slide });
    if (!thumb) return;
    const sid = thumb.dataset.slide;
    if (!b) return setSlide(sid);
    const act = b.dataset.slideAct, i = slideIndex(sid);
    if (act === "duplicate") slideOp("duplicate", sid);
    if (act === "delete") {
      const n = slideEls(sid).length;
      if (confirm(`Delete ${slideName(sid)} and its ${n} element(s)? Undo (⌘Z) restores it.`)) slideOp("delete", sid);
    }
    if (act === "up" || act === "down") {
      const j = act === "up" ? i - 1 : i + 1;
      commit((p) => { const [s] = p.slides.splice(i, 1); p.slides.splice(j, 0, s); }, "Reordered slides");
    }
  });
  $("#strip").addEventListener("dblclick", (e) => {
    const thumb = e.target.closest(".thumb"); if (!thumb || e.target.closest("button")) return;
    const s = slides()[slideIndex(thumb.dataset.slide)], t = prompt("Slide title", s.title);
    if (t && t.trim()) commit((p) => { p.slides.find((x) => x.id === s.id).title = t.trim(); }, "Renamed slide");
  });

  // ------------------------------------------------------------------ transfer menu (after a cross-slide drop)
  const MODE_INFO = [
    ["move", "Move as-is", "Same module, ids and evidence links, on the target slide."],
    ["copy", "Copy as-is", "Keep it here and place a linked copy there."],
    ["move_adapt", "Move and adapt", "Move it; AI reworks wording and layout for the target slide."],
    ["use_as_evidence", "Use as evidence for a new slide", "Keep it here; AI builds new content around its evidence."],
    ["split", "Split into multiple modules", "Move it; AI breaks it into smaller modules."],
    ["summarise", "Summarise for target slide", "Keep it here; AI writes a short summary there."],
  ];
  const LITERAL = new Set(["move", "copy"]);
  function openTransfer(ids, target) {
    ids = expandGroups(ids.filter(byId)); if (!ids.length) return;
    const dlg = $("#xferDlg"), src = S.slide, mods = ids.map(byId);
    const X = { ids, mode: "move" };
    $("#xferTitle").textContent = `Transfer ${ids.length} module${ids.length === 1 ? "" : "s"}`;
    const linked = new Set(mods.flatMap(allRefs)), claims = new Set(mods.flatMap((m) => m.refs?.claims || []));
    $("#xferFrom").innerHTML = `From <b>${esc(slideName(src))}</b>: ${esc([...new Set(mods.map((m) => m.type === "barchart" ? "chart" : m.type))].join(", "))}. ` +
      `Carries ${linked.size} evidence link(s) and ${claims.size} claim(s); they stay attached in every mode.`;
    $("#xferTarget").innerHTML = slides().filter((s) => s.id !== src).map((s) => `<option value="${esc(s.id)}">${esc(slideName(s.id))}</option>`).join("") + `<option value="">＋ New slide</option>`;
    $("#xferTarget").value = target ?? "";
    $("#xferNewTitle").value = "";
    $("#xferModes").innerHTML = [["Place as-is", MODE_INFO.slice(0, 2), ""], ["Ask AI to adapt · creates a transfer request", MODE_INFO.slice(2), "ai"]].map(([g, list, cls]) =>
      `<div class="grp">${g}</div><div class="opts ${cls}">` + list.map(([k, l, d]) => `<label><input type="radio" name="xmode" value="${k}" ${k === "move" ? "checked" : ""}><div><b>${l}</b><span>${d}</span></div></label>`).join("") + `</div>`).join("");
    $("#xferText").value = "";
    let t;
    const refresh = () => {
      X.mode = $("#xferModes input:checked").value; X.target = $("#xferTarget").value || null;
      $("#xferNewRow").hidden = X.target !== null;
      const literal = LITERAL.has(X.mode); $("#xferText").disabled = literal;
      $("#xferOk").textContent = literal ? MODE_INFO.find((m) => m[0] === X.mode)[1] : "Create transfer request";
      clearTimeout(t); t = setTimeout(previewTransfer, 200);
    };
    const previewTransfer = async () => {
      const box = $("#xferPreview");
      try {
        const r = await api("POST", "/api/transfer/preview", { project: S.project, module_ids: X.ids, target_slide_id: X.target, mode: X.mode, instruction: $("#xferText").value });
        if (!r.ok) { box.innerHTML = `<span class="chip err">cannot transfer</span> ${esc(r.error)}`; $("#xferOk").disabled = true; return; }
        $("#xferOk").disabled = false;
        const c = r.classification, ph = r.placeholders;
        box.innerHTML = LITERAL.has(X.mode) ? `<span class="chip ok">no request</span> ${r.module_ids.length} element(s) placed on ${X.target ? "the target slide" : "a new slide"} with links unchanged.`
          : `<span class="chip ai">transfer request</span> ${ph.length ? `Will add: ${ph.map(esc).join("; ")}.` : "Modules are flagged for adaptation."}` +
            (c ? ` <span class="hint">Instruction reads as ${c.intent === "research" ? `<b>needs research</b> (${esc(c.uncovered_topics.join(", "))})` : c.intent === "existing_data" ? "<b>new exhibit from existing evidence</b>" : "<b>rework existing content</b>"}.</span>` : "");
      } catch (err) { box.textContent = err.message; }
    };
    $("#xferModes").onchange = refresh; $("#xferTarget").onchange = refresh; $("#xferText").oninput = refresh;
    refresh();
    dlg.returnValue = ""; dlg.showModal();
    dlg.addEventListener("close", async () => {
      if (dlg.returnValue !== "ok") return;
      try {
        const r = await api("POST", "/api/transfer", { project: S.project, module_ids: X.ids, target_slide_id: X.target, mode: X.mode,
          instruction: LITERAL.has(X.mode) ? "" : $("#xferText").value, new_slide_title: $("#xferNewTitle").value });
        const res = r.result, label = MODE_INFO.find((m) => m[0] === X.mode)[1];
        replaceProject(r.project, `${label}: ${res.module_ids.length} element(s) → ${res.created_slide ? "new slide" : slideName(res.target_slide_id)}`);
        setSlide(res.target_slide_id); select([...res.element_ids, ...res.placeholder_ids]);
        if (res.transfer_request) { S.activeReq = res.transfer_request.id; showTab("requests"); renderSide(); }
      } catch (err) { toast(`Transfer failed: ${err.message}`); }
    }, { once: true });
  }

  // ------------------------------------------------------------------ side panel
  function showTab(t) { $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); $$(".pane").forEach((p) => p.classList.toggle("on", p.id === `pane-${t}`)); }
  function renderSide() { renderProps(); renderRequests(); placeCtxbar(); }
  function refsHtml(el) {
    const parts = [];
    allRefs(el).forEach((id) => { const e = ev(id);
      parts.push(`<div class="card"><code>${esc(id)}</code> <span class="chip ${e?.verification === "verified" ? "ok" : "err"}">${esc(e?.verification || "missing")}</span>${isFixture(id) ? ` <span class="chip err">TEST FIXTURE</span>` : ""}<br>` +
        (e ? `${esc(e.subject || "")} · ${esc(e.period || "")}${e.value !== undefined ? ` · <b>${esc(e.value)}</b> ${esc(e.unit)}` : ""}<br><span class="ex">p.${esc(e.page)}: “${esc(e.excerpt)}”</span>` : "") + `</div>`); });
    (el.refs?.claims || []).forEach((id) => { const c = S.project.claims[id];
      parts.push(`<div class="card"><code>${esc(id)}</code> <span class="chip">${esc(c?.nature)}</span> <span class="chip ${c?.support === "supported" ? "ok" : "warn"}">${esc(c?.support)}</span><br>${esc(c?.statement)}</div>`); });
    (el.refs?.gaps || []).forEach((id) => { const g = S.project.gaps[id]; parts.push(`<div class="card"><code>${esc(id)}</code> <span class="chip warn">${esc(g?.reason)}</span><br>${esc(g?.description)}</div>`); });
    if (el.detached_from) parts.push(`<div class="card"><span class="chip warn">detached</span> was bound to <code>${esc(el.detached_from)}</code></div>`);
    return parts.join("") || `<p class="hint">No linked evidence, claims or gaps. Numbers typed here are flagged as unsourced.</p>`;
  }
  function renderProps() {
    const pane = $("#pane-props");
    if (!S.selected.length) {
      const openR = S.project.research_requests.filter((r) => r.status !== "fulfilled" && r.status !== "closed").length;
      const openT = S.project.transfer_requests.filter((t) => t.status === "pending_adaptation").length;
      const s = slides()[slideIndex(S.slide)];
      pane.innerHTML = `<div class="sec"><h5>Slide ${slideIndex(S.slide) + 1} of ${slides().length}</h5>
        <label class="field"><span>Title</span><input data-slide-title value="${esc(s.title)}"></label>
        <p class="hint">${slideEls().length} elements on this slide</p></div>
        <div class="sec"><h5>Project</h5><p><b>${esc(S.project.title)}</b></p>
        <p class="hint">${slides().length} slides · ${Object.keys(S.evidence).length} evidence records · ${openR} open research request(s) · ${openT} pending transfer(s)</p></div>
        <div class="sec"><h5>How to edit</h5><p class="hint">Click to select, shift-click for more, drag to move, drag handles to resize. Double-click any text to edit it.
        Drag a selection onto another slide in the strip (or onto <b>＋ New slide</b>) to move, copy or ask AI to adapt it there; <b>⇢ Slide…</b> in the toolbar does the same.
        Use <b>AI region</b> to draw a box and describe a change, or <b>✦ Ask AI</b> on a selection. Figures marked 🔒 come from verified evidence and cannot be typed over.</p></div>`;
      return;
    }
    if (S.selected.length > 1) { pane.innerHTML = `<div class="sec"><h5>Selection</h5><p><b>${S.selected.length} elements</b></p><p class="hint">Use the floating toolbar to align, distribute, group or ask AI.</p></div>`; return; }
    const el = byId(S.selected[0]), st = el.style || {};
    const num = (k, v) => `<label class="field"><span>${k.toUpperCase()}</span><input type="number" data-geo="${k}" value="${v}"></label>`;
    const sty = (k, label, type = "text", opts) => opts
      ? `<label class="field"><span>${label}</span><select data-style="${k}">${opts.map((o) => `<option ${String(st[k]) === String(o) ? "selected" : ""}>${o}</option>`).join("")}</select></label>`
      : `<label class="field"><span>${label}</span><input type="${type}" data-style="${k}" value="${esc(st[k] ?? (type === "color" ? "#ffffff" : ""))}"></label>`;
    let styleHtml = "";
    if (el.type === "text") styleHtml = sty("fontSize", "Font size", "number") + sty("fontWeight", "Weight", "", [400, 600, 700]) + sty("color", "Colour", "color") + sty("fill", "Background") + sty("align", "Align", "", ["left", "center", "right"]);
    if (el.type === "panel") styleHtml = sty("fill", "Fill", "color") + sty("borderColor", "Border", "color") + sty("borderWidth", "Border px", "number") + sty("radius", "Radius", "number");
    if (["metric", "table", "barchart", "timeline", "gap"].includes(el.type)) styleHtml = sty("fill", "Fill", "color") + sty("borderColor", "Border", "color");
    if (el.type === "barchart") styleHtml += sty("bar", "Bar colour", "color") + `<label class="field"><span>Decimals</span><input type="number" min="0" max="4" data-fmt="decimals" value="${el.fmt?.decimals ?? 0}"></label>`;
    if (el.type === "sources") styleHtml = sty("fontSize", "Font size", "number") + sty("color", "Colour", "color");
    let extra = "";
    if (el.type === "metric") extra = `<label class="field"><span>Decimals</span><input type="number" min="0" max="4" data-fmt="decimals" value="${el.fmt?.decimals ?? 0}"></label>
      <button data-side="detach" title="Replace the bound figure with plain text (flagged in Data)">Detach value from evidence…</button>`;
    if (el.type === "pending" && el.request_id) { const r = rr(el.request_id); extra = r ? `<div class="card ai"><b>${esc(r.status)}</b><br>${esc(r.instruction)}<div class="row"><button data-side="rr-show" data-rr="${r.id}">Open request</button></div></div>` : ""; }
    if (el.transfer_id) { const x = tr(el.transfer_id); extra += x ? `<div class="card xfer"><b>${esc(x.mode_label)}</b> · ${esc(x.status)}<br>${esc(x.instruction || x.intent)}<div class="row"><button data-side="tr-show" data-tr="${x.id}">Open transfer request</button></div></div>` : ""; }
    if (el.origin) extra += `<p class="hint">Copied from <code>${esc(el.origin.element_id)}</code> on ${esc(slideName(el.origin.slide_id))}</p>`;
    pane.innerHTML = `<div class="sec"><h5>${esc(el.type === "barchart" ? "chart" : el.type)}</h5><code>${esc(el.id)}</code>${el.group ? ` <span class="chip">group</span>` : ""}${el.created_by ? ` <span class="chip ai">${esc(el.created_by)}</span>` : ""}</div>
      <div class="sec"><h5>Position & size</h5><div class="geo">${num("x", el.x)}${num("y", el.y)}${num("w", el.w)}${num("h", el.h)}</div></div>
      ${styleHtml || extra ? `<div class="sec"><h5>Style</h5>${styleHtml}${extra}</div>` : ""}
      <div class="sec"><h5>Linked research records</h5>${refsHtml(el)}</div>`;
  }
  $("#side").addEventListener("change", (e) => {
    const t = e.target, el = byId(S.selected[0]);
    if (t.dataset.geo && el) commit(() => { el[t.dataset.geo] = Math.max(["w", "h"].includes(t.dataset.geo) ? 4 : -2000, Math.round(+t.value)); }, "Changed geometry");
    if (t.dataset.style && el) commit(() => { el.style ||= {}; el.style[t.dataset.style] = t.type === "number" ? +t.value : t.value; }, "Changed style");
    if (t.dataset.fmt && el) commit(() => { el.fmt = { ...el.fmt, decimals: Math.max(0, Math.min(4, +t.value)) }; }, "Changed display format");
    if (t.dataset.req) commit((p) => { p.annotations.find((a) => a.id === t.dataset.req).instruction = t.value; }, "Updated instruction");
    if (t.hasAttribute("data-slide-title") && t.value.trim()) commit((p) => { p.slides.find((s) => s.id === S.slide).title = t.value.trim(); }, "Renamed slide");
  });
  $("#side").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || !b.dataset.side) return;
    const act = b.dataset.side, rid = b.dataset.req, rqid = b.dataset.rr, tid = b.dataset.tr;
    // transfer requests (cross-slide drops)
    if (act === "tr-show") {
      const x = tr(tid); S.activeReq = tid; showTab("requests");
      if (x && slideIndex(x.target_slide_id) >= 0) { setSlide(x.target_slide_id); select([...x.target_element_ids, ...x.placeholder_element_ids].filter(byId)); showTab("requests"); }
      renderRequests();
    }
    if (act === "tr-export") {
      try { const r = await api("POST", `/api/projects/${projectName}/transfers/${tid}`, S.project); S.transfers[tid] = { exported: r }; toast(`Transfer request written to editor/${r.request}`); renderRequests(); } catch (err) { toast(err.message); }
    }
    if (act === "tr-cancel") {
      if (!confirm("Cancel this transfer request? Its placeholders are removed; moved modules stay where they are (⌘Z moves them back).")) return;
      try { const r = await api("POST", "/api/transfer/cancel", { project: S.project, transfer_id: tid }); replaceProject(r.project, "Transfer request cancelled"); } catch (err) { toast(err.message); }
    }
    if (act === "detach") {
      const el = byId(S.selected[0]); if (!confirm("Detach this figure from its evidence? It becomes plain text and is flagged in Data.")) return;
      const shown = fmtValue(ev(el.evidence_id)?.value, el.fmt);
      commit((p) => { const i = p.elements.findIndex((x) => x.id === el.id);
        p.elements[i] = { id: el.id, type: "text", x: el.x, y: el.y, w: el.w, h: el.h, text: `${el.label}\n${shown}`, style: { fontSize: 14, fontWeight: 700, color: "#0f2742", fill: "#ffffff" }, refs: {}, detached_from: el.evidence_id }; }, "Detached value (flagged)");
    }
    // layout change requests (agent patch flow)
    if (act === "req-del") commit((p) => { p.annotations = p.annotations.filter((a) => a.id !== rid); }, "Deleted change request");
    if (act === "req-focus") { S.activeReq = rid; renderAnnotations(); select(scopeIds(S.project.annotations.find((a) => a.id === rid))); }
    if (act === "req-export") {
      try { const r = await api("POST", `/api/projects/${projectName}/requests/${rid}`, S.project); S.previews[rid] = { exported: r };
        commit((p) => { p.annotations.find((a) => a.id === rid).status = "exported"; }, `Change request written to editor/${r.request}`); } catch (err) { toast(err.message); }
    }
    if (act === "req-load" || act === "req-paste") {
      try {
        const patch = act === "req-load" ? await api("GET", `/api/projects/${projectName}/requests/${rid}/patch`) : JSON.parse($(`textarea[data-patch="${rid}"]`).value);
        const r = await api("POST", "/api/patch/validate", { project: S.project, request_id: rid, patch });
        S.previews[rid] = { ...S.previews[rid], patch, result: r }; toast(r.ok ? "Patch is valid. Review it, then Apply." : `Patch rejected (${r.errors.length} problem(s))`);
      } catch (err) { S.previews[rid] = { ...S.previews[rid], result: { ok: false, errors: [err.message] } }; toast(err.message); }
      renderRequests();
    }
    if (act === "req-apply") {
      const pv = S.previews[rid]; if (!pv?.result?.ok) return; const keep = S.project.annotations;
      commit((p) => { Object.assign(p, pv.result.project); p.annotations = keep.map((a) => a.id === rid ? pv.result.project.annotations.find((x) => x.id === rid) : a); }, "Applied validated patch (⌘Z to undo)");
      delete S.previews[rid];
    }
    // research requests
    if (act === "rr-show") { S.activeReq = rqid; const r = rr(rqid); const ph = r && byId(r.inserted_element_id || r.placeholder_element_id);
      if (ph && slideOf(ph) !== S.slide) setSlide(slideOf(ph)); showTab("requests"); renderRequests(); if (r?.placeholder_element_id || r?.inserted_element_id) select([r.inserted_element_id || r.placeholder_element_id].filter(byId)); }
    if (act === "rr-export") {
      try { const r = await api("POST", `/api/projects/${projectName}/research/${rqid}`, S.project); S.research[rqid] = { ...S.research[rqid], exported: r }; toast(`Research request written to editor/${r.request}`); renderRequests(); } catch (err) { toast(err.message); }
    }
    if (act === "rr-load" || act === "rr-fixture") {
      try {
        const response = act === "rr-load" ? await api("GET", `/api/projects/${projectName}/research/${rqid}/response`)
                                           : await api("POST", "/api/research/fixture", { name: $(`select[data-fixture="${rqid}"]`).value, request_id: rqid });
        const r = await api("POST", "/api/research/apply", { project: S.project, response });
        S.research[rqid] = { ...S.research[rqid], response, result: r, fixture: act === "rr-fixture" };
        toast(r.ok ? `Response is valid (${response.status}). Review, then insert.` : `Response rejected (${r.errors.length} problem(s))`);
      } catch (err) { S.research[rqid] = { ...S.research[rqid], result: { ok: false, errors: [err.message], warnings: [] } }; toast(err.message); }
      renderRequests();
    }
    if (act === "rr-apply") {
      const x = S.research[rqid]; if (!x?.result?.ok) return;
      replaceProject(x.result.project, x.response.status === "not_available" ? "Recorded: data not available (no chart created)" : "Inserted research-backed content (⌘Z to undo)");
      delete S.research[rqid]; const r = rr(rqid); if (r?.inserted_element_id) select([r.inserted_element_id]);
    }
    if (act === "rr-revert") {
      try { const r = await api("POST", "/api/research/revert", { project: S.project, request_id: rqid }); replaceProject(r.project, "Removed inserted content; request reopened"); } catch (err) { toast(err.message); }
    }
  });
  const RR_LABEL = { pending_research: ["Pending research", "ai"], fulfilled: ["Fulfilled", "ok"], partially_fulfilled: ["Partially fulfilled", "warn"], not_available: ["Not available", "warn"], open: ["Open", "ai"], closed: ["Closed", ""] };
  function researchCard(r) {
    const [lbl, cls] = RR_LABEL[r.status] || [r.status, ""], x = S.research[r.id] || {};
    const res = x.result ? (x.result.ok
      ? `<p><span class="chip ok">valid</span> ${esc(x.response.status)}${x.fixture ? ` <span class="chip err">TEST FIXTURE</span>` : ""} · ${(x.response.evidence || []).length} new evidence item(s)</p>` +
        (x.result.warnings.length ? `<pre>${esc(x.result.warnings.join("\n"))}</pre>` : "") +
        `<div class="row"><button data-side="rr-apply" data-rr="${r.id}" class="primary">${x.response.status === "not_available" ? "Record as not available" : "Insert into slide"}</button></div>`
      : `<p><span class="chip err">rejected</span></p><pre>${esc(x.result.errors.join("\n"))}</pre>`) : "";
    const legacy = !r.schema;  // research requests that came from the bundle gap or older edits
    if (legacy) return `<div class="card ai"><span class="chip ${cls}">${esc(lbl)}</span> ${esc(r.description || r.instruction)}<br><span class="hint">${esc(r.source || "")}${r.gap_id ? " · " + esc(r.gap_id) : ""}</span></div>`;
    return `<div class="card ai ${r.status === "fulfilled" ? "done" : ""}">
      <span class="chip ${cls}">${esc(lbl)}</span> <b>${esc(r.visualization || r.content_type || "content")}</b>
      <p style="margin:6px 0">${esc(r.instruction)}</p>
      <dl><dt>Company</dt><dd>${esc(r.company || "—")}</dd><dt>Period</dt><dd>${esc(r.period || "not specified")}</dd>
        <dt>Geography</dt><dd>${esc(r.geographic_scope || "—")}</dd><dt>Region</dt><dd>x${r.region.x} y${r.region.y} ${r.region.w}×${r.region.h}</dd>
        <dt>Needs</dt><dd>${esc((r.required_data || []).join("; "))}</dd>
        <dt>Existing evidence</dt><dd>${r.related_evidence_ids.length ? r.related_evidence_ids.map((i) => `<code>${esc(i)}</code>`).join(" ") : "none"}</dd>
        ${r.related_gaps.length ? `<dt>Known gaps</dt><dd>${r.related_gaps.map((g) => `<code>${esc(g)}</code>`).join(" ")}</dd>` : ""}
        <dt>Constraints</dt><dd>${esc((r.constraints || []).join(" "))}</dd>
        ${(r.unresolved || []).length ? `<dt>Unresolved</dt><dd>${r.unresolved.map((u) => `${esc(u.description)}: ${esc(u.reason)}${u.alternative ? ` <i>(try: ${esc(u.alternative)})</i>` : ""}`).join("<br>")}</dd>` : ""}</dl>
      <div class="row"><button data-side="rr-show" data-rr="${r.id}">Show on slide</button>
        ${["pending_research", "partially_fulfilled"].includes(r.status) ? `<button data-side="rr-export" data-rr="${r.id}">Send to Research Engine</button><button data-side="rr-load" data-rr="${r.id}">Load engine response</button>` : ""}
        ${r.placeholder_snapshot ? `<button data-side="rr-revert" data-rr="${r.id}">${r.status === "not_available" ? "Reopen request" : "Remove inserted content"}</button>` : ""}</div>
      ${x.exported ? `<p class="hint">Handoff file: editor/${esc(x.exported.request)}<br>Engine response expected at: editor/${esc(x.exported.response_expected_at)}</p>` : ""}
      ${["pending_research", "partially_fulfilled"].includes(r.status) ? `<details><summary>Simulate with a TEST FIXTURE response</summary><div class="row"><select data-fixture="${r.id}">${(S.fixtures || []).map((f) => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join("")}</select><button data-side="rr-fixture" data-rr="${r.id}">Load fixture</button></div><p class="hint">Fixtures are simulated engine output with synthetic data, for testing the insertion path only.</p></details>` : ""}
      ${res}
      <details><summary>History (${r.history.length})</summary><pre>${esc(r.history.map((h) => `${h.at}  ${h.event}${h.detail ? " — " + h.detail : ""}`).join("\n"))}</pre></details></div>`;
  }
  function layoutCard(a, i) {
    const scope = scopeIds(a), pv = S.previews[a.id] || {};
    const where = a.kind === "region" ? `Region ${a.rect.w}×${a.rect.h}` : `Selection`;
    const res = pv.result ? (pv.result.ok
      ? `<p><span class="chip ok">valid</span> ${esc(pv.patch.summary || "")} · ${pv.patch.ops.length} op(s)</p><div class="row"><button data-side="req-apply" data-req="${a.id}" class="primary">Apply patch</button></div>`
      : `<p><span class="chip err">rejected</span></p><pre>${esc(pv.result.errors.join("\n"))}</pre>`) : "";
    return `<div class="card layout ${a.status === "applied" ? "done" : ""}">
      <b>#${i + 1}</b> ${where} <span class="chip ${a.status === "applied" ? "ok" : "info"}">${esc(a.status)}</span> <span class="chip">${esc(INTENTS[a.intent || "layout"])}</span>
      <p class="hint">Scope: ${scope.map((s) => `<code>${esc(s)}</code>`).join(" ") || "empty area"}${a.uses_evidence ? `<br>Evidence to use: ${a.uses_evidence.map((x) => `<code>${esc(x)}</code>`).join(" ")}` : ""}</p>
      <textarea data-req="${a.id}">${esc(a.instruction)}</textarea>
      ${a.patch_summary ? `<p class="hint">Applied: ${esc(a.patch_summary)}</p>` : ""}
      <div class="row"><button data-side="req-focus" data-req="${a.id}">Show scope</button><button data-side="req-export" data-req="${a.id}" ${a.instruction ? "" : "disabled"}>Export for agent</button>
        <button data-side="req-load" data-req="${a.id}">Load agent patch</button><button data-side="req-del" data-req="${a.id}">Delete</button></div>
      ${pv.exported ? `<p class="hint">Request: editor/${esc(pv.exported.request)} · patch expected at editor/${esc(pv.exported.patch_expected_at)}. Suggested command (not run automatically):</p><pre>${esc(pv.exported.suggested_command)}</pre>` : ""}
      <details><summary>Paste patch JSON</summary><textarea data-patch="${a.id}"></textarea><button data-side="req-paste" data-req="${a.id}">Validate pasted patch</button></details>
      ${res}</div>`;
  }
  const TR_LABEL = { pending_adaptation: ["Pending AI adaptation", "ai"], cancelled: ["Cancelled", ""], adapted: ["Adapted", "ok"] };
  function transferCard(x) {
    const [lbl, cls] = TR_LABEL[x.status] || [x.status, ""], L = x.linked, ex = S.transfers[x.id] || {};
    const codes = (arr) => arr.length ? arr.map((i) => `<code>${esc(i)}</code>`).join(" ") : "none";
    return `<div class="card xfer ${x.status === "cancelled" ? "cancelled" : ""}">
      <span class="chip ${cls}">${esc(lbl)}</span> <b>${esc(x.mode_label)}</b>
      <p style="margin:6px 0">${x.instruction ? esc(x.instruction) : `<i>No instruction</i>: ${esc(x.intent)}`}</p>
      <dl><dt>From</dt><dd>${esc(slideName(x.source_slide_id))}${x.source_kept ? " (kept)" : ""}</dd>
        <dt>To</dt><dd>${esc(slideName(x.target_slide_id))}${x.target_is_new_slide ? " <span class=\"chip\">new slide</span>" : ""}</dd>
        <dt>Modules</dt><dd>${x.modules.map((m) => `${esc(m.type === "barchart" ? "chart" : m.type)}: ${esc(m.label)}`).join("<br>")}</dd>
        <dt>Evidence</dt><dd>${codes(L.evidence_ids)}</dd><dt>Claims</dt><dd>${codes(L.claim_ids)}</dd><dt>Metrics</dt><dd>${codes(L.metric_ids)}</dd>
        ${L.gap_ids.length ? `<dt>Gaps</dt><dd>${codes(L.gap_ids)}</dd>` : ""}
        <dt>Placeholders</dt><dd>${x.placeholder_element_ids.length ? x.placeholder_element_ids.map((i) => esc(byId(i)?.title || `${i} (removed)`)).join("<br>") : "none"}</dd>
        ${x.research_request_ids.length ? `<dt>Research</dt><dd>${x.research_request_ids.map((i) => `<code>${esc(i)}</code> ${esc(rr(i)?.status || "")}`).join("<br>")}</dd>` : ""}</dl>
      <div class="row"><button data-side="tr-show" data-tr="${x.id}">Show on slide</button>
        ${x.status === "pending_adaptation" ? `<button data-side="tr-export" data-tr="${x.id}">Send to AI (write handoff)</button><button data-side="tr-cancel" data-tr="${x.id}">Cancel request</button>` : ""}</div>
      ${ex.exported ? `<p class="hint">Handoff file: editor/${esc(ex.exported.request)}. No model is called; a future adaptation step reads this file.</p>` : ""}
      <details><summary>History (${x.history.length})</summary><pre>${esc(x.history.map((h) => `${h.at}  ${h.event}${h.detail ? " — " + h.detail : ""}`).join("\n"))}</pre></details></div>`;
  }
  function renderRequests() {
    const rs = S.project.research_requests, anns = S.project.annotations, ts = S.project.transfer_requests;
    const active = S.activeReq;
    const sortActive = (arr) => [...arr].sort((a, b) => (b.id === active) - (a.id === active));
    $("#pane-requests").innerHTML =
      `<div class="sec"><h5>Transfer requests (${ts.length})</h5>${ts.length ? sortActive([...ts].reverse()).map(transferCard).join("") : `<p class="hint">None. Drag modules onto another slide and choose an “Ask AI to adapt” option.</p>`}</div>` +
      `<div class="sec"><h5>Research requests (${rs.length})</h5>${rs.length ? sortActive(rs).map(researchCard).join("") : `<p class="hint">None. Draw an AI region and ask for content that needs new data.</p>`}</div>` +
      `<div class="sec"><h5>Layout change requests (${anns.length})</h5>${anns.length ? anns.map(layoutCard).join("") : `<p class="hint">None. Draw an AI region or use ✦ Ask AI on a selection.</p>`}</div>`;
  }
  let intTimer;
  function scheduleIntegrity() { clearTimeout(intTimer); intTimer = setTimeout(async () => { try { const r = await api("POST", "/api/integrity", S.project); S.integrity = r.integrity; renderIntegrity(); } catch (err) { /* server down */ } }, 250); }
  function renderIntegrity() {
    const issues = S.integrity, n = issues.filter((i) => i.level !== "info").length;
    $("#intCount").textContent = n ? `(${n})` : "✓";
    $("#pane-integrity").innerHTML = `<p class="hint">Checked by the local server (editor/slidemodel.py) after every change.</p>` +
      (issues.length ? issues.map((i) => `<div class="issue" data-el="${esc(i.element_id || "")}" data-slide="${esc(i.slide_id || "")}"><span class="chip ${i.level === "error" ? "err" : i.level === "warning" ? "warn" : "info"}">${i.level}</span> <code>${esc(i.code)}</code>${i.slide_id ? ` <span class="hint">slide ${slideIndex(i.slide_id) + 1}</span>` : ""}<br>${esc(i.message)}</div>`).join("")
        : `<p><span class="chip ok">clean</span> All figures are bound to verified evidence, citations intact, no unsourced numbers.</p>`) +
      `<div class="sec"><h5>Evidence on this slide</h5>${[...new Set(slideEls().flatMap(allRefs))].map((id) => `<div class="issue" data-ev="${esc(id)}"><code>${esc(id)}</code>${isFixture(id) ? ` <span class="chip err">TEST FIXTURE</span>` : ""}<br>${esc(ev(id)?.subject || "")} · ${esc(ev(id)?.period || "")}</div>`).join("")}</div>`;
  }
  $("#pane-integrity").addEventListener("click", (e) => { const d = e.target.closest(".issue");
    if (d?.dataset.slide && d.dataset.slide !== S.slide) { setSlide(d.dataset.slide); showTab("integrity"); }
    if (d?.dataset.el) select([d.dataset.el]); if (d?.dataset.ev) select(els().filter((x) => allRefs(x).includes(d.dataset.ev)).map((x) => x.id)); });
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

  // ------------------------------------------------------------------ keyboard + chrome
  document.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) actions[b.dataset.act]?.(); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable=true]"), mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return save(); }
    if (typing) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); return actions.duplicate(); }
    if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); return e.shiftKey ? actions.ungroup() : actions.group(); }
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); return actions.delete(); }
    if (e.key === "Escape") { if (!popover.hidden) return closePopover(); setMode("select"); return select([]); }
    if (e.key === "PageDown" || e.key === "PageUp") { const s = slides()[slideIndex(S.slide) + (e.key === "PageDown" ? 1 : -1)]; if (s) setSlide(s.id); return; }
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
    try { S.project = await api("GET", `/api/projects/${projectName}`); } catch (err) { toast(`Could not load project ${projectName}: ${err.message}`); return; }
    S.project.research_results ||= []; S.project.transfer_requests ||= [];
    S.saved = JSON.stringify(S.project);
    const q = new URLSearchParams(location.search);
    S.slide = (slides()[(+q.get("slide") || 1) - 1] || slides()[0]).id;
    try { S.fixtures = await api("GET", "/api/fixtures"); } catch { S.fixtures = []; }
    initTransform(); render(); fit(); status();
    const tab = q.get("tab"); if (["props", "requests", "integrity"].includes(tab)) showTab(tab);
    window.__editor = { S, select, actions, undo, redo, save, render, fmtValue, openPopover, exportPng, setMode, setSlide, openTransfer };  // for debugging/tests
  })();
})();
