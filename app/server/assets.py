"""Visual assets for slides: flags, icons, map geometry, photographs and logos, fetched from licensed public sources.

Every asset is addressed as "<kind>:<name>" and comes from one of a few allowlisted sources whose licence is known
before anything is downloaded. Assets are cached locally (assets_cache/, not in git) with a manifest entry giving the
source URL, licence, attribution, retrieval time and content hash, so a slide can say where each picture came from.

    flag:<iso2>        national flag, SVG 4:3          flag-icons (MIT; flag designs are public domain)
    icon:<name>        line icon, SVG 24x24            Lucide (ISC)
    geo:<name>         country geometry, TopoJSON      world-atlas (ISC), from Natural Earth (public domain)
    commons:<File>     photograph or logo              Wikimedia Commons, only files whose licence is public domain,
                                                       CC0, CC BY or CC BY-SA (attribution recorded and shown)

    python app/server/assets.py fetch flag:bh icon:ship geo:countries-50m
    python app/server/assets.py search "Strait of Hormuz" --limit 10      # Commons files with their licences
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import quote

import httpx

ROOT = Path(__file__).resolve().parent / "assets_cache"
UA = {"User-Agent": "frr-workspace/0.3 (research-to-report prototype; asset fetcher)"}
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
SOURCES = {
    "flag": {"url": "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/{name}.svg", "ext": "svg", "name": r"[a-z]{2}",
             "license": "MIT (flag-icons by Panayiotis Lipiridis); flag designs public domain", "attribution": "flag-icons"},
    "icon": {"url": "https://cdn.jsdelivr.net/npm/lucide-static@0.460.0/icons/{name}.svg", "ext": "svg", "name": r"[a-z0-9-]{2,40}",
             "license": "ISC (Lucide)", "attribution": "Lucide icons"},
    "geo": {"url": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/{name}.json", "ext": "json", "name": r"(countries|land)-(10|50|110)m",
            "license": "ISC (world-atlas); geometry from Natural Earth, public domain", "attribution": "Natural Earth"},
}
# Commons licences a slide may reuse: attribution is recorded and printed in the source line
OPEN = re.compile(r"^(public domain|pd\b|pd-|cc0|cc[- ]by(-sa)?[- ]\d(\.\d)?)", re.I)
MEDIA = {"svg": "image/svg+xml", "json": "application/json", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def http_get(url: str, params: dict | None = None) -> httpx.Response:
    for wait in (0, 5, 15, 40):  # a rate-limited source (HTTP 429) is retried politely, never hammered
        time.sleep(wait)
        r = httpx.get(url, params=params, headers=UA, timeout=60, follow_redirects=True)
        if r.status_code != 429:
            break
    r.raise_for_status()
    return r


def _manifest(root: Path) -> dict:
    f = root / "manifest.json"
    return json.loads(f.read_text()) if f.exists() else {}


def _save_manifest(root: Path, m: dict):
    root.mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps(m, indent=1, ensure_ascii=False))


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:120]


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", str(s or "")))).strip()


def _info(page: dict) -> dict:
    ii = page["imageinfo"][0]
    meta = {k: _clean(v.get("value")) for k, v in (ii.get("extmetadata") or {}).items()}
    lic = meta.get("LicenseShortName", "")
    vector = ii.get("mime") == "image/svg+xml"
    return {"title": page["title"], "url": ii["url"] if vector or ii.get("width", 0) <= 2400 else ii.get("thumburl", ii["url"]), "page": ii.get("descriptionurl"),
            "mime": ii.get("mime"), "width": ii.get("width"), "height": ii.get("height"), "license": lic,
            "artist": meta.get("Artist", ""), "credit": meta.get("Credit", ""), "description": meta.get("ImageDescription", "")[:300],
            "restrictions": meta.get("Restrictions", ""), "open": bool(OPEN.match(lic))}


II = {"prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "2400", "format": "json", "formatversion": "2"}


def commons_info(title: str, get: Callable = http_get) -> dict:
    """A Commons file's URL (a scaled rendition for photographs), licence and author."""
    t = title if title.startswith("File:") else "File:" + title
    page = get(COMMONS_API, {"action": "query", "titles": t, **II}).json()["query"]["pages"][0]
    if "imageinfo" not in page:
        raise ValueError(f"{t}: not on Wikimedia Commons")
    return _info(page)


