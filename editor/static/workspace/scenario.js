// Scripted scenarios for screenshots and end-to-end smoke checks (never saves the project).
//   /workspace/index.html?scenario=smoke   → runs checks, writes JSON into <pre id="scenario-result">
//   ?scenario=chat|data|chart|dna|focus    → sets up a visual state for screenshots
// Headless: chrome --headless=new --dump-dom --virtual-time-budget=15000 "<url>?scenario=smoke"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const btn = (scope, text) => $$(`${scope} button`).find((b) => b.textContent.trim().includes(text));
async function chat(text) {
  const ta = $(".composer textarea"); ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true })); await sleep(50);
  btn(".composer", "Send").click(); await sleep(250);
}
const chartData = (id) => { const n = $(`#canvasWrap .el[data-id="${id}"] .el-chart > div`); return n && JSON.stringify(echarts.getInstanceByDom(n).getOption().series.map((s) => s.data)); };

const SCENARIOS = {
  async chat(S) {
    S.ui({ slide: "s-france-debt", panel: "chat", selected: ["el-debt-chart", "el-debt-table"] }); await sleep(300);
    await chat("Make the chart larger and the table narrower");
    btn(".proposal", "Preview").click(); await sleep(200);
  },
  async data(S) {
    S.ui({ slide: "s-france-debt", panel: "data", selected: [], checked: ["ds.fr.debt_gdp", "ds.de.debt_gdp", "ds.it.debt_gdp"] }); await sleep(400);
  },
  async chart(S) {
    S.ui({ slide: "s-france-debt", panel: "design", selected: ["el-debt-chart"], chartTab: "data" }); await sleep(400);
  },
  async dna(S) {
    S.ui({ slide: "s-france-debt", panel: "design", selected: [] }); await sleep(300);
    btn(".design", "Try alternative").click(); await sleep(400);
  },
  async focus(S) { S.ui({ slide: "s-markets", focus: true }); await sleep(300); },

  async smoke(S) {
    const r = {}, check = (k, ok, detail = "") => { r[k] = { ok: !!ok, detail }; };
    // 1. Data → deterministic chart
    S.ui({ slide: "s-markets", panel: "data", selected: [], checked: ["ds.fr.debt_gdp", "ds.fr.primary_balance_q"] }); await sleep(300);
    check("incompatible_mix_blocked", $(".check.bad") && !btn(".data", "Insert on slide"), $(".check")?.textContent);
    S.ui({ checked: ["ds.fr.debt_gdp", "ds.de.debt_gdp", "ds.it.debt_gdp"] }); await sleep(300);
    btn(".data", "Insert on slide").click(); await sleep(400);
    const p = S.get().project, el = p.elements.at(-1), spec = p.charts[el.chart_id];
    check("chart_inserted_without_values", el.type === "chart" && !JSON.stringify(spec).includes('"values"'), `${el.x},${el.y} ${el.w}x${el.h}`);
    check("parity", /✓ 74 plotted points = 74/.test($(".design .check")?.textContent || ""), $(".design .check")?.textContent);
    // 2. restyle keeps data
    const d0 = chartData(el.id); S.ui({ chartTab: "style" }); await sleep(200);
    btn(".design .seg", "bar").click(); await sleep(300);
    check("restyle_keeps_values", chartData(el.id) === d0);
    // 3. chat proposal → preview → apply → undo
    S.ui({ slide: "s-france-debt", panel: "chat", selected: ["el-debt-chart", "el-debt-table"] }); await sleep(300);
    const before = S.get().project; await chat("Make the chart larger and the table narrower");
    btn(".proposal", "Preview").click(); await sleep(150);
    check("preview_ghosts", $$(".gbox").length === 3, `${$$(".gbox").length} ghosts`);
    btn(".proposal", "Apply").click(); await sleep(250);
    const after = S.get().project, untouched = after.elements.filter((e) => !["el-debt-chart", "el-debt-table", "el-debt-comment"].includes(e.id));
    check("apply_changes_only_scope", untouched.every((e) => before.elements.includes(e)) && after.elements.find((e) => e.id === "el-debt-chart").w > 720);
    check("apply_keeps_data", after.datasets === before.datasets && after.charts["ch.debt"] === before.charts["ch.debt"]);
    S.undo(); await sleep(200);
    check("undo_restores", JSON.stringify(S.get().project.elements) === JSON.stringify(before.elements));  // inverse patches recreate equal objects
    // 4. stale proposal
    await chat("make the chart larger");
    S.commit("Moved chart by hand", (d) => { d.elements.find((e) => e.id === "el-debt-chart").x += 5; }); await sleep(200);
    $$(".proposal button").filter((b) => b.textContent.trim() === "Apply").at(-1).click(); await sleep(200);
    check("stale_proposal_refused", S.get().project.threads["s-france-debt"].messages.at(-1).proposal.status === "stale");
    // 5. DNA restyles all slides, data unchanged
    S.ui({ panel: "design", selected: [] }); await sleep(250);
    const c0 = chartData("el-debt-chart"); btn(".design", "Try alternative").click(); await sleep(300);
    check("dna_restyles_thumbnails", $$("#rail .r-kicker").every((k) => getComputedStyle(k).color === "rgb(11, 122, 117)"));
    check("dna_keeps_values", chartData("el-debt-chart") === c0);
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
