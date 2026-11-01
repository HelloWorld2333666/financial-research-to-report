"""Fetch the pinned GenOffice subset into vendor/genoffice/src and apply our patches.

    python3 -I vendor/genoffice/tools/sync.py [--tarball PATH]

- Downloads the tarball for manifest["commit"] from GitHub (or uses --tarball for offline work).
- Extracts only the files listed in manifest.json and checks each one's sha256 before patching.
- Applies vendor/genoffice/patches/*.diff in order (`patch -p1`). Any mismatch stops the sync.
The extracted source is not committed (see .gitignore); this script plus the manifest reproduce it.
"""

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SRC = HERE / "src"


def main(argv: list[str]):
    manifest = json.loads((HERE / "manifest.json").read_text())
    commit, files = manifest["commit"], manifest["files"]
    if "--tarball" in argv:
        data = Path(argv[argv.index("--tarball") + 1]).read_bytes()
    else:
        url = f"https://codeload.github.com/{manifest['repository']}/tar.gz/{commit}"
        print(f"fetching {url}")
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
    if SRC.exists():
        shutil.rmtree(SRC)
    found = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            rel = member.name.split("/", 1)[1] if "/" in member.name else ""
            if rel not in files or not member.isfile():
                continue
            body = tar.extractfile(member).read()
            digest = hashlib.sha256(body).hexdigest()
            if digest != files[rel]:
                raise SystemExit(f"sha256 mismatch for {rel}: {digest} != {files[rel]}")
            out = SRC / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(body)
            found[rel] = digest
    missing = sorted(set(files) - set(found))
    if missing:
        raise SystemExit(f"{len(missing)} manifest files missing from the tarball, e.g. {missing[:3]}")
    print(f"extracted and verified {len(found)} files at {commit[:8]}")
    for patch in sorted((HERE / "patches").glob("*.diff")):
        r = subprocess.run(["patch", "-p1", "--forward", "--silent", "-d", str(SRC), "-i", str(patch)], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f"patch {patch.name} failed:\n{r.stdout}{r.stderr}")
        print(f"applied {patch.name}")
    (SRC / ".synced").write_text(json.dumps({"commit": commit, "patches": [p.name for p in sorted((HERE / "patches").glob("*.diff"))]}))


if __name__ == "__main__":
    main(sys.argv[1:])
