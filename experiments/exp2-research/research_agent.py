"""Experiment 2: an evidence-capturing research agent on a local model.

    brief -> LLM research plan -> per-question tool loop (Eurostat API, page fetch)
          -> evidence *candidates* -> deterministic validator -> frr ResearchRecord

The model never supplies evidence directly. Tools capture what they retrieve (query URL,
observations, page text + sha256, time). The validator accepts a candidate only when it is
reproducible from that capture AND from an independent re-fetch; everything else is rejected
with a reason, and unanswered questions become gaps.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlencode, urlparse

import httpx
import trafilatura
from pydantic import BaseModel, Field
from pydantic_ai import Agent, NativeOutput
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.providers.ollama import OllamaProvider

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from frr import schema as S  # noqa: E402  (our Evidence Core)

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
MODEL = OllamaModel("qwen2.5:14b", provider=OllamaProvider(base_url="http://localhost:11434/v1"))
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
UA = {"User-Agent": "frr-research-exp/0.1 (research prototype)"}
ALLOWED_HOSTS = {"ec.europa.eu", "www.ecb.europa.eu", "data.ecb.europa.eu", "www.aft.gouv.fr", "www.banque-france.fr",
                 "www.imf.org", "www.oecd.org", "www.fitchratings.com", "www.spglobal.com", "ratings.moodys.com",
                 "en.wikipedia.org", "www.insee.fr"}
SECONDARY_HOSTS = {"en.wikipedia.org"}

# ------------------------------------------------------------------ capture store (filled by tools only)
CAPTURE: dict[str, dict] = {}
LOG: list[dict] = []


def log(event: str, **kw):
    LOG.append({"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "event": event, **kw})
    print(f"[{event}] " + json.dumps(kw, ensure_ascii=False)[:300], flush=True)


def _eurostat_fetch(dataset: str, filters: dict[str, str], since: str) -> tuple[str, dict[str, float], str]:
    params = {"format": "JSON", "sinceTimePeriod": since, **filters}
    url = EUROSTAT + dataset + "?" + urlencode(sorted(params.items()))
    d = httpx.get(url, timeout=40, headers=UA).json()
    if "value" not in d:
        raise ValueError(d.get("error", {}).get("label") or json.dumps(d)[:200])
    idx = d["dimension"]["time"]["category"]["index"]
    inv = {v: k for k, v in idx.items()}
    obs = {inv[int(i)]: float(v) for i, v in d["value"].items()}
    return url, dict(sorted(obs.items())), d.get("label", "")


def eurostat_series(dataset: str, filters: dict[str, str], since: str = "2015") -> str:
    """Fetch an annual series from the Eurostat statistics API.

    Args:
        dataset: Eurostat dataset code, e.g. "gov_10dd_edpt1".
        filters: dimension filters, e.g. {"geo": "FR", "unit": "PC_GDP", "sector": "S13", "na_item": "GD"}.
        since: first year to return.
    Returns JSON with the exact query URL (cite it as source_url) and the observations by year.
    """
    try:
        url, obs, label = _eurostat_fetch(dataset, filters, since)
    except Exception as e:  # tool errors go back to the model as text
        log("tool_error", tool="eurostat_series", dataset=dataset, filters=filters, error=str(e)[:200])
        return json.dumps({"error": str(e)[:300]})
    CAPTURE[url] = {"kind": "api", "dataset": dataset, "filters": filters, "label": label, "observations": obs,
                    "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    log("tool_call", tool="eurostat_series", url=url, n=len(obs))
    return json.dumps({"source_url": url, "dataset_label": label, "observations": obs})


def fetch_page(url: str) -> str:
    """Fetch a public web page and return its main text (first 6000 characters).

    Only official, rating-agency and a few reference domains are allowed. Quote excerpts verbatim
    from the returned text; cite the same url as source_url.
    """
    host = urlparse(url).hostname or ""
    if host not in ALLOWED_HOSTS:
        log("tool_refused", tool="fetch_page", url=url, reason="host not allowed")
        return json.dumps({"error": f"host {host} is not on the allow-list"})
    try:
        r = httpx.get(url, timeout=40, follow_redirects=True, headers=UA)
        text = trafilatura.extract(r.text, include_tables=True) or ""
    except Exception as e:
        log("tool_error", tool="fetch_page", url=url, error=type(e).__name__)
        return json.dumps({"error": type(e).__name__})
    if r.status_code != 200 or len(text) < 200:
        log("tool_blocked", tool="fetch_page", url=url, status=r.status_code, chars=len(text))
        return json.dumps({"error": f"HTTP {r.status_code}; page text unavailable ({len(text)} chars): likely a JavaScript app or bot protection"})
    CAPTURE[url] = {"kind": "page", "text": text, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "secondary": host in SECONDARY_HOSTS}
    log("tool_call", tool="fetch_page", url=url, chars=len(text))
    # give the model the passages that mention the subject first, then the head of the page
    hits = [m.start() for m in re.finditer(r"France", text)]
    window = "\n...\n".join(text[max(0, h - 300): h + 500] for h in hits[:4])
    return json.dumps({"source_url": url, "text": (window or text)[:6000]})


# ------------------------------------------------------------------ model outputs
class PlannedQuestion(BaseModel):
    id: str = Field(description="short id like q1")
    text: str
    rationale: str
    metric: Optional[str] = Field(None, description="the quantitative metric to retrieve, if any")


class ResearchPlan(BaseModel):
    questions: list[PlannedQuestion] = Field(min_length=3, max_length=10)
    storyline: list[str] = Field(description="slide titles for a four-slide deck", min_length=4, max_length=4)


class Candidate(BaseModel):
    kind: Literal["metric_value", "fact"]
    statement: str
    value: Optional[float] = None
    unit: Optional[str] = None
    period: Optional[str] = Field(None, description="year, e.g. 2025")
    source_url: str = Field(description="exactly the source_url returned by the tool")
    excerpt: Optional[str] = Field(None, description="verbatim text copied from fetch_page output (facts)")


class QuestionResult(BaseModel):
    question_id: str
    candidates: list[Candidate] = Field(default_factory=list)
    unanswered_reason: Optional[str] = None


TOOL_GUIDE = """Tools:
- eurostat_series(dataset, filters, since): official EU statistics. Useful series for a country (geo=FR, DE, IT...):
  * general government gross debt, % of GDP: dataset gov_10dd_edpt1, filters unit=PC_GDP, sector=S13, na_item=GD
  * government deficit(-)/surplus(+), % of GDP: gov_10dd_edpt1, unit=PC_GDP, sector=S13, na_item=B9
  * interest payable by government, % of GDP: gov_10a_main, unit=PC_GDP, sector=S13, na_item=D41PAY
  * real GDP growth, %: nama_10_gdp, unit=CLV_PCH_PRE, na_item=B1GQ
  * 10-year government bond yield (EMU convergence criterion), %: irt_lt_mcby_a, geo only
