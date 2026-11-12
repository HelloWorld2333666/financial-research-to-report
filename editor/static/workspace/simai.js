// SIMULATED slide assistant: deterministic keyword rules, no model, no network.
// It turns size/position requests into geometry changes so the proposal → preview → apply
// flow can be exercised. A real agent would return the same shape: changes within a scope.

const TARGETS = [
  ["chart", (e) => e.type === "chart" || e.type === "barchart"],
  ["table", (e) => e.type === "table" || e.type === "datatable"],
  ["commentary", (e) => e.type === "text" && (e.role === "body" || (e.text || "").length > 120)],
  ["title", (e) => e.role === "title"],
];
const WORDS = { chart: /\b(chart|graph|line)s?\b/, table: /\btables?\b/, commentary: /\b(commentary|text|bullets?|takeaways?|notes?)\b/, title: /\btitle\b/ };
const GROW = /\b(larger|bigger|enlarge|wider|widen|expand|grow|more space)\b/, SHRINK = /\b(smaller|narrower|narrow|shrink|reduce|compact|tighter)\b/;
const MOVE = /\bmove\b.*\b(left|right|up|down)\b/;

const right = (e) => e.x + e.w;
const overlapsY = (a, b) => a.y < b.y + b.h && a.y + a.h > b.y;

export function interpret(text, slideEls, chips) {
  const t = text.toLowerCase();
  if (/\b(three|3)\b.*\blayouts?\b|\balternatives?\b/.test(t))
    return { reply: "Layout alternatives are designed in the study (mockup “alternatives”) but not built in this prototype. I can resize or move selected objects." };
  if (/\b(research|verify|find|look up)\b/.test(t))
    return { reply: "Research and verification would run as background tasks through the Research Request contract. In this prototype, use Data → “Request research” on a missing dataset." };
  const clauses = t.split(/\band\b|,|;/).map((c) => c.trim()).filter(Boolean);
  const changes = new Map(), notes = [];
  const geom = (e) => changes.get(e.id) || { x: e.x, y: e.y, w: e.w, h: e.h };
  const put = (e, g, why) => changes.set(e.id, { ...g, why: changes.has(e.id) ? `${changes.get(e.id).why}; ${why}` : why });
  for (const c of clauses) {
    let targets = TARGETS.filter(([k]) => WORDS[k].test(c)).flatMap(([, f]) => slideEls.filter(f));
    if (!targets.length && /\b(this|it|selected|selection)\b/.test(c)) targets = slideEls.filter((e) => chips.includes(e.id));
    if (!targets.length) continue;
    const grow = GROW.test(c), shrink = SHRINK.test(c), move = c.match(MOVE);
    for (const e of targets) {
      const g = geom(e), d = Math.round(Math.min(120, Math.max(60, g.w * 0.14)));
      if (grow) {
        const ng = { ...g, w: Math.min(g.w + d, 1240 - g.x), h: /\btaller\b|\bhigher\b/.test(c) ? g.h + 40 : g.h };
        put(e, ng, `wider by ${ng.w - g.w} px`);
        // reflow the column to the right so nothing overlaps
        slideEls.filter((o) => o.id !== e.id && o.x >= right(e) - 8 && overlapsY(o, e) && o.w < 900).forEach((o) => {
          const og = geom(o), delta = ng.w - g.w; put(o, { ...og, x: og.x + delta, w: Math.max(120, og.w - delta) }, "reflowed to make room");
        });
      } else if (shrink && changes.get(e.id)?.why.includes("reflowed")) {
        put(e, g, "narrower (via the reflow)");  // already narrowed by the neighbour growing; don't shrink twice
      } else if (shrink) {
        const ng = { ...g, x: g.x + d, w: Math.max(120, g.w - d) };  // right edge stays (right-hand columns)
        put(e, ng, `narrower by ${g.w - ng.w} px`);
      } else if (move) {
        const step = 40, [dx, dy] = { left: [-step, 0], right: [step, 0], up: [0, -step], down: [0, step] }[move[1]];
        put(e, { ...g, x: Math.max(0, g.x + dx), y: Math.max(0, g.y + dy) }, `moved ${move[1]}`);
      }
    }
  }
  if (!changes.size) {
    notes.push("I couldn't match that to a size or position change.");
    return { reply: `${notes[0]} This simulated assistant understands requests like “make the chart larger and the table narrower” or “move the commentary down”, applied to the selection or to named object types.` };
  }
  return { reply: "Here is a proposal. Preview shows the new outlines on the slide; nothing changes until you apply it.", changes: [...changes].map(([id, g]) => ({ id, ...g })) };
}
