// Minimal deterministic SVG line chart (benchmark baseline; ~100 lines, no dependencies).
// Geometry is a pure function of the data and the box: no smoothing, no interpolation.
// A null observation breaks the line instead of being bridged.

const niceStep = (span, target) => {
  const raw = span / Math.max(1, target), mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
};

export function ticks(min, max, target = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min, target), out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  if (out[0] > min) out.unshift(+(out[0] - step).toFixed(10));
  if (out.at(-1) < max) out.push(+(out.at(-1) + step).toFixed(10));
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** spec: {width, height, title, unit, x: [labels or epoch ms], series: [{name, color, values: (number|null)[]}], xType: "category"|"time"} */
export function renderLineChart(spec) {
  const { width: W, height: H } = spec, m = { l: 44, r: 96, t: 40, b: 26 };
  const all = spec.series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  const yt = ticks(Math.min(...all), Math.max(...all));
  const y0 = yt[0], y1 = yt.at(-1), n = spec.x.length;
  const px = (i) => m.l + (n === 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const py = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica Neue, Arial, sans-serif" font-size="10">`];
  parts.push(`<text x="${m.l}" y="14" font-size="11" font-weight="700" fill="#0f2742">${esc(spec.title)}</text>`);
  for (const t of yt) {
    const y = py(t).toFixed(1);
    parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="#e3e7ed"/><text x="${m.l - 6}" y="${y}" dy="3" text-anchor="end" fill="#5b6b7f">${t}</text>`);
  }
  const every = Math.max(1, Math.ceil(n / 8));
  for (let i = 0; i < n; i += every) {
    const lab = spec.xType === "time" ? new Date(spec.x[i]).getUTCFullYear() : spec.x[i];
    parts.push(`<text x="${px(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#5b6b7f">${esc(lab)}</text>`);
  }
  let points = 0;
  for (const s of spec.series) {
    let d = "", pen = false, last = null;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`; pen = true; points++; last = [i, v];
    });
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round"/>`);
    if (last) parts.push(`<text x="${(px(last[0]) + 6).toFixed(1)}" y="${py(last[1]).toFixed(1)}" dy="3" fill="${s.color}" font-weight="700">${esc(s.name)}</text>`);
  }
  parts.push(`<text x="${m.l}" y="${m.t - 10}" fill="#5b6b7f">${esc(spec.unit)}</text></svg>`);
  return { svg: parts.join(""), plottedPoints: points };
}
