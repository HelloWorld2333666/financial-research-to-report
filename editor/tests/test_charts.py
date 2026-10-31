import copy

import pytest

import build_workspace_demo
import charts
import slidemodel as sm

from .helpers import el


@pytest.fixture
def demo():
    return build_workspace_demo.build()


def codes(issues):
    return {i["code"] for i in issues}


def test_demo_project_is_valid_and_flags_sample_data(demo):
    assert sm.validate_project(demo) == []
    issues = sm.check_integrity(demo)
    assert codes(issues) == {"sample_data_on_slide", "manual_edits_unverified"}
    assert all(i["slide_id"] in ("s-france-debt", "s-markets") for i in issues)  # China Re slide stays clean


def test_chart_series_come_from_datasets_without_interpolation(demo):
    s = charts.chart_series(demo, "ch.debt")
    assert s["x"] == [str(y) for y in range(2002, 2027)]
    italy = next(x for x in s["series"] if x["label"] == "Italy")
    assert italy["values"][3] is None  # the missing year stays a gap
    for x in s["series"]:
        obs = [o["value"] for o in charts.effective_observations(demo["datasets"][x["dataset"]])]
        assert x["values"] == obs  # plotted == working view, one for one


def test_working_edit_drives_chart_but_source_is_kept(demo):
    ds = demo["datasets"]["ds.fr.debt_gdp"]
    work, source = ds["working"]["2024"], ds["observations"][22]
    france = charts.chart_series(demo, "ch.debt")["series"][0]
    assert france["values"][22] == work["value"] != source["value"]  # geometry follows the working value
    eff = charts.effective_observations(ds)[22]
    assert eff["source_value"] == source["value"] and eff["edited"] and eff["status"] == "manual_unverified"
    msgs = [i["message"] for i in sm.check_integrity(demo) if i["code"] == "manual_edits_unverified"]
    assert msgs and all("1 manually edited observation — pending verification" in m for m in msgs)
    del ds["working"]["2024"]  # "restore original"
    assert charts.chart_series(demo, "ch.debt")["series"][0]["values"][22] == source["value"]


def test_added_and_removed_observations(demo):
    ds = demo["datasets"]["ds.de.debt_gdp"]
    ds["working"]["2027"] = {"value": 70.0, "status": "manual_unverified"}
    ds["working"]["2010"] = {"deleted": True, "status": "manual_unverified"}
    demo["charts"]["ch.debt"]["x"]["to"] = "2027"
    s = charts.chart_series(demo, "ch.debt")
    de = next(x for x in s["series"] if x["label"] == "Germany")
    assert s["x"][-1] == "2027" and de["values"][-1] == 70.0
    assert de["values"][s["x"].index("2010")] is None  # removed → a gap, not a bridged line
    fr = next(x for x in s["series"] if x["label"] == "France")
    assert fr["values"][-1] is None  # France has no 2027 observation: nothing fabricated
    assert sm.validate_project(demo) == []


def test_snapshot_bar_chart_one_bar_per_series(demo):
    s = charts.chart_series(demo, "ch.debt_bar")
    assert s["x"] == ["France", "Germany", "Italy"]
    assert s["series"][0]["values"] == [charts.effective_observations(demo["datasets"][f"ds.{c}.debt_gdp"])[-1]["value"] for c in ("fr", "de", "it")]
    demo["charts"]["ch.debt_bar"]["series"].pop(1)  # remove Germany
    assert charts.chart_series(demo, "ch.debt_bar")["x"] == ["France", "Italy"]


def test_manual_table_and_bar_edits_are_reported(demo):
    t = el(demo, "cr-table")
    t["rows"][0]["cells"][0]["working"] = {"value": 85.0, "status": "manual_unverified"}
    t["rows"].append({"label": "New row", "cells": [{"value": 1.0}, {"text": "n/a"}, {"text": ""}]})
    bars = el(demo, "seg-chart")["bars"]
    bars[0]["working"] = {"value": 50000, "status": "manual_unverified"}
    issues = [i for i in sm.check_integrity(demo) if i["code"] == "manual_edits_unverified" and i["element_id"] in ("cr-table", "seg-chart")]
    assert {i["element_id"]: i["message"].split(" ")[0] for i in issues} == {"cr-table": "2", "seg-chart": "1"}
    assert t["rows"][0]["cells"][0]["evidence_id"] == "ev.cr.cr.overseas_pc_chaucer.fy2024"  # source link kept


def test_range_restricts_points(demo):
    demo["charts"]["ch.debt"]["x"] = {"from": "2020", "to": "2024"}
    assert charts.chart_series(demo, "ch.debt")["x"] == ["2020", "2021", "2022", "2023", "2024"]


def test_compatibility_reports_mixed_frequency_and_units(demo):
    ok = charts.compatibility(demo, ["ds.fr.debt_gdp", "ds.de.debt_gdp", "ds.it.debt_gdp"])
    assert ok["ok"] and ok["frequency"] == "annual" and ok["gaps"] == ["Italy · general government debt: 2005"]
    bad = charts.compatibility(demo, ["ds.fr.debt_gdp", "ds.fr.primary_balance_q", "ds.fr.y10_m"])
    assert not bad["ok"]
    assert any("mixed frequency" in i for i in bad["issues"]) and any("mixed unit" in i for i in bad["issues"])


@pytest.mark.parametrize("mutate,expected", [
    (lambda p: p["charts"]["ch.debt"]["series"][0].__setitem__("values", [1, 2, 3]), "must not store values"),
    (lambda p: p["charts"]["ch.debt"].__setitem__("data", [1]), "must not store values"),
    (lambda p: p["charts"]["ch.debt"]["series"][0].__setitem__("dataset", "ds.none"), "unknown dataset"),
    (lambda p: p["datasets"]["ds.fr.debt_gdp"].__setitem__("frequency", "sometimes"), "frequency must be"),
    (lambda p: el(p, "el-debt-chart").__setitem__("chart_id", "ch.none"), "unknown chart"),
])
def test_invalid_specs_are_rejected(demo, mutate, expected):
    mutate(demo)
    assert any(expected in e for e in sm.validate_project(demo))


def test_mixing_incomparable_series_in_a_chart_is_an_error(demo):
    demo["charts"]["ch.debt"]["series"].append({"dataset": "ds.fr.primary_balance_q", "label": "PB"})
    assert "incomparable_series" in codes(sm.check_integrity(demo))


def test_moving_and_restyling_a_chart_keeps_its_values(demo):
    before = charts.chart_series(demo, "ch.debt")
    c = el(demo, "el-debt-chart")
    c.update(x=60, w=900, h=480, style={"palette": "alt"})
    demo["charts"]["ch.debt"]["labels"] = "legend"
    assert charts.chart_series(demo, "ch.debt") == before


@pytest.mark.parametrize("text,nums", [
    ("10-year benchmark yields", set()), ("FRANCE · 10Y YIELDS", set()), ("5Y CDS", set()),
    ("Yield rose to 10 percent", {"10"}), ("Debt reached 112.5% in 2024", {"112.5", "2024"}),
])
def test_tenors_are_not_figures(text, nums):
    assert sm.numbers_in(text) == nums
