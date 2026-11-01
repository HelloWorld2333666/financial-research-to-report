// Scripted scenarios for screenshots and end-to-end smoke checks (never saves the project).
//   /workspace/index.html?scenario=smoke   → runs checks, writes JSON into <pre id="scenario-result">
//   ?scenario=chat|data|sheet|table|dna|focus → sets up a visual state for screenshots
// Headless: chrome --headless=new --dump-dom --virtual-time-budget=20000 "<url>?scenario=smoke"
// The checks drive the same DOM handlers a user triggers (inputs + Enter, buttons, in-place editing).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const btn = (scope, text) => $$(`${scope} button`).find((b) => b.textContent.trim().includes(text));
const typeInto = async (inp, val) => { inp.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, val);
  inp.dispatchEvent(new Event("input", { bubbles: true })); await sleep(20); inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(150); };
const chartOpt = (id) => { const n = $(`#canvasWrap .el[data-id="${id}"] .el-chart > div`); return n && echarts.getInstanceByDom(n)?.getOption(); };
const sheetRow = (label) => $$(".sheet tbody tr").find((tr) => tr.querySelector("td.date")?.textContent === label || tr.querySelector("input")?.value === label);
async function chat(text) { const ta = $(".composer textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true })); await sleep(50); $(".composer .send").click(); await sleep(250); }

const SCENARIOS = {
  async chat(S) { S.ui({ slide: "s-france-debt", panel: "chat", selected: ["el-debt-chart", "el-debt-table"] }); await sleep(300);
    await chat("Make the chart larger and the table narrower"); btn(".proposal", "Preview").click(); await sleep(200); },
  async data(S) { S.ui({ slide: "s-france-debt", panel: "data", selected: [], checked: ["ds.fr.debt_gdp", "ds.de.debt_gdp", "ds.it.debt_gdp"] }); await sleep(400); },
  async sheet(S) { S.ui({ slide: "s-france-debt", panel: "props", selected: ["el-debt-chart"], sheet: "el-debt-chart" }); await sleep(400); },
  async table(S) { S.ui({ slide: "overview", panel: "props", selected: ["cr-table"] }); await sleep(400); },
  async dna(S) { S.ui({ slide: "s-france-debt", panel: "design", selected: [] }); await sleep(300); btn(".design", "Editorial").click(); await sleep(400); },
  async focus(S) { S.ui({ slide: "s-markets", focus: true }); await sleep(300); },

  async smoke(S) {
    const r = {}, check = (k, ok, detail = "") => { r[k] = { ok: !!ok, detail: String(detail).slice(0, 160) }; };
    const P = () => S.get().project, el = (id) => P().elements.find((e) => e.id === id);

    // A. in-place text editing (double-click path → contentEditable → commit → remount)
    S.ui({ slide: "overview", selected: [] }); await sleep(200);
    window.__startEdit("title", '[data-field="text"]'); await sleep(50);
    const node = $('#canvasWrap .el[data-id="title"] [data-field="text"]');
    check("text_edit_starts", node?.isContentEditable);
    node.textContent = "Edited heading"; node.dispatchEvent(new FocusEvent("blur")); await sleep(200);  // scripted runs have no window focus, so .blur() would not fire
    check("text_edit_commits", el("title").text === "Edited heading" && $('#canvasWrap .el[data-id="title"]').innerText === "Edited heading", el("title").text);
    window.__ws.E.setProp(S, "title", "Font size", (x) => { x.style = { ...x.style, fontSize: 30 }; }); await sleep(100);
    check("text_style_applies", getComputedStyle($('#canvasWrap .el[data-id="title"] .el-text')).fontSize === "30px");

    // B. table editing in the Properties grid (sourced cell → working edit; header; row)
    S.ui({ selected: ["cr-table"], panel: "props" }); await sleep(300);
    const bodyRows = () => $$(".tg tbody tr");
    await typeInto(bodyRows()[0].querySelectorAll("input.cell")[1], "85.2");
    const cell = el("cr-table").rows[0].cells[0];
    check("table_cell_working_edit", cell.working?.value === 85.2 && cell.evidence_id === "ev.cr.cr.overseas_pc_chaucer.fy2024" && P().evidence[cell.evidence_id].value === 84.71, JSON.stringify(cell.working));
    await typeInto($$(".tg thead input.cell")[1], "2024 (FY)");
    check("table_header_rename", el("cr-table").columns[1] === "2024 (FY)");
    const nRows = el("cr-table").rows.length; btn(".tg-tools", "Row").click(); await sleep(150);
    check("table_add_row", el("cr-table").rows.length === nRows + 1);
    check("one_undo_step_per_cell_edit", S.get().history.filter((h) => h.label === "Edited table cell").length === 2, S.get().history.map((h) => h.label).join(", "));

    // C. bar chart Edit data: edit a value, remove a category, source intact
    S.ui({ slide: "s-france-debt", selected: ["el-debt-bar"], sheet: "el-debt-bar" }); await sleep(300);
    check("bar_chart_rendered", chartOpt("el-debt-bar")?.series[0].data.length === 3);
    await typeInto(sheetRow("France").querySelector("td.dc input"), "110.5");
    check("bar_draft_updates", chartOpt("el-debt-bar").series[0].data[0].value === 110.5, JSON.stringify(chartOpt("el-debt-bar").series[0].data.map((d) => d.value)));
    sheetRow("Germany").querySelector('button[title="Remove category"]').click(); await sleep(200);
    check("bar_remove_category", chartOpt("el-debt-bar").xAxis[0].data.join() === "France,Italy");
    check("bar_source_intact", P().datasets["ds.fr.debt_gdp"].observations.find((o) => o.date === "2026").value === 103.1 && P().datasets["ds.de.debt_gdp"].observations.length === 25);
    check("table_chart_consistency", $('#canvasWrap .el[data-id="el-debt-table"] td[data-cell="0:2"]').textContent.startsWith("110.5") && chartOpt("el-debt-chart").series[0].data.at(-1) === 110.5);

    // D. line chart Edit data: edit one observation, gaps kept, add/remove series
    S.ui({ sheet: null }); await sleep(200); S.ui({ selected: ["el-debt-chart"], sheet: "el-debt-chart" }); await sleep(500);  // let the sheet remount for the new chart
    const before = chartOpt("el-debt-chart").series.map((s) => s.data.slice());
    await typeInto(sheetRow("2010").querySelectorAll("td.dc input")[1], "66.6");
    const after = chartOpt("el-debt-chart").series.map((s) => s.data);
    check("line_single_point_changes", after[1][8] === 66.6 && before.every((s, i) => s.every((v, j) => (i === 1 && j === 8) || v === after[i][j])));
    check("line_gap_not_fabricated", after[2][3] === null);
    $$(".sheet thead th").find((th) => th.querySelector("input")?.value === "Italy").querySelector('button[title="Remove series"]').click(); await sleep(200);
    const sel = $(".sheet .sh-tools select.btn"); sel.value = "__manual"; sel.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    await typeInto($$(".sheet .sh-tools input").find((i) => i.placeholder === "New series name"), "Spain"); await sleep(150);
    await typeInto(sheetRow("2026").querySelectorAll("td.dc input")[2], "107");
    const names = chartOpt("el-debt-chart").series.map((s) => s.name);
    check("line_add_remove_series", names.join() === "France,Germany,Spain" && chartOpt("el-debt-chart").series[2].data.filter((v) => v !== null).length === 1, names);

    // E. AI proposal → preview → apply, then manual edits on the same objects
    S.ui({ sheet: null, panel: "chat", selected: ["el-debt-comment"] }); await sleep(300);
    await chat("Move the commentary down"); btn(".proposal", "Preview").click(); await sleep(100);
    check("ai_preview_ghost", $$(".gbox").length === 1);
    btn(".proposal", "Apply").click(); await sleep(200);
    check("ai_applied", el("el-debt-comment").y === 536 && S.get().history.at(-1).label.startsWith("AI layout"));
    window.__startEdit("el-debt-comment", '[data-field="text"]'); await sleep(50);
    const cn = $('#canvasWrap .el[data-id="el-debt-comment"] [data-field="text"]'); cn.textContent = "Manual wording after AI"; cn.dispatchEvent(new FocusEvent("blur")); await sleep(200);
    window.__ws.E.setProp(S, "el-debt-comment", "Moved", (x) => { x.y = 496; }); await sleep(100);
    check("manual_edit_after_ai", el("el-debt-comment").text === "Manual wording after AI" && el("el-debt-comment").y === 496);
    await chat("Move the commentary down"); window.__ws.E.setProp(S, "el-debt-comment", "Moved by hand", (x) => { x.y = 480; }); await sleep(100);
    $$(".proposal button").filter((b) => b.textContent.trim() === "Apply").at(-1).click(); await sleep(150);
    check("stale_proposal_refused", P().threads["s-france-debt"].messages.at(-1).proposal.status === "stale");

    // F. clipboard, group/ungroup, undo/redo, move between slides (keyboard shortcuts)
    const key = (k, mods = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...mods }));
    S.ui({ slide: "overview", selected: ["kpi-roe"], panel: "props" }); await sleep(200);
    const n0 = P().elements.length; key("c", { metaKey: true }); key("v", { metaKey: true }); await sleep(150);
    const copyId = S.get().ui.selected[0], copy = el(copyId);
    check("copy_paste", P().elements.length === n0 + 1 && copy?.evidence_id === "ev.cr.roe.fy2025" && copy.x === el("kpi-roe").x + 16);
    S.ui({ selected: [copyId, "kpi-assets"] }); key("g", { metaKey: true }); await sleep(100);
    check("group", el(copyId).group && el(copyId).group === el("kpi-assets").group);
    key("g", { metaKey: true, shiftKey: true }); await sleep(100);
    check("ungroup", !el(copyId).group && !el("kpi-assets").group);
    key("z", { metaKey: true }); await sleep(100);
    check("undo", !!el(copyId).group);
    key("z", { metaKey: true, shiftKey: true }); await sleep(100);
    check("redo", !el(copyId).group);
    window.__ws.E.moveToSlide(S, [copyId], "s-markets"); await sleep(100);
    S.ui({ slide: "s-markets" }); await sleep(200);
    check("move_to_slide", el(copyId).slide_id === "s-markets" && !!$(`#canvasWrap .el[data-id="${copyId}"]`));

    // Design DNA restyles every slide, chart values unchanged
    S.ui({ slide: "s-france-debt", panel: "design", selected: [] }); await sleep(250);
    const d0 = JSON.stringify(chartOpt("el-debt-chart").series.map((s) => s.data)); btn(".design", "Editorial").click(); await sleep(250);
    check("dna_restyles_and_keeps_values", $$("#left .r-kicker").every((k) => getComputedStyle(k).color === "rgb(11, 122, 117)") && JSON.stringify(chartOpt("el-debt-chart").series.map((s) => s.data)) === d0);
    return r;
  },
};

export async function run(name, store) {
  await sleep(500);
  const res = await SCENARIOS[name]?.(store);
  await sleep(300); window.__ws.moveable?.updateRect();  // re-measure after late layout (headless capture)
  if (res) {
    const pre = document.createElement("pre"); pre.id = "scenario-result"; pre.textContent = JSON.stringify(res); pre.hidden = true;
    document.body.appendChild(pre); window.__scenario = res;
  }
}
