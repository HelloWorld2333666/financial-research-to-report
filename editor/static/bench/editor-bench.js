// Measures the CURRENT editor (static/editor.js) in place. Open the editor on a deck, then in the console:
//   const m = await import("/bench/editor-bench.js"); await m.run()
// It duplicates slides in memory only (nothing is saved) and reports medians in ms.
const now = () => performance.now();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function timeRender(E, runs = 9) {
  const t = [];
  for (let i = 0; i < runs; i++) { const s = now(); E.render(); t.push(now() - s); await frame(); }
  return median(t);
}

async function timeCommit(E, runs = 9) {
  // A one-pixel nudge goes through the single commit path (snapshot + full re-render), like every edit.
  const id = E.S.project.elements.find((e) => (e.slide_id || E.S.project.slides[0].id) === E.S.slide && e.type === "metric")?.id;
  const t = [];
  for (let i = 0; i < runs; i++) {
    E.select([id]);
    const s = now();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: i % 2 ? "ArrowLeft" : "ArrowRight", bubbles: true }));
    t.push(now() - s); await frame();
  }
  if (E.S.history.length < runs) throw new Error("nudge did not commit; commit timing invalid");
  return median(t);
}

async function timeDrag(E, moves = 60) {
  const id = E.S.project.elements.find((e) => (e.slide_id || E.S.project.slides[0].id) === E.S.slide && e.type === "metric").id;
  E.select([id]); await frame(); await frame();
  const node = document.querySelector(`#stage .el[data-id="${id}"]`), b = node.getBoundingClientRect();
  const o = (x, y, buttons) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window });
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2, tgt = document.elementFromPoint(x0, y0);
  tgt.dispatchEvent(new PointerEvent("pointerdown", o(x0, y0, 1))); tgt.dispatchEvent(new MouseEvent("mousedown", o(x0, y0, 1)));
  const per = [];
  for (let i = 1; i <= moves; i++) {
    const x = x0 + (i % 20) * 2, y = y0 + (i % 10), el = document.elementFromPoint(x, y) || document.body, s = now();
    el.dispatchEvent(new PointerEvent("pointermove", o(x, y, 1))); el.dispatchEvent(new MouseEvent("mousemove", o(x, y, 1)));
    per.push(now() - s); await frame();
  }
  const s = now();
  window.dispatchEvent(new PointerEvent("pointerup", o(x0, y0, 0))); window.dispatchEvent(new MouseEvent("mouseup", o(x0, y0, 0)));
  const endMs = now() - s;
  E.undo(); await frame();
  return { move_handler_median_ms: median(per), move_handler_max_ms: +Math.max(...per).toFixed(2), drag_end_commit_ms: +endMs.toFixed(2) };
}

async function timeExport(E) {
  const s = now();
  await htmlToImage.toPng(document.querySelector("#stage"), { pixelRatio: 2, width: 1280, height: 720 });
  return +(now() - s).toFixed(1);
}

export async function run({ slideCounts = [3, 10, 30] } = {}) {
  const E = window.__editor, original = JSON.stringify(E.S.project), results = [];
  const heap = () => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);
  for (const n of slideCounts) {
    const p = JSON.parse(original), base = p.slides[0].id, src = p.elements.filter((e) => (e.slide_id || base) === base);
    while (p.slides.length < n) {
      const sid = `bench-${p.slides.length}`;
      p.slides.push({ id: sid, title: `Bench copy ${p.slides.length}` });
      src.forEach((e) => p.elements.push({ ...JSON.parse(JSON.stringify(e)), id: `${e.id}-${sid}`, slide_id: sid }));
    }
    E.S.project = p; E.S.slide = base;
    await frame();
    results.push({ slides: n, elements: p.elements.length, render_ms: await timeRender(E), commit_ms: await timeCommit(E),
      ...(n === slideCounts[0] ? await timeDrag(E) : {}), heap_mb: heap(), thumbs_dom_nodes: document.querySelectorAll("#thumbs *").length });
  }
  E.S.project = JSON.parse(original); E.S.slide = E.S.project.slides[0].id; E.S.history = []; E.S.future = []; E.render();
  results.push({ export_png_2x_ms: await timeExport(E) });
  return { env: { ua: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`, visible: document.visibilityState, at: new Date().toISOString() }, results };
}
