"""Research-to-Report workspace service (Phase 3).

    python3 app/server/service.py [--port 8791] [--projects DIR]

Serves the JSON API under /api and the built web client (app/web/dist) at /.
M1: projects (bundle save/load, versions) and the deterministic composer. M3: working-data
validation on save, integrity of the saved deck, and the export policy. M4: the AG-UI agent at
/api/agent (tools return proposals; see agent.py). M5: uploads and the task centre (tasks.py).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE))

import httpx  # noqa: E402
from pydantic_ai.ui import StateDeps  # noqa: E402
from pydantic_ai.ui.ag_ui import AGUIAdapter  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import FileResponse, JSONResponse  # noqa: E402
from starlette.routing import Mount, Route  # noqa: E402
from starlette.staticfiles import StaticFiles  # noqa: E402

import agent as workspace_agent  # noqa: E402
import export  # noqa: E402
import tasks as task_center  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
import integrity  # noqa: E402
from composer import compose  # noqa: E402
from frr.schema import SCHEMA_VERSION  # noqa: E402
from projects import BundleError, ProjectStore  # noqa: E402

WEB_DIST = ROOT / "app" / "web" / "dist"
MANIFEST = ROOT / "vendor" / "genoffice" / "manifest.json"
PROJECTS = Path(os.environ.get("FRR_PROJECTS", HERE / "projects"))


def create_app(web_dist: Path = WEB_DIST, projects_root: Path = PROJECTS, model=None, fetch=None) -> Starlette:
    """``model`` and ``fetch`` replace the configured model and Eurostat access (tests)."""
    store = ProjectStore(projects_root)
    center = task_center.TaskCenter(store, model, **({"get": fetch} if fetch else {}))
    agent = workspace_agent.create_agent(store, model, **({"get": fetch} if fetch else {}), center=center)

    def guarded(fn):
        async def handler(request: Request):
            try:
                return await fn(request)
            except BundleError as e:
                return JSONResponse({"error": str(e)}, status_code=404 if str(e) in ("not found", "unknown project") else 400)
        return handler

    async def health(_):
        manifest = json.loads(MANIFEST.read_text())
        return JSONResponse({"ok": True, "service": "frr-workspace", "evidence_schema": SCHEMA_VERSION,
                             "genoffice_commit": manifest["commit"], "web_built": web_dist.joinpath("index.html").exists()})

    async def list_projects(_):
        return JSONResponse(store.list())

    async def create_project(request: Request):
        body = await request.json()
        return JSONResponse(store.create(body.get("seed", "blank"), body.get("title") or "Untitled project"), status_code=201)

    async def get_project(request: Request):
        return JSONResponse(store.load(request.path_params["pid"]))

    async def put_project(request: Request):
        pid, bundle = request.path_params["pid"], await request.json()
        meta = store.save(pid, bundle)
        res = integrity.check(store.deck_bytes(pid), bundle["project"], bundle["sidecar"])
        return JSONResponse({**meta, "integrity": {k: (len(v) if isinstance(v, list) else v) for k, v in res.items()}})

    async def get_integrity(request: Request):
        pid = request.path_params["pid"]
        b = store.load(pid)
        return JSONResponse(integrity.check(store.deck_bytes(pid), b["project"], b["sidecar"]))

    async def get_export_policy(request: Request):
        pid = request.path_params["pid"]
        return JSONResponse({**export.policy(store.load(pid), store.deck_bytes(pid)), "exports": store.exports(pid)})

    async def post_export(request: Request):
        pid, body = request.path_params["pid"], await request.json()
        b, deck = store.load(pid), store.deck_bytes(pid)
        pol = export.policy(b, deck)
        mode, ack = body.get("mode"), list(body.get("acknowledged") or [])
        ok, why = export.decide(pol, mode, ack)
        if not ok:
            return JSONResponse({"error": why, "policy": pol}, status_code=409)
        data, record = export.build(b, deck, mode, ack, pol)
        record = store.write_export(pid, mode, data, record)
        return JSONResponse({**record, "url": f"/api/projects/{pid}/exports/{record['file']}"}, status_code=201)

    async def get_export(request: Request):
        f = store.export_file(request.path_params["pid"], request.path_params["name"])
        return FileResponse(f, filename=f.name, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")

    async def post_version(request: Request):
        body = await request.json()
        return JSONResponse(store.save_version(request.path_params["pid"], body.get("label") or "Version"), status_code=201)

    async def list_versions(request: Request):
        return JSONResponse(store.versions(request.path_params["pid"]))

    async def get_version(request: Request):
        return JSONResponse(store.load_version(request.path_params["pid"], request.path_params["n"]))

    async def post_upload(request: Request):
        body = await request.body()
        return JSONResponse(store.save_upload(request.path_params["pid"], request.query_params.get("name", "upload.pdf"), body), status_code=201)

    async def list_tasks(request: Request):
        return JSONResponse(center.list(request.path_params["pid"]))

    async def post_task(request: Request):
        body = await request.json()
        return JSONResponse(center.create(request.path_params["pid"], body.get("kind", ""), body.get("params") or {}, body.get("title")), status_code=201)

    async def cancel_task(request: Request):
        return JSONResponse(center.cancel(request.path_params["pid"], request.path_params["tid"]))

    async def retry_task(request: Request):
        return JSONResponse(center.retry(request.path_params["pid"], request.path_params["tid"]), status_code=201)

    async def run_agent(request: Request):
        return await AGUIAdapter.dispatch_request(request, agent=agent, deps=StateDeps(workspace_agent.WorkspaceState()))

    async def agent_config(_):
        cfg = workspace_agent.model_config()
        try:
            async with httpx.AsyncClient(timeout=2) as c:
                reachable = (await c.get(cfg["url"].rstrip("/") + "/models")).status_code == 200
        except httpx.HTTPError:
            reachable = False
        return JSONResponse({**cfg, "reachable": reachable})

    async def post_compose(request: Request):
        body = await request.json()
        project = store.load(body["project"])["project"] if "project" in body else body["data"]
        return JSONResponse({"kind": "deck_proposal", "slides": compose(project, body.get("country", "FR"), body.get("peer", "DE"))})

    routes = [
        Route("/api/health", health),
        Route("/api/projects", list_projects, methods=["GET"]),
        Route("/api/projects", guarded(create_project), methods=["POST"]),
        Route("/api/projects/{pid}", guarded(get_project), methods=["GET"]),
        Route("/api/projects/{pid}", guarded(put_project), methods=["PUT"]),
        Route("/api/projects/{pid}/versions", guarded(list_versions), methods=["GET"]),
        Route("/api/projects/{pid}/versions", guarded(post_version), methods=["POST"]),
        Route("/api/projects/{pid}/versions/{n:int}", guarded(get_version), methods=["GET"]),
        Route("/api/projects/{pid}/integrity", guarded(get_integrity), methods=["GET"]),
        Route("/api/projects/{pid}/export", guarded(get_export_policy), methods=["GET"]),
        Route("/api/projects/{pid}/export", guarded(post_export), methods=["POST"]),
        Route("/api/projects/{pid}/exports/{name}", guarded(get_export), methods=["GET"]),
        Route("/api/compose", guarded(post_compose), methods=["POST"]),
        Route("/api/projects/{pid}/uploads", guarded(post_upload), methods=["POST"]),
        Route("/api/projects/{pid}/tasks", guarded(list_tasks), methods=["GET"]),
        Route("/api/projects/{pid}/tasks", guarded(post_task), methods=["POST"]),
        Route("/api/projects/{pid}/tasks/{tid}/cancel", guarded(cancel_task), methods=["POST"]),
        Route("/api/projects/{pid}/tasks/{tid}/retry", guarded(retry_task), methods=["POST"]),
        Route("/api/agent", run_agent, methods=["POST"]),
        Route("/api/agent/config", agent_config, methods=["GET"]),
    ]
    if web_dist.joinpath("index.html").exists():
        routes.append(Mount("/", StaticFiles(directory=web_dist, html=True), name="web"))
    @asynccontextmanager
    async def lifespan(_app):
        center.recover()  # tasks that were running when the server last stopped
        yield

    app = Starlette(routes=routes, lifespan=lifespan)
    app.state.tasks = center
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--projects", type=Path, default=None)
    args = parser.parse_args()
    uvicorn.run(create_app(projects_root=args.projects) if args.projects else app, host="127.0.0.1", port=args.port, log_level="info")
