// Static, high-fidelity mockups of the proposed workspace (docs/workspace-study/04-ux-concepts.md).
// ?state=chat|deck|data|chart|alternatives|tasks|fullscreen|grid
// All country figures are SYNTHETIC; AI messages are illustrative copy, not model output.
import { renderLineChart } from "../bench/svgchart.js";
import { annualDebt, dailyYields } from "../bench/bench.js";

const state = new URLSearchParams(location.search).get("state") || "chat";
const debt = annualDebt(), yields = dailyYields();
const last = (s) => s.values.filter((v) => v !== null).at(-1);
const fmt = (v, d = 1) => v.toFixed(d);
const yLast = Object.fromEntries(yields.series.map((s) => [s.name, last(s)]));
const dLast = Object.fromEntries(debt.series.map((s) => [s.name, last(s)]));
const deficit = { France: -5.1, Germany: -2.3, Italy: -3.6 };  // SYNTHETIC

// ------------------------------------------------------------------ slide content (1280×720)
const chart = (ds, w, h, title) => renderLineChart({ ...ds, title: title ?? ds.title, width: w, height: h }).svg;
const table = () => `<table><thead><tr><th>Fiscal snapshot</th><th>Debt/GDP</th><th>Balance</th><th>10Y</th></tr></thead><tbody>` +
  ["France", "Germany", "Italy"].map((c) => `<tr><td>${c}</td><td>${fmt(dLast[c])}</td><td>${fmt(deficit[c])}</td><td>${fmt(yLast[c], 2)}</td></tr>`).join("") +
  `</tbody></table><div class="note" style="margin-top:6px">% of GDP; 10Y yield in %, last observation. SAMPLE values.</div>`;
const bullets = `<div class="bul"><p>France's ratio keeps rising while Germany's is broadly flat: the gap is structural, not cyclical.</p>
  <p>Italy remains the most indebted, but its trajectory has stabilised over the sample.</p><p>Market pricing (slide 3) has only partly reflected the divergence.</p></div>`;
const head = (kicker, title, sub) => `<div class="el kicker" style="left:40px;top:28px">${kicker}</div>
  <div class="el title" style="left:40px;top:46px;width:1100px">${title}</div><div class="el sub" style="left:40px;top:86px">${sub}</div>
  <div class="el rule" style="left:40px;top:110px;width:1200px"></div>`;
const foot = `<div class="el note" style="left:40px;top:676px;width:1200px">Source: SAMPLE synthetic series generated for this mockup; not official statistics. Chart rendered deterministically from the dataset (gaps shown, no interpolation).</div>`;

export const LAYOUT = {
  chart: { x: 40, y: 128, w: 720, h: 420 }, table: { x: 784, y: 128, w: 456, h: 190 }, comment: { x: 784, y: 336, w: 456, h: 212 },
};
function slide2(variant = "hero", L = LAYOUT) {
  const h = head("France · debt dynamics", "France's debt ratio is diverging from core peers", "General government gross debt, % of GDP · annual, end of period · SAMPLE DATA");
  if (variant === "two") return `<div class="slide">${h}
    <div class="el box" style="left:40px;top:128px;width:590px;height:380px">${chart(debt, 588, 378, "Debt, % of GDP (SAMPLE)")}</div>
    <div class="el box" style="left:650px;top:128px;width:590px;height:380px">${chart(yields, 588, 378, "10Y yield, % daily (SAMPLE)")}</div>
    <div class="el" style="left:40px;top:528px;width:1200px;height:120px;background:#f3f5f8;border-left:4px solid #c8102e;padding:14px 18px;font-size:15px;line-height:1.5"><b>Conclusion.</b> Fiscal divergence is visible in the stock of debt; market pricing has moved by less. Watch the next budget cycle.</div>${foot}</div>`;
  if (variant === "table") return `<div class="slide">${h}
    <div class="el box" style="left:40px;top:128px;width:700px;height:300px;padding:14px">${table()}</div>
    <div class="el box" style="left:40px;top:446px;width:700px;height:200px">${chart(debt, 698, 198, "Debt, % of GDP (SAMPLE)")}</div>
    <div class="el" style="left:770px;top:128px;width:470px">${bullets}</div>${foot}</div>`;
  return `<div class="slide">${h}
    <div class="el box" style="left:${L.chart.x}px;top:${L.chart.y}px;width:${L.chart.w}px;height:${L.chart.h}px">${chart(debt, L.chart.w - 2, L.chart.h - 2)}</div>
    <div class="el box" style="left:${L.table.x}px;top:${L.table.y}px;width:${L.table.w}px;height:${L.table.h}px;padding:12px">${table()}</div>
    <div class="el" style="left:${L.comment.x}px;top:${L.comment.y}px;width:${L.comment.w}px">${bullets}</div>${foot}</div>`;
}
const slides = [
  { title: "Euro area overview", html: () => `<div class="slide">${head("Euro area · overview", "Sovereign divergence returns after the rate cycle", "SAMPLE DATA")}
    <div class="el box" style="left:40px;top:128px;width:760px;height:420px">${chart(debt, 758, 418)}</div>
    <div class="el" style="left:830px;top:140px;width:410px">${bullets}</div>${foot}</div>` },
  { title: "France debt dynamics", html: () => slide2() },
  { title: "Market pricing", html: () => `<div class="slide">${head("Markets · 10Y yields", "Yields have priced only part of the fiscal gap", "Daily, % · SAMPLE DATA")}
    <div class="el box" style="left:40px;top:128px;width:1200px;height:440px">${chart(yields, 1198, 438)}</div>${foot}</div>` },
  { title: "Ratings & outlook", html: () => `<div class="slide">${head("Ratings · outlook", "Rating history and outlook changes", "SAMPLE — research pending")}
    <div class="el" style="left:40px;top:140px;width:1200px;height:380px;border:1.5px dashed #6d3fd1;border-radius:6px;background:repeating-linear-gradient(135deg,#faf7ff,#faf7ff 8px,#f4eefd 8px,#f4eefd 16px);padding:20px;color:#4b2390;font-size:15px"><b>⟳ Pending research:</b> sovereign ratings and outlooks for France, Germany, Italy (3 agencies, last 10 years). No values shown until verified.</div>${foot}</div>` },
];

