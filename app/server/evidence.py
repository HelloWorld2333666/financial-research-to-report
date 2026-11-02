"""Evidence Core for the workspace: projects built from verified ResearchRecords.

A project holds datasets (observations bound to evidence ids, plus a working layer for manual edits),
the evidence records themselves, gaps, and the deck's design tokens. Numbers on slides are always
projected from here; the model never supplies them (Experiment 2).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

PROJECT_SCHEMA = "frr-project/1"
SEEDS = Path(__file__).resolve().parent / "seeds"

# metric key -> (Eurostat dataset, fixed filters, label, unit)
METRICS = {
    "debt": ("gov_10dd_edpt1", {"na_item": "GD", "sector": "S13", "unit": "PC_GDP"}, "General government gross debt", "% of GDP"),
    "deficit": ("gov_10dd_edpt1", {"na_item": "B9", "sector": "S13", "unit": "PC_GDP"}, "Government deficit (-) / surplus (+)", "% of GDP"),
    "interest": ("gov_10a_main", {"na_item": "D41PAY", "sector": "S13", "unit": "PC_GDP"}, "Interest payable", "% of GDP"),
    "growth": ("nama_10_gdp", {"na_item": "B1GQ", "unit": "CLV_PCH_PRE"}, "Real GDP growth", "%"),
    "yield": ("irt_lt_mcby_a", {}, "10-year government bond yield", "%"),
}
# metric key -> what kind of measure it is (VIS V2). Visual rules read this instead of guessing: a ratio of
# GDP for several countries is not a set of parts of one total, so it can never be a pie or a stack.
# additive_parts_of names the total a dataset is a part of (None = not additive across datasets).
MEASURES = {
    "debt": {"kind": "ratio", "of": "GDP", "signed": False, "additive_parts_of": None, "scale": "interval"},
    "deficit": {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"},
    "interest": {"kind": "ratio", "of": "GDP", "signed": False, "additive_parts_of": None, "scale": "interval"},
    "growth": {"kind": "rate", "of": None, "signed": True, "additive_parts_of": None, "scale": "interval"},
    "yield": {"kind": "rate", "of": None, "signed": False, "additive_parts_of": None, "scale": "interval"},
}
NAMES = {"FR": "France", "DE": "Germany", "IT": "Italy", "ES": "Spain", "NL": "Netherlands", "BE": "Belgium", "AT": "Austria", "PT": "Portugal",
         "EL": "Greece", "IE": "Ireland", "FI": "Finland", "LU": "Luxembourg", "SK": "Slovakia", "SI": "Slovenia", "LT": "Lithuania",
         "LV": "Latvia", "EE": "Estonia", "CY": "Cyprus", "MT": "Malta", "HR": "Croatia", "PL": "Poland", "SE": "Sweden", "DK": "Denmark",
         "CZ": "Czechia", "HU": "Hungary", "RO": "Romania", "BG": "Bulgaria"}
DESIGN_DNA = {"font": "Inter", "ink": "#0f2742", "accent": "#c8102e", "muted": "#5b6b7f", "rule": "#0f2742",
              "series": ["#1f4e9c", "#c8102e", "#2e8b57", "#b8860b"]}


def metric_of(dataset: str, filters: dict) -> str | None:
    for key, (ds, fixed, *_rest) in METRICS.items():
        if ds == dataset and all(filters.get(a) == b for a, b in fixed.items()):
            return key
    return None


def project_from_record(record: dict, project_id: str, title: str) -> dict:
    sources = {s["id"]: s for s in record["sources"]}
    datasets: dict[str, dict] = {}
    evidence: dict[str, dict] = {}
    for e in record["evidence"]:
        m = re.match(r"(\S+) (\{.*\}) @ (\S+)", e.get("locator") or "")
        if not m:
            continue
        dataset, filters, period = m.group(1), json.loads(m.group(2)), m.group(3)
        key = metric_of(dataset, filters)
        if not key:
            continue
        geo, src = filters["geo"], sources[e["source_id"]]
        did = f"ds.{geo.lower()}.{key}"
        ds = datasets.setdefault(did, {
            "id": did, "title": f"{NAMES.get(geo, geo)} · {METRICS[key][2].lower()}", "entity": NAMES.get(geo, geo), "geo": geo,
            "metric": key, "unit": METRICS[key][3], "measure": dict(MEASURES[key]), "frequency": "annual", "origin": "eurostat", "verification": "verified",
            "source_url": src["url"], "source_note": f"Eurostat {dataset} ({src['accessed_date']})", "observations": [], "working": {}})
        if not any(o["date"] == period for o in ds["observations"]):
            ds["observations"].append({"date": period, "value": e["value"], "status": "verified", "evidence_id": e["id"]})
        evidence[e["id"]] = {**e, "source_title": src["title"], "source_url": src["url"]}
    for ds in datasets.values():
        ds["observations"].sort(key=lambda o: o["date"])
    return {"schema": PROJECT_SCHEMA, "id": project_id, "title": title, "record_id": record["record_id"],
            "datasets": datasets, "evidence": evidence, "derivations": {}, "gaps": record.get("gaps", []), "design_dna": dict(DESIGN_DNA)}


def seed_project(seed: str, project_id: str, title: str) -> dict:
    if seed == "france":
        return project_from_record(json.loads((SEEDS / "france-record.json").read_text()), project_id, title)
    if seed == "blank":
        return {"schema": PROJECT_SCHEMA, "id": project_id, "title": title, "datasets": {}, "evidence": {}, "derivations": {}, "gaps": [], "design_dna": dict(DESIGN_DNA)}
    raise ValueError(f"unknown seed {seed!r}")
