"""Project bundles on disk: deck (OOXML), Evidence Core project, bindings sidecar, journal, threads.

    <root>/<project id>/current/{deck.pptx, project.json, sidecar.json, journal.jsonl, threads.json, meta.json}
    <root>/<project id>/versions/<n>/...   (same files, frozen by "Save version")

Saving overwrites `current` (autosave). A version is a copy of `current` with a label. Bundles are
validated structurally before anything is written; a failed save leaves the previous files intact.
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from evidence import PROJECT_SCHEMA, seed_project
from integrity import validate_working

BUNDLE_SCHEMA = "frr-bundle/1"
SIDECAR_SCHEMA = "frr-sidecar/1"
MAX_DECK_BYTES = 50 * 1024 * 1024
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
DURABLE_RE = re.compile(r"^e_[0-9a-zA-Z]+$")


class BundleError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_bundle(b: dict) -> bytes | None:
    """Check a bundle's structure; return the decoded deck bytes (or None for a deck-less project)."""
    if b.get("schema") != BUNDLE_SCHEMA:
        raise BundleError(f"bundle schema must be {BUNDLE_SCHEMA}")
    if (b.get("project") or {}).get("schema") != PROJECT_SCHEMA:
        raise BundleError(f"project schema must be {PROJECT_SCHEMA}")
    sidecar = b.get("sidecar") or {}
    if sidecar.get("schema") != SIDECAR_SCHEMA:
        raise BundleError(f"sidecar schema must be {SIDECAR_SCHEMA}")
    bad = [k for k in sidecar.get("bindings", {}) if not DURABLE_RE.match(k)]
    if bad:
        raise BundleError(f"sidecar binding keys must be durable element ids, got {bad[:3]}")
    if not isinstance(b.get("journal", []), list) or not isinstance(b.get("threads", {}), dict):
        raise BundleError("journal must be a list and threads an object")
    problems = validate_working(b["project"])
    if problems:
        raise BundleError("working data refused: " + "; ".join(problems[:5]))
    if b.get("deck") is None:
        return None
    deck = base64.b64decode(b["deck"], validate=True)
    if len(deck) > MAX_DECK_BYTES or deck[:2] != b"PK":
        raise BundleError("deck must be a .pptx (zip) under 50 MB")
    return deck


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _dir(self, pid: str) -> Path:
        if not ID_RE.match(pid):
            raise BundleError("invalid project id")
        return self.root / pid

    def list(self) -> list[dict]:
        out = []
        for d in sorted(self.root.iterdir()):
            meta = d / "current" / "meta.json"
            if meta.exists():
                out.append(json.loads(meta.read_text()))
        return out

    def create(self, seed: str, title: str) -> dict:
        pid = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "project"
        pid = f"{pid}-{uuid.uuid4().hex[:6]}"
        bundle = {"schema": BUNDLE_SCHEMA, "project": seed_project(seed, pid, title), "sidecar": {"schema": SIDECAR_SCHEMA, "bindings": {}},
                  "journal": [], "threads": {}, "deck": None}
        self.save(pid, bundle, created=True)
        return self.load(pid)

    def _write(self, target: Path, b: dict, deck: bytes | None, meta: dict):
        tmp = target.with_name(target.name + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        if deck is not None:
            (tmp / "deck.pptx").write_bytes(deck)
        (tmp / "project.json").write_text(json.dumps(b["project"], ensure_ascii=False))
        (tmp / "sidecar.json").write_text(json.dumps(b["sidecar"], ensure_ascii=False))
        (tmp / "journal.jsonl").write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in b.get("journal", [])))
        (tmp / "threads.json").write_text(json.dumps(b.get("threads", {}), ensure_ascii=False))
        (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        shutil.rmtree(target, ignore_errors=True)
        tmp.rename(target)  # swap in only after every file is written

    def save(self, pid: str, b: dict, created: bool = False) -> dict:
        deck = validate_bundle(b)
        d = self._dir(pid)
        if not created and not (d / "current").exists():
            raise BundleError("unknown project")
        if b["project"].get("id") != pid:
            raise BundleError("bundle belongs to a different project")
        prev = self._meta(pid) if not created else {}
        meta = {"id": pid, "title": b["project"].get("title", pid), "created": prev.get("created", _now()), "saved": _now(),
                "slides": b.get("slides"), "journal": len(b.get("journal", [])), "has_deck": deck is not None}
        self._write(d / "current", b, deck, meta)
        return meta

    def _meta(self, pid: str) -> dict:
        m = self._dir(pid) / "current" / "meta.json"
        return json.loads(m.read_text()) if m.exists() else {}

    def _read(self, folder: Path) -> dict:
        if not (folder / "meta.json").exists():
            raise BundleError("not found")
        deck = folder / "deck.pptx"
        return {"schema": BUNDLE_SCHEMA, "project": json.loads((folder / "project.json").read_text()),
                "sidecar": json.loads((folder / "sidecar.json").read_text()),
                "journal": [json.loads(line) for line in (folder / "journal.jsonl").read_text().splitlines() if line],
                "threads": json.loads((folder / "threads.json").read_text()),
                "deck": base64.b64encode(deck.read_bytes()).decode() if deck.exists() else None,
                "meta": json.loads((folder / "meta.json").read_text())}

    def load(self, pid: str) -> dict:
        return self._read(self._dir(pid) / "current")

    def deck_bytes(self, pid: str) -> bytes | None:
        f = self._dir(pid) / "current" / "deck.pptx"
        return f.read_bytes() if f.exists() else None

    def write_export(self, pid: str, mode: str, data: bytes, record: dict) -> dict:
        d = self._dir(pid) / "exports"
        d.mkdir(exist_ok=True)
        name = f"{pid}-{mode}-{record['at'].replace(':', '').replace('+0000', 'Z')[:17]}.pptx"
        (d / name).write_bytes(data)
        record = {**record, "file": name, "bytes": len(data)}
        with (d / "log.jsonl").open("a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record

    def export_file(self, pid: str, name: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]+-(draft|final)-[0-9T-]+Z?\.pptx", name):
            raise BundleError("not found")
        f = self._dir(pid) / "exports" / name
        if not f.exists():
            raise BundleError("not found")
        return f

    def exports(self, pid: str) -> list[dict]:
        log = self._dir(pid) / "exports" / "log.jsonl"
        return [json.loads(line) for line in log.read_text().splitlines() if line] if log.exists() else []

    def save_version(self, pid: str, label: str) -> dict:
        d = self._dir(pid)
        versions = d / "versions"
        versions.mkdir(exist_ok=True)
        n = 1 + max([int(p.name) for p in versions.iterdir() if p.name.isdigit()], default=0)
        shutil.copytree(d / "current", versions / str(n))
        meta = {**json.loads((versions / str(n) / "meta.json").read_text()), "version": n, "label": label[:80], "versioned": _now()}
        (versions / str(n) / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        return meta

    def versions(self, pid: str) -> list[dict]:
        v = self._dir(pid) / "versions"
        return [json.loads((p / "meta.json").read_text()) for p in sorted(v.iterdir(), key=lambda p: int(p.name))] if v.exists() else []

    def load_version(self, pid: str, n: int) -> dict:
        return self._read(self._dir(pid) / "versions" / str(int(n)))
