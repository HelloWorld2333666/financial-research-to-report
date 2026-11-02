"""Deterministic deck composer: slide proposals written from verified datasets.

The model chooses (later, M4); this code writes every number and claim from the project's data,
so generated text is correct by construction (Experiments 2-3). Each proposal also says where
every written number comes from (schema 0.2 ``NumberRef``): ``numbers[role]`` lists, in reading
order, each figure as written and its evidence id or derivation id. Computed figures (a change in
pp, a deficit's magnitude, the yield spread) are ``derivations`` with formula and inputs.
"""

from __future__ import annotations

from evidence import NAMES


def series(project: dict, did: str) -> dict[str, float]:
    return {o["date"]: o["value"] for o in project["datasets"].get(did, {}).get("observations", [])}


def evidence_id(project: dict, did: str, date: str) -> str | None:
    obs = project["datasets"].get(did, {}).get("observations", [])
    return next((o.get("evidence_id") for o in obs if o["date"] == date), None)


def fmt(v: float, d: int = 1) -> str:
    return f"{v:.{d}f}"


class Writer:
    """Collects number references and derivations while a slide's text is written."""

    def __init__(self, project: dict):
        self.project, self.numbers, self.derivations = project, {}, []

    def ev(self, role: str, text: str, did: str, date: str) -> str:
        eid = evidence_id(self.project, did, date)
        if eid:
            self.numbers.setdefault(role, []).append({"text": text, "evidence": eid})
        return text

    def der(self, role: str, text: str, d: dict) -> str:
        if all(d["inputs"].values()):
            if not any(x["id"] == d["id"] for x in self.derivations):
                self.derivations.append(d)
            self.numbers.setdefault(role, []).append({"text": text, "derivation": d["id"]})
        return text

    def take(self, slide: dict) -> dict:
        slide["numbers"], slide["derivations"] = self.numbers, self.derivations
        self.numbers, self.derivations = {}, []
        return slide


