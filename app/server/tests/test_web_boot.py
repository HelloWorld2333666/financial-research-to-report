"""Headless boot check: the built web client loads a blank deck in GenOffice's canvas and reaches the API.

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


@pytest.mark.skipif(CHROME is None or not service.WEB_DIST.joinpath("index.html").exists(), reason="needs Chrome and app/web/dist")
def test_web_client_boots_blank_deck(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(service.create_app(), host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    try:
        out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp_path}", "--window-size=1440,900",
                              "--virtual-time-budget=15000", "--dump-dom", f"http://127.0.0.1:{port}/?selftest=1"],
                             capture_output=True, text=True, timeout=90).stdout
    finally:
        server.should_exit = True
    m = re.search(r'<pre id="selftest"[^>]*>(.*?)</pre>', out, re.S)
    assert m, "web client did not finish booting"
    result = json.loads(html.unescape(m.group(1)))
    assert result["booted"] and result["canvas"] and result["slides"] == ["s_1"]
    assert result["width"] == 800 and result["api"]["ok"]
