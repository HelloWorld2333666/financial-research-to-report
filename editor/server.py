"""Local server for the slide editor spike (Python stdlib only).

    python editor/server.py [--port 8765]

Serves editor/static and a small JSON API. Binds to 127.0.0.1 only.

    GET  /api/projects/<name>                      load project
    PUT  /api/projects/<name>                      save (keeps a timestamped copy in projects/.history)
    POST /api/integrity                            integrity report for a posted project
    POST /api/projects/<name>/export               save a PNG (data URL) to editor/exports/
    POST /api/projects/<name>/requests/<id>        write change request + prompt for an agent
    GET  /api/projects/<name>/requests/<id>/patch  read the agent's patch file, if any
    POST /api/patch/validate                       validate (and preview) a patch against a project
    POST /api/classify                             layout edit vs existing data vs research (no model calls)
    POST /api/research/create                      add a Research Request + pending placeholder
    POST /api/projects/<name>/research/<id>        write the Research Request handoff file
    GET  /api/projects/<name>/research/<id>/response   read a Research Engine response file, if any
    POST /api/research/apply                       validate and apply a Research Engine response
    POST /api/research/revert                      remove inserted research content, reopen the request
    GET  /api/fixtures                             list TEST FIXTURE responses (simulated engine output)
    POST /api/research/fixture                     load a TEST FIXTURE response for a request
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shlex
import sys
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import research  # noqa: E402
import slidemodel  # noqa: E402

HERE = Path(__file__).resolve().parent
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MAX_BODY = 40 * 1024 * 1024


class Paths:
    def __init__(self, root: Path = HERE):
        self.root = root
        self.static = root / "static"
        self.projects = root / "projects"
        self.history = root / "projects" / ".history"
        self.exports = root / "exports"
        self.requests = root / "requests"
        self.research = root / "research"
        self.fixtures = root / "fixtures" / "research_responses"


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def make_handler(paths: Paths):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(paths.static), **kw)

        def log_message(self, fmt, *args):  # quieter console
            sys.stderr.write("%s %s\n" % (self.command, self.path))

        # ---------------------------------------------------------------- helpers
        def send_json(self, obj, status=HTTPStatus.OK):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def fail(self, status, message):
            self.send_json({"error": message}, status)

        def read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                raise ValueError("missing or oversized body")
            return json.loads(self.rfile.read(length))

        def route(self):
            return [p for p in urlparse(self.path).path.split("/") if p]

        def project_path(self, name):
            if not NAME_RE.match(name):
                raise ValueError("invalid project name")
            return paths.projects / f"{name}.json"

        def end_headers(self):
            if not self.path.startswith("/api/"):
                self.send_header("Cache-Control", "no-store")
            super().end_headers()

        # ---------------------------------------------------------------- verbs
        def do_GET(self):
            r = self.route()
            try:
                if r[:2] == ["api", "projects"] and len(r) == 3:
                    p = self.project_path(r[2])
                    if not p.exists():
                        return self.fail(HTTPStatus.NOT_FOUND, "no such project")
                    return self.send_json(json.loads(p.read_text(encoding="utf-8")))
                if r[:2] == ["api", "projects"] and len(r) == 6 and r[3] == "requests" and r[5] == "patch":
                    self.project_path(r[2])
                    if not NAME_RE.match(r[4]):
                        raise ValueError("invalid request id")
                    f = paths.requests / r[2] / f"{r[4]}.patch.json"
                    if not f.exists():
                        return self.fail(HTTPStatus.NOT_FOUND, f"no patch file yet: {f.relative_to(paths.root)}")
                    return self.send_json(json.loads(f.read_text(encoding="utf-8")))
                if r[:2] == ["api", "projects"] and len(r) == 6 and r[3] == "research" and r[5] == "response":
                    self.project_path(r[2])
                    if not NAME_RE.match(r[4]):
                        raise ValueError("invalid request id")
                    f = paths.research / r[2] / f"{r[4]}.response.json"
                    if not f.exists():
                        return self.fail(HTTPStatus.NOT_FOUND, f"no response yet: {f.relative_to(paths.root)}")
                    return self.send_json(json.loads(f.read_text(encoding="utf-8")))
                if r == ["api", "fixtures"]:
                    files = sorted(paths.fixtures.glob("*.json")) if paths.fixtures.exists() else []
                    return self.send_json([{"name": f.stem, "description": json.loads(f.read_text())["notes"]}
                                           for f in files])
            except ValueError as exc:
                return self.fail(HTTPStatus.BAD_REQUEST, str(exc))
            if r and r[0] == "api":
                return self.fail(HTTPStatus.NOT_FOUND, "unknown endpoint")
            return super().do_GET()

        def do_PUT(self):
            r = self.route()
            try:
                if r[:2] == ["api", "projects"] and len(r) == 3:
                    p = self.project_path(r[2])
                    project = self.read_json()
                    errors = slidemodel.validate_project(project)
                    if errors:
                        return self.send_json({"errors": errors}, HTTPStatus.UNPROCESSABLE_ENTITY)
                    data = json.dumps(project, indent=1, ensure_ascii=False).encode("utf-8")
                    if p.exists():  # keep the previous version for revert after reload
                        atomic_write(paths.history / r[2] / f"{stamp()}.json", p.read_bytes())
                    atomic_write(p, data)
                    return self.send_json({"saved": str(p.relative_to(paths.root)),
                                           "integrity": slidemodel.check_integrity(project)})
            except (ValueError, json.JSONDecodeError) as exc:
                return self.fail(HTTPStatus.BAD_REQUEST, str(exc))
            return self.fail(HTTPStatus.NOT_FOUND, "unknown endpoint")

        def do_POST(self):
            r = self.route()
            try:
                body = self.read_json()
                if r == ["api", "integrity"]:
                    return self.send_json({"errors": slidemodel.validate_project(body),
                                           "integrity": slidemodel.check_integrity(body)})
                if r == ["api", "patch", "validate"]:
                    errors, new = slidemodel.validate_patch(body["project"], body["request_id"], body["patch"])
                    if errors:
                        return self.send_json({"ok": False, "errors": errors})
                    return self.send_json({"ok": True, "project": new,
                                           "integrity": slidemodel.check_integrity(new)})
                if r == ["api", "classify"]:
                    return self.send_json(research.classify(body["project"], body.get("instruction", "")))
                if r == ["api", "research", "create"]:
                    new, req = research.create_request(body["project"], body.get("instruction", ""),
                                                       body.get("region") or {}, body.get("overrides"))
                    return self.send_json({"project": new, "request": req,
                                           "integrity": slidemodel.check_integrity(new)})
                if r == ["api", "research", "apply"]:
                    errors, warnings, new = research.apply_response(body["project"], body["response"])
                    if errors:
                        return self.send_json({"ok": False, "errors": errors, "warnings": warnings})
                    return self.send_json({"ok": True, "warnings": warnings, "project": new,
                                           "integrity": slidemodel.check_integrity(new)})
                if r == ["api", "research", "revert"]:
                    new = research.revert_insertion(body["project"], body["request_id"])
                    return self.send_json({"project": new, "integrity": slidemodel.check_integrity(new)})
                if r == ["api", "research", "fixture"]:
                    if not NAME_RE.match(body.get("name", "")):
                        raise ValueError("invalid fixture name")
                    f = paths.fixtures / f"{body['name']}.json"
                    if not f.exists():
                        raise ValueError("no such fixture")
                    resp = json.loads(f.read_text(encoding="utf-8"))
                    resp["request_id"] = body["request_id"]  # fixtures are request-agnostic
                    return self.send_json(resp)
                if r[:2] == ["api", "projects"] and len(r) == 5 and r[3] == "research":
                    self.project_path(r[2])
                    if not NAME_RE.match(r[4]):
                        raise ValueError("invalid request id")
                    handoff = research.export_request(body, r[4])
                    d = paths.research / r[2]
                    atomic_write(d / f"{r[4]}.request.json", json.dumps(handoff, indent=1, ensure_ascii=False).encode("utf-8"))
                    return self.send_json({"request": str((d / f"{r[4]}.request.json").relative_to(paths.root)),
                                           "response_expected_at": str((d / f"{r[4]}.response.json").relative_to(paths.root))})
                if r[:2] == ["api", "projects"] and len(r) == 4 and r[3] == "export":
                    self.project_path(r[2])
                    url = body.get("png", "")
                    if not url.startswith("data:image/png;base64,"):
                        raise ValueError("expected a PNG data URL")
                    png = base64.b64decode(url.split(",", 1)[1], validate=True)
                    if not png.startswith(b"\x89PNG"):
                        raise ValueError("not a PNG")
                    out = paths.exports / f"{r[2]}-{body.get('label') or 'export'}-{stamp()}.png"
                    if not NAME_RE.match((body.get("label") or "export")):
                        raise ValueError("invalid label")
                    atomic_write(out, png)
                    return self.send_json({"saved": str(out.relative_to(paths.root)), "bytes": len(png)})
                if r[:2] == ["api", "projects"] and len(r) == 5 and r[3] == "requests":
                    self.project_path(r[2])
                    if not NAME_RE.match(r[4]):
                        raise ValueError("invalid request id")
                    request = slidemodel.build_change_request(body, r[4])
                    d = paths.requests / r[2]
                    req_file, prompt_file = d / f"{r[4]}.request.json", d / f"{r[4]}.prompt.md"
                    atomic_write(req_file, json.dumps(request, indent=1, ensure_ascii=False).encode("utf-8"))
                    atomic_write(prompt_file, slidemodel.render_prompt(request).encode("utf-8"))
                    patch_file = d / f"{r[4]}.patch.json"
                    schema = json.dumps(slidemodel.PATCH_SCHEMA, separators=(",", ":"))
                    # Not executed by the server: shown to the user to run deliberately.
                    command = (f"claude -p --tools '' --output-format json --no-session-persistence "
                               f"--json-schema {shlex.quote(schema)} < {shlex.quote(str(prompt_file))}")
                    return self.send_json({"request": str(req_file.relative_to(paths.root)),
                                           "prompt": str(prompt_file.relative_to(paths.root)),
                                           "patch_expected_at": str(patch_file.relative_to(paths.root)),
                                           "scope_element_ids": request["scope_element_ids"],
                                           "suggested_command": command})
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                return self.fail(HTTPStatus.BAD_REQUEST, f"{type(exc).__name__}: {exc}")
            return self.fail(HTTPStatus.NOT_FOUND, "unknown endpoint")

    return Handler


def serve(port: int, paths: Paths = Paths()) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(paths))


def main() -> int:
    ap = argparse.ArgumentParser(description="Slide editor spike server")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    httpd = serve(args.port)
    print(f"Slide editor: http://127.0.0.1:{args.port}/?project=china_re_overview")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
