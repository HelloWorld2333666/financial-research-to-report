// ChartSpec → ECharts option (SVG renderer). Pure: geometry depends only on the working data
// series, the spec's visual fields, the DNA tokens and the box size. No animation, no smoothing,
// nulls stay gaps (connectNulls: false). Sampling is never enabled.
import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "./html.js";

export function compileOption(spec, series, dna, { mini = false } = {}) {
  const st = spec.style || {}, fs = mini ? 8 : st.font_size || 11, colors = dna.series;
  const many = series.x.length > 40, snapshot = series.snapshot, labels = spec.labels || "end";
  const color = (i) => colors[i % colors.length];
  const lineSeries = (s, i) => ({
    name: s.label, type: spec.type, data: s.values, connectNulls: false, sampling: undefined,
    showSymbol: !!st.markers && !mini, symbolSize: 5,
    itemStyle: { color: color(s.role ?? i) }, lineStyle: { width: mini ? 1 : st.line_width || 1.8 },
    barGap: `${st.bar_gap ?? 20}%`, barCategoryGap: `${st.bar_gap ?? 30}%`,
    endLabel: spec.type === "line" && labels === "end" && !mini ? { show: true, formatter: "{a}", fontSize: fs, fontWeight: 700, color: color(s.role ?? i) } : undefined,
    label: st.data_labels && !mini ? { show: true, position: "top", fontSize: fs - 1, color: dna.muted } : undefined,
  });
  return {
    animation: false, textStyle: { fontFamily: `"${dna.font}", Helvetica, Arial, sans-serif`, color: dna.ink },
    title: mini || st.hide_title ? undefined : { text: spec.title, left: 8, top: 6, textStyle: { fontSize: 12, fontWeight: 700, color: dna.ink } },
    grid: { left: st.y_title ? 56 : 44, right: spec.type === "line" && labels === "end" ? 72 : 18, top: mini ? 10 : 42, bottom: labels === "legend" ? 46 : 28 },
    legend: labels === "legend" && !mini && !snapshot ? { bottom: 4, itemWidth: 14, textStyle: { fontSize: fs } } : undefined,
    xAxis: { type: "category", data: series.x, boundaryGap: spec.type === "bar",
             axisLabel: { fontSize: fs, color: dna.muted, interval: many ? Math.ceil(series.x.length / 8) - 1 : "auto", formatter: (v) => (many ? String(v).slice(0, 4) : v) },
             axisLine: { lineStyle: { color: "#9aa5b4" } }, axisTick: { show: false } },
    yAxis: { type: "value", scale: !spec.y?.zero, name: st.y_title || undefined, nameTextStyle: { fontSize: fs, color: dna.muted }, nameGap: 10,
             axisLabel: { fontSize: fs, color: dna.muted }, splitLine: { lineStyle: { color: "#e6e9ee" } } },
    series: snapshot
      ? [{ type: "bar", data: series.series[0].values.map((v, i) => ({ value: v, itemStyle: { color: color(series.series[0].roles[i]) } })),
           barCategoryGap: `${st.bar_gap ?? 35}%`, label: (st.data_labels ?? true) && !mini ? { show: true, position: "top", fontSize: fs, fontWeight: 700, color: dna.ink } : undefined }]
      : series.series.map(lineSeries),
  };
}

export function ChartView({ spec, series, dna, w, h }) {
  const ref = useRef(null), chart = useRef(null);
  // Layout effects run synchronously after the DOM update. Plain effects wait for an animation frame,
  // which is throttled when the window is not visible and left charts blank (Phase 1 defect).
  useLayoutEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: "svg", width: w, height: h });
    return () => chart.current.dispose();
  }, []);
  useLayoutEffect(() => {
    chart.current.resize({ width: w, height: h });
    chart.current.setOption(compileOption(spec, series, dna), true);
  }, [spec, series, dna, w, h]);
  return html`<div ref=${ref} style=${`width:${w}px;height:${h}px`}></div>`;
}
