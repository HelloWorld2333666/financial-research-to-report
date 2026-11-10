"""Layout retrieval over the design-library catalog: deterministic filter + score, no embeddings, no model calls.

One implementation, two callers: the Claude Skill (via this CLI) and the app's local agent (via a server tool that
imports search()/load()). Results are compact so a shortlist costs a few hundred tokens.

    python -m design_library.retrieve --lib <private root> search '{"purpose":["trend"],"chart":true,"kpis":1,"chars":400}'
    python -m design_library.retrieve --lib <private root> load <layout id>
    python -m design_library.retrieve suggest '{"purpose":["trend"],"chart":true}'      recipes (+ references when --lib or
                                                                                         FRR_DESIGN_LIBRARY is set)

A request (every field optional):
    purpose   list of: summary trend comparison kpi survey framework process matrix case recommendation detail_table
              statement section about
    kind      content | cover | divider | agenda           (default content)
    chart     true when the slide carries a chart; series / points sizes are not used yet
    table     true when it carries a table;   kpis: number of headline figures;   panels: parallel blocks wanted
    chars     body text the slide must hold (characters);  tone: light | dark;   lang: en | zh
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from functools import lru_cache
from pathlib import Path

DENSITY_CHARS = {"light": (0, 450), "medium": (450, 1100), "dense": (1100, 10**6)}
# the recipe table the planner (TypeScript) also reads: one source for both
RECIPES = Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "design" / "recipes.json"


@lru_cache(maxsize=1)
def recipes() -> tuple[dict, ...]:
    return tuple(json.loads(RECIPES.read_text())["recipes"])


def recipe_score(r: dict, q: dict) -> float:
    kind = q.get("kind", "content")
    if kind != "content":
        return 5.0 if r["composition"]["kind"] == kind else -5.0
    if r["composition"]["kind"] in ("agenda", "divider"):
        return -5.0
    s = 3.0 * len(set(q.get("purpose") or []) & set(r["purpose"]))
    if q.get("chart"):
        s += 1.0 if any(a.startswith("chart_led") for a in r["archetypes"]) else -1.0
    if q.get("kpis"):
        s += 0.5 if "kpi" in r["purpose"] else 0.0
    return s


@lru_cache(maxsize=4)
def _layouts(lib: str) -> tuple[dict, ...]:
    return tuple(json.loads(l) for l in (Path(lib) / "catalog" / "layouts.jsonl").open())


def score(L: dict, q: dict) -> tuple[float, list[str]]:
    why, s = [], 0.0
    want = set(q.get("purpose") or [])
    got = set(L["purpose"])
    if want:
        hit = want & got
        s += 3.0 * len(hit) - 1.0 * len(want - got)
        if hit:
            why.append("+".join(sorted(hit)))
    st = set(t.split("_")[0] for t in L["structure"])
    if q.get("chart"):
        s += 2.0 if "chart" in st else -2.0
    if q.get("table"):
        s += 2.0 if "table" in st else -1.5
    if q.get("kpis"):
        s += 1.5 if "kpi" in st else 0.0
    if q.get("panels"):
        d = abs(L["capacity"]["panels"] - q["panels"])
        s += 1.5 if d == 0 else -0.5 * d
    if q.get("chars") is not None:
        lo, hi = DENSITY_CHARS[L["design"]["density"]]
        c = q["chars"]
        s += 1.0 if lo <= c < hi else -0.6 * abs(math.log((c + 100) / ((lo + min(hi, 2500)) / 2 + 100)))
    if q.get("tone") and L["design"]["tone"] and q["tone"] != L["design"]["tone"]:
        s -= 1.0
    if q.get("lang") and L["lang"] != q["lang"]:
        s -= 0.5
    if L["design"]["title"] == "headline":
        s += 0.5  # action titles: the house style we want to learn from
    if (L["design"].get("min_pt") or 12) < 7:
        s -= 0.5  # very small type: harder to reuse legibly
    s += 0.4 * math.log(1 + L["size"])  # recurring patterns over one-offs
    return round(s, 2), why


def search(lib: str, q: dict, k: int = 3) -> list[dict]:
    kind = q.get("kind", "content")
    pool = [L for L in _layouts(lib) if L["compat"] == "rebuild" and L["kind"] == kind]
    ranked = sorted(((score(L, q), L) for L in pool), key=lambda x: (-x[0][0], x[1]["id"]))
    out, seen = [], set()
    best = ranked[0][0][0] if ranked else 0
    for (s, why), L in ranked:  # diversity: one layout per primary structure, among layouts close to the best match
        key = L["structure"][0]
        if key in seen:
            continue
        if s < best - 4:
            break
        seen.add(key)
        slots = {}
        for sl in L["slots"]:
            slots[sl["role"]] = slots.get(sl["role"], 0) + 1
        out.append({"id": L["id"], "archetype": L.get("archetype"), "recipes": [r["id"] for r in recipes() if L.get("archetype") in r["archetypes"]], "score": s, "why": why, "structure": L["structure"], "purpose": L["purpose"], "tone": L["design"]["tone"],
                    "density": L["design"]["density"], "slots": slots, "preview": L["preview"], "members": L["size"]})
        if len(out) == k:
            break
    return out


def suggest(q: dict, lib: str | None = None, k: int = 3) -> dict:
    """What the Skill and the app agent call: the recipes that fit the request (always available, public), and, when the
    private library is configured, a shortlist of reference layouts with the recipes their archetype maps to."""
    ranked = sorted(recipes(), key=lambda r: (-recipe_score(r, q), r["id"]))
    rs = [{"id": r["id"], "pattern": r["pattern"], "name": r["name"], "when": r["when"], "composition": r["composition"]}
          for r in ranked if recipe_score(r, q) > 0][:k]
    refs = search(lib, q, k) if lib and (Path(lib) / "catalog" / "layouts.jsonl").exists() else []
    return {"recipes": rs, "references": refs, "library": bool(refs)}


def load(lib: str, layout_id: str) -> dict:
    L = next((x for x in _layouts(lib) if x["id"] == layout_id), None)
    if L is None:
        raise KeyError(layout_id)
    keep = ("id", "kind", "purpose", "structure", "design", "capacity", "slots", "preview", "size", "publisher", "lang")
    return {k: L[k] for k in keep}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", default=os.environ.get("FRR_DESIGN_LIBRARY"))
    ap.add_argument("cmd", choices=["search", "load", "suggest"])
    ap.add_argument("arg")
    ap.add_argument("-k", type=int, default=3)
    a = ap.parse_args(argv)
    r = search(a.lib, json.loads(a.arg), a.k) if a.cmd == "search" else suggest(json.loads(a.arg), a.lib, a.k) if a.cmd == "suggest" else load(a.lib, a.arg)
    json.dump(r, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    print()


if __name__ == "__main__":
    main()
