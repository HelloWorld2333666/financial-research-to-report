"""Datasets and deterministic chart specifications.

A project may hold ``datasets`` (series of dated observations with unit,
frequency and observation type) and ``charts`` (ChartSpecs). A ChartSpec
references datasets and never stores values: what is plotted is always derived
from the dataset by ``chart_series``. Missing observations stay ``None`` (a gap
in the line); nothing is interpolated.

Slide elements use them through two element types:
  ``chart``      {"chart_id": ...}
  ``datatable``  {"dataset_ids": [...], "dates": [...]}  (cells read from datasets)
"""

from __future__ import annotations

FREQUENCIES = {"annual", "quarterly", "monthly", "daily", "point"}
OBSERVATION_TYPES = {"annual_average", "end_of_period", "point_in_time", "flow"}
CHART_TYPES = {"line", "bar"}
VALUE_KEYS = {"values", "data", "points"}  # a spec (or series) holding any of these is storing numbers


def _dataset(project: dict, dataset_id: str) -> dict | None:
    return project.get("datasets", {}).get(dataset_id)


def compatibility(project: dict, dataset_ids: list[str]) -> dict:
    """Can these datasets share one chart axis? Mixed units, frequencies or
    observation types are reported rather than silently combined."""
    sets = [(i, _dataset(project, i)) for i in dataset_ids]
    issues = [f"unknown dataset {i}" for i, d in sets if d is None]
    found = [d for _, d in sets if d is not None]
    out = {"ok": False, "issues": issues}
    for field in ("unit", "frequency", "observation_type"):
        vals = sorted({d.get(field) for d in found})
        out[field] = vals[0] if len(vals) == 1 else None
        if len(vals) > 1:
            issues.append(f"mixed {field.replace('_', ' ')}: {', '.join(map(str, vals))}")
    gaps = [f"{d.get('title')}: {o['date']}" for d in found for o in d.get("observations", []) if o.get("value") is None]
    out["gaps"] = gaps
    out["ok"] = bool(found) and not issues
    return out


def current_value(obs: dict) -> float | None:
    return obs.get("value")


def chart_series(project: dict, chart_id: str) -> dict:
    """Plotted series for a ChartSpec, aligned on the union of dates in range.

    Values come straight from the datasets; a date a series does not have is
    ``None``. User revisions are *not* applied: they are shown as pending until
    verified (see ``revisions`` on the dataset)."""
    spec = project["charts"][chart_id]
    lo, hi = (spec.get("x") or {}).get("from"), (spec.get("x") or {}).get("to")
    in_range = lambda d: (lo is None or str(d) >= str(lo)) and (hi is None or str(d) <= str(hi))
    by_series = []
    dates: set[str] = set()
    for s in spec.get("series", []):
        ds = _dataset(project, s["dataset"]) or {}
        obs = {str(o["date"]): current_value(o) for o in ds.get("observations", []) if in_range(o["date"])}
        dates |= set(obs)
        by_series.append((s, obs))
    x = sorted(dates)
    return {"x": x, "series": [{"label": s.get("label"), "dataset": s["dataset"], "values": [obs.get(d) for d in x]}
                               for s, obs in by_series]}


def element_dataset_ids(el: dict, project: dict) -> list[str]:
    if el.get("type") == "chart":
        spec = project.get("charts", {}).get(el.get("chart_id"), {})
        return [s.get("dataset") for s in spec.get("series", [])]
    if el.get("type") == "datatable":
        return list(el.get("dataset_ids", []))
    return []


def element_evidence_ids(el: dict, project: dict) -> set[str]:
    ids = set()
    for did in element_dataset_ids(el, project):
        for o in (_dataset(project, did) or {}).get("observations", []):
            if o.get("evidence_id"):
                ids.add(o["evidence_id"])
    return ids


def validate(project: dict) -> list[str]:
    """Structural errors in datasets and charts."""
    errors: list[str] = []
    datasets, charts = project.get("datasets", {}), project.get("charts", {})
    if not isinstance(datasets, dict) or not isinstance(charts, dict):
        return ["datasets and charts must be objects"]
    for did, d in datasets.items():
        if d.get("frequency") not in FREQUENCIES:
            errors.append(f"dataset {did}: frequency must be one of {sorted(FREQUENCIES)}")
        if d.get("observation_type") not in OBSERVATION_TYPES:
            errors.append(f"dataset {did}: observation_type must be one of {sorted(OBSERVATION_TYPES)}")
        for o in d.get("observations", []):
            if "date" not in o or not (o.get("value") is None or isinstance(o.get("value"), (int, float))):
                errors.append(f"dataset {did}: observation needs a date and a numeric or null value")
                break
    for cid, c in charts.items():
        if c.get("type") not in CHART_TYPES:
            errors.append(f"chart {cid}: type must be one of {sorted(CHART_TYPES)}")
        if VALUE_KEYS & set(c) or any((VALUE_KEYS | {"y"}) & set(s) for s in c.get("series", [])):
            errors.append(f"chart {cid}: chart specs reference datasets and must not store values")
        for s in c.get("series", []):
            if s.get("dataset") not in datasets:
                errors.append(f"chart {cid}: unknown dataset {s.get('dataset')}")
    for el in project.get("elements", []):
        if el.get("type") == "chart" and el.get("chart_id") not in charts:
            errors.append(f"{el.get('id')}: unknown chart {el.get('chart_id')}")
    return errors


def integrity(project: dict, slide_of) -> list[dict]:
    """Data-safety issues for chart and datatable elements."""
    issues = []
    datasets = project.get("datasets", {})
    for el in project.get("elements", []):
        ids = element_dataset_ids(el, project)
        if not ids:
            continue
        add = lambda level, code, msg: issues.append(dict(level=level, code=code, element_id=el["id"], message=msg,
                                                          slide_id=slide_of(el)))
        unknown = [i for i in ids if i not in datasets]
        if unknown:
            add("error", "dangling_ref", f"references unknown dataset(s) {', '.join(map(str, unknown))}")
        known = [datasets[i] for i in ids if i in datasets]
        synthetic = [d["title"] for d in known if d.get("origin") == "synthetic"]
        if synthetic:
            add("warning", "sample_data_on_slide", f"shows SAMPLE (synthetic) data: {', '.join(synthetic)}; not real statistics")
        unverified = [d["title"] for d in known if d.get("verification") not in ("verified", "sample")]
        if unverified:
            add("warning", "unverified_value", f"shows unverified dataset(s): {', '.join(unverified)}")
        pending = [f"{d['title']} {r['date']}" for d in known for r in d.get("revisions", []) if r.get("status") == "pending_verification"]
        if pending:
            add("warning", "revision_pending_verification", f"user revision awaiting verification (not plotted): {'; '.join(pending)}")
        if el["type"] == "chart":
            c = compatibility(project, [i for i in ids if i in datasets])
            if not c["ok"] and not unknown:
                add("error", "incomparable_series", "; ".join(c["issues"]))
    return issues