// ------------------------------------------------------------------ chrome
const scaled = (html, w) => `<div class="mini" style="transform:scale(${w / 1280})">${html}</div>`;
function rail(active = 1, opts = {}) {
  return `<aside id="rail"><h6>Slides</h6>` + slides.map((s, i) => `<div class="thumb ${i === active ? "on" : ""} ${opts.affected?.includes(i) ? "affected" : ""}">
    <div class="n">${i + 1}</div><div class="f">${scaled(s.html(), 160)}${opts.badges?.[i] || ""}</div><div class="t">${s.title}</div></div>`).join("") +
    `<button class="ghost small" style="text-align:left;color:var(--muted)">＋ New slide</button></aside>`;
}
function top(opts = {}) {
  return `<header id="top"><div class="logo"></div><span class="proj">France sovereign risk — Q3 review</span><span class="chip warn">SAMPLE</span>
    <span class="crumb">/ Slide 2 · France debt dynamics</span><span class="grow"></span>
    <button class="ghost" title="Undo">↶</button><button class="ghost" title="Redo">↷</button>
    <div class="seg"><button class="${opts.view === "grid" ? "" : "on"}">Slide</button><button class="${opts.view === "grid" ? "on" : ""}">Grid</button><button>Focus</button></div>
    <span class="taskpill"><span class="dot run"></span>3 running · <b style="color:var(--warn)">1 needs review</b></span>
    <button>Share</button><button class="primary">Export ▾</button></header>`;
}
const tabs = (on) => `<div class="ptabs">${["Chat", "Data", "Design", "Layers"].map((t) => `<button class="${t === on ? "on" : ""}">${t}</button>`).join("")}<span class="sp"></span><button class="ghost" title="Collapse panel">⇥</button></div>`;
const panel = (on, body) => `<aside class="panel"><div class="resize" title="Drag to resize"></div>${tabs(on)}<div class="pbody">${body}</div></aside>`;
function shelf() {
  return `<div id="shelf"><div class="lbl">Evidence shelf</div>
    <div class="card"><span class="chip ok">✓ verified</span><b>Debt/GDP · FR, DE, IT</b><span class="muted">annual · 2002–2026 · 3 series</span></div>
    <div class="card"><span class="chip ok">✓ verified</span><b>10Y yields · daily</b><span class="muted">3 series · 6,391 obs</span></div>
    <div class="card"><span class="chip ok">✓ verified</span><b>Claim: divergence is structural</b><span class="muted">2 evidence links</span></div>
    <div class="card prov"><span class="chip warn">provisional note</span><b>Budget slippage risk</b><span class="muted">analyst note · not a source</span></div>
    <div class="card idea"><span class="chip ai">needs research</span><b>5Y CDS, FR vs DE</b><span class="muted">no verified data yet</span></div>
    <div class="muted small" style="align-self:center">Drag a card onto a slide, or into Chat as context.</div></div>`;
}
function canvas(inner, opts = {}) {
  return `<div id="canvasWrap"><div id="stageBox"><div class="s1280" style="width:1280px;height:720px;position:absolute;left:0;top:0;transform-origin:0 0;box-shadow:0 6px 28px rgba(15,39,66,.16)">${inner}</div></div>${opts.extra || ""}<span class="zoom">Fit · 1280×720</span></div>`;
}
function selBox(r) { const hs = [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]];
  return `<div class="sel" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${hs.map(([a, b]) => `<i style="left:calc(${a * 100}% - 5px);top:calc(${b * 100}% - 5px)"></i>`).join("")}</div>`; }
