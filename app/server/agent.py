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
``FRR_MODEL`` (default ``qwen2.5:14b``); ``FRR_MODEL_URL`` (default Ollama's local endpoint);
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
from evidence import METRICS, NAMES
from projects import ProjectStore

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


# ------------------------------------------------------------------ model
def model_from_env():
    provider = os.environ.get("FRR_MODEL_PROVIDER", "ollama")
    name = os.environ.get("FRR_MODEL", "qwen2.5:14b")
    if provider == "ollama":
        from pydantic_ai.models.ollama import OllamaModel
        from pydantic_ai.providers.ollama import OllamaProvider
        return OllamaModel(name, provider=OllamaProvider(base_url=os.environ.get("FRR_MODEL_URL", "http://localhost:11434/v1")))
    if provider == "openai-compatible":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
        return OpenAIChatModel(name, provider=OpenAIProvider(base_url=os.environ["FRR_MODEL_URL"], api_key=os.environ.get("FRR_MODEL_API_KEY")))
    raise ValueError(f"unknown FRR_MODEL_PROVIDER {provider!r}")


def model_config() -> dict:
    return {"provider": os.environ.get("FRR_MODEL_PROVIDER", "ollama"), "model": os.environ.get("FRR_MODEL", "qwen2.5:14b"),
            "url": os.environ.get("FRR_MODEL_URL", "http://localhost:11434/v1")}


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
                         "verified_by": "frr-live-validator (independent re-fetch)", "verified_on": now.date().isoformat(),
                         "source_title": f"Eurostat: {label}", "source_url": url,
                         "retrieval": {"method": "api", "query_url": url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": sha,
                                       "series_key": f"{dataset} {json.dumps(filters, sort_keys=True)}", "note": "Eurostat dissemination API (JSON-stat)"}}
        observations.append({"date": p, "value": v, "status": "verified", "evidence_id": eid})
    return {"dataset": {"id": did, "title": f"{name} · {label.lower()}", "entity": name, "geo": geo, "metric": metric, "unit": unit,
                        "frequency": "annual", "origin": "eurostat", "verification": "verified", "source_url": url,
                        "source_note": f"Eurostat {dataset} ({now.date().isoformat()}, live)", "observations": observations, "working": {}},
            "evidence": evidence, "rejected": len(obs) - len(accepted)}


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


def create_agent(store: ProjectStore, model=None, get: Callable[[str], bytes] = http_get) -> Agent:
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
                "layout_suggestion (align or distribute the selected elements); start_research (record a research request, e.g. rating history).")

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
    def start_research(ctx: RunContext[Deps], topic: str, country: str = "FR") -> dict:
        """Record a research request (for example 'rating history') as a placeholder on the current slide."""
        name = NAMES.get(country.upper()[:2], country)
        request = {"schema": "frr-research-request/0.1", "topic": topic[:120], "entity": name,
                   "reason": "requested in chat; background research tasks arrive in M5"}
        return {"kind": "research_proposal", "slide": ctx.deps.state.slide, "label": f"{topic[:60]} ({name}) — pending research", "request": request,
                "summary": f"Proposed a placeholder recording a research request for “{topic[:60]}” ({name}). No research has run: "
                           f"background research tasks arrive in M5. {NOTHING_YET}"}

    return agent
