"""Write vendor/genoffice/patches/<name>.diff from edits made in vendor/genoffice/src.

    python3 -I vendor/genoffice/tools/make_patch.py begin <file>...   # snapshot files before editing
    python3 -I vendor/genoffice/tools/make_patch.py end <name>         # diff snapshot vs src -> patches/<name>.diff
"""
import difflib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SRC, SNAP = HERE / "src", HERE / ".patch-snapshot"

if sys.argv[1] == "begin":
    shutil.rmtree(SNAP, ignore_errors=True)
    for rel in sys.argv[2:]:
        (SNAP / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC / rel, SNAP / rel)
    (SNAP / ".files").write_text(json.dumps(sys.argv[2:]))
elif sys.argv[1] == "end":
    out = []
    for rel in json.loads((SNAP / ".files").read_text()):
        a = (SNAP / rel).read_text().splitlines(keepends=True)
        b = (SRC / rel).read_text().splitlines(keepends=True)
        out += difflib.unified_diff(a, b, f"a/{rel}", f"b/{rel}")
    if not out:
        raise SystemExit("no changes")
    (HERE / "patches" / f"{sys.argv[2]}.diff").write_text("".join(out))
    shutil.rmtree(SNAP)
    print(f"wrote patches/{sys.argv[2]}.diff ({len(out)} lines)")