- fetch_page(url): text of an allowed public page (official sites, rating agencies, en.wikipedia.org).
Rules: every number you report must be copied from a tool result for the period you state; cite the tool's source_url.
For facts, copy a short excerpt verbatim from fetch_page output. If you cannot find it, set unanswered_reason. Never estimate."""

planner = Agent(MODEL, output_type=NativeOutput(ResearchPlan), retries=3, system_prompt=(
    "You are a sovereign credit analyst planning research. Break the brief into the economic and financial questions "
    "a rating analyst must answer (debt level and trend, fiscal balance, interest burden, growth, market pricing, "
    "rating actions, and any others you judge material). Each question should be answerable from public data: "
    "official EU statistics (debt, deficit, interest, growth, 10-year bond yields) and public web pages. "
    "Do not call any functions; reply only with the plan."))

# Run 2: tool-call output mode -> tools called, structured output failed validation (3 retries).
# Run 3: native JSON output -> no tool calls at all, 27/27 candidates invented and rejected.
# Run 4 design: the model only chooses WHAT to retrieve (tool calls, free-text answer); numbers are taken
# from the tool captures by code, and page facts are quoted in a separate no-tools extraction step.
researcher = Agent(MODEL, retries=3, tools=[eurostat_series, fetch_page], system_prompt=(
    "You are a research assistant answering ONE question. You MUST call the tools to retrieve data before answering; "
    "you have no reliable knowledge of recent figures. Retrieve France and, where useful, Germany. "
    "Then answer in two or three sentences.\n" + TOOL_GUIDE))


class Quotes(BaseModel):
    excerpts: list[str] = Field(default_factory=list, description="sentences copied verbatim from the text", max_length=4)


quoter = Agent(MODEL, output_type=NativeOutput(Quotes), retries=2, system_prompt=(
    "Copy, character for character, up to four short sentences or table rows from the given text that answer the "
    "question. Do not paraphrase, do not add anything. If nothing answers it, return an empty list."))


def candidates_from_capture(urls: list[str], question: str) -> list[Candidate]:
    out: list[Candidate] = []
    for url in urls:
        cap = CAPTURE[url]
        if cap["kind"] == "api":
            geo = cap["filters"].get("geo", "?")
            for period, value in list(cap["observations"].items())[-6:]:
                out.append(Candidate(kind="metric_value", statement=f"{cap['label']} [{cap['dataset']} {geo}] {period}: {value:g}",
                                     value=value, unit=cap["filters"].get("unit"), period=period, source_url=url))
        else:
            try:
                q = quoter.run_sync(f"Question: {question}\n\nText:\n{cap['text'][:6000]}").output
            except Exception as e:
                log("quote_failed", url=url, error=type(e).__name__); continue
            out += [Candidate(kind="fact", statement=x[:300], excerpt=x, source_url=url) for x in q.excerpts]
    return out


# ------------------------------------------------------------------ deterministic validator
def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def validate(c: Candidate) -> tuple[bool, str]:
    cap = CAPTURE.get(c.source_url)
    if cap is None:
        return False, "source_url was never retrieved by a tool in this run (not captured)"
    if cap["kind"] == "api":
        if c.kind != "metric_value" or c.value is None or not c.period:
            return False, "API source but candidate is not a metric value with a period"
        if c.period not in cap["observations"]:
            return False, f"period {c.period} not in the captured series"
        if cap["observations"][c.period] != c.value:
            return False, f"value {c.value} != captured {cap['observations'][c.period]} for {c.period}"
        try:  # independent re-fetch of the exact query
            url2, obs2, _ = _eurostat_fetch(cap["dataset"], cap["filters"], min(cap["observations"]))
        except Exception as e:
            return False, f"re-fetch failed: {e}"
        if obs2.get(c.period) != c.value:
            return False, f"re-fetch gave {obs2.get(c.period)} for {c.period}"
        return True, "API value reproduced from capture and independent re-fetch"
    if not c.excerpt:
        return False, "page source but no verbatim excerpt"
    if _norm(c.excerpt) not in _norm(cap["text"]):
        return False, "excerpt not found verbatim in the captured page text"
    if c.value is not None and not re.search(re.escape(f"{c.value:g}"), c.excerpt):
        return False, "value does not appear inside the excerpt"
    return True, "excerpt found verbatim in captured page" + (" (secondary source)" if cap.get("secondary") else "")


# ------------------------------------------------------------------ run
def main(brief: str):
    t0 = time.time()
    log("brief", text=brief)
    plan_run = planner.run_sync(brief)
    plan: ResearchPlan = plan_run.output
    log("plan", seconds=round(time.time() - t0), questions=[q.model_dump() for q in plan.questions], storyline=plan.storyline)

    results, accepted, rejected = [], [], []
    for q in plan.questions:
        tq = time.time()
        before = set(CAPTURE)
        try:
            answer = researcher.run_sync(f"Question {q.id}: {q.text}\nMetric: {q.metric or 'n/a'}\nCountry: France (compare with Germany where useful).").output
        except Exception as e:
            answer = f"agent error: {type(e).__name__}"
            log("question_failed", id=q.id, error=str(e)[:200], cause=repr(e.__cause__)[:400])
        new = [u for u in CAPTURE if u not in before]
        log("answer", id=q.id, text=str(answer)[:400], captures=len(new))
        r = QuestionResult(question_id=q.id, candidates=candidates_from_capture(new, q.text),
                           unanswered_reason=None if new else "no tool retrieval for this question")
        results.append(r)
        for c in r.candidates:
            ok, why = validate(c)
            (accepted if ok else rejected).append((q.id, c, why))
            log("candidate", q=q.id, ok=ok, why=why, statement=c.statement[:120], value=c.value, period=c.period, url=c.source_url[:120])
        log("question_done", id=q.id, seconds=round(time.time() - tq), candidates=len(r.candidates), unanswered=r.unanswered_reason)

    # ---- build an frr ResearchRecord: only validated evidence; the rest become gaps
    today = date.today()
    sources: dict[str, S.Source] = {}
    evidence: list[S.Evidence] = []
    for i, (qid, c, why) in enumerate(accepted, 1):
        cap = CAPTURE[c.source_url]
        sid = "src." + hashlib.sha1(c.source_url.encode()).hexdigest()[:10]
        if sid not in sources:
            sources[sid] = S.Source(id=sid, title=(cap.get("label") or urlparse(c.source_url).hostname)[:200],
                                    publisher="Eurostat" if cap["kind"] == "api" else urlparse(c.source_url).hostname,
                                    source_type=S.SourceType.official_statistics if cap["kind"] == "api" else S.SourceType.other,
                                    origin=S.SourceOrigin.retrieved, url=c.source_url, accessed_date=today,
                                    notes=("secondary source" if cap.get("secondary") else None))
        locator = (f"{cap['dataset']} {json.dumps(cap['filters'], sort_keys=True)} @ {c.period}" if cap["kind"] == "api"
                   else f"page sha256 {cap['sha256'][:12]}")
        evidence.append(S.Evidence(id=f"ev.exp2.{i}", source_id=sid, kind=S.EvidenceKind(c.kind), statement=c.statement,
                                   locator=locator, excerpt=c.excerpt, subject="France", question_ids=[qid],
                                   verification=S.Verification.verified, verified_by="exp2-validator", verified_on=today,
                                   value=c.value, unit=c.unit, period=c.period))
    answered = {qid for qid, _, _ in accepted}
    gaps = [S.Gap(id=f"gap.{r.question_id}", description=(r.unanswered_reason or "no candidate passed validation")[:500],
                  reason=S.GapReason.not_found if not r.candidates else S.GapReason.needs_verification,
                  question_ids=[r.question_id], auto_detected=True)
            for r in results if r.question_id not in answered]
    record = S.ResearchRecord(
        record_id=f"exp2-{int(t0)}", mode=S.RecordMode.live, created_at=datetime.now(timezone.utc), llm_provider="ollama:qwen2.5:14b",
        scope=S.Scope(company="Republic of France", objective=brief, use_case="company_credit", sector="general"),
        questions=[S.ResearchQuestion(id=q.id, text=q.text, rationale=q.rationale, evidence_needed=[q.metric or q.text],
                                      status=S.QuestionStatus.answered if q.id in answered else S.QuestionStatus.open) for q in plan.questions],
        sources=list(sources.values()), evidence=evidence, gaps=gaps)
    (OUT / "record.json").write_text(record.model_dump_json(indent=1))
    (OUT / "log.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in LOG))
    summary = {"seconds": round(time.time() - t0), "questions": len(plan.questions), "answered": len(answered),
               "accepted": len(accepted), "rejected": len(rejected), "gaps": len(gaps),
               "tool_calls": sum(1 for x in LOG if x["event"] == "tool_call"),
               "blocked": [x["url"] for x in LOG if x["event"] in ("tool_blocked", "tool_refused")],
               "rejections": [{"q": q, "why": why, "statement": c.statement[:100]} for q, c, why in rejected],
               "plan_usage": str(plan_run.usage())}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Analyze France's sovereign credit risk and create a professional four-slide presentation.")
