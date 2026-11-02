"""Headless boot and end-to-end checks of the built web client against a real service.

Skipped when Chrome or the web build (app/web/dist) is missing. Build first: `npm run build` in app/web.
"""

import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

pytest.importorskip("uvicorn")
import uvicorn  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service  # noqa: E402

CANDIDATES = [os.environ.get("CHROME_BIN"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              shutil.which("chromium"), shutil.which("google-chrome"), shutil.which("chrome")]
CHROME = next((c for c in CANDIDATES if c and os.path.exists(c)), None)


needs = pytest.mark.skipif(CHROME is None or not service.WEB_DIST.joinpath("index.html").exists(), reason="needs Chrome and app/web/dist")


def run_page(tmp_path, query: str, element: str, budget_ms: int) -> dict:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    app = service.create_app(projects_root=tmp_path / "projects")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    try:
        out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp_path / 'chrome'}", "--window-size=1440,900",
                              f"--virtual-time-budget={budget_ms}", "--dump-dom", f"http://127.0.0.1:{port}/?{query}"],
                             capture_output=True, text=True, timeout=120).stdout
    finally:
        server.should_exit = True
    m = re.search(rf'<pre id="{element}"[^>]*>(.*?)</pre>', out, re.S)
    assert m, f"page did not finish ({query})"
    return json.loads(html.unescape(m.group(1)))


@needs
def test_web_client_boots_blank_deck(tmp_path):
    result = run_page(tmp_path, "selftest=1", "selftest", 15000)
    assert result["booted"] and result["canvas"] and result["slides"] == ["s_1"]
    assert result["width"] == 800 and result["api"]["ok"]


@needs
def test_end_to_end_checks_in_the_browser(tmp_path):
    result = run_page(tmp_path, "checks=1", "checks", 60000)
    failed = {k: v for k, v in result.items() if not v["ok"]}
    assert len(result) >= 29 and not failed, failed