def compose(project: dict, geo: str = "FR", peer: str = "DE") -> list[dict]:
    g, p = geo.lower(), peer.lower()
    name, pname = NAMES.get(geo, geo), NAMES.get(peer, peer)
    debt, debt_p = series(project, f"ds.{g}.debt"), series(project, f"ds.{p}.debt")
    defi, intr = series(project, f"ds.{g}.deficit"), series(project, f"ds.{g}.interest")
    grow, yld, yld_p = series(project, f"ds.{g}.growth"), series(project, f"ds.{g}.yield"), series(project, f"ds.{p}.yield")
    last = lambda s: max(s) if s else None  # noqa: E731
    w = Writer(project)
    E = lambda did, date: evidence_id(project, did, date)  # noqa: E731
    slides = []
    if debt:
        y0, y1 = min(debt), last(debt)
        claim = (f"{name}'s debt ratio rose from {w.ev('title', fmt(debt[y0]) + '%', f'ds.{g}.debt', y0)} "
                 f"to {w.ev('title', fmt(debt[y1]) + '%', f'ds.{g}.debt', y1)} of GDP ({y0}–{y1})")
        if debt_p:
            pl, pf = last(debt_p), min(debt_p)
            claim += (f"; {pname}'s was {w.ev('title', fmt(debt_p[pl]) + '%', f'ds.{p}.debt', pl)} in {pl} "
                      f"({w.ev('title', fmt(debt_p[pf]) + '%', f'ds.{p}.debt', pf)} in {pf})")
        change = round(debt[y1] - debt[y0], 1)
        bullets = [f"{name}: {w.ev('body', fmt(debt[y1]) + '%', f'ds.{g}.debt', y1)} of GDP in {y1}, "
                   + w.der("body", f"{'+' if change >= 0 else ''}{fmt(change)} pp", {
                       "id": f"der.{g}.debt.change.{y0}-{y1}", "statement": f"Change in {name}'s debt ratio, {y0} to {y1}",
                       "formula": "end - start", "inputs": {"start": E(f"ds.{g}.debt", y0), "end": E(f"ds.{g}.debt", y1)},
                       "value": change, "unit": "pp", "period": f"{y0}-{y1}", "rounding": 1})
                   + f" since {y0}."]
        if debt_p:
            bullets.append(f"{pname}: {w.ev('body', fmt(debt_p[last(debt_p)]) + '%', f'ds.{p}.debt', last(debt_p))} in {last(debt_p)}.")
        slides.append(w.take({"key": "debt", "kicker": f"{name.upper()} · DEBT", "title": claim,
                              "subtitle": "General government gross debt, % of GDP · Eurostat (gov_10dd_edpt1)",
                              "chart": {"type": "line", "title": "Gross debt, % of GDP", "series": [f"ds.{g}.debt"] + ([f"ds.{p}.debt"] if debt_p else [])},
                              "bullets": bullets}))
    if defi and intr:
        yd, yi = last(defi), last(intr)
        mag = round(abs(defi[yd]), 1)
        title = (f"The deficit was " + w.der("title", fmt(mag) + "%", {
            "id": f"der.{g}.deficit.size.{yd}", "statement": f"Size of {name}'s {yd} deficit (Eurostat records deficits as negative values)",
            "formula": "abs(balance)", "inputs": {"balance": E(f"ds.{g}.deficit", yd)}, "value": mag, "unit": "% of GDP", "period": yd, "rounding": 1})
            + f" of GDP in {yd}; interest costs reached {w.ev('title', fmt(intr[yi]) + '%', f'ds.{g}.interest', yi)} in {yi}")
        slides.append(w.take({"key": "fiscal", "kicker": f"{name.upper()} · FISCAL", "title": title,
                              "subtitle": "Deficit and interest payable, % of GDP · Eurostat (gov_10dd_edpt1, gov_10a_main)",
                              "chart": {"type": "line", "title": "Deficit (-) / surplus (+), % of GDP", "series": [f"ds.{g}.deficit"] + ([f"ds.{p}.deficit"] if series(project, f"ds.{p}.deficit") else [])},
                              "table": {"title": "Interest payable, % of GDP", "datasets": [f"ds.{g}.interest"] + ([f"ds.{p}.interest"] if series(project, f"ds.{p}.interest") else []), "dates": sorted(intr)[-3:]}}))
    if grow and yld:
        yg, yy = last(grow), last(yld)
        spread = round((yld[yy] - yld_p[yy]) * 100) if yld_p and yy in yld_p else None
        sd = None
        if spread is not None:
            sd = {"id": f"der.{g}{p}.spread.{yy}", "statement": f"10-year yield spread, {name} over {pname}, {yy}",
                  "formula": "(own - peer) * 100", "inputs": {"own": E(f"ds.{g}.yield", yy), "peer": E(f"ds.{p}.yield", yy)},
                  "value": spread, "unit": "bp", "period": yy, "rounding": 0}
        title = f"Growth slowed to {w.ev('title', fmt(grow[yg]) + '%', f'ds.{g}.growth', yg)} in {yg}"
        if sd:
            title += f"; the 10-year spread over {pname} was {w.der('title', f'{spread} bp', sd)} in {yy}"
        bullets = []
        if sd:
            bullets.append(f"10-year spread over {pname}: {w.der('body', f'{spread} bp', sd)} in {yy} "
                           f"({name} {w.ev('body', fmt(yld[yy], 2) + '%', f'ds.{g}.yield', yy)} − {pname} {w.ev('body', fmt(yld_p[yy], 2) + '%', f'ds.{p}.yield', yy)}).")
        slides.append(w.take({"key": "market", "kicker": f"{name.upper()} · GROWTH & MARKETS", "title": title,
                              "subtitle": "Real GDP growth, %; 10-year government bond yields, % · Eurostat (nama_10_gdp, irt_lt_mcby_a)",
                              "chart": {"type": "line", "title": "Real GDP growth, %", "series": [f"ds.{g}.growth"] + ([f"ds.{p}.growth"] if series(project, f"ds.{p}.growth") else [])},
                              "table": {"title": "10-year yield, %", "datasets": [f"ds.{g}.yield"] + ([f"ds.{p}.yield"] if yld_p else []), "dates": sorted(yld)[-3:]},
                              "bullets": bullets}))
    slides.append(w.take({"key": "ratings", "kicker": f"{name.upper()} · RATINGS", "title": "Rating actions: pending a primary source",
                          "subtitle": "Agency press releases are not machine-accessible (bot protection / JavaScript apps); upload them or connect a data feed",
                          "placeholder": {"label": "Rating history — pending research", "request": {"schema": "frr-research-request/0.1", "topic": "rating actions", "entity": name,
                                          "reason": "primary sources blocked in Experiment 2 (S&P 403, AFT 403, Fitch/Moody's JavaScript)"}}}))
    return slides
