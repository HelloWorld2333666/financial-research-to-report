"""Renderer-independent visualization spec (frr-viz/1, VIS V1): validation and projection on the server.

Mirrors ``app/web/src/core/viz.ts`` so the server can check a saved deck on its own: the chart on the
slide must equal the realization of its spec from the current working data (``integrity.check``).
The spec is authoritative; the chart XML is a realization. Missing values are gaps, never zeros.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

import integrity

VIZ_SCHEMA = "frr-viz/1"
Family = Literal["column", "bar", "line", "area", "pie", "doughnut", "scatter", "combo",
                 "dumbbell", "slope", "dot", "lollipop", "waterfall", "step", "multiples", "kpi", "rating_timeline"]
# drawn as shape groups by the client's composite adapter (VIS V3); data marks are named "frr-mark s c v"
COMPOSITE = {"dumbbell", "slope", "dot", "lollipop", "waterfall", "step", "multiples", "kpi", "rating_timeline"}

# Long-term rating scales on one ordinal notch index (mirrors app/web/src/core/ratings.ts)
NOTCHES = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "CCC+", "CCC", "CCC-", "CC", "C", "D"]
MOODYS = ["Aaa", "Aa1", "Aa2", "Aa3", "A1", "A2", "A3", "Baa1", "Baa2", "Baa3", "Ba1", "Ba2", "Ba3", "B1", "B2", "B3", "Caa1", "Caa2", "Caa3", "Ca", "C"]


def notch(symbol: str | None) -> int | None:
    """0 = AAA ... 21 = D; None for a symbol outside the table (ordinal: never averaged)."""
    import re  # noqa: PLC0415

    if not symbol:
        return None
    s = re.sub(r"\s+", " ", symbol.strip())
    if re.fullmatch(r"[A-D][A-D+\- ]*", s) and s.replace(" ", "") in NOTCHES:
        return NOTCHES.index(s.replace(" ", ""))
    if s in MOODYS:
        return MOODYS.index(s)
    m = re.fullmatch(r"(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)(?: \(([Hh]igh|[Ll]ow)\))?", s)
    if not m:
        return None
    hi, lo = (m.group(2) or "").lower() == "high", (m.group(2) or "").lower() == "low"
    if (hi or lo) and m.group(1) in ("AAA", "CC", "C", "D"):
        return None
    return NOTCHES.index(m.group(1)) + (-1 if hi else 1 if lo else 0)


class View(BaseModel):
    model_config = ConfigDict(extra="forbid")
    datasets: list[str] = []
    transform: Literal["none", "latest", "at", "rank", "diff", "pct_change", "pair", "bridge", "ratings"] = "none"
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    at: Optional[str] = None
    between: Optional[tuple[str, str]] = None
    order: Optional[Literal["desc", "asc"]] = None
    evidence: Optional[list[str]] = None  # ratings: rating-action evidence ids

    @model_validator(mode="after")
    def _inputs(self):
        if self.transform == "ratings" and not self.evidence:
            raise ValueError("a rating timeline needs rating actions (evidence)")
        if self.transform != "ratings" and not self.datasets:
            raise ValueError("a view needs at least one dataset")
        return self


# mirrors the warning codes of app/web/src/core/constraints.ts (test_vis_v2 checks they agree)
WarningCode = Literal["negative_stack", "combo_one_unit", "many_slices", "few_periods", "many_lines", "overlapping_areas", "many_bars", "few_points",
                      "small_steps", "step_continuous", "many_rows", "many_panels"]


class VizSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_: Literal["frr-viz/1"] = Field(alias="schema")
    id: str = Field(pattern=r"^viz_[0-9A-Za-z]+$")
    title: str
    family: Family
    subtype: Optional[Literal["clustered", "stacked", "percent"]] = None
    view: View
    missing: Literal["gap"] = "gap"
    legend: Optional[Literal["b", "r", "none"]] = None
    # warnings the user kept with "Use anyway" (VIS V2). Only warning codes: an invalid visual can't be acknowledged
    accepted_warnings: Optional[list[WarningCode]] = None


class VizError(ValueError):
    pass


def _ds(project: dict, did: str) -> dict:
    d = project.get("datasets", {}).get(did)
    if d is None:
        raise VizError(f"dataset {did} is not in the project")
    return d


def _common(project: dict, ids: list[str]) -> list[str]:
    sets = [{t for t, o in integrity.effective(project, i).items() if o["value"] is not None} for i in ids]
    return sorted(set.intersection(*sets)) if sets else []


def _names(project: dict, ids: list[str]) -> list[str]:
    ents = [_ds(project, i)["entity"] for i in ids]
    return [f"{_ds(project, i)['entity']} · {_ds(project, i)['metric']}" if ents.count(ents[k]) > 1 else ents[k] for k, i in enumerate(ids)]


def project_view(project: dict, spec: dict) -> dict:
    """{shape, categories, series: [{name, values}], x?}: the same projection as the client's."""
    view, family = spec["view"], spec["family"]
    ids = view.get("datasets", [])
    if view.get("transform") == "ratings":
        return _ratings(project, view)
    units = {_ds(project, i)["unit"] for i in ids}
    if len(units) > 1 and family not in ("combo", "scatter"):
        raise VizError(f"datasets have different units ({', '.join(sorted(units))}); one axis shows one unit")
    eff = {i: integrity.effective(project, i) for i in ids}
    val = lambda i, t: (eff[i].get(t) or {}).get("value")  # noqa: E731
    transform = view.get("transform", "none")
    if family == "scatter":
        if len(ids) != 2 or transform != "none":
            raise VizError("a scatter pairs exactly two datasets over time (x, y)")
        xi, yi = ids
        pts = [t for t in _common(project, ids) if (not view.get("from") or t >= view["from"]) and (not view.get("to") or t <= view["to"])]
        pts.sort(key=lambda t: val(xi, t))
        return {"shape": "pairs", "categories": [_num(val(xi, t)) for t in pts], "x": [val(xi, t) for t in pts],
                "series": [{"name": _names(project, [yi])[0], "values": [val(yi, t) for t in pts]}]}
    if transform == "none":
        dates = sorted({t for i in ids for t in eff[i]})
        dates = [t for t in dates if (not view.get("from") or t >= view["from"]) and (not view.get("to") or t <= view["to"])]
        return {"shape": "time", "categories": dates, "series": [{"name": n, "values": [val(i, t) for t in dates]} for i, n in zip(ids, _names(project, ids))]}
    metric = _ds(project, ids[0])["title"].split(" · ", 1)[-1] if " · " in _ds(project, ids[0])["title"] else _ds(project, ids[0])["metric"]
    entities = [_ds(project, i)["entity"] for i in ids]
    if transform in ("latest", "at", "rank"):
        period = view.get("at") if transform == "at" else (view.get("at") or (_common(project, ids) or [None])[-1])
        if not period:
            raise VizError("the datasets share no period with data; pick one (at)")
        rows = [(e, val(i, period)) for i, e in zip(ids, entities)]
        if transform == "rank":
            sign = 1 if view.get("order") == "asc" else -1
            rows.sort(key=lambda r: (r[1] is None, sign * (r[1] or 0)))
        return {"shape": "cross", "categories": [r[0] for r in rows], "series": [{"name": f"{metric} {period}", "values": [r[1] for r in rows]}]}
    if transform == "pair":
        common = _common(project, ids)
        a, b = view.get("between") or ((common[0], common[-1]) if common else (None, None))
        if not a or not b or a == b:
            raise VizError("a two-period comparison needs two different periods (between)")
        return {"shape": "cross", "categories": entities, "series": [{"name": a, "values": [val(i, a) for i in ids]}, {"name": b, "values": [val(i, b) for i in ids]}]}
    if transform == "bridge":
        if len(ids) != 1:
            raise VizError("a bridge follows one dataset from one period to another")
        i = ids[0]
        have = sorted(t for t, o in eff[i].items() if o["value"] is not None)
        a, b = view.get("between") or ((have[0], have[-1]) if have else (None, None))
        if not a or not b or a >= b:
            raise VizError("a bridge needs a start period before its end period (between)")
        dates = sorted(t for t in eff[i] if a <= t <= b)
        vs = [val(i, t) for t in dates]
        deltas = [None if x is None or y is None else round(y - x, 6) for x, y in zip(vs, vs[1:])]
        return {"shape": "cross", "categories": [a, *[f"{t} change" for t in dates[1:]], b], "series": [{"name": metric, "values": [vs[0], *deltas, vs[-1]]}]}
    common = _common(project, ids)
    a, b = view.get("between") or ((common[0], common[-1]) if common else (None, None))
    if not a or not b or a == b:
        raise VizError("a change needs two different periods (between)")
    pct = transform == "pct_change"
    out = []
    for i in ids:
        va, vb = val(i, a), val(i, b)
        v = None if va is None or vb is None or (pct and va == 0) else ((vb / va - 1) * 100 if pct else vb - va)
        out.append(None if v is None else round(v, 6))
    return {"shape": "cross", "categories": entities, "series": [{"name": f"{a}–{b}", "values": out}]}


