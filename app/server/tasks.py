"""Task centre (M5): background research that survives the browser.

A task is a JSON file in ``<project>/tasks/``: kind, params, status, progress, log and, when done,
a RESULT PROPOSAL that the user applies like any other (nothing lands in the deck by itself).
Tasks run in the server's event loop (blocking work in threads), so editing or reloading the page
does not touch them. If the server itself stops, running tasks are marked ``interrupted`` at the
next start and can be retried; they are never silently lost or half-applied.

Kinds:
- ``eurostat_pack``: several Eurostat series, each fetched twice and kept only where both agree;
- ``rating_pdf``: rating actions quoted from an uploaded agency PDF and verified on the page.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import agent as workspace_agent
import research_runs as rr
from evidence import CURVES, GROUPS, METRICS, NAMES
from projects import BundleError, ProjectStore

STATUSES = ("queued", "running", "done", "failed", "cancelled", "interrupted")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TaskCenter:
    def __init__(self, store: ProjectStore, model=None, get: Callable[[str], bytes] = workspace_agent.http_get, pace: float = 0.4):
        self.store, self.model, self.get, self.pace = store, model, get, pace
        self.handles: dict[str, asyncio.Task] = {}
        self._quoter = None

    # ---------------------------------------------------------------- storage
    def _dir(self, pid: str) -> Path:
        d = self.store._dir(pid) / "tasks"
        if not (self.store._dir(pid) / "current").exists():
            raise BundleError("unknown project")
        d.mkdir(exist_ok=True)
        return d

    def _save(self, pid: str, t: dict) -> None:
        t["updated"] = _now()
        f = self._dir(pid) / f"{t['id']}.json"
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(t, ensure_ascii=False))
        tmp.replace(f)

    def list(self, pid: str) -> list[dict]:
        return sorted((json.loads(f.read_text()) for f in self._dir(pid).glob("task-*.json")), key=lambda t: t["created"])

    def load(self, pid: str, tid: str) -> dict:
        f = self._dir(pid) / f"{tid}.json"
        if not tid.startswith("task-") or not f.exists():
            raise BundleError("not found")
        return json.loads(f.read_text())

    def recover(self) -> int:
        """At start-up: tasks that were running when the server stopped become 'interrupted'."""
        n = 0
        for f in self.store.root.glob("*/tasks/task-*.json"):
            t = json.loads(f.read_text())
            if t["status"] in ("queued", "running"):
                t.update(status="interrupted", error="the server stopped while this task was running; retry it")
                t["log"].append({"at": _now(), "msg": "interrupted by a server restart"})
                self._save(f.parent.parent.name, t)
                n += 1
        return n

    # ---------------------------------------------------------------- lifecycle
    def create(self, pid: str, kind: str, params: dict, title: str | None = None) -> dict:
        if kind not in RUNNERS:
            raise BundleError(f"unknown task kind {kind!r}")
        t = {"id": f"task-{uuid.uuid4().hex[:8]}", "kind": kind, "params": params, "title": title or kind, "status": "queued",
             "progress": 0.0, "log": [], "result": None, "error": None, "created": _now()}
        self._save(pid, t)
        self.handles[t["id"]] = asyncio.get_running_loop().create_task(self._run(pid, t))
        return t

    def cancel(self, pid: str, tid: str) -> dict:
        t = self.load(pid, tid)
        h = self.handles.get(tid)
        if h and not h.done():
            h.cancel()
        elif t["status"] in ("queued", "running"):  # no live handle (e.g. another process): mark it
            t.update(status="cancelled")
            self._save(pid, t)
        return t

    def retry(self, pid: str, tid: str) -> dict:
        t = self.load(pid, tid)
        if t["status"] in ("queued", "running"):
            raise BundleError("task is still running")
        return self.create(pid, t["kind"], t["params"], t["title"] + " (retry)")

    def progress(self, pid: str, t: dict, frac: float, msg: str) -> None:
        t["progress"] = round(max(t["progress"], min(frac, 1.0)), 3)
        t["log"].append({"at": _now(), "msg": msg})
        self._save(pid, t)

    async def _run(self, pid: str, t: dict) -> None:
        t["status"] = "running"
        self.progress(pid, t, 0.0, "started")
        try:
            t["result"] = await RUNNERS[t["kind"]](self, pid, t)
            t["status"], t["progress"] = "done", 1.0
            t["log"].append({"at": _now(), "msg": t["result"].get("summary", "done")})
        except asyncio.CancelledError:
            t["status"] = "cancelled"
            t["log"].append({"at": _now(), "msg": "cancelled"})
        except Exception as exc:  # recorded on the task; the server keeps running
            t["status"], t["error"] = "failed", f"{type(exc).__name__}: {exc}"
            t["log"].append({"at": _now(), "msg": t["error"]})
        finally:
            self._save(pid, t)
            self.handles.pop(t["id"], None)

    async def quote(self, doc: str) -> str:
        if self._quoter is None:
            from pydantic_ai import Agent
            self._quoter = Agent(self.model or workspace_agent.model_from_env(), output_type=str, instructions=rr.QUOTER, name="frr-quoter")
        return (await self._quoter.run(doc)).output


# ------------------------------------------------------------------ runners
async def run_eurostat_pack(c: TaskCenter, pid: str, t: dict) -> dict:
    p = t["params"]
    geos, metrics, since = [g.upper()[:2] for g in p["geos"]], p.get("metrics") or GROUPS["fiscal"], str(p.get("since", "2015"))
    have = set(c.store.load(pid)["project"]["datasets"])
    # a yield curve is euro-area wide and comes in one request per curve, whatever countries were asked for
    jobs = [(g, m) for g in geos for m in metrics if m in METRICS] + [("EA", m) for m in metrics if m in CURVES]
    datasets, evidence, failed, rejected = [], {}, [], 0
    for i, (geo, metric) in enumerate(jobs):
        if metric in CURVES:
            c.progress(pid, t, i / len(jobs), f"Euro area · {metric}: fetching every tenor twice from Eurostat")
            try:
                got_all = await asyncio.to_thread(workspace_agent.fetch_curve, c.get, metric, str(p.get("curve_since", "2024-01")))
            except Exception as exc:
                failed.append(f"EA {metric}: {exc}")
                c.progress(pid, t, (i + 1) / len(jobs), f"Euro area · {metric}: failed ({exc})")
                continue
            new = [g for g in got_all if g["dataset"]["id"] not in have and g["dataset"]["observations"]]
            for g in new:
                datasets.append(g["dataset"])
                evidence.update(g["evidence"])
                rejected += g["rejected"]
            c.progress(pid, t, (i + 1) / len(jobs), f"Euro area · {metric}: {len(new)} tenors, {sum(len(g['dataset']['observations']) for g in new)} values verified")
            await asyncio.sleep(c.pace)
            continue
        c.progress(pid, t, i / len(jobs), f"{NAMES.get(geo, geo)} · {metric}: fetching twice from Eurostat")
        if f"ds.{geo.lower()}.{metric}" in have:
            c.progress(pid, t, (i + 1) / len(jobs), f"{NAMES.get(geo, geo)} · {metric}: already in the project, skipped")
            continue
        try:
            got = await asyncio.to_thread(workspace_agent.fetch_verified, c.get, metric, geo, since)
        except Exception as exc:  # one series failing does not sink the pack
            failed.append(f"{geo} {metric}: {exc}")
            c.progress(pid, t, (i + 1) / len(jobs), f"{NAMES.get(geo, geo)} · {metric}: failed ({exc})")
            continue
        rejected += got["rejected"]
        if got["dataset"]["observations"]:
            datasets.append(got["dataset"])
            evidence.update(got["evidence"])
        c.progress(pid, t, (i + 1) / len(jobs), f"{NAMES.get(geo, geo)} · {metric}: {len(got['dataset']['observations'])} values verified"
                   + (f", {got['rejected']} rejected" if got["rejected"] else ""))
        await asyncio.sleep(c.pace)  # polite pacing between API calls
    n = sum(len(d["observations"]) for d in datasets)
    return {"kind": "datasets_proposal", "datasets": datasets, "evidence": evidence, "rejected": rejected, "failed": failed,
            "summary": f"Retrieved {len(datasets)} series ({n} values) from Eurostat, each confirmed by an independent re-fetch"
                       + (f"; {rejected} values rejected" if rejected else "") + (f"; {len(failed)} series failed" if failed else "")
                       + ". Apply to add them to the project's data; nothing has changed yet."}


async def run_rating_pdf(c: TaskCenter, pid: str, t: dict) -> dict:
    p = t["params"]
    data, meta = c.store.upload(pid, p["upload"])
    c.progress(pid, t, 0.1, f"reading {meta['filename']} with pypdf")
    pages = await asyncio.to_thread(rr.pdf_pages, data)
    if not any(x.strip() for x in pages):
        raise rr.ResearchError("the PDF has no extractable text (scanned?); OCR is not part of D4's lightweight path")
    c.progress(pid, t, 0.3, f"{len(pages)} pages; asking the local model to quote rating actions")
    try:
        quoted = await rr.model_candidates(pages, c.quote)
    except Exception as exc:  # the model is optional: the pattern finder still runs
        quoted = []
        c.progress(pid, t, 0.6, f"model unavailable ({type(exc).__name__}); using the pattern finder only")
    found = rr.pattern_candidates(pages)
    c.progress(pid, t, 0.7, f"{len(quoted)} quotes from the model, {len(found)} from the pattern finder; verifying each on its page")
    entity = p.get("entity") or "France"
    evidence, rejected = rr.rating_evidence(data, meta["filename"], entity, quoted + found, pages)
    if not evidence:
        return {"kind": "no_evidence", "rejected": rejected[:20], "pages": len(pages),
                "summary": f"No verifiable rating action in {meta['filename']}: {len(rejected)} candidates failed verification. Nothing was changed."}
    top = evidence[0]["rating"]
    month = top["date"][:7] if top["date"] else None
    title = f"Rating actions: {top['agency']} {top['action']} {entity} at {top['rating']}" + (f", outlook {top['outlook']}" if top["outlook"] else "")
    if month:
        title += f" ({datetime.strptime(month, '%Y-%m').strftime('%B %Y')})"
    return {"kind": "rating_proposal", "element": p.get("element"), "slide": p.get("slide"), "evidence": evidence, "rejected": rejected[:20],
            "title": title, "source_note": f"Source: {top['agency']} press release, {meta['filename']} (uploaded; SHA-256 {evidence[0]['retrieval']['content_sha256'][:12]}…), "
                                           f"p. {', '.join(sorted({str(e['page']) for e in evidence}))}. Each row's excerpt verified on its page.",
            "summary": f"Verified {len(evidence)} rating action{'' if len(evidence) == 1 else 's'} in {meta['filename']} (page and verbatim excerpt; "
                       f"{len(rejected)} candidate{'' if len(rejected) == 1 else 's'} rejected). Apply to replace the placeholder; nothing has changed yet."}


RUNNERS = {"eurostat_pack": run_eurostat_pack, "rating_pdf": run_rating_pdf}
