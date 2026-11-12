// Rendering benchmark for the workspace study (docs/workspace-study/07-benchmark.md).
// All France/Germany/Italy numbers here are SYNTHETIC (seeded PRNG); they exercise
// rendering cost only and must never be read as data.
import { renderLineChart } from "./svgchart.js";

const now = () => performance.now();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2); };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ synthetic datasets
export function annualDebt() {
  const years = Array.from({ length: 25 }, (_, i) => 2002 + i), r = rng(7);
  const walk = (start, drift) => years.map((_, i) => +(start + drift * i + (r() - 0.5) * 6).toFixed(1));
  const it = walk(105, 1.1); it[3] = null;  // one missing observation: must break the line, not be bridged
  return { x: years, xType: "category", unit: "% of GDP (SYNTHETIC)", title: "General government debt, 2002–2026 (SYNTHETIC SAMPLE)",
    series: [{ name: "France", color: "#1f4e9c", values: walk(60, 2.0) }, { name: "Germany", color: "#c8102e", values: walk(60, 0.2) }, { name: "Italy", color: "#2e8b57", values: it }] };
}
export function dailyYields() {
  const x = []; for (let t = Date.UTC(2002, 0, 1); t <= Date.UTC(2026, 5, 30); t += 864e5) { const d = new Date(t).getUTCDay(); if (d && d < 6) x.push(t); }
  const r = rng(11), walk = (start) => { let v = start; return x.map(() => +(v += (r() - 0.5) * 0.06).toFixed(3)); };
  return { x, xType: "time", unit: "% (SYNTHETIC)", title: "10-year government bond yield, daily (SYNTHETIC SAMPLE)",
    series: [{ name: "France", color: "#1f4e9c", values: walk(4.9) }, { name: "Germany", color: "#c8102e", values: walk(4.8) }, { name: "Italy", color: "#2e8b57", values: walk(5.1) }] };
}

// ------------------------------------------------------------------ chart renderers
function box(w, h) { const d = document.createElement("div"); d.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-10000px;top:0`; document.body.appendChild(d); return d; }
const RENDERERS = {
  "hand-svg": {
    mount(el, ds, w, h) { const r = renderLineChart({ ...ds, width: w, height: h }); el.innerHTML = r.svg; el.firstChild.getBBox(); return { points: r.plottedPoints }; },
    resize(el, ds, w, h) { return this.mount(el, ds, w, h); },
  },
  ...Object.fromEntries(["svg", "canvas"].flatMap((renderer) => [false, true].map((lttb) => [`echarts-${renderer}${lttb ? "-lttb" : ""}`, {
    mount(el, ds, w, h) {
      const c = echarts.init(el, null, { renderer, width: w, height: h });
      const time = ds.xType === "time";
      c.setOption({ animation: false, title: { text: ds.title, textStyle: { fontSize: 11 } }, grid: { left: 44, right: 96, top: 28, bottom: 26 },
        xAxis: { type: time ? "time" : "category", data: time ? undefined : ds.x }, yAxis: { type: "value", scale: true },
        series: ds.series.map((s) => ({ type: "line", name: s.name, showSymbol: false, connectNulls: false, sampling: lttb ? "lttb" : undefined,
          lineStyle: { width: 1.6, color: s.color }, data: time ? s.values.map((v, i) => [ds.x[i], v]) : s.values })) });
      el._chart = c; return {};
    },
    resize(el, ds, w, h) { el._chart.resize({ width: w, height: h }); return {}; },
  }]))),
};

export async function chartSuite(runs = 7) {
  const out = [];
  for (const [dsName, ds] of [["annual 3×25", annualDebt()], ["daily 3×" + dailyYields().x.length, dailyYields()]]) {
    for (const [name, R] of Object.entries(RENDERERS)) {
      if (ds.xType === "category" && name.endsWith("-lttb")) continue;
      const mount = [], resize = [];
      let info = {};
      for (let i = 0; i < runs; i++) {
        const el = box(760, 380);
        let t = now(); info = R.mount(el, ds, 760, 380); mount.push(now() - t);
        t = now(); R.resize(el, ds, 560, 300); resize.push(now() - t);
        el._chart?.dispose(); el.remove(); await frame();
      }
      out.push({ suite: "chart", dataset: dsName, renderer: name, mount_ms: median(mount), resize_ms: median(resize), ...info });
    }
  }
  return out;
}

// ------------------------------------------------------------------ dense financial table (DOM)
export async function tableSuite(runs = 9) {
  const r = rng(3), cols = ["Country", "Rating", "Outlook", "Debt/GDP", "Deficit", "10Y", "5Y CDS", "Updated"];
  const rows = Array.from({ length: 60 }, (_, i) => [`Country ${i + 1}`, "AA", "Stable", ...Array.from({ length: 4 }, () => (r() * 120).toFixed(1)), "2026-06-30"]);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const el = box(900, 1400);
    const t = now();
    el.innerHTML = `<table style="font:10.5px Helvetica;border-collapse:collapse"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((row) => `<tr>${row.map((c) => `<td style="padding:3px 6px;border-bottom:1px solid #e3e7ed">${c}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
    el.offsetHeight;  // force layout
    times.push(now() - t); el.remove(); await frame();
  }
  return [{ suite: "table", case: "60 rows × 8 cols, DOM", render_ms: median(times) }];
}

