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
# Government debt by remaining maturity (VIS V4, maturity ladder): non-overlapping buckets that add up to the total
MATURITY = [("rmd_le1", "Y_LE1", "1 year or less"), ("rmd_1_5", "Y1-5", "1 to 5 years"), ("rmd_5_10", "Y5-10", "5 to 10 years"),
            ("rmd_10_30", "Y10-30", "10 to 30 years"), ("rmd_gt30", "Y_GT30", "over 30 years")]
for _k, _code, _label in MATURITY:
    METRICS[_k] = ("gov_10dd_rmd", {"sector": "S13", "na_item": "GD", "unit": "PC_GDP", "maturity": _code}, f"Debt maturing in {_label}", "% of GDP")
METRICS["rmd_total"] = ("gov_10dd_rmd", {"sector": "S13", "na_item": "GD", "unit": "PC_GDP", "maturity": "TOTAL"}, "Debt by remaining maturity, total", "% of GDP")
# Euro-area government yield curves (VIS V4): one request per curve returns every tenor (agent.fetch_curve)
CURVES = {"yc_all": ("irt_euryld_m", {"yld_curv": "SPOT_RT", "bonds": "CGB_EA"}, "Euro-area government bond spot yield (all ratings)"),
          "yc_aaa": ("irt_euryld_m", {"yld_curv": "SPOT_RT", "bonds": "CGB_EA_AAA"}, "Euro-area AAA government bond spot yield")}
# what a research request can name besides single metrics
GROUPS = {"fiscal": ["debt", "deficit", "interest", "growth", "yield"], "maturity": [k for k, *_ in MATURITY] + ["rmd_total"], "yield_curve": list(CURVES)}
EU27 = ["BE", "BG", "CZ", "DK", "DE", "EE", "IE", "EL", "ES", "FR", "HR", "IT", "CY", "LV", "LT", "LU", "HU", "MT", "NL", "AT", "PL", "PT", "RO", "SI", "SK", "FI", "SE"]
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
# maturity buckets are parts of ONE country's debt: "{geo}" is filled in per dataset, so France's buckets never
# add up with Italy's; bucket.order keeps the ladder in maturity order
for _i, (_k, _code, _label) in enumerate(MATURITY):
    MEASURES[_k] = {"kind": "debt_by_maturity", "of": "GDP", "signed": False, "additive_parts_of": "{geo}.debt_by_maturity", "scale": "interval",
                    "bucket": {"order": _i, "label": _label}}
MEASURES["rmd_total"] = {"kind": "debt_by_maturity_total", "of": "GDP", "signed": False, "additive_parts_of": None, "scale": "interval"}


def measure_for(metric: str, geo: str) -> dict:
    m = json.loads(json.dumps(MEASURES[metric]))
    if m.get("additive_parts_of"):
        m["additive_parts_of"] = m["additive_parts_of"].replace("{geo}", geo.lower())
    return m
NAMES = {"EA": "Euro area", "FR": "France", "DE": "Germany", "IT": "Italy", "ES": "Spain", "NL": "Netherlands", "BE": "Belgium", "AT": "Austria", "PT": "Portugal",
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
