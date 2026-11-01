"""Deterministic deck composer: slide proposals written from verified datasets.

The model chooses (later, M4); this code writes every number and claim from the project's data,
so generated text is correct by construction (Experiments 2-3). Ported unchanged from Experiment 3.
"""

from __future__ import annotations

from evidence import NAMES


def series(project: dict, did: str) -> dict[str, float]:
    return {o["date"]: o["value"] for o in project["datasets"].get(did, {}).get("observations", [])}


def fmt(v: float, d: int = 1) -> str:
    return f"{v:.{d}f}"


def compose(project: dict, geo: str = "FR", peer: str = "DE") -> list[dict]:
    g, p = geo.lower(), peer.lower()
    name, pname = NAMES.get(geo, geo), NAMES.get(peer, peer)
    debt, debt_p = series(project, f"ds.{g}.debt"), series(project, f"ds.{p}.debt")
    defi, intr = series(project, f"ds.{g}.deficit"), series(project, f"ds.{g}.interest")
    grow, yld, yld_p = series(project, f"ds.{g}.growth"), series(project, f"ds.{g}.yield"), series(project, f"ds.{p}.yield")
    last = lambda s: max(s) if s else None  # noqa: E731
    slides = []
    if debt:
        y0, y1 = min(debt), last(debt)
        claim = f"{name}'s debt ratio rose from {fmt(debt[y0])}% to {fmt(debt[y1])}% of GDP ({y0}–{y1})"
        if debt_p:
            claim += f"; {pname}'s was {fmt(debt_p[last(debt_p)])}% in {last(debt_p)} ({fmt(debt_p[min(debt_p)])}% in {min(debt_p)})"
        slides.append({"key": "debt", "kicker": f"{name.upper()} · DEBT", "title": claim,
                       "subtitle": "General government gross debt, % of GDP · Eurostat (gov_10dd_edpt1)",
                       "chart": {"type": "line", "title": "Gross debt, % of GDP", "series": [f"ds.{g}.debt"] + ([f"ds.{p}.debt"] if debt_p else [])},
                       "bullets": [f"{name}: {fmt(debt[y1])}% of GDP in {y1}, {'+' if debt[y1] >= debt[y0] else ''}{fmt(debt[y1] - debt[y0])} pp since {y0}."]
                       + ([f"{pname}: {fmt(debt_p[last(debt_p)])}% in {last(debt_p)}."] if debt_p else [])})
    if defi and intr:
        yd, yi = last(defi), last(intr)
        slides.append({"key": "fiscal", "kicker": f"{name.upper()} · FISCAL", "title": f"The deficit was {fmt(abs(defi[yd]))}% of GDP in {yd}; interest costs reached {fmt(intr[yi])}% in {yi}",
                       "subtitle": "Deficit and interest payable, % of GDP · Eurostat (gov_10dd_edpt1, gov_10a_main)",
                       "chart": {"type": "line", "title": "Deficit (-) / surplus (+), % of GDP", "series": [f"ds.{g}.deficit"] + ([f"ds.{p}.deficit"] if series(project, f"ds.{p}.deficit") else [])},
                       "table": {"title": "Interest payable, % of GDP", "datasets": [f"ds.{g}.interest"] + ([f"ds.{p}.interest"] if series(project, f"ds.{p}.interest") else []), "dates": sorted(intr)[-3:]}})
    if grow and yld:
        yg, yy = last(grow), last(yld)
        spread = (yld[yy] - yld_p[yy]) * 100 if yld_p and yy in yld_p else None
        slides.append({"key": "market", "kicker": f"{name.upper()} · GROWTH & MARKETS", "title": f"Growth slowed to {fmt(grow[yg])}% in {yg}" + (f"; the 10-year spread over {pname} was {spread:.0f} bp in {yy}" if spread is not None else ""),
                       "subtitle": "Real GDP growth, %; 10-year government bond yields, % · Eurostat (nama_10_gdp, irt_lt_mcby_a)",
                       "chart": {"type": "line", "title": "Real GDP growth, %", "series": [f"ds.{g}.growth"] + ([f"ds.{p}.growth"] if series(project, f"ds.{p}.growth") else [])},
                       "table": {"title": "10-year yield, %", "datasets": [f"ds.{g}.yield"] + ([f"ds.{p}.yield"] if yld_p else []), "dates": sorted(yld)[-3:]},
                       "derived": ({"spread_bp": round(spread), "inputs": [f"ds.{g}.yield@{yy}", f"ds.{p}.yield@{yy}"]} if spread is not None else None)})
    slides.append({"key": "ratings", "kicker": f"{name.upper()} · RATINGS", "title": "Rating actions: pending a primary source",
                   "subtitle": "Agency press releases are not machine-accessible (bot protection / JavaScript apps); upload them or connect a data feed",
                   "placeholder": {"label": "Rating history — pending research", "request": {"schema": "frr-research-request/0.1", "topic": "rating actions", "entity": name,
                                   "reason": "primary sources blocked in Experiment 2 (S&P 403, AFT 403, Fitch/Moody's JavaScript)"}}})
    return slides