// ------------------------------------------------------------------ scene: DOM vs Konva (objects on a 1280×720 slide)
export async function sceneSuite(runs = 5) {
  const out = [];
  for (const n of [25, 400]) {
    const res = { dom: { mount: [], move: [] }, konva: { mount: [], move: [] } };
    for (let k = 0; k < runs; k++) {
      // DOM
      const host = box(1280, 720);
      let t = now();
      host.innerHTML = Array.from({ length: n }, (_, i) => `<div style="position:absolute;left:${(i * 37) % 1200}px;top:${(i * 53) % 680}px;width:72px;height:28px;background:#eef2f7;border:1px solid #d5dbe3;font:10px Helvetica">Item ${i}</div>`).join("");
      host.offsetHeight; res.dom.mount.push(now() - t);
      const node = host.children[0], moves = [];
      for (let i = 0; i < 60; i++) { t = now(); node.style.left = `${100 + i}px`; node.getBoundingClientRect(); moves.push(now() - t); }
      res.dom.move.push(median(moves)); host.remove();
      // Konva
      const kh = box(1280, 720);
      t = now();
      const stage = new Konva.Stage({ container: kh, width: 1280, height: 720 }), layer = new Konva.Layer();
      for (let i = 0; i < n; i++) {
        const g = new Konva.Group({ x: (i * 37) % 1200, y: (i * 53) % 680, draggable: true });
        g.add(new Konva.Rect({ width: 72, height: 28, fill: "#eef2f7", stroke: "#d5dbe3" }), new Konva.Text({ text: `Item ${i}`, fontSize: 10, padding: 8 }));
        layer.add(g);
      }
      stage.add(layer); layer.draw(); res.konva.mount.push(now() - t);
      const first = layer.children[0], km = [];
      for (let i = 0; i < 60; i++) { t = now(); first.x(100 + i); layer.draw(); km.push(now() - t); }
      res.konva.move.push(median(km)); stage.destroy(); kh.remove();
      await frame();
    }
    for (const eng of ["dom", "konva"]) out.push({ suite: "scene", objects: n, engine: eng, mount_ms: median(res[eng].mount), move_one_ms: median(res[eng].move) });
  }
  return out;
}

// Frame intervals while one object moves every frame (includes style, layout, paint and composite).
export async function frameSuite(n = 400, frames = 120) {
  const out = [];
  const host = box(1280, 720); host.style.left = "0"; host.style.zIndex = "-1";
  host.innerHTML = Array.from({ length: n }, (_, i) => `<div style="position:absolute;left:${(i * 37) % 1200}px;top:${(i * 53) % 680}px;width:72px;height:28px;background:#eef2f7;border:1px solid #d5dbe3;font:10px Helvetica">Item ${i}</div>`).join("");
  const run = async (step) => { const d = []; let last = await new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < frames; i++) { step(i); const t = await new Promise((r) => requestAnimationFrame(r)); d.push(t - last); last = t; } return d; };
  let d = await run((i) => { host.children[0].style.left = `${100 + (i % 200)}px`; });
  out.push({ suite: "frames", objects: n, engine: "dom", frame_median_ms: median(d), frame_p95_ms: p95(d) });
  host.innerHTML = "";
  const stage = new Konva.Stage({ container: host, width: 1280, height: 720 }), layer = new Konva.Layer();
  for (let i = 0; i < n; i++) { const g = new Konva.Group({ x: (i * 37) % 1200, y: (i * 53) % 680 }); g.add(new Konva.Rect({ width: 72, height: 28, fill: "#eef2f7", stroke: "#d5dbe3" }), new Konva.Text({ text: `Item ${i}`, fontSize: 10, padding: 8 })); layer.add(g); }
  stage.add(layer);
  d = await run((i) => { layer.children[0].x(100 + (i % 200)); layer.batchDraw(); });
  out.push({ suite: "frames", objects: n, engine: "konva", frame_median_ms: median(d), frame_p95_ms: p95(d) });
  stage.destroy(); host.remove();
  return out;
}

export async function runAll() {
  const env = { ua: navigator.userAgent, dpr: devicePixelRatio, viewport: `${innerWidth}×${innerHeight}`, visible: document.visibilityState, at: new Date().toISOString() };
  const results = [...await chartSuite(), ...await tableSuite(), ...await sceneSuite(), ...await frameSuite()];
  return { env, results };
}
export { median, p95 };
