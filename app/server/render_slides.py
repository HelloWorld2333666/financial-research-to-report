"""Render slides or design candidates to 1280x720 PNGs with headless Chrome, through the app's own renderer.

    python render_slides.py --base http://127.0.0.1:8791 --project <id> --out <dir> slide:5 brief:debt:0 brief:debt:1 ...

Each target becomes <out>/<name>.png plus <out>/<name>.json (what the page drew: candidate label, layout, QA findings).
Uses the ?render=1 page (app/web/src/render.tsx); candidates are applied to an in-memory copy, never saved.
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CANDIDATES = [os.environ.get("CHROME_BIN"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              shutil.which("chromium"), shutil.which("google-chrome"), shutil.which("chrome")]
CHROME = next((c for c in CANDIDATES if c and os.path.exists(c)), None)


def chrome(args: list[str], url: str, profile: str) -> str:
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--window-size=1280,720",
                           "--hide-scrollbars", "--force-device-scale-factor=1", "--virtual-time-budget=20000", *args, url],
                          capture_output=True, text=True, timeout=180).stdout


def render(base: str, project: str, target: str, out: Path) -> dict:
    kind, *rest = target.split(":")
    if kind == "slide":
        query, name = f"slide={rest[0]}", f"slide-{rest[0]}"
    elif kind == "brief":
        query, name = f"brief={rest[0]}&cand={rest[1]}", f"{rest[0]}-{rest[1]}"
    else:
        raise SystemExit(f"unknown target {target}")
    url = f"{base}/?render=1&project={project}&{query}"
    with tempfile.TemporaryDirectory() as prof:
        dom = chrome(["--dump-dom"], url, prof)
        m = re.search(r'<pre id="render"[^>]*>(.*?)</pre>', dom, re.S)
        meta = json.loads(html.unescape(m.group(1))) if m else {"error": "the page did not finish"}
        if "error" not in meta:
            chrome([f"--screenshot={out / (name + '.png')}"], url, prof)
    (out / f"{name}.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    return {"name": name, **meta}


def main(argv: list[str]):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    ap.add_argument("--project", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("targets", nargs="+")
    a = ap.parse_args(argv)
    if not CHROME:
        raise SystemExit("Chrome not found (set CHROME_BIN)")
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for t in a.targets:
        r = render(a.base, a.project, t, out)
        print(json.dumps({k: r.get(k) for k in ("name", "label", "error", "qa")}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
