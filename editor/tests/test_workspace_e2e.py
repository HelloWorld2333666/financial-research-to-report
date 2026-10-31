"""End-to-end smoke test of the workspace prototype in headless Chrome.

Runs editor/static/workspace/scenario.js ("smoke"): Data → chart parity, restyle keeps
values, proposal preview/apply/undo, stale-proposal refusal, Design DNA. Skipped when no
Chrome/Chromium binary is available. The scenario never saves the project.
"""

import html
import json
import os
import re
import shutil
import subprocess
import threading

import pytest

import server

CANDIDATES = [os.environ.get("CHROME_BIN"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              shutil.which("chromium"), shutil.which("google-chrome"), shutil.which("chrome")]
CHROME = next((c for c in CANDIDATES if c and os.path.exists(c)), None)


@pytest.mark.skipif(CHROME is None, reason="no Chrome/Chromium available")
def test_workspace_smoke_scenario(tmp_path):
    httpd = server.serve(0)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/workspace/index.html?scenario=smoke"
        out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp_path}", "--window-size=1440,900",
                              "--virtual-time-budget=20000", "--dump-dom", url], capture_output=True, text=True, timeout=120).stdout
    finally:
        httpd.shutdown()
    m = re.search(r'<pre id="scenario-result"[^>]*>(.*?)</pre>', out, re.S)
    assert m, "scenario did not finish"
    result = json.loads(html.unescape(m.group(1)))
    failed = {k: v for k, v in result.items() if not v["ok"]}
    assert len(result) == 11 and not failed, failed
