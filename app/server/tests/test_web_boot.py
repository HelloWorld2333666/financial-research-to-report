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


@needs
def test_pd1_designed_slides_render_16_9_at_1440_and_1100(tmp_path):
    """PD1: the checks build designed slides (applied, redesigned, saved); real headless-Chrome screenshots of that project
    at two editor widths, and the probe confirms the slide keeps 16:9 at each (the stage scales; it never reflows)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    app = service.create_app(projects_root=tmp_path / "projects")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    def chrome(args: list[str], url: str, size: str, profile: str) -> str:
        r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--enable-logging=stderr", "--v=0", f"--user-data-dir={tmp_path / profile}", f"--window-size={size}", *args,
                            f"http://127.0.0.1:{port}/?{url}"], capture_output=True, text=True, timeout=180)
        console.extend(line for line in r.stderr.splitlines() if "CONSOLE" in line)
        return r.stdout
    console: list[str] = []
    try:
        out = chrome(["--virtual-time-budget=60000", "--dump-dom"], "checks=1", "1440,900", "c0")
        m = re.search(r'<pre id="checks"[^>]*>(.*?)</pre>', out, re.S)
        assert m, "checks did not finish"
        checks = json.loads(html.unescape(m.group(1)))
        for k in ("pd1_designs_editable_and_clean", "pd1_redesign_keeps_user_edits"):
            assert checks[k]["ok"], (k, checks[k])
        pid = checks["pd1_project"]["detail"]
        for w, h in ((1440, 900), (1100, 800)):
            dom = chrome(["--virtual-time-budget=15000", "--dump-dom"], f"project={pid}&probe=1", f"{w},{h}", f"p{w}")
            pm = re.search(r'<pre id="probe"[^>]*>(.*?)</pre>', dom, re.S)
            assert pm, f"no probe at {w}px: {pid} " + " || ".join(console[-6:])
            probe = json.loads(html.unescape(pm.group(1)))
            assert probe["slides"] >= 6 and abs(probe["slideW"] / probe["slideH"] - 16 / 9) < 0.01, probe
            shot = tmp_path / f"pd1-{w}.png"
            chrome(["--virtual-time-budget=15000", f"--screenshot={shot}", "--hide-scrollbars"], f"project={pid}&slide={probe['slides']}", f"{w},{h}", f"s{w}")  # the last slide: a designed one
            data = shot.read_bytes()
            assert data[:8] == b"\x89PNG\r\n\x1a\n" and int.from_bytes(data[16:20], "big") == w, f"screenshot at {w}px"
            if os.environ.get("PD1_SHOTS"):
                shutil.copy(shot, Path(os.environ["PD1_SHOTS"]) / shot.name)
    finally:
        server.should_exit = True
