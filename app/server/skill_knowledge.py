"""Selective retrieval of the financial-slide-design Skill's knowledge cards for the in-app AI.

The Skill (.claude/skills/financial-slide-design) holds the design knowledge as cards: a router, families (V01-V16),
modifiers (M), patterns (P), anchors (A1), devices (D1), assets (S1, S2), text hierarchy (H1), grouping (G1),
conventions (C1), refinement (R) and deck planning (DK). The app's AI must not load all of them for every slide: this
module picks the few that apply to one slide's objective, the same way the router tells a designer to, and returns
them condensed (purpose, when, when not, hard constraints, how to plan and execute) with the router's hard rules.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2] / ".claude" / "skills" / "financial-slide-design"
CARDS = SKILL / "cards"
MAX_CARDS = 5
SECTIONS = ("Purpose", "Applies when", "Not when", "Hard constraints", "How to plan one", "Execution", "Combines with", "Alternatives",
            "Use them proactively", "Where imagery is expected", "Cover composition")

# analytical intent (the app's frr-viz intents and the router's objectives) -> family cards, best first
INTENT_CARDS = {
    "trend": ["V07", "V08"], "ranking": ["V05", "V09"], "change": ["V06", "V09"], "composition": ["V01", "V04", "V03"],
    "relationship": ["V15"], "distribution": ["V16"], "curve": ["V07"], "maturity": ["V04"], "sensitivity": ["V09"],
    "spotlight": ["A1"], "ratings": ["V12"], "drivers": ["V14"], "geography": ["V10"], "causality": ["V11"],
    "sequence": ["V12"], "framework": ["V13"], "assessment": ["V09", "M1"],
}
# page role -> pattern and support cards
ROLE_CARDS = {
    "cover": ["P5", "S2"], "divider": ["P5", "S2"], "closing": ["P5", "S2", "H1"], "summary": ["H1", "A1"],
    "evidence": ["P1"], "dashboard": ["P3"], "chart_table": ["P2", "P4"], "statement": ["P6", "A1"], "comparison": ["P4", "V09"],
}
# words in the objective that bring a card in (the router: "geography as mechanism", identity markers, drivers, ...)
KEYWORDS = [
    (r"\b(map|route|strait|chokepoint|canal|pipeline|border|region(al)?|geograph|corridor|shipping)\w*", "V10"),
    (r"\b(countr(y|ies)|sovereigns?|compan(y|ies)|agenc(y|ies)|issuers?|banks?)\b", "S1"),
    (r"\b(driver|bridge|decompos|contribution|waterfall)\w*", "V14"),
    (r"\b(cause|causal|transmission|channel|mechanism|reaches|chain|feedback)\w*", "V11"),
    (r"\b(cover|title page|opening|closing|divider|section)\b", "P5"),
    (r"\b(photo|image|picture)\w*", "S2"),
    (r"\b(highlight|focus|emphasi[sz]e|tier|intensity)\w*", "M1"),
    (r"\b(benchmark|target|threshold|average|reference line)\b", "M3"),
    (r"\b(gap|spread|difference)\b", "M2"),
    (r"\b(scorecard|assessment|risk tiers?|rank the risks?)\b", "V09"),
    (r"\b(timeline|sequence|stages?|history of (rating|actions))\b", "V12"),
]


@lru_cache(maxsize=1)
def _cards() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for f in sorted(CARDS.glob("*.md")):
        text = f.read_text()
        m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
        meta, body = (m.group(1), m.group(2)) if m else ("", text)
        cid = (re.search(r"^id:\s*(\S+)", meta, re.M) or [None, f.stem.split("-")[0]])[1]
        name = (re.search(r"^name:\s*(.+)$", meta, re.M) or [None, f.stem])[1].strip()
        out[cid] = {"id": cid, "name": name, "file": f.name, "body": body}
    return out


def _condense(body: str, limit: int = 1500) -> str:
    """The card's decision-relevant sections in priority order, cut to `limit` characters (status tables dropped)."""
    body = body.split("**Status**")[0]
    parts = re.split(r"\n(?=\*\*[^*\n]+(?:\*\*:|:\*\*))", "\n" + body)
    keep = []
    for want in SECTIONS:
        for p in parts:
            head = re.match(r"\*\*([^*:\n]+)", p.strip())
            if head and head.group(1).strip().lower().startswith(want.lower()):
                keep.append(re.sub(r"\n{2,}", "\n", p.strip()))
    s = "\n".join(keep) or body.strip()
    return s if len(s) <= limit else s[: limit - 1].rsplit("\n", 1)[0] + "\n…"


def router_rules() -> str:
    r = _cards().get("ROUTER", {}).get("body", "")
    m = re.search(r"## Hard constraints \(H\): never broken\n(.*?)\n## ", r, re.S)
    rules = m.group(1).strip() if m else ""
    lim = re.search(r"## Renderer limits never downgrade a design\n(.*?)\n## ", r, re.S)
    return rules + ("\n\nRenderer limits: " + re.sub(r"\s+", " ", lim.group(1)).strip() if lim else "")


def select(objective: str = "", intents: list[str] | None = None, role: str = "", places_matter: bool = False) -> list[str]:
    """The card ids for one slide: families for its intents, the pattern for its role, then cards its wording calls for."""
    ids: list[str] = []
    add = lambda c: ids.append(c) if c in _cards() and c not in ids else None  # noqa: E731
    for i in intents or []:
        for c in INTENT_CARDS.get(i.lower().strip(), [])[:2]:
            add(c)
    for c in ROLE_CARDS.get((role or "").lower().strip(), []):
        add(c)
    if places_matter:
        add("V10")
    text = (objective or "").lower()
    for pat, c in KEYWORDS:
        if re.search(pat, text):
            add(c)
    if not ids:
        add("P1"); add("A1")
    return ids[:MAX_CARDS]


def guidance(objective: str = "", intents: list[str] | None = None, role: str = "", places_matter: bool = False) -> dict:
    ids = select(objective, intents, role, places_matter)
    cards = _cards()
    return {"cards": [{"id": c, "name": cards[c]["name"], "guidance": _condense(cards[c]["body"])} for c in ids],
            "rules": router_rules(), "available": sorted(k for k in cards if k not in ("ROUTER",))}
