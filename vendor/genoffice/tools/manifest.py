"""Generate vendor/genoffice/manifest.json from a pristine GenOffice checkout.

    python3 -I vendor/genoffice/tools/manifest.py <genoffice-checkout> <commit-sha>

The manifest lists exactly the files our app imports: the static and dynamic import closure of the
entry points below, plus `?raw` assets, the package.json of every included package, and the
licence files. Each file is recorded with its sha256, so sync.py can verify what it fetches.
"""

import hashlib
import json
import os
import re
import sys
from pathlib import Path

ENTRIES = [
    "packages/pptx-engine/src/index.ts",
    "packages/pptx-ops/src/index.ts",
    "packages/pptx-render/src/index.ts",
    "apps/slides/src/renderer/SlideCanvas.tsx",
    "apps/slides/src/renderer/konva-adapter.ts",
    "apps/slides/src/renderer/TextEditOverlay.tsx",
    # PD1: deterministic slide geometry audit (bounds, text overflow, overlaps) on render nodes
    "packages/pipelines/src/slides/layout-audit.ts",
]
ALWAYS = ["LICENSE", "NOTICE", "LICENSE-UNICODE.txt"]
# `import type` / `export type` statements are erased at build time, so they do not pull files in
IMPORT = re.compile(r"""(?:import|export)\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]""", re.M)


def package_aliases(root: Path) -> dict[str, Path]:
    out = {}
    for pj in sorted((root / "packages").glob("*/package.json")):
        d = json.loads(pj.read_text())
        for key, target in (d.get("exports") or {}).items():
            if isinstance(target, str):
                out[d["name"] + ("" if key == "." else key[1:])] = (pj.parent / target).resolve()
    return out


def resolve(root: Path, aliases: dict, base: Path, spec: str):
    spec = spec.split("?")[0]
    if spec in aliases:
        return aliases[spec]
    if not spec.startswith("."):
        return None  # third-party package, installed by npm
    p = (base.parent / spec).resolve()
    for c in [p, p.with_suffix(".ts"), p.with_suffix(".tsx"), p / "index.ts", p / "index.tsx",
              Path(str(p).removesuffix(".js") + ".ts"), Path(str(p).removesuffix(".js") + ".tsx")]:
        if c.is_file():
            return c
    raise SystemExit(f"unresolved import {spec!r} in {base.relative_to(root)}")


def main(root: Path, commit: str):
    aliases = package_aliases(root)
    seen: set[Path] = set()
    todo = [(root / e).resolve() for e in ENTRIES]
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        if f.suffix not in (".ts", ".tsx"):
            continue
        for m in IMPORT.finditer(f.read_text(errors="ignore")):
            spec = next(x for x in m.groups() if x)
            r = resolve(root, aliases, f, spec)
            if r is not None:
                todo.append(r)
    files = {str(p.relative_to(root)) for p in seen}
    pkgs = {Path(*Path(p).parts[:2]) for p in files if p.startswith("packages/")}
    files |= {str(p / "package.json") for p in pkgs} | set(ALWAYS)
    manifest = {"repository": "genspark-ai/genoffice", "commit": commit, "license": "Apache-2.0 (ee/ excluded)",
                "files": {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(files)}}
    out = Path(__file__).resolve().parents[1] / "manifest.json"
    out.write_text(json.dumps(manifest, indent=1) + "\n")
    lines = sum((root / p).read_text(errors="ignore").count("\n") for p in files)
    by_top = {}
    for p in files:
        k = "/".join(p.split("/")[:2]); by_top[k] = by_top.get(k, 0) + 1
    print(f"{len(files)} files, {lines} lines -> {out}")
    print(json.dumps(dict(sorted(by_top.items(), key=lambda x: -x[1])), indent=0))


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
