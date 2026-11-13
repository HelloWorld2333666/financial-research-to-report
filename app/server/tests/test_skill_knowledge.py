"""The in-app AI's connection to the design Skill: selective card retrieval and plan repair (no model needed)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import skill_knowledge as sk  # noqa: E402
import agent as A  # noqa: E402


def test_cards_are_read_from_the_skill():
    ids = set(sk._cards())
    assert {"ROUTER", "V07", "V10", "P5", "S1", "S2", "DK"} <= ids and len(ids) >= 30


def test_selection_is_selective_and_follows_the_objective():
    trend = sk.select("Inflation since 2019 in five countries; highlight Colombia", ["trend"])
    assert trend[:2] == ["V07", "V08"] and "S1" in trend and "M1" in trend and "V10" not in trend
    geo = sk.select("How shipping disruption through the Strait of Hormuz reaches Gulf budgets", ["causality"], "evidence")
    assert "V11" in geo and "V10" in geo
    assert sk.select("Open the deck", role="cover")[:2] == ["P5", "S2"]
    assert all(len(sk.select("x " * 50, ["trend", "ranking", "change", "composition"], "dashboard", True)) <= sk.MAX_CARDS for _ in range(1))


def test_guidance_is_condensed_with_the_hard_rules():
    g = sk.guidance("ranking of debt across countries", ["ranking"])
    assert all(len(c["guidance"]) <= 1500 and "**Status**" not in c["guidance"] for c in g["cards"])
    assert "Bars start at zero" in g["rules"] and "Every figure is bound to evidence" in g["rules"]


def test_plan_repair_lifts_objects_and_assigns_slots():
    plan = {"claim": "c", "composition": {"kind": "columns", "objects": [
        {"id": "chart", "kind": "viz", "slot": "chart", "request": {}}, {"id": "t", "kind": "text", "role": "exhibit", "text": "x"},
        {"id": "n", "kind": "text", "role": "note", "text": "y"}],
        "params": {"columns": [{"span": 8, "slots": ["exhibit", "chart"]}, {"span": 4, "slots": ["kpi", "note"]}]}}}
    out, fixed = A.normalize_plan(plan)
    assert "objects" not in out["composition"] and {o["id"]: o["slot"] for o in out["objects"]} == {"chart": "chart", "t": "exhibit", "n": "note"}
    assert fixed[0] == "objects moved out of the composition"
