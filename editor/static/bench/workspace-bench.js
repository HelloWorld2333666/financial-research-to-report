// Measures the workspace prototype (static/workspace) the same way editor-bench.js measures the old editor:
// duplicate the China Re slide to N slides (in memory only), then time a one-pixel nudge commit.
// Open /workspace/index.html, then in the console:
//   const m = await import("/bench/workspace-bench.js"); await m.run()
import { options } from "preact";

const now = () => performance.now();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
// Yield between iterations without relying on animation frames (throttled when the window is not in view);
// all timed sections are synchronous, so the yield method does not affect the numbers.
const frame = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

export async function run({ slideCounts = [3, 10, 30], runs = 9 } = {}) {
  const { store } = window.__ws, original = store.get().project, prev = options.debounceRendering, results = [];
  options.debounceRendering = (cb) => cb();  // render synchronously so the timing includes Preact's diff and DOM work
  try {
    for (const n of slideCounts) {
      const p = JSON.parse(JSON.stringify(original)), base = p.slides[0].id, src = p.elements.filter((e) => (e.slide_id || base) === base);
      p.slides = p.slides.slice(0, 1); p.elements = [...src];
      while (p.slides.length < n) {
        const sid = `bench-${p.slides.length}`;
        p.slides.push({ id: sid, title: `Bench copy ${p.slides.length}` });
        src.forEach((e) => p.elements.push({ ...JSON.parse(JSON.stringify(e)), id: `${e.id}-${sid}`, slide_id: sid }));
      }
      store.replaceProject(p); store.ui({ slide: base, selected: [] });
      await frame(); await frame();
      const t = [];
      for (let i = 0; i < runs; i++) {
        const s = now();
        store.commit("Nudged", (d) => { d.elements.find((e) => e.id === "kpi-roe").x += i % 2 ? -1 : 1; });
        t.push(now() - s); await frame();
      }
      const sw = [];
      for (let i = 0; i < 5; i++) { const s = now(); store.ui({ slide: p.slides[(i % (n - 1)) + 1].id }); sw.push(now() - s); await frame(); }
      results.push({ slides: n, elements: p.elements.length, commit_ms: median(t), switch_slide_ms: median(sw),
                     heap_mb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null });
    }
  } finally {
    options.debounceRendering = prev;
    store.replaceProject(original); store.ui({ slide: original.slides[0].id, selected: [] });
  }
  return { env: { ua: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`, visible: document.visibilityState, at: new Date().toISOString() }, results };
}