def _ratings(project: dict, view: dict) -> dict:
    """Rating actions with a verified date, one series per agency, values = notch (for drawing only)."""
    pts = []
    for eid in view.get("evidence") or []:
        r = (project.get("evidence", {}).get(eid) or {}).get("rating")
        if not r:
            raise VizError(f"evidence {eid} is not a rating action")
        n = notch(r.get("rating"))
        if n is None:
            raise VizError(f"“{r.get('rating')}” is not a symbol on the long-term rating scale")
        if r.get("date"):
            pts.append((r["date"], r["agency"], n, eid))
    pts.sort(key=lambda x: (x[0], x[1]))
    dates = sorted({x[0] for x in pts})
    agencies = list(dict.fromkeys(x[1] for x in pts))
    return {"shape": "ratings", "categories": dates, "points": pts,
            "series": [{"name": ag, "values": [next((x[2] for x in pts if x[1] == ag and x[0] == t), None) for t in dates]} for ag in agencies]}


def _num(v: float) -> str:
    """Number text as JavaScript's String(v) writes it (scatter x categories)."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def realized(project: dict, spec: dict) -> dict:
    """The categories and series values the slide's chart must carry (horizontal rankings read top-down)."""
    pr = project_view(project, spec)
    if spec["family"] in COMPOSITE:
        return pr
    if spec["family"] == "bar" and pr["shape"] == "cross":
        pr = {**pr, "categories": pr["categories"][::-1], "series": [{**s, "values": s["values"][::-1]} for s in pr["series"]]}
    return pr


def validate_spec(spec: dict) -> list[str]:
    try:
        VizSpec.model_validate(spec)
        return []
    except Exception as exc:  # pydantic ValidationError: report the first problems
        return [str(exc).splitlines()[0][:200]]