const composer = (chips, text, scope = "Selection") => `<div class="composer">${chips}<div class="input">${text}</div>
  <div class="bar"><span class="scope">Scope: <b>${scope}</b> ▾</span><button class="ghost small" title="Attach image or file">📎</button><span style="flex:1"></span><button class="ai">Send</button></div></div>`;

// ------------------------------------------------------------------ states
const L2 = { chart: { x: 40, y: 128, w: 820, h: 420 }, table: { x: 884, y: 128, w: 356, h: 190 }, comment: { x: 884, y: 336, w: 356, h: 212 } };
const STATES = {
  chat() {
    const ghosts = `<div class="gbox" style="left:${L2.chart.x}px;top:${L2.chart.y}px;width:${L2.chart.w}px;height:${L2.chart.h}px"><span>Chart → 820 px wide · data unchanged</span></div>
      <div class="gbox shrink" style="left:${L2.table.x}px;top:${L2.table.y}px;width:${L2.table.w}px;height:${L2.table.h}px"><span>Table → 356 px</span></div>
      <div class="gbox shrink" style="left:${L2.comment.x}px;top:${L2.comment.y}px;width:${L2.comment.w}px;height:${L2.comment.h}px"><span>Text reflows</span></div>`;
    return { main: rail(1) + `<div id="center">${canvas(slide2() + selBox(LAYOUT.chart) + ghosts)}</div>` + panel("Chat", `
      <div class="muted small">Slide 2 conversation · shares project data with the deck thread</div>
      <div class="thread">
        <div class="msg user"><div class="who">You · 10:42</div><span class="ctx">▣ Chart · Debt/GDP</span><span class="ctx">▦ Table · Fiscal snapshot</span><br>Make the chart larger and the table narrower. Keep every number exactly as is.</div>
        <div class="msg ai"><div class="who">Slide AI · simulated</div>I can do that without touching the data. Preview is on: dashed outlines show the new positions.</div>
        <div class="proposal"><div class="hd">✦ Proposal · 3 objects <span class="chip ai">Selection</span><span style="flex:1"></span><span class="chip info">Previewing</span></div>
          <ul><li>Chart: 720 → 820 px wide (re-rendered from dataset)</li><li>Table: 456 → 356 px; columns tightened</li><li>Commentary: moved with table, text reflows</li></ul>
          <div class="inv"><span class="chip ok">✓ 9 evidence links unchanged</span><span class="chip ok">✓ no number changed</span><span class="chip ok">✓ nothing outside selection</span></div>
          <div class="row"><button class="primary">Apply</button><button>Reject</button><button>Regenerate</button><button class="ghost">Before / after</button></div></div>
      </div>${composer(`<div><span class="ctx">▣ Chart · Debt/GDP</span></div>`, "Ask about this slide, or describe a change…")}`) };
  },
  deck() {
    return { main: rail(1, { affected: [0, 1], badges: { 0: `<span class="badge chip ai">edit</span>`, 1: `<span class="badge chip ai">edit</span>` } }) +
      `<div id="center">${canvas(slide2())}</div>` + panel("Chat", `
      <div class="seg" style="align-self:flex-start"><button>Slide 2</button><button class="on">Whole deck</button></div>
      <div class="check"><b>Storyline</b>${slides.map((s, i) => `<div><span class="chip">${i + 1}</span>${s.title}<span class="muted small">— ${["Divergence returns", "France debt keeps rising", "Pricing lags fundamentals", "Ratings: pending research"][i]}</span></div>`).join("")}</div>
      <div class="thread">
        <div class="msg user"><div class="who">You</div>Page 2 should zoom in on France rather than repeat the euro-area overview. Reorganize the storyline without deleting evidence.</div>
        <div class="proposal"><div class="hd">✦ Deck proposal · 2 slides <span class="chip ai">Deck</span></div>
          <ul><li><b>Slide 1</b> keeps the 3-country chart; adds a one-line bridge to France</li><li><b>Slide 2</b> becomes France-only: debt chart (FR highlighted), fiscal table, drivers</li><li>Germany/Italy comparison moves to slide 1 notes; no evidence deleted</li></ul>
          <div class="inv"><span class="chip ok">✓ evidence set unchanged (21)</span><span class="chip ok">✓ claims unchanged</span><span class="chip warn">slides 3–4 untouched</span></div>
          <div class="row"><button class="primary">Review slide by slide</button><button>Apply all</button><button>Reject</button></div></div>
        <div class="check"><b>Consistency review</b><div><span class="chip warn">style</span>Slide 3 chart uses a different series colour for Italy</div><div><span class="chip warn">data</span>Slide 1 and 2 cite different vintages of the debt series</div><div><span class="chip ok">refs</span>Source notes follow DNA format</div></div>
      </div>${composer("", "Ask about the whole report…", "Deck")}`) };
  },
  data() {
    const row = (on, name, meta, st) => `<label class="${on ? "checked" : ""}"><input type="checkbox" ${on ? "checked" : ""}><span>${name}<br><span class="meta">${meta}</span></span>${st}</label>`;
    const preview = renderLineChart({ ...debt, title: "Preview · line chart", width: 372, height: 170 }).svg;
    return { main: rail(1) + `<div id="center">${canvas(slide2(), { extra: "" })}${shelf()}</div>` + panel("Data", `
      <div style="display:flex;gap:6px"><input style="flex:1;font:inherit;border:1px solid var(--line);border-radius:6px;padding:5px 8px" placeholder="Search datasets, claims, sources…"><button>Filter ▾</button></div>
      <div class="ds scrolly" style="max-height:290px"><div class="grp">Public debt · annual</div>
        ${row(true, "France · debt/GDP", "% of GDP · annual, end of period · 2002–2026", `<span class="chip ok">✓</span>`)}
        ${row(true, "Germany · debt/GDP", "% of GDP · annual, end of period · 2002–2026", `<span class="chip ok">✓</span>`)}
        ${row(true, "Italy · debt/GDP", "% of GDP · 1 missing year (gap kept)", `<span class="chip ok">✓</span>`)}
        <div class="grp">Market · daily</div>
        ${row(false, "10Y yields · FR, DE, IT", "% · daily close · 6,391 obs", `<span class="chip ok">✓</span>`)}
        ${row(false, "5Y CDS · FR, DE", "bp · not yet available", `<button class="small">Request research</button>`)}
        <div class="grp">Claims</div>${row(false, "Divergence is structural", "claim · 2 evidence links", `<span class="chip">claim</span>`)}</div>
      <div class="check"><b>3 selected · compatible</b><div><span class="chip ok">✓</span>Same unit (% of GDP) and frequency (annual)</div><div><span class="chip ok">✓</span>Same observation type (end of period)</div><div><span class="chip warn">!</span>Italy 2005 missing → shown as a gap</div></div>
      <div class="box" style="border:1px solid var(--line);border-radius:8px;padding:4px">${preview}</div>
      <div style="display:flex;gap:6px"><span class="seg"><button class="on">Line</button><button>Bar</button><button>Table</button><button>Metric</button></span><span style="flex:1"></span><button>Place…</button><button class="primary">Insert</button></div>`) };
  },
  chart() {
    const years = [2022, 2023, 2024, 2025, 2026];
    const val = (c, y) => debt.series.find((s) => s.name === c).values[debt.x.indexOf(y)];
    return { main: rail(1) + `<div id="center">${canvas(slide2() + selBox(LAYOUT.chart))}</div>` + panel("Design", `
      <div style="display:flex;align-items:center;gap:6px"><b>Line chart</b><span class="chip">ch.debt3</span><span style="flex:1"></span><span class="chip ok">🔒 values locked</span></div>
      <div class="seg" style="align-self:flex-start"><button class="on">Data</button><button>Style</button><button>Notes</button></div>
      <div class="check"><div><b>Series</b><span style="flex:1"></span><button class="small">＋ Add from Data</button></div>
        ${debt.series.map((s) => `<div><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block"></span>${s.name} · debt/GDP<span style="flex:1"></span><span class="chip ok">✓ verified</span></div>`).join("")}
        <div class="muted small">Range 2002–2026 · annual · end of period · gaps shown, never interpolated</div></div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:6px 8px"><table class="grid"><thead><tr><th>Year</th><th>France</th><th>Germany</th><th>Italy</th></tr></thead><tbody>
        ${years.map((y) => `<tr><td>${y}</td>${["France", "Germany", "Italy"].map((c) => y === 2024 && c === "France" ? `<td class="rev" title="User revision, pending verification">${fmt(val(c, y) + 0.4)}*</td>` : `<td>${fmt(val(c, y))}</td>`).join("")}</tr>`).join("")}
        <tr><td>2005</td><td>${fmt(val("France", 2005))}</td><td>${fmt(val("Germany", 2005))}</td><td class="gap">missing</td></tr></tbody></table>
        <div class="small" style="margin-top:6px"><span class="chip warn">* user revision</span> France 2024: ${fmt(val("France", 2024))} → ${fmt(val("France", 2024) + 0.4)} · reason "updated vintage" · <b>pending verification</b>; original kept</div></div>
      <div class="check"><b>Source</b><div class="muted small">SAMPLE synthetic series (mockup). Real projects show source, table id, vintage and page here.</div><button class="small" style="align-self:flex-start">Verify all values against sources</button></div>
      <div class="check"><b>Style (re-renders from data)</b><div>Series colours <span style="flex:1"></span><span class="chip">DNA: series.1–3</span></div><div>Labels <span style="flex:1"></span><span class="chip info">end of line</span></div><div>Y axis <span style="flex:1"></span><span class="chip">auto · not zero-based</span></div></div>`) };
  },
  alternatives() {
    const alt = (v, name, why) => `<div style="display:flex;flex-direction:column;gap:6px;width:400px"><div style="width:400px;height:225px;border:1px solid var(--line);border-radius:6px;overflow:hidden;position:relative">${scaled(slide2(v), 400)}</div>
      <b>${name}</b><span class="muted small">${why}</span><div class="inv"><span class="chip ok">✓ same 9 evidence links</span><span class="chip ok">✓ same claims</span><span class="chip ok">✓ no number edits</span></div></div>`;
    return { main: rail(1) + `<div id="center">${canvas(slide2())}</div>` + panel("Chat", `<div class="thread"><div class="msg user"><div class="who">You</div>Show me three better layouts for this page.</div><div class="msg ai"><div class="who">Slide AI · simulated</div>Three strategies, same verified content. Opened side by side.</div></div>${composer("", "Ask about this slide…", "Slide")}`),
      overlay: `<div class="overlay"><div class="modal" style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">Layout alternatives · Slide 2</b><span class="chip ai">same verified content</span><span style="flex:1"></span><button class="ghost">✕</button></div>
        <div style="display:flex;gap:18px">${alt("hero", "A · Hero chart + evidence", "One proof: the trajectory. Table and commentary support it.")}${alt("two", "B · Two charts + conclusion", "Fundamentals vs pricing side by side; conclusion band.")}${alt("table", "C · Comparison table first", "Leads with the cross-country numbers; chart as context.")}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button>Regenerate</button><button>Compare with current</button><button class="primary">Use B</button></div></div></div>` };
  },
  tasks() {
    const working = `<div class="working" style="left:${LAYOUT.table.x}px;top:${LAYOUT.table.y}px;width:${LAYOUT.table.w}px;height:${LAYOUT.table.h}px"><span>⟳ Verifying values…</span></div>`;
    const badges = { 0: `<span class="badge chip ai">⟳</span>`, 1: `<span class="badge chip ai">⟳</span>`, 2: `<span class="badge chip warn">review</span>`, 3: `<span class="badge chip ok">✓</span>` };
    const t = (dot, title, sub, right, pct) => `<div class="task"><span class="dot ${dot}" style="margin-top:5px"></span><div><b>${title}</b><br><span class="muted small">${sub}</span></div><div>${right}</div>${pct != null ? `<div class="bar2"><i style="width:${pct}%"></i></div>` : ""}</div>`;
    return { main: rail(1, { badges }) + `<div id="center">${canvas(slide2() + working)}</div>` + panel("Chat", `<div class="thread"><div class="msg user"><div class="who">You</div><span class="ctx">▦ Table · Fiscal snapshot</span> Verify every value in this table against the original sources.</div><div class="msg ai"><div class="who">Slide AI · simulated</div>Started task “Verify fiscal snapshot”. You can keep editing; I'll propose corrections when done.</div></div>${composer("", "Ask about this slide…")}`),
      overlay: `<div class="popover" style="right:180px;top:52px;width:420px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b>AI tasks</b><span class="chip">4</span><span style="flex:1"></span><span class="muted small">All slides ▾</span></div>
        ${t("run", "Slide 1 · Research missing indicators", "primary balance, interest burden · 2 of 4 sources checked", `<span class="chip ai">running</span>`, 55)}
        ${t("run", "Slide 2 · Verify fiscal snapshot", "9 values · table locked for AI edits", `<span class="chip ai">running</span>`, 30)}
        ${t("warn", "Slide 3 · Three layout alternatives", "ready · 3 proposals", `<button class="small primary">Review</button>`)}
        ${t("ok", "Slide 4 · Citation review", "12 references reformatted to DNA style", `<span class="chip ok">applied</span>`)}
        <div class="check" style="margin-top:8px;border-color:#f0c36d;background:var(--warn-soft)"><div><span class="chip warn">conflict</span><b>You edited the table while verification was running</b></div><div class="small">The verification result was computed on the previous values. <button class="small">Re-run on current</button> <button class="small">Compare</button></div></div></div>` };
  },
  fullscreen() {
    return { main: `<div id="center" style="background:#1d232c">${canvas(slide2() + selBox(LAYOUT.chart), { extra: `
      <div class="floatbar" style="left:50%;transform:translateX(-50%);top:14px"><button>↖ Select</button><button>T Text</button><button>▭ Shape</button><button>▤ Chart</button><button>▦ Table</button><span class="sep"></span><button>Align ▾</button><button>Arrange ▾</button><span class="sep"></span><button>⇲ Exit focus (F)</button></div>
      <div class="floatbar" style="right:18px;bottom:18px;flex-direction:column;width:300px;padding:10px;gap:6px"><div style="display:flex;align-items:center;gap:6px"><b>Slide 2 chat</b><span class="chip ai">1 proposal</span><span style="flex:1"></span><button class="ghost small">⤢</button></div><div class="small muted">“Chart → 820 px, table → 356 px” is ready to preview.</div><div style="display:flex;gap:6px"><button class="small primary">Preview</button><button class="small">Open chat (⌘J)</button></div></div>
      <div class="floatbar" style="left:18px;bottom:18px"><button>◀ 1</button><b style="padding:4px 6px">2 / 4</b><button>3 ▶</button></div>` })}</div>`, dark: true };
  },
  grid() {
    return { main: `<div id="center" style="padding:24px;overflow:hidden"><div style="display:grid;grid-template-columns:repeat(2, 560px);gap:22px 28px;justify-content:center">
      ${slides.map((s, i) => `<div style="display:flex;flex-direction:column;gap:6px"><div style="width:560px;height:315px;border:1px solid ${i === 1 ? "var(--accent)" : "var(--line)"};border-radius:6px;overflow:hidden;position:relative;background:#fff;${i === 1 ? "box-shadow:0 0 0 3px var(--accent-soft)" : ""}">${scaled(s.html(), 560)}</div>
        <div style="display:flex;gap:6px;align-items:center"><span class="chip">${i + 1}</span><b>${s.title}</b><span class="muted small">${["Divergence returns", "France debt keeps rising", "Pricing lags fundamentals", "Ratings: pending research"][i]}</span></div></div>`).join("")}</div></div>`, view: "grid" };
  },
};

// ------------------------------------------------------------------ mount + fit
const S = STATES[state]();
document.body.innerHTML = (S.dark ? "" : top({ view: S.view })) + `<div id="main">${S.main}${S.overlay || ""}</div><div class="sample">Mockup · SAMPLE data · AI responses illustrative</div>`;
function fit() {
  const box = document.querySelector("#stageBox"); if (!box) return;
  const wrap = box.parentElement, s = Math.min((wrap.clientWidth - 48) / 1280, (wrap.clientHeight - 40) / 720);
  box.style.cssText = `width:${1280 * s}px;height:${720 * s}px;position:relative`;
  box.querySelector(".s1280").style.transform = `scale(${s})`;
  box.querySelectorAll(".sel i, .gbox span, .working span").forEach((n) => { n.style.transform = `scale(${1 / s})`; n.style.transformOrigin = "0 100%"; });
}
fit(); addEventListener("resize", fit); document.title = `Workspace mockup · ${state}`;
