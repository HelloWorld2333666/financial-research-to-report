"""The workspace agent (M4): PydanticAI over AG-UI, local model by default (decision D1).

Every tool returns a PROPOSAL in our vocabulary plus a ``summary`` written by code from the
result. The browser previews a proposal on a copy of the deck and applies it only when the
user approves; the app shows the summary, not model prose, after a tool call (Experiment 3: the
model said "has been added" before Apply).

The model never writes numbers (Experiment 2):
- ``compose_deck`` returns the deterministic composer's slides, numbers bound to evidence;
- ``add_comparison`` fetches a country's series from Eurostat, keeps only values an independent
  re-fetch confirms, and records query URL, time and response hash for each;
- ``rewrite_text`` asks the model for wording of a TEMPLATE of the selected text in which every
  figure is a placeholder (``{n1}``). The result is validated in code: a typed number, an unknown
  placeholder, a new year, or a figure separated from its year is refused and fed back (up to 3
  attempts, inside the tool), so a wrong number cannot reach the slide. Local Qwen did not
  reliably call a tool again after a retry prompt in the conversation; the loop lives here.

Provider: ``FRR_MODEL_PROVIDER`` = ``ollama`` (default) or ``openai-compatible``;
``FRR_MODEL`` (default ``DEFAULT_MODEL`` below); ``FRR_MODEL_URL`` (default Ollama's local endpoint);
``FRR_MODEL_THINKING`` (``none`` | ``low`` | ``medium`` | ``xhigh``; default ``DEFAULT_THINKING``) for thinking models;
``FRR_MODEL_API_KEY`` for an OpenAI-compatible server.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Callable, Literal, Optional
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.ui import StateDeps

import integrity
from composer import compose
from design_library.retrieve import recipes, suggest
from evidence import CURVES, EU27, GROUPS, MATURITY, METRICS, NAMES, measure_for
from projects import ProjectStore
import skill_knowledge

EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
UA = {"User-Agent": "frr-workspace/0.3 (research-to-report prototype)"}
PLACEHOLDER = re.compile(r"\{(n\d+)\}")
YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
NOTHING_YET = "Preview and apply; nothing has changed yet."


# ------------------------------------------------------------------ state shared with the browser (AG-UI state)
class Figure(BaseModel):
    key: str  # n1, n2, ... as offered to the model
    text: str  # as written on the slide, e.g. "115.7%"
    evidence: Optional[str] = None
    derivation: Optional[str] = None


class Selected(BaseModel):
    id: str  # durable element id
    kind: str  # text | chart | table | placeholder | decor
    label: Optional[str] = None
    role: Optional[str] = None
    metric: Optional[str] = None
    datasets: list[str] = []
    text: Optional[str] = None
    figures: list[Figure] = []


class WorkspaceState(BaseModel):
    project: Optional[str] = None
    thread: str = "project"  # "project" or a slide id
    slide: Optional[str] = None
    selection: list[Selected] = []


Deps = StateDeps[WorkspaceState]


def local_day(t: datetime) -> str:
    """The calendar day of instant `t` where the app runs (it runs on the user's machine). Timestamps stay in UTC;
    a date written for people (source notes, "verified on") is the user's day, not UTC's."""
    return t.astimezone().date().isoformat()


# ------------------------------------------------------------------ model
# The one local model every component uses (chat agent, text writer, PDF quote extraction, background tasks).
# Override with FRR_MODEL; nothing else names a model.
DEFAULT_MODEL = "qwen3.8:27b"
DEFAULT_URL = "http://localhost:11434/v1"
# Qwen3.8 thinks before answering (Ollama's default level is medium). At about 5 tokens/s on a 32 GB M5 a long think
# adds tens of seconds per step; "low" keeps a short think. Sent as reasoning_effort on Ollama's OpenAI-compatible
# endpoint ("none" turns it off; Ollama ignores think=false there). Models without thinking ignore it.
DEFAULT_THINKING = "low"


def model_name() -> str:
    return os.environ.get("FRR_MODEL") or DEFAULT_MODEL


def model_from_env():
    provider = os.environ.get("FRR_MODEL_PROVIDER", "ollama")
    name = model_name()
    if provider == "ollama":
        from pydantic_ai.models.ollama import OllamaModel
        from pydantic_ai.providers.ollama import OllamaProvider
        from pydantic_ai.settings import ModelSettings
        thinking = os.environ.get("FRR_MODEL_THINKING") or DEFAULT_THINKING
        return OllamaModel(name, provider=OllamaProvider(base_url=os.environ.get("FRR_MODEL_URL", DEFAULT_URL)),
                           settings=ModelSettings(extra_body={"reasoning_effort": thinking}))
    if provider == "openai-compatible":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
        return OpenAIChatModel(name, provider=OpenAIProvider(base_url=os.environ["FRR_MODEL_URL"], api_key=os.environ.get("FRR_MODEL_API_KEY")))
    raise ValueError(f"unknown FRR_MODEL_PROVIDER {provider!r}")


def model_config() -> dict:
    return {"provider": os.environ.get("FRR_MODEL_PROVIDER", "ollama"), "model": model_name(), "url": os.environ.get("FRR_MODEL_URL", DEFAULT_URL),
            "thinking": os.environ.get("FRR_MODEL_THINKING") or DEFAULT_THINKING}


# ------------------------------------------------------------------ live retrieval with independent re-fetch
def http_get(url: str) -> bytes:
    return httpx.get(url, timeout=40, headers=UA).content


def eurostat_series(get: Callable[[str], bytes], dataset: str, filters: dict, since: str) -> tuple[str, bytes, dict[str, float]]:
    url = EUROSTAT + dataset + "?" + urlencode(sorted({"format": "JSON", "sinceTimePeriod": since, **filters}.items()))
    body = get(url)
    d = json.loads(body)
    if "value" not in d:
        raise ValueError((d.get("error") or {}).get("label") or "no data in the response")
    inv = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    return url, body, dict(sorted({inv[int(i)]: float(v) for i, v in d["value"].items()}.items()))


def fetch_verified(get: Callable[[str], bytes], metric: str, geo: str, since: str) -> dict:
    """A dataset and its evidence, each value confirmed by a second, independent request."""
    dataset, fixed, label, unit = METRICS[metric]
    filters = {**fixed, "geo": geo}
    url, body, obs = eurostat_series(get, dataset, filters, since)
    _, _, again = eurostat_series(get, dataset, filters, since)
    accepted = {p: v for p, v in obs.items() if again.get(p) == v}
    now = datetime.now(timezone.utc)
    sha = hashlib.sha256(body).hexdigest()
    did, name = f"ds.{geo.lower()}.{metric}", NAMES.get(geo, geo)
    evidence, observations = {}, []
    for p, v in accepted.items():
        eid = f"ev.live.{geo.lower()}.{metric}.{p}"
        evidence[eid] = {"id": eid, "source_id": f"src.live.{dataset}.{geo.lower()}", "kind": "metric_value", "subject": name,
                         "statement": f"{label} [{dataset} {geo}] {p}: {v:g}", "metric_id": metric, "value": v, "unit": unit, "period": p,
                         "locator": f"{dataset} {json.dumps(filters, sort_keys=True)} @ {p}", "verification": "verified",
                         "verified_by": "frr-live-validator (independent re-fetch)", "verified_on": local_day(now),
                         "source_title": f"Eurostat: {label}", "source_url": url,
                         "retrieval": {"method": "api", "query_url": url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": sha,
                                       "series_key": f"{dataset} {json.dumps(filters, sort_keys=True)}", "note": "Eurostat dissemination API (JSON-stat)"}}
        observations.append({"date": p, "value": v, "status": "verified", "evidence_id": eid})
    return {"dataset": {"id": did, "title": f"{name} · {label.lower()}", "entity": name, "geo": geo, "metric": metric, "unit": unit,
                        "measure": measure_for(metric, geo), "frequency": "annual", "origin": "eurostat", "verification": "verified", "source_url": url,
                        "source_note": f"Eurostat {dataset} ({local_day(now)}, live)", "observations": observations, "working": {}},
            "evidence": evidence, "rejected": len(obs) - len(accepted)}


def fetch_curve(get: Callable[[str], bytes], curve: str, since: str) -> list[dict]:
    """A euro-area yield curve: one dataset per tenor (monthly), from ONE request per fetch, each value confirmed
    by a second, independent request. Tenors are read from the response, not assumed."""
    dataset, fixed, label = CURVES[curve]

    def read() -> tuple[str, bytes, dict[tuple[str, str], float]]:
        url = EUROSTAT + dataset + "?" + urlencode(sorted({"format": "JSON", "sinceTimePeriod": since, "geo": "EA", **fixed}.items()))
        body = get(url)
        d = json.loads(body)
        if "value" not in d:
            raise ValueError((d.get("error") or {}).get("label") or "no data in the response")
        ids, sizes = d["id"], d["size"]
        cats = {dim: {v: k for k, v in d["dimension"][dim]["category"]["index"].items()} for dim in ids}
        out = {}
        for flat, v in d["value"].items():
            n, coord = int(flat), {}
            for dim, size in zip(reversed(ids), reversed(sizes)):
                coord[dim] = cats[dim][n % size]
                n //= size
            out[(coord["maturity"], coord["time"])] = float(v)
        return url, body, out

    url, body, obs = read()
    _, _, again = read()
    now = datetime.now(timezone.utc)
    sha = hashlib.sha256(body).hexdigest()
    out = []
    for tenor in sorted({m for m, _ in obs}, key=lambda m: int(m[1:]) if m[1:].isdigit() else 0):
        if not re.fullmatch(r"Y\d+", tenor):
            continue  # only whole-year tenors (Y1..Y30); a curve is drawn on a numeric tenor axis
        years, metric = int(tenor[1:]), f"{curve}_{tenor.lower()}"
        did, filters = f"ds.ea.{metric}", {**fixed, "geo": "EA", "maturity": tenor}
        evidence, observations = {}, []
        for (m, p), v in sorted(obs.items()):
            if m != tenor or again.get((m, p)) != v:
                continue
            eid = f"ev.live.ea.{metric}.{p}"
            evidence[eid] = {"id": eid, "source_id": f"src.live.{dataset}.{curve}", "kind": "metric_value", "subject": "Euro area",
                             "statement": f"{label}, {years}-year [{dataset}] {p}: {v:g}", "metric_id": metric, "value": v, "unit": "%", "period": p,
                             "locator": f"{dataset} {json.dumps(filters, sort_keys=True)} @ {p}", "verification": "verified",
                             "verified_by": "frr-live-validator (independent re-fetch)", "verified_on": local_day(now),
                             "source_title": f"Eurostat: {label}", "source_url": url,
                             "retrieval": {"method": "api", "query_url": url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": sha,
                                           "series_key": f"{dataset} {json.dumps(filters, sort_keys=True)}", "note": "Eurostat dissemination API (JSON-stat)"}}
            observations.append({"date": p, "value": v, "status": "verified", "evidence_id": eid})
        out.append({"dataset": {"id": did, "title": f"Euro area · {label.lower()}, {years}-year", "entity": "Euro area", "geo": "EA", "metric": metric, "unit": "%",
                                "measure": {"kind": "yield", "of": None, "signed": True, "additive_parts_of": None, "scale": "interval", "tenor": years, "curve": curve},
                                "frequency": "monthly", "origin": "eurostat", "verification": "verified", "source_url": url,
                                "source_note": f"Eurostat {dataset} ({local_day(now)}, live)", "observations": observations, "working": {}},
                    "evidence": evidence, "rejected": sum(1 for (m, p), v in obs.items() if m == tenor and again.get((m, p)) != v)})
    return out


def research_scope(countries: Optional[list[str]], country: str, metrics: Optional[list[str]]) -> tuple[list[str], list[str]]:
    """Countries (EU27 expands) and metrics (groups expand: fiscal, maturity, yield_curve) of a research request."""
    geos: list[str] = []
    for c in countries or [country]:
        geos += EU27 if c.upper() in ("EU27", "EU-27", "EU") else [c.upper()[:2]]
    ms: list[str] = []
    for m in metrics or ["fiscal"]:
        ms += GROUPS.get(m, [m] if m in METRICS or m in CURVES else [])
    return list(dict.fromkeys(geos)), list(dict.fromkeys(ms))


# ------------------------------------------------------------------ rewrite with placeholders
def figure_label(project: dict, f: Figure) -> str:
    if f.derivation:
        d = (project.get("derivations") or {}).get(f.derivation)
        return f"derived: {d['statement']}" if d else "derived"
    where = integrity.evidence_index(project).get(f.evidence or "")
    if not where:
        return "evidence"
    ds = project["datasets"][where[0]]
    return f"{ds['entity']} {ds['metric']} {where[1]}"


def trusted_figures(project: dict, figures: list[Figure]) -> list[Figure]:
    """Figures whose reference still resolves, in the saved project, to the number as written."""
    out = []
    for f in figures:
        written = integrity.figures(f.text)
        ref = {"evidence": f.evidence} if f.evidence else {"derivation": f.derivation}
        v = integrity.current_value(project, ref)
        if written and v is not None and abs(v - written[0][1]) <= 0.5 * 10 ** -written[0][2] + 1e-9:
            out.append(f)
    return out


def template_of(text: str, figures: list[Figure]) -> str:
    """The text with each figure (in reading order) replaced by its placeholder."""
    out, pos = [], 0
    for f in figures:
        i = text.find(f.text, pos)
        if i < 0:
            continue
        out += [text[pos:i], "{" + f.key + "}"]
        pos = i + len(f.text)
    return "".join(out) + text[pos:]


WRITER = ("You reword one piece of slide text for a financial presentation. You receive a template in which every number is a "
          "placeholder such as {n1}; each placeholder already includes its unit (%, pp, bp). Rules: write placeholders exactly as "
          "given, never type a digit except years already in the template, keep each placeholder's year in the same clause, keep the "
          "facts and their direction (rose/fell) unchanged, and drop no placeholder whose year you keep. Reply with the new text only.")


def figure_periods(project: dict, figures: list[Figure]) -> dict[str, str]:
    """placeholder key -> the year an evidence figure is for (derived figures carry their own wording)."""
    idx = integrity.evidence_index(project)
    return {f.key: idx[f.evidence][1][:4] for f in figures if f.evidence and f.evidence in idx}


def build_rewrite(new_text: str, figures: list[Figure], original: str, periods: dict[str, str] | None = None) -> tuple[str, list[dict]]:
    """Substitute placeholders; refuse any number the model typed itself, and any figure separated from
    its year (a figure without its period reads as another year's value). Raises ValueError with a retry hint."""
    by_key = {f.key: f for f in figures}
    unknown = sorted({k for k in PLACEHOLDER.findall(new_text) if k not in by_key})
    if unknown:
        raise ValueError(f"unknown placeholders {unknown}; use only {sorted(by_key)}")
    bare = PLACEHOLDER.sub(" ", new_text)
    typed = [f[0] for f in integrity.figures(bare)]
    if typed:
        raise ValueError(f"write every number as a placeholder such as {{n1}}; you typed {typed}")
    years = set(YEAR.findall(bare)) - set(YEAR.findall(original))
    if years:
        raise ValueError(f"years {sorted(years)} are not in the original text; keep its periods")
    for clause in re.split(r"[;.]\s+|\n", new_text):
        for key in PLACEHOLDER.findall(clause):
            year = (periods or {}).get(key)
            if year and year not in YEAR.findall(PLACEHOLDER.sub(" ", clause)):
                raise ValueError(f"{{{key}}} is the {year} value: keep {year} in the same clause as {{{key}}}")
    numbers: list[dict] = []

    def put(m: re.Match) -> str:
        f = by_key[m.group(1)]
        numbers.append({"text": f.text, **({"evidence": f.evidence} if f.evidence else {"derivation": f.derivation})})
        return f.text

    text = PLACEHOLDER.sub(put, new_text.strip())
    # the placeholder already carries its unit ("115.7%"); drop a unit the model repeated after it
    text = re.sub(r"(\d(?:%|\sbp|\spp))\s?(?:%|per ?cent\b|bp\b|pp\b)", r"\1", text)
    if not text:
        raise ValueError("the rewrite is empty")
    return text, numbers


# ------------------------------------------------------------------ agent
LAYOUT = Literal["align_left", "align_right", "align_top", "align_bottom", "align_center", "align_middle", "distribute_horizontal", "distribute_vertical"]


def normalize_plan(plan: dict) -> tuple[dict, list[str]]:
    """Repair the structural slips a local model makes in a slide plan (objects nested in the composition, objects without a slot
    or with a slot the composition lacks), so its design decisions reach the validator. Every repair is reported to the user."""
    fixed: list[str] = []
    comp = dict(plan.get("composition") or {})
    if isinstance(comp.get("objects"), list):
        plan["objects"] = [*(plan.get("objects") or []), *comp.pop("objects")]; fixed.append("objects moved out of the composition")
    if "columns" in comp and "params" not in comp:
        comp["params"] = {"columns": comp.pop("columns")}; fixed.append("columns moved into params")
    plan["composition"] = comp
    cols = (comp.get("params") or {}).get("columns") or []
    if comp.get("kind", "columns") == "columns" and cols:
        slots = [sl for c in cols for sl in c.get("slots", [])]
        has_viz = next((c for c in cols if any(o.get("slot") in c.get("slots", []) and o.get("kind") == "viz" for o in plan.get("objects") or [])), cols[0])
        def guess(o: dict) -> str:
            role, kind = o.get("role", ""), o.get("kind", "")
            for sl in slots:  # a slot named after the role or kind ("exhibit", "notes", "kpi", "chart")
                if sl.rstrip("s") in (role.rstrip("s"), kind) or (kind == "viz" and sl in ("chart", "main", "table")):
                    return sl
            if role in ("exhibit", "unit"):
                return has_viz["slots"][0]
            return cols[-1]["slots"][-1]
        for o in plan.get("objects") or []:
            if not isinstance(o, dict) or o.get("role") in ("headline", "source") or o.get("anchor") or o.get("cell") or o.get("node"):
                continue
            if o.get("slot") not in slots:
                o["slot"] = guess(o); fixed.append(f"{o.get('id', o.get('kind'))} placed in slot {o['slot']}")
    return plan, fixed


def create_agent(store: ProjectStore, model=None, get: Callable[[str], bytes] = http_get, center=None) -> Agent:
    agent = Agent(model or model_from_env(), deps_type=Deps, retries=2, name="frr-workspace")

    def project_of(ctx: RunContext[Deps]) -> dict:
        if not ctx.deps.state.project:
            raise ModelRetry("No project is open.")
        return store.load(ctx.deps.state.project)["project"]

    @agent.instructions
    def instructions(ctx: RunContext[Deps]) -> str:
        st = ctx.deps.state
        try:
            project = store.load(st.project)["project"] if st.project else {"datasets": {}}
        except Exception:
            project = {"datasets": {}}
        geos = sorted({d["geo"] for d in project["datasets"].values()})
        lines = []
        for s in st.selection:
            if s.kind == "text":
                figs = trusted_figures(project, s.figures) if st.project else []
                table = "; ".join(f"{{{f.key}}} = {f.text} ({figure_label(project, f)})" for f in figs) or "none"
                lines.append(f"text ({s.role}): \"{s.text}\" — figures: {table}")
            else:
                lines.append(f"{s.kind} '{s.label}'" + (f" (metric {s.metric}, datasets {s.datasets})" if s.metric else ""))
        return ("You are the assistant inside a financial presentation editor. Act only through the tools; never state or invent numbers. "
                "After a tool call, add no text of your own; the app shows the proposal and the user decides.\n"
                f"Conversation: {'the whole project' if st.thread == 'project' else 'slide ' + str(st.slide)}.\n"
                f"Selected on the canvas: {' | '.join(lines) or 'nothing'}.\n"
                f"Countries with verified data in the project: {', '.join(geos) or 'none'} (ISO-2 codes).\n"
                "Tools: compose_deck (draft a deck from verified data); add_comparison (add a country to the selected chart); "
                "rewrite_text (reword the selected text; pass the user's instruction, the tool does the wording); "
                "layout_suggestion (align or distribute the selected elements); start_research (Eurostat data for one or more countries or ['EU27']; metrics 'fiscal' (default), a single metric such as 'deficit', 'maturity' or 'yield_curve'; or a rating request); "
                "propose_visual (a chart of project data: name the analytical INTENT — trend over time, ranking at one period, change between two periods, "
                "composition of a total, relationship between two measures, spotlight (one headline number), ratings (the rating history from rating actions), "
                "distribution (spread across many countries), curve (euro-area yield curve), maturity (debt by remaining maturity), sensitivity (debt under "
                "assumed interest and growth rates) — "
                "the metric and the countries; the app picks the chart type from the data); "
                "change_visual (turn the selected chart into another type, e.g. a dumbbell, slope, lollipop, waterfall bridge, small multiples or step line); "
                "design_slide (plan and design a whole slide from verified data: purpose trend, comparison or risk, the countries, your one-sentence message, "
                "density, and optionally a preferred layout; redesign=true redesigns the current slide and keeps what the user edited); "
                "set_design_profile (change the visual style of the deck: institutional or editorial; data never changes); "
                "design_guidance then plan_slide (the design Skill: for any slide the fixed purposes of design_slide do not cover, or when the user asks for "
                "a particular composition, map, cover or visual technique — FIRST call design_guidance with the slide's objective, its analytical intents and "
                "its role; it returns the few design cards that apply, the hard rules and the datasets you may cite; THEN call plan_slide with a plan that "
                "follows those cards; the app resolves every figure from evidence, validates, renders a preview and the user applies it).\n"
                "If a request does not make the intent clear (e.g. 'compare France with the PIIGS' could mean the trend, the current ranking or the change "
                "since a year), ask ONE short question offering those options instead of guessing.")

    @agent.tool
    def compose_deck(ctx: RunContext[Deps], country: str = "FR", peer: str = "DE") -> dict:
        """Propose a four-slide deck for a country from verified data. country and peer are ISO-2 codes (e.g. FR, DE)."""
        project = project_of(ctx)
        g = country.upper()[:2]
        if not any(d["geo"] == g for d in project["datasets"].values()):
            return {"kind": "error", "message": f"The project has no verified data for {NAMES.get(g, g)} yet."}
        slides = compose(project, g, peer.upper()[:2])
        return {"kind": "deck_proposal", "slides": slides,
                "summary": f"Proposed {len(slides)} slides from verified data ({', '.join(s['key'] for s in slides)}); every number is bound to its evidence. "
                           "Preview and apply each one; nothing has changed yet."}

    @agent.tool
    def add_comparison(ctx: RunContext[Deps], country: str) -> dict:
        """Add a country (ISO-2 code such as IT or ES) as a new series on the chart selected on the canvas."""
        sel = next((s for s in ctx.deps.state.selection if s.kind == "chart" and s.metric), None)
        if sel is None:
            return {"kind": "error", "message": "Select a chart on the canvas first."}
        project = project_of(ctx)
        geo = country.upper()[:2]
        did = f"ds.{geo.lower()}.{sel.metric}"
        if did in sel.datasets:
            return {"kind": "error", "message": f"{NAMES.get(geo, geo)} is already on this chart."}
        if did in project["datasets"]:
            ev = {o["evidence_id"]: project["evidence"][o["evidence_id"]] for o in project["datasets"][did]["observations"] if o.get("evidence_id") in project["evidence"]}
            payload = {"dataset": project["datasets"][did], "evidence": ev, "rejected": 0, "retrieved": False}
        else:
            dates = [o["date"] for d in sel.datasets for o in project["datasets"].get(d, {}).get("observations", [])]
            try:
                payload = {**fetch_verified(get, sel.metric, geo, min(dates) if dates else "2019"), "retrieved": True}
            except (ValueError, KeyError, httpx.HTTPError) as exc:
                return {"kind": "error", "message": f"Eurostat returned no usable {sel.metric} data for {NAMES.get(geo, geo)}: {exc}"}
        n, rej = len(payload["dataset"]["observations"]), payload["rejected"]
        if not n:
            return {"kind": "error", "message": f"No {sel.metric} values for {NAMES.get(geo, geo)} passed verification."}
        how = "retrieved live from Eurostat and confirmed by an independent re-fetch" if payload["retrieved"] else "from verified project data"
        return {"kind": "series_proposal", "element": sel.id, "chart_label": sel.label, **payload,
                "summary": f"Proposed adding {payload['dataset']['entity']} to “{sel.label}”: {n} values {how}"
                           + (f", {rej} rejected because the re-fetch disagreed" if rej else "") + f". {NOTHING_YET}"}

    writer = Agent(model or model_from_env(), output_type=str, instructions=WRITER, name="frr-writer")

    @agent.tool
    async def rewrite_text(ctx: RunContext[Deps], instruction: str = "make it more concise", text: Optional[str] = None) -> dict:
        """Propose new wording for the text selected on the canvas, following the user's instruction (e.g. 'more concise').
        Optionally pass a draft as `text`, with every figure written as its placeholder ({n1}); it is checked like any draft."""
        sel = [s for s in ctx.deps.state.selection if s.kind == "text"]
        if len(sel) != 1:
            return {"kind": "error", "message": "Select exactly one text box on the canvas first."}
        s, project = sel[0], project_of(ctx)
        figs = trusted_figures(project, s.figures)
        periods = figure_periods(project, figs)
        table = "\n".join(f"{{{f.key}}} = {f.text}: {figure_label(project, f)}" for f in figs) or "(no figures)"
        prompt = f"Instruction: {instruction}\nTemplate: {template_of(s.text or '', figs)}\nPlaceholders:\n{table}"
        history, reasons = None, []
        drafts = [text] if text else []  # a draft from the conversation model is checked first, never trusted
        for _ in range(3 + len(drafts)):
            if drafts:
                draft, out = drafts.pop(), None
            else:
                out = await writer.run(prompt, message_history=history)
                draft = out.output.strip().strip('"').strip()
            try:
                after, numbers = build_rewrite(draft, figs, s.text or "", periods)
            except ValueError as exc:
                reasons.append(str(exc))
                if out is not None:
                    history, prompt = out.all_messages(), f"Refused: {exc}. Write the text again following the rules."
                continue
            return {"kind": "rewrite_proposal", "element": s.id, "role": s.role, "before": s.text, "after": after, "numbers": numbers, "attempts": len(reasons) + 1,
                    "summary": f"Proposed new wording for the {s.role or 'text'}: {len(numbers)} figure{'' if len(numbers) == 1 else 's'}, each bound to its evidence "
                               f"(the model wrote placeholders; the numbers come from data){f', after {len(reasons)} refused draft' + ('s' if len(reasons) > 1 else '') if reasons else ''}. {NOTHING_YET}"}
        return {"kind": "error", "message": f"No acceptable wording after {len(reasons)} drafts (last refusal: {reasons[-1]}). Nothing was changed."}

    @agent.tool
    def layout_suggestion(ctx: RunContext[Deps], action: LAYOUT) -> dict:
        """Align or distribute the elements selected on the canvas."""
        ids = [s.id for s in ctx.deps.state.selection]
        need = 3 if action.startswith("distribute") else 2
        if len(ids) < need:
            return {"kind": "error", "message": f"Select at least {need} elements to {action.replace('_', ' ')}."}
        verb, how = action.split("_")
        mode = {"left": "left", "right": "right", "top": "top", "bottom": "bottom", "center": "centerH", "middle": "centerV"}.get(how)
        cmd = {"kind": "elements.align", "ids": ids, "mode": mode} if verb == "align" else {"kind": "elements.distribute", "ids": ids, "axis": how}
        return {"kind": "layout_proposal", "commands": [cmd], "action": action,
                "summary": f"Proposed: {action.replace('_', ' ')} for {len(ids)} elements. {NOTHING_YET}"}

    @agent.tool
    async def start_research(ctx: RunContext[Deps], topic: str = "economic data", country: str = "FR", countries: Optional[list[str]] = None,
                             metrics: Optional[list[str]] = None) -> dict:
        """Start research. Rating history: records a request on the current slide, completed by uploading the agency's PDF.
        Economic or fiscal data for one country, or several via `countries` (ISO-2 / Eurostat codes, e.g. ["IT","ES","PT"],
        or ["EU27"] for all member states): starts a background Eurostat task. `metrics`: "fiscal" (debt, deficit, interest,
        growth, 10-year yield; the default), single metrics such as "deficit", "maturity" (debt by remaining maturity),
        or "yield_curve" (euro-area government yield curves)."""
        geos, ms = research_scope(countries, country, metrics)
        geo = geos[0]
        name = NAMES.get(geo, country) if len(geos) == 1 else "the EU-27" if len(geos) == 27 else ", ".join(NAMES.get(g, g) for g in geos)
        if re.search(r"rating|agency|outlook|moody|fitch|s&p|dbrs|scope", topic, re.I) or center is None:
            request = {"schema": "frr-research-request/0.1", "topic": topic[:120], "entity": name,
                       "reason": "rating agencies publish press releases that cannot be fetched automatically; upload the agency's PDF to complete this"}
            return {"kind": "research_proposal", "slide": ctx.deps.state.slide, "label": f"{topic[:60]} ({name}) — pending research", "request": request,
                    "summary": f"Proposed a placeholder recording a research request for “{topic[:60]}” ({name}). To complete it, select the placeholder and upload "
                               f"the agency's press release PDF (Evidence tab); the rating is verified on the page. {NOTHING_YET}"}
        if not ctx.deps.state.project:
            return {"kind": "error", "message": "No project is open."}
        if not ms:
            return {"kind": "error", "message": f"Unknown data request {metrics}; ask for fiscal data, deficit, debt, maturity or yield_curve."}
        t = center.create(ctx.deps.state.project, "eurostat_pack", {"geos": geos, "metrics": ms, "since": "2015"}, f"Eurostat data for {name}")
        n = sum(1 for m in ms if m in METRICS) * len(geos) + sum(1 for m in ms if m in CURVES)
        what = "series" if not any(m in CURVES for m in ms) else "requests (each yield curve is one request covering every tenor)"
        return {"kind": "task_started", "task_id": t["id"], "title": t["title"],
                "summary": f"Started a background task: {n} Eurostat {what} for {name}, each confirmed by an independent re-fetch. "
                           "It keeps running while you work; its result appears in Tasks as a proposal."}

    @agent.tool
    def propose_visual(ctx: RunContext[Deps], intent: Literal["trend", "ranking", "change", "composition", "relationship", "spotlight", "ratings",
                                                              "distribution", "curve", "maturity", "sensitivity"], metric: str = "",
                       countries: Optional[list[str]] = None, period: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                       second_metric: Optional[str] = None, curves: Optional[Literal["all", "aaa", "both"]] = None,
                       years: Optional[int] = None, rates: Optional[list[float]] = None, growth: Optional[list[float]] = None) -> dict:
        """Propose a chart of project data by analytical intent. metric: debt, deficit, interest, growth or yield; countries: ISO-2 codes
        (default: every country with that metric). period: the year for a ranking or composition; start/end: the years of a change.
        relationship: a second_metric for the other axis (one country). distribution: the spread across countries (box plot,
        histogram, range). curve: the euro-area yield curve (curves: all ratings, AAA or both; period, or start/end to compare two months).
        maturity: one country's debt by remaining maturity. sensitivity: one country's debt ratio after `years` under assumed interest
        `rates` and nominal `growth` rates (%), from its verified debt, balance and interest. The app chooses the chart type under fixed rules."""
        project = project_of(ctx)
        dsets = project["datasets"]
        special = None
        if intent == "curve":
            want = {"all": ["yc_all"], "aaa": ["yc_aaa"], "both": ["yc_all", "yc_aaa"]}[curves or "all"]
            special = [k for k, d in dsets.items() if (d.get("measure") or {}).get("curve") in want]
            what = "the euro-area yield curve" + (" (all ratings and AAA)" if len(want) == 2 else " (AAA)" if want == ["yc_aaa"] else "")
            hint = "start_research with metrics ['yield_curve']"
        elif intent in ("maturity", "sensitivity"):
            geo = (countries or ["FR"])[0].upper()[:2]
            keys = [k for k, *_ in MATURITY] if intent == "maturity" else ["debt", "deficit", "interest"]
            special = [f"ds.{geo.lower()}.{k}" for k in keys if f"ds.{geo.lower()}.{k}" in dsets]
            if len(special) < len(keys):
                special = []
            what = f"{NAMES.get(geo, geo)}'s debt by remaining maturity" if intent == "maturity" else f"{NAMES.get(geo, geo)}'s debt sensitivity"
            hint = f"start_research for {geo} with metrics {['maturity'] if intent == 'maturity' else ['fiscal']}"
        read_as = []
        if intent == "sensitivity":
            # percent, not fractions: a grid where every value is under 0.2 (e.g. 0.02) is a list of fractions; it is converted
            # and the summary says so (the card shows the assumptions before anything is applied), never read as 0.02 %
            def pct(name: str, xs: Optional[list[float]]) -> Optional[list[float]]:
                if xs and max(abs(x) for x in xs) < 0.2 and any(xs):
                    read_as.append(f"{name} {xs} read as {[round(x * 100, 6) for x in xs]} %")
                    return [round(x * 100, 6) for x in xs]
                return xs
            rates, growth = pct("rates", rates), pct("growth", growth)
        if special is not None:
            if not special:
                return {"kind": "error", "message": f"The project has no verified data for {what}. Start research first ({hint})."}
            params = {k: v for k, v in (("years", years), ("rates", rates), ("growth", growth)) if v}
            req = {"intent": intent, "datasets": sorted(special), **({"at": period} if period else {}), **({"between": [start, end]} if start and end else {}),
                   **({"params": params} if params and intent == "sensitivity" else {})}
            return {"kind": "visual_request", **req, "missing": [], "slide": ctx.deps.state.slide,
                    "summary": f"Requested {what}" + (f" with assumptions {params}" if params and intent == "sensitivity" else "")
                               + (f" ({'; '.join(read_as)}: the values looked like fractions)" if read_as else "")
                               + ". The app recommends a chart type from the data under fixed rules; preview and apply. Nothing has changed yet."}
        if intent == "ratings":
            # rating actions recorded as evidence (M5): the app draws them on the ordinal scale; undated ones are listed, not placed
            subjects = {NAMES.get(c.upper()[:2], c) for c in countries} if countries else None
            ev = [k for k, v in project.get("evidence", {}).items() if v.get("rating") and (subjects is None or v.get("subject") in subjects)]
            if not ev:
                return {"kind": "error", "message": "The project has no rating actions yet. Start research on the rating history and upload the agency's press release."}
            undated = sum(1 for k in ev if not project["evidence"][k]["rating"].get("date"))
            return {"kind": "visual_request", "intent": "ratings", "datasets": [], "evidence": ev, "missing": [], "slide": ctx.deps.state.slide,
                    "summary": f"Requested a rating timeline from {len(ev)} rating action{'s' if len(ev) != 1 else ''}"
                               + (f" ({undated} without a verified date cannot be placed on it)" if undated else "")
                               + ". The app checks it against the evidence; preview and apply. Nothing has changed yet."}
        m = metric.lower().strip()
        geos = research_scope(countries, "FR", None)[0] if countries else sorted({d["geo"] for d in project["datasets"].values() if d["metric"] == m})  # "EU27" expands
        if intent == "relationship":
            ids = [f"ds.{geos[0].lower()}.{m}", f"ds.{geos[0].lower()}.{(second_metric or '').lower()}"] if geos and second_metric else []
        else:
            ids = [f"ds.{g.lower()}.{m}" for g in geos]
        missing = [i for i in ids if i not in project["datasets"]]
        present = [i for i in ids if i in project["datasets"]]
        if not present or (intent == "relationship" and missing):
            return {"kind": "error", "message": f"The project has no verified {m} data for {', '.join(NAMES.get(i.split('.')[1].upper(), i) for i in missing) or 'those countries'}. "
                                                "Start research for them first (start_research with countries)."}
        req = {"intent": intent, "datasets": present, **({"at": period} if period else {}), **({"between": [start, end]} if start and end else {})}
        who = ", ".join(NAMES.get(i.split(".")[1].upper(), i) for i in present)
        return {"kind": "visual_request", **req, "missing": missing, "slide": ctx.deps.state.slide,
                "summary": f"Requested a {intent} visual of {m} for {who}" + (f" (no verified data for {', '.join(missing)})" if missing else "")
                           + ". The app recommends a chart type from the data under fixed rules; preview and apply. Nothing has changed yet."}

    @agent.tool
    def design_slide(ctx: RunContext[Deps], purpose: Literal["trend", "comparison", "risk", "agenda", "divider"], focus: str = "FR", peers: Optional[list[str]] = None,
                     metric: str = "", message: str = "", objective: str = "", density: Literal["low", "medium", "high"] = "medium",
                     audience: Literal["executive", "analyst", "committee"] = "executive",
                     layout: Optional[Literal["analytical_hero", "comparative", "executive_insight"]] = None, redesign: bool = False,
                     recipe: Optional[str] = None, section: int = 0) -> dict:
        """Plan a slide before drawing it (PD1). purpose is the DATA QUESTION: trend (one metric over time for a focus country and peers),
        comparison (one metric across many countries at ONE period, ranked) or risk (an executive summary of verified credit pressures).
        layout is the ARRANGEMENT: analytical_hero (one big chart), comparative (chart beside a table or a second chart), executive_insight
        (claim and KPIs). "Show the trend with a table of start and end values" is purpose trend with layout comparative.
        When redesigning, leave metric empty to keep the slide's metric.
        focus: ISO-2 country the slide is about; peers: ISO-2 comparison countries (default: all with the metric); metric: debt, deficit,
        interest, growth or yield. message: your one-sentence wording of the main takeaway; any figure in it must be one the evidence holds,
        otherwise the app keeps its own wording. layout: a preferred layout family (alternatives are still offered). redesign: redesign the
        current slide instead of adding one; elements the user moved or rewrote are kept. The app builds two or three designs from the
        verified data, validates every figure and shows previews with layout checks; the user applies one.
        agenda / divider: a contents slide with section `section` (0-based) marked, or the divider opening it; no data.
        recipe: a recipe id from find_layout_references whose design is offered first."""
        project = project_of(ctx)
        known = {r["id"] for r in recipes()}
        if recipe and recipe not in known:
            return {"kind": "error", "message": f"Unknown recipe {recipe}; known: {', '.join(sorted(known))}."}
        if purpose in ("agenda", "divider"):
            req = {"purpose": purpose, "section": max(0, int(section)), **({"recipe": recipe} if recipe else {})}
            return {"kind": "design_request", "request": req, "slide": None,
                    "summary": f"Plan {'an agenda' if purpose == 'agenda' else 'a divider'} slide (section {int(section) + 1}). Navigation slides carry no figures. Preview and apply. Nothing has changed yet."}
        dsets = project["datasets"]
        f = (focus or "FR").upper()[:2]
        m = (metric or "").lower().strip()
        if not m and not redesign and purpose in ("trend", "comparison"):
            # never guess the metric silently: take it from the model's own wording, or ask for it
            said = f"{message} {objective}".lower()
            found = [k for k, words in (("deficit", ("deficit", "balance", "fiscal")), ("debt", ("debt",)), ("yield", ("yield", "spread", "bond")),
                                        ("interest", ("interest",)), ("growth", ("growth", "gdp growth"))) if any(w in said for w in words)]
            if len(found) != 1:
                return {"kind": "error", "message": "Say which metric the slide is about: metric = debt, deficit, interest, growth or yield."}
            m = found[0]
        geos = research_scope(peers, "FR", None)[0] if peers else []
        if purpose in ("trend", "comparison") and m:
            have = [g for g in sorted({d["geo"] for d in dsets.values() if d["metric"] == m})]
            if f"ds.{f.lower()}.{m}" not in dsets and purpose == "trend":
                return {"kind": "error", "message": f"The project has no verified {m} data for {NAMES.get(f, f)}. Start research first (start_research)."}
            pool = [g for g in geos if f"ds.{g.lower()}.{m}" in dsets] if geos else have
            if purpose == "comparison" and len(set(pool) | {f}) < 3:
                return {"kind": "error", "message": f"A comparison needs {m} data for at least three countries; the project has {', '.join(have) or 'none'}. "
                                                    "Start research for more countries first (start_research with countries and metrics)."}
        req = {"purpose": purpose, "focus": f, **({"peers": [g.upper()[:2] for g in geos if g.upper()[:2] != f]} if geos else {}), **({"metric": m} if m else {}),
               **({"claim": message.strip()} if message.strip() else {}), **({"objective": objective.strip()} if objective.strip() else {}),
               "density": density, "audience": audience, **({"family": layout} if layout else {}), **({"recipe": recipe} if recipe else {})}
        target = ctx.deps.state.slide if redesign else None
        return {"kind": "design_request", "request": req, "slide": target,
                "summary": f"{'Redesign this slide' if target else 'Plan a new slide'}: {purpose} for {NAMES.get(f, f)}"
                           + (f" (message proposed: \"{message.strip()}\")" if message.strip() else "")
                           + ". The app builds designs from verified data and checks each one; preview and apply. Nothing has changed yet."}

    @agent.tool
    def design_guidance(ctx: RunContext[Deps], objective: str, intents: Optional[list[Literal["trend", "ranking", "change", "composition", "relationship",
                        "distribution", "curve", "maturity", "sensitivity", "spotlight", "drivers", "geography", "causality", "sequence", "framework",
                        "assessment"]]] = None, role: Optional[Literal["cover", "divider", "closing", "summary", "evidence", "dashboard", "chart_table",
                        "statement", "comparison"]] = None, places_matter: bool = False) -> dict:
        """Retrieve the design Skill's knowledge for ONE slide before planning it. objective: what the slide must show, in words (the user's
        content and message); intents: the analytical questions it answers; role: its place in the deck; places_matter: true when geography is
        part of the mechanism (routes, chokepoints, exposure by place). Returns at most five condensed cards (when to use a technique, when not,
        hard constraints, how to plan and execute it), the router's hard rules, and the project's datasets (ids for figure tokens and chart
        requests). Follow the cards in plan_slide and name the card ids you used in the plan's rationale."""
        project = project_of(ctx)
        g = skill_knowledge.guidance(objective, intents or [], role or "", places_matter)
        by: dict[str, dict] = {}
        for d in project["datasets"].values():
            obs = [o["date"] for o in d.get("observations", []) if o.get("value") is not None]
            if not obs:
                continue
            k = by.setdefault(d["metric"], {"unit": d.get("unit"), "geos": set(), "from": obs[0], "to": obs[-1]})
            k["geos"].add((d.get("geo") or "").lower()); k["from"] = min(k["from"], obs[0]); k["to"] = max(k["to"], obs[-1])
        data = [f"{m} ({v['unit']}): ds.<geo>.{m} for {','.join(sorted(v['geos']))}; periods {v['from']}–{v['to']}" for m, v in sorted(by.items())][:40]
        facts = [f"{e['id']}: {e.get('statement', '')[:90]}" for e in project["evidence"].values() if e.get("retrieval", {}).get("method") == "web"][:12]
        return {"kind": "design_guidance", **g, "datasets": data, "facts": facts,
                "summary": f"Design guidance from the Skill: cards {', '.join(c['id'] for c in g['cards'])}. Plan the slide with plan_slide."}

    @agent.tool
    def plan_slide(ctx: RunContext[Deps], plan: dict, cards: Optional[list[str]] = None, redesign: bool = False) -> dict:
        """Submit a slide plan written from design_guidance. The plan is JSON:
        {"claim": "the action title (no typed figures)", "composition": {"kind": "columns", "params": {"columns": [{"span": 8, "slots": ["exhibit", "chart"]},
        {"span": 4, "slots": ["notes"], "tint": false}]}}, "objects": [...], "rationale": ["card ids used and why"]}.
        Objects (each with "id", "kind" and a "slot" of the composition): text {"role": exhibit|unit|lead|conclusion|note|body|source, "text": "..." or
        {"lead": "Bold lead-in.", "text": "..."}}; kpi {"value": "{{num ds.br.debt 2026}}", "label": "what it measures", "context": "...", "variant": hero|stat};
        viz {"request": {"intent": trend|ranking|change|composition|relationship|distribution|curve|maturity|sensitivity, "family": line|bar|column|
        dumbbell|slope|multiples|yield_curve|heatmap|scatter|..., "datasets": ["ds.br.inflation", ...], "at": "2026", "between": ["2019", "2026"],
        "from": "2019", "to": "2027"}, "emphasis": "ds.co.inflation", "draw": {"form": "rankTable"|"benchList", "flags": true, "band": {"from": "2026", "to": "2027"}}};
        image {"role": "photo", "asset": "commons:<File>"}; map {"map": {"view": [W, S, E, N], "regions": [{"geo": "BR", "tone": "focus"}], ...}}.
        Markers: "mark": "flag:br" or "icon:ship" on a text or kpi. Compositions: columns (spans of 12, optional tint, dividers), statement, wide,
        bands, cover. NEVER type a figure: write {{num ds.<geo>.<metric> <period>}}, {{change ds… <start> <end>}} or {{ev <evidence id>}}.
        cards: the Skill card ids the plan follows. redesign: replace the current slide instead of adding one."""
        project = project_of(ctx)
        if not isinstance(plan, dict):
            return {"kind": "error", "message": "plan must be a JSON object."}
        plan, fixed = normalize_plan(dict(plan))
        claim = (plan.get("claim") or "").strip() or next((o.get("text") for o in plan.get("objects", []) if o.get("role") == "headline" and isinstance(o.get("text"), str)), "")
        if not claim:
            return {"kind": "error", "message": "A plan needs a claim: the slide's action title."}
        comp = plan.get("composition") or {"kind": "columns", "params": {"columns": [{"span": 12, "slots": sorted({o.get("slot") for o in plan.get("objects", []) if o.get("slot")}) or ["main"]}]}}
        if comp.get("kind") not in ("columns", "cover", "statement", "wide", "bands", "rail", "lead_panel", "agenda", "divider"):
            return {"kind": "error", "message": f"Unknown composition {comp.get('kind')!r}: use columns, statement, wide, bands or cover."}
        objs, problems = [], []
        for i, o in enumerate(plan.get("objects") or []):
            if not isinstance(o, dict) or o.get("kind") not in ("text", "kpi", "viz", "image", "map", "shape"):
                problems.append(f"object {i}: kind must be text, kpi, viz, image or map"); continue
            o = {"id": o.get("id") or f"o{i}", **o}
            if o["kind"] == "text" and o.get("role") == "headline":
                continue
            if o["kind"] == "viz":
                req = o.get("request") or {}
                missing = [d for d in req.get("datasets", []) if d not in project["datasets"]]
                if missing or not req.get("datasets"):
                    problems.append(f"{o['id']}: datasets not in the project: {', '.join(missing) or 'none given'}"); continue
                o.setdefault("role", "primary")
            if o["kind"] == "kpi":
                o.setdefault("role", "kpi"); o.setdefault("variant", "stat")
            for t in re.findall(r"\{\{\s*(?:num|change|gap|spread)\s+(ds\.[\w.]+)", json.dumps(o)):
                if t not in project["datasets"]:
                    problems.append(f"{o['id']}: {t} is not a dataset in the project")
            objs.append(o)
        if problems:
            return {"kind": "error", "message": "Plan not accepted: " + "; ".join(problems[:6]) + ". Use the datasets design_guidance listed."}
        if not any(o.get("role") == "source" for o in objs):
            used = {d for o in objs for d in (o.get("request") or {}).get("datasets", [])} | set(re.findall(r"ds\.[\w.]+", json.dumps(objs)))
            notes = sorted({project["datasets"][d].get("source_note") for d in used if d in project["datasets"] and project["datasets"][d].get("source_note")})
            objs.append({"id": "source", "kind": "text", "role": "source", "text": "Source: " + ("; ".join(notes) or "project evidence") + ". Values verified by independent re-fetch."})
        out = {"id": plan.get("id") or "ai-plan", "objective": plan.get("objective") or claim, "claim": claim, "density": plan.get("density", "medium"),
               "composition": comp, "objects": [{"id": "headline", "kind": "text", "role": "headline", "text": claim}, *objs],
               "rationale": list(plan.get("rationale") or []) + ([f"Skill cards: {', '.join(cards)}"] if cards else [])}
        return {"kind": "plan_request", "plan": out, "cards": cards or [], "slide": ctx.deps.state.slide if redesign else None, "repaired": fixed,
                "summary": f"Planned with the design Skill ({', '.join(cards or []) or 'cards not named'}): “{claim}”. The app resolves every figure from evidence, "
                           "validates and previews it; apply to add it. Nothing has changed yet." + (f" Repaired: {'; '.join(fixed)}." if fixed else "")}

    @agent.tool_plain
    def find_layout_references(purpose: list[Literal["summary", "trend", "comparison", "kpi", "survey", "framework", "process", "matrix", "case",
                                                      "recommendation", "detail_table", "statement", "section"]],
                               chart: bool = False, table: bool = False, kpis: int = 0, panels: int = 0, chars: Optional[int] = None,
                               kind: Literal["content", "agenda", "divider"] = "content") -> dict:
        """Find design recipes (and, when the private design library is configured, reference layouts) for a slide before
        design_slide. purpose: what the slide argues; chart/table: what it carries; kpis: headline figures; panels: parallel
        blocks; chars: body text it must hold. Returns up to three recipes (id, when to use it) and up to three references
        (archetype, why, slot counts; no reference text), plus the design principles that apply, one line each with their status
        (tested, renderable or principle only). Pass the chosen recipe id to design_slide; recipes include chart-commentary,
        multi-module (trend), rank-table (comparison), risk-matrix, exec-split, causal-chain (risk)."""
        q = {"purpose": purpose, "chart": chart, "table": table, "kpis": kpis, "panels": panels, "kind": kind, **({"chars": chars} if chars is not None else {})}
        r = suggest(q, os.environ.get("FRR_DESIGN_LIBRARY"))
        # the principles come back as one-line rules (id, status): enough to choose and justify a recipe, not the library
        return {"kind": "layout_references", **r,
                "summary": f"{len(r['recipes'])} recipe(s)" + (f" and {len(r['references'])} reference layout(s) from the private library" if r["library"] else " (no private library configured)")
                           + ". Choose one and call design_slide with its recipe id."}

    @agent.tool
    def set_design_profile(ctx: RunContext[Deps], profile: Literal["institutional", "editorial"]) -> dict:
        """Change the deck's visual style: institutional (navy structure, gold accents, ivory background) or editorial (white, black type,
        one red accent). Designed slides are restyled; no data, chart meaning or user edit changes."""
        project_of(ctx)
        return {"kind": "profile_request", "profile": profile,
                "summary": f"Restyle the deck with the {profile} profile. Data and evidence stay as they are; preview and apply. Nothing has changed yet."}

    @agent.tool
    def change_visual(ctx: RunContext[Deps], family: Literal["column", "bar", "line", "area", "pie", "doughnut", "scatter", "combo",
                                                     "dumbbell", "slope", "dot", "lollipop", "waterfall", "step", "multiples", "kpi",
                                                     "box", "histogram", "range"],
                      subtype: Optional[Literal["clustered", "stacked", "percent"]] = None,
                      view: Optional[Literal["over_time", "ranking", "change", "two_periods", "bridge", "distribution", "histogram", "range"]] = None) -> dict:
        """Turn the chart selected on the canvas into another type (and optionally another view of the same data).
        The app checks the request against the data and refuses visuals that would misrepresent it, with the reason."""
        sel = next((s for s in ctx.deps.state.selection if s.kind == "chart"), None)
        if sel is None:
            return {"kind": "error", "message": "Select a chart on the canvas first."}
        # dumbbell, slope and KPI compare two periods; a waterfall bridges one series: the view follows the family unless given
        default = {"dumbbell": "two_periods", "slope": "two_periods", "kpi": "two_periods", "waterfall": "bridge", "step": "over_time", "multiples": "over_time",
                   "box": "distribution", "histogram": "histogram", "range": "range"}.get(family)
        view = view or default
        transform = {"over_time": "none", "ranking": "rank", "change": "diff", "two_periods": "pair", "bridge": "bridge",
                     "distribution": "distribution", "histogram": "histogram", "range": "range", None: None}[view]
        return {"kind": "visual_change_request", "element": sel.id, "family": family, **({"subtype": subtype} if subtype else {}), **({"transform": transform} if transform else {}),
                "summary": f"Requested: show “{sel.label}” as {family}{f' ({subtype})' if subtype else ''}{f', {view.replace('_', ' ')}' if view else ''}. "
                           "The app checks it against the data first. Nothing has changed yet."}

    return agent