def fetch(key: str, root: Path = ROOT, get: Callable = http_get) -> dict:
    """Fetch one asset into the cache (or return its cached entry). Refuses sources and licences outside the allowlist."""
    kind, _, name = key.partition(":")
    m = _manifest(root)
    if key in m and (root / m[key]["file"]).exists():
        return m[key]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if kind in SOURCES:
        s = SOURCES[kind]
        if not re.fullmatch(s["name"], name):
            raise ValueError(f"{key}: not a valid {kind} name")
        url = s["url"].format(name=name)
        body, ext = get(url).content, s["ext"]
        entry = {"license": s["license"], "attribution": s["attribution"], "source_url": url}
    elif kind == "commons":
        info = commons_info(name, get)
        if not info["open"]:
            raise ValueError(f"{key}: licence '{info['license']}' is not one a slide may reuse (public domain, CC0, CC BY, CC BY-SA)")
        body = get(info["url"]).content
        ext = {"image/svg+xml": "svg", "image/png": "png", "image/webp": "webp"}.get(info["mime"] or "", "jpg")
        if info["mime"] not in ("image/svg+xml", "image/png", "image/webp") and info["url"].lower().endswith(".png"):
            ext = "png"
        who = info["artist"] or info["credit"]
        entry = {"license": info["license"], "attribution": f"{who} / Wikimedia Commons ({info['license']})" if who else f"Wikimedia Commons ({info['license']})",
                 "source_url": info["page"], "file_url": info["url"], "restrictions": info["restrictions"], "description": info["description"]}
    else:
        raise ValueError(f"{key}: unknown asset kind (flag, icon, geo, commons)")
    rel = f"{kind}/{_slug(name)}.{ext}"
    (root / kind).mkdir(parents=True, exist_ok=True)
    (root / rel).write_bytes(body)
    entry = {"key": key, "kind": kind, "file": rel, "media_type": MEDIA.get(ext, "application/octet-stream"), "bytes": len(body),
             "sha256": hashlib.sha256(body).hexdigest(), "retrieved_at": now, **entry}
    m[key] = entry
    _save_manifest(root, m)
    return entry


def search_commons(q: str, limit: int = 10, get: Callable = http_get) -> list[dict]:
    """Commons files matching q, each with its licence (only files a slide may reuse are marked open). One request."""
    r = get(COMMONS_API, {"action": "query", "generator": "search", "gsrsearch": q, "gsrnamespace": "6", "gsrlimit": str(limit), **II}).json()
    pages = sorted((r.get("query") or {}).get("pages", []), key=lambda x: x.get("index", 0))
    return [{k: i[k] for k in ("title", "license", "open", "width", "height", "mime", "artist", "description")} for i in (_info(p) for p in pages if "imageinfo" in p)]


def read(key: str, root: Path = ROOT) -> tuple[bytes, dict]:
    e = fetch(key, root)
    return (root / e["file"]).read_bytes(), e


def main(argv: list[str]):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("keys", nargs="+")
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=10)
    a = ap.parse_args(argv)
    if a.cmd == "fetch":
        for k in a.keys:
            try:
                e = fetch(k)
                print(json.dumps({k: {x: e[x] for x in ("file", "bytes", "license", "attribution")}}, ensure_ascii=False))
            except Exception as ex:  # noqa: BLE001
                print(json.dumps({k: {"error": str(ex)}}))
    else:
        print(json.dumps(search_commons(a.query, a.limit), indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
