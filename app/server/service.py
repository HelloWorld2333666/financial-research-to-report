"""Research-to-Report workspace service (Phase 3).

    python3 app/server/service.py [--port 8791]

Serves the JSON API under /api and the built web client (app/web/dist) at /. M0 provides health
only; projects, evidence, agent and tasks arrive in M1–M5 (docs/workspace-prototype/PHASE3-PLAN.md).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Mount, Route  # noqa: E402
from starlette.staticfiles import StaticFiles  # noqa: E402

from frr.schema import SCHEMA_VERSION  # noqa: E402

WEB_DIST = ROOT / "app" / "web" / "dist"
MANIFEST = ROOT / "vendor" / "genoffice" / "manifest.json"


def health(_: Request) -> JSONResponse:
    manifest = json.loads(MANIFEST.read_text())
    return JSONResponse({"ok": True, "service": "frr-workspace", "evidence_schema": SCHEMA_VERSION,
                         "genoffice_commit": manifest["commit"], "web_built": WEB_DIST.joinpath("index.html").exists()})


def create_app(web_dist: Path = WEB_DIST) -> Starlette:
    routes = [Route("/api/health", health)]
    if web_dist.joinpath("index.html").exists():
        routes.append(Mount("/", StaticFiles(directory=web_dist, html=True), name="web"))
    return Starlette(routes=routes)


app = create_app()

if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    uvicorn.run(app, host="127.0.0.1", port=parser.parse_args().port, log_level="info")
