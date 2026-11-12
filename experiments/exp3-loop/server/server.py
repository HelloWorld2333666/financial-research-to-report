"""Experiment 3 backend: AG-UI agent (local Qwen via PydanticAI) + Evidence Core endpoints.

  POST /api/agent        AG-UI run. Tools return *proposals* in our semantic vocabulary; the browser
                         compiles them to GenOffice pptx-ops, previews them on a cloned deck, and applies
                         them only on the user's approval. The model never supplies numbers (Experiment 2).
  GET  /api/project      project JSON built from Experiment 2's verified ResearchRecord
  GET  /api/tasks        background tasks (status + resulting proposal)

Run: .venv/bin/python -I server.py   (port 8790)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
import trafilatura
import uvicorn
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.providers.ollama import OllamaProvider
from pydantic_ai.ui import StateDeps
from pydantic_ai.ui.ag_ui import AGUIAdapter
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

HERE = Path(__file__).parent
RECORD = HERE.parent.parent / "exp2" / "out" / "record.json"
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
UA = {"User-Agent": "frr-research-exp/0.1 (research prototype)"}

# metric key -> (dataset, fixed filters, label, unit)
METRICS = {
    "debt": ("gov_10dd_edpt1", {"na_item": "GD", "sector": "S13", "unit": "PC_GDP"}, "General government gross debt", "% of GDP"),
    "deficit": ("gov_10dd_edpt1", {"na_item": "B9", "sector": "S13", "unit": "PC_GDP"}, "Government deficit (-) / surplus (+)", "% of GDP"),
    "interest": ("gov_10a_main", {"na_item": "D41PAY", "sector": "S13", "unit": "PC_GDP"}, "Interest payable", "% of GDP"),
    "growth": ("nama_10_gdp", {"na_item": "B1GQ", "unit": "CLV_PCH_PRE"}, "Real GDP growth", "%"),
    "yield": ("irt_lt_mcby_a", {}, "10-year government bond yield", "%"),
}
NAMES = {"FR": "France", "DE": "Germany", "IT": "Italy", "ES": "Spain", "NL": "Netherlands", "BE": "Belgium", "AT": "Austria", "PT": "Portugal"}


def metric_of(dataset: str, filters: dict) -> Optional[str]:
    for k, (ds, f, *_rest) in METRICS.items():
        if ds == dataset and all(filters.get(a) == b for a, b in f.items()):
            return k
    return None


# ------------------------------------------------------------------ Evidence Core: project from the verified record
def build_project() -> dict:
    rec = json.loads(RECORD.read_text())
    src = {s["id"]: s for s in rec["sources"]}
    datasets: dict[str, dict] = {}
    evidence: dict[str, dict] = {}
    for e in rec["evidence"]:
        m = re.match(r"(\S+) (\{.*\}) @ (\S+)", e.get("locator") or "")
        if not m:
            continue
        dataset, filters, period = m.group(1), json.loads(m.group(2)), m.group(3)
        key = metric_of(dataset, filters)
        if not key:
            continue
        geo = filters["geo"]
        did = f"ds.{geo.lower()}.{key}"
        ds = datasets.setdefault(did, {"id": did, "title": f"{NAMES.get(geo, geo)} · {METRICS[key][2].lower()}", "entity": NAMES.get(geo, geo),
                                       "geo": geo, "metric": key, "unit": METRICS[key][3], "frequency": "annual",
                                       "origin": "eurostat", "verification": "verified", "source_url": src[e["source_id"]]["url"],
                                       "source_note": f"Eurostat {dataset} ({src[e['source_id']]['accessed_date']})", "observations": [], "working": {}})
        if not any(o["date"] == period for o in ds["observations"]):
            ds["observations"].append({"date": period, "value": e["value"], "status": "verified", "evidence_id": e["id"]})
        evidence[e["id"]] = {**e, "source_title": src[e["source_id"]]["title"], "source_url": src[e["source_id"]]["url"]}
    for ds in datasets.values():
        ds["observations"].sort(key=lambda o: o["date"])
    return {"id": "france-sovereign", "title": "France sovereign credit (Experiment 3)", "record_id": rec["record_id"],
            "datasets": datasets, "evidence": evidence, "gaps": rec["gaps"], "design_dna": {
                "font": "Liberation Sans", "ink": "#0f2742", "accent": "#c8102e", "muted": "#5b6b7f", "rule": "#0f2742",
                "series": ["#1f4e9c", "#c8102e", "#2e8b57", "#b8860b"]}}


PROJECT = build_project()


# ------------------------------------------------------------------ live retrieval with capture + independent re-fetch (Experiment 2 validator)
def eurostat(dataset: str, filters: dict, since: str) -> tuple[str, dict[str, float]]:
    params = {"format": "JSON", "sinceTimePeriod": since, **filters}
    url = EUROSTAT + dataset + "?" + urlencode(sorted(params.items()))
    d = httpx.get(url, timeout=40, headers=UA).json()
    if "value" not in d:
        raise ValueError(d.get("error", {}).get("label") or "no data")
    inv = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    return url, dict(sorted({inv[int(i)]: float(v) for i, v in d["value"].items()}.items()))


def fetch_verified_dataset(metric: str, geo: str, since: str) -> dict:
    dataset, fixed, label, unit = METRICS[metric]
    url, obs = eurostat(dataset, {**fixed, "geo": geo}, since)
    _, obs2 = eurostat(dataset, {**fixed, "geo": geo}, since)  # independent re-fetch
    accepted = {p: v for p, v in obs.items() if obs2.get(p) == v}
    did = f"ds.{geo.lower()}.{metric}"
    today = datetime.now(timezone.utc).date().isoformat()
    ev, observations = {}, []
    for p, v in accepted.items():
        eid = f"ev.live.{geo.lower()}.{metric}.{p}"
        ev[eid] = {"id": eid, "kind": "metric_value", "statement": f"{label} [{dataset} {geo}] {p}: {v:g}", "value": v, "unit": unit,
                   "period": p, "locator": f"{dataset} {json.dumps({**fixed, 'geo': geo}, sort_keys=True)} @ {p}",
                   "verification": "verified", "verified_by": "exp3-live-validator", "verified_on": today, "source_url": url,
                   "source_title": label}
        observations.append({"date": p, "value": v, "status": "verified", "evidence_id": eid})
    return {"dataset": {"id": did, "title": f"{NAMES.get(geo, geo)} · {label.lower()}", "entity": NAMES.get(geo, geo), "geo": geo,
                        "metric": metric, "unit": unit, "frequency": "annual", "origin": "eurostat", "verification": "verified",
                        "source_url": url, "source_note": f"Eurostat {dataset} ({today}, live)", "observations": observations, "working": {}},
            "evidence": ev, "rejected": len(obs) - len(accepted)}


# ------------------------------------------------------------------ deterministic composer (the model chooses; code writes numbers)
def series(did: str) -> dict[str, float]:
    return {o["date"]: o["value"] for o in PROJECT["datasets"].get(did, {}).get("observations", [])}


def fmt(v: float, d: int = 1) -> str:
    return f"{v:.{d}f}"


def compose(geo: str = "FR", peer: str = "DE") -> list[dict]:
    g, p = geo.lower(), peer.lower()
    name, pname = NAMES.get(geo, geo), NAMES.get(peer, peer)
    debt, debt_p = series(f"ds.{g}.debt"), series(f"ds.{p}.debt")
    defi, intr = series(f"ds.{g}.deficit"), series(f"ds.{g}.interest")
    grow, yld, yld_p = series(f"ds.{g}.growth"), series(f"ds.{g}.yield"), series(f"ds.{p}.yield")
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
                       "chart": {"type": "line", "title": "Deficit (-) / surplus (+), % of GDP", "series": [f"ds.{g}.deficit"] + ([f"ds.{p}.deficit"] if series(f"ds.{p}.deficit") else [])},
                       "table": {"title": "Interest payable, % of GDP", "datasets": [f"ds.{g}.interest"] + ([f"ds.{p}.interest"] if series(f"ds.{p}.interest") else []), "dates": sorted(intr)[-3:]}})
    if grow and yld:
        yg, yy = last(grow), last(yld)
        spread = (yld[yy] - yld_p[yy]) * 100 if yld_p and yy in yld_p else None
        slides.append({"key": "market", "kicker": f"{name.upper()} · GROWTH & MARKETS", "title": f"Growth slowed to {fmt(grow[yg])}% in {yg}" + (f"; the 10-year spread over {pname} was {spread:.0f} bp in {yy}" if spread is not None else ""),
                       "subtitle": "Real GDP growth, %; 10-year government bond yields, % · Eurostat (nama_10_gdp, irt_lt_mcby_a)",
                       "chart": {"type": "line", "title": "Real GDP growth, %", "series": [f"ds.{g}.growth"] + ([f"ds.{p}.growth"] if series(f"ds.{p}.growth") else [])},
                       "table": {"title": "10-year yield, %", "datasets": [f"ds.{g}.yield"] + ([f"ds.{p}.yield"] if yld_p else []), "dates": sorted(yld)[-3:]},
                       "derived": ({"spread_bp": round(spread), "inputs": [f"ds.{g}.yield@{yy}", f"ds.{p}.yield@{yy}"]} if spread is not None else None)})
    slides.append({"key": "ratings", "kicker": f"{name.upper()} · RATINGS", "title": "Rating actions: pending a primary source",
                   "subtitle": "Agency press releases are not machine-accessible (bot protection / JavaScript apps); upload them or connect a data feed",
                   "placeholder": {"label": "Rating history — pending research", "request": {"schema": "frr-research-request/0.1", "topic": "rating actions", "entity": name,
                                   "reason": "primary sources blocked in Experiment 2 (S&P 403, AFT 403, Fitch/Moody's JavaScript)"}}})
    return slides


# ------------------------------------------------------------------ agent
class Selection(BaseModel):
    id: str
    kind: str
    label: Optional[str] = None
    chart_metric: Optional[str] = None
    datasets: list[str] = []


class WorkspaceState(BaseModel):
    thread: str = "project"  # "project" or a slide id
    slide: Optional[str] = None
    selection: list[Selection] = []


MODEL = OllamaModel("qwen2.5:14b", provider=OllamaProvider(base_url="http://localhost:11434/v1"))
agent = Agent(MODEL, deps_type=StateDeps[WorkspaceState], retries=2)


@agent.instructions
def instructions(ctx: RunContext[StateDeps[WorkspaceState]]) -> str:
    st = ctx.deps.state
    ds = ", ".join(sorted(PROJECT["datasets"]))
    sel = "; ".join(f"{s.kind} '{s.label}' (metric {s.chart_metric}, datasets {s.datasets})" for s in st.selection) or "nothing"
    return ("You are the assistant inside a financial presentation editor. Use the tools to act; never state numbers yourself "
            "(tools and the canvas show verified values). Reply in one or two sentences.\n"
            f"Conversation: {'project-level' if st.thread == 'project' else 'slide ' + str(st.slide)}. Selected on the canvas: {sel}.\n"
            f"Verified datasets in the project: {ds}.\n"
            "Tools: compose_deck (build a deck from verified data), add_comparison (add a country to the selected chart), "
            "start_background_research (long-running research, e.g. rating history).")


@agent.tool
def compose_deck(ctx: RunContext[StateDeps[WorkspaceState]], country: str = "FR", peer: str = "DE") -> dict:
    """Propose a four-slide deck for a country from verified datasets. country/peer are ISO-2 codes."""
    slides = compose(country.upper(), peer.upper())
    return {"kind": "deck_proposal", "slides": slides, "note": "Each slide is a separate proposal; nothing changes until approved."}


@agent.tool
def add_comparison(ctx: RunContext[StateDeps[WorkspaceState]], country: str) -> dict:
    """Add a country (ISO-2 code, e.g. DE, IT) as a series to the chart selected on the canvas."""
    sel = next((s for s in ctx.deps.state.selection if s.kind == "chart" and s.chart_metric), None)
    if sel is None:
        return {"kind": "error", "message": "Select a chart on the canvas first."}
    geo = country.upper()[:2]
    did = f"ds.{geo.lower()}.{sel.chart_metric}"
    if did in sel.datasets:
        return {"kind": "error", "message": f"{NAMES.get(geo, geo)} is already on this chart."}
    if did in PROJECT["datasets"]:
        payload = {"dataset": PROJECT["datasets"][did], "evidence": {}, "rejected": 0, "retrieved": False}
    else:
        dates = [o["date"] for d in sel.datasets for o in PROJECT["datasets"].get(d, {}).get("observations", [])]
        payload = {**fetch_verified_dataset(sel.chart_metric, geo, min(dates) if dates else "2019"), "retrieved": True}
        PROJECT["datasets"][did] = payload["dataset"]
        PROJECT["evidence"].update(payload["evidence"])
    return {"kind": "series_proposal", "element": sel.id, "chart_label": sel.label, **payload}


TASKS: dict[str, dict] = {}


async def rating_research(task_id: str, entity: str):
    t = TASKS[task_id]
    tried = []
    for url in ["https://www.aft.gouv.fr/en/frances-credit-ratings", "https://www.spglobal.com/ratings/en/",
                "https://www.fitchratings.com/research/sovereigns", "https://ratings.moodys.com/"]:
        t["log"].append(f"fetching {url}")
        await asyncio.sleep(1.5)  # visible progress; also polite pacing
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=UA) as c:
                r = await c.get(url)
            text = trafilatura.extract(r.text) or ""
            ok = r.status_code == 200 and entity in text and re.search(r"\b(AA|Aa\d|affirm|downgrad|outlook)", text)
            tried.append({"url": url, "status": r.status_code, "chars": len(text), "usable": bool(ok)})
        except Exception as e:
            tried.append({"url": url, "status": type(e).__name__, "chars": 0, "usable": False})
    usable = [x for x in tried if x["usable"]]
    t["status"] = "done"
    t["result"] = {"kind": "gap_proposal", "topic": "rating history", "entity": entity, "tried": tried,
                   "message": "No primary source returned usable rating text." if not usable else "Usable text found; extraction not implemented in this spike.",
                   "proposal": {"label": f"{entity} rating history — pending primary source", "request": {
                       "schema": "frr-research-request/0.1", "topic": "rating actions", "entity": entity,
                       "options": ["upload agency press releases (PDF)", "connect a licensed ratings feed"]}}}


@agent.tool
async def start_background_research(ctx: RunContext[StateDeps[WorkspaceState]], topic: str, country: str = "FR") -> dict:
    """Start a long-running research task (for example 'rating history'). Results arrive later as a proposal."""
    tid = "task-" + uuid.uuid4().hex[:6]
    TASKS[tid] = {"id": tid, "topic": topic, "status": "running", "log": [], "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    asyncio.get_running_loop().create_task(rating_research(tid, NAMES.get(country.upper(), country)))
    return {"kind": "task_started", "task_id": tid, "topic": topic}


# ------------------------------------------------------------------ HTTP
async def run_agent(request: Request):
    return await AGUIAdapter.dispatch_request(request, agent=agent, deps=StateDeps(WorkspaceState()))


async def get_project(_):
    return JSONResponse(PROJECT)


async def get_tasks(_):
    return JSONResponse(list(TASKS.values()))


async def post_compose(request: Request):  # used by the scripted checks to bypass the model
    body = await request.json()
    return JSONResponse({"kind": "deck_proposal", "slides": compose(body.get("country", "FR"), body.get("peer", "DE"))})


app = Starlette(routes=[Route("/api/agent", run_agent, methods=["POST"]), Route("/api/project", get_project),
                        Route("/api/tasks", get_tasks), Route("/api/compose", post_compose, methods=["POST"])])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8790, log_level="info")
