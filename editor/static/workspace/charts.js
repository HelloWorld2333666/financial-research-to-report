// ChartSpec → ECharts option (SVG renderer). Pure: the plotted geometry depends only on the
// dataset series, the spec's visual fields, the DNA tokens and the box size. No animation,
// no smoothing, nulls stay gaps (connectNulls: false). LTTB sampling is never enabled here.
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";

export function compileOption(spec, series, dna, { w, h: hh, mini = false }) {
  const fs = mini ? 8 : 11, colors = dna.series;
  const many = series.x.length > 40;
  return {
    animation: false, textStyle: { fontFamily: `"${dna.font}", Helvetica, Arial, sans-serif`, color: dna.ink },
    title: mini ? undefined : { text: spec.title, left: 8, top: 4, textStyle: { fontSize: 12, fontWeight: 700, color: dna.ink } },
    grid: { left: 44, right: spec.labels === "end" ? 70 : 16, top: mini ? 10 : 40, bottom: spec.labels === "legend" ? 44 : 26 },
    legend: spec.labels === "legend" && !mini ? { bottom: 4, itemWidth: 14, textStyle: { fontSize: fs } } : undefined,
    xAxis: { type: "category", data: series.x, boundaryGap: spec.type === "bar",
             axisLabel: { fontSize: fs, color: dna.muted, interval: many ? Math.ceil(series.x.length / 8) - 1 : "auto",
                          formatter: (v) => (many ? String(v).slice(0, 4) : v) },
             axisLine: { lineStyle: { color: "#9aa5b4" } }, axisTick: { show: false } },
    yAxis: { type: "value", scale: !spec.y?.zero, axisLabel: { fontSize: fs, color: dna.muted },
             splitLine: { lineStyle: { color: "#e3e7ed" } } },
    series: series.series.map((s, i) => ({
      name: s.label, type: spec.type, data: s.values, connectNulls: false, showSymbol: false, sampling: undefined,
      itemStyle: { color: colors[(s.role ?? i) % colors.length] }, lineStyle: { width: mini ? 1 : 1.8 },
      endLabel: spec.type === "line" && spec.labels === "end" && !mini ? { show: true, formatter: "{a}", fontSize: fs, fontWeight: 700, color: colors[(s.role ?? i) % colors.length] } : undefined,
      barMaxWidth: 18,
    })),
  };
}

export function ChartView({ spec, series, dna, w, h: hh, mini }) {
  const ref = useRef(null), chart = useRef(null);
  useEffect(() => {
    chart.current = echarts.init(ref.current, null, { renderer: "svg", width: w, height: hh });
    return () => chart.current.dispose();
  }, []);
  useEffect(() => {
    chart.current.resize({ width: w, height: hh });
    chart.current.setOption(compileOption(spec, series, dna, { w, h: hh, mini }), true);
  }, [spec, series, dna, w, hh]);
  return html`<div ref=${ref} style=${`width:${w}px;height:${hh}px`}></div>`;
}
