"""Asset library: allowlisted sources, licence gate, cache with provenance (no network: a fake fetcher)."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import assets  # noqa: E402


class Resp:
    def __init__(self, content=b"", data=None):
        self.content, self._data = content, data

    def json(self):
        return self._data


def commons(lic, mime="image/jpeg"):
    page = {"title": "File:X.jpg", "imageinfo": [{"url": "https://upload.example/X.jpg", "thumburl": "https://upload.example/X_t.jpg", "width": 3000, "height": 2000,
                                                   "mime": mime, "descriptionurl": "https://commons.wikimedia.org/wiki/File:X.jpg",
                                                   "extmetadata": {"LicenseShortName": {"value": lic}, "Artist": {"value": "<a href='x'>NASA</a>"}}}]}

    def get(url, params=None):
        if params:
            return Resp(data={"query": {"pages": [page]}})
        return Resp(content=b"JPEGDATA")
    return get


def test_flag_and_icon_come_from_allowlisted_sources(tmp_path):
    seen = []
    get = lambda url, params=None: (seen.append(url), Resp(content=b"<svg/>"))[1]  # noqa: E731
    e = assets.fetch("flag:bh", tmp_path, get)
    assert seen == ["https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/bh.svg"]
    assert e["license"].startswith("MIT") and e["media_type"] == "image/svg+xml" and (tmp_path / e["file"]).read_bytes() == b"<svg/>"
    assert json.loads((tmp_path / "manifest.json").read_text())["flag:bh"]["sha256"] == e["sha256"]
    assets.fetch("flag:bh", tmp_path, get)  # cached: no second request
    assert len(seen) == 1
    with pytest.raises(ValueError):
        assets.fetch("flag:../../etc", tmp_path, get)
    with pytest.raises(ValueError):
        assets.fetch("http://example.com/x.png", tmp_path, get)


def test_commons_accepts_open_licences_with_attribution(tmp_path):
    e = assets.fetch("commons:X.jpg", tmp_path, commons("Public domain"))
    assert e["attribution"].startswith("NASA") and e["file_url"].endswith("X_t.jpg")  # a scaled rendition, not the 3000 px original
    assert (tmp_path / e["file"]).read_bytes() == b"JPEGDATA"


def test_commons_refuses_restrictive_licences(tmp_path):
    with pytest.raises(ValueError, match="not one a slide may reuse"):
        assets.fetch("commons:X.jpg", tmp_path, commons("Attribution"))
    with pytest.raises(ValueError):
        assets.fetch("commons:X.jpg", tmp_path, commons("All rights reserved"))
    assert not (tmp_path / "commons").exists()


def test_deck_checks_flag_template_drift_and_missing_markers():
    import deck
    panel = {"kind": "columns", "params": {"columns": [{"span": 8, "slots": ["a"]}, {"span": 4, "slots": ["b"], "tint": True}]}}
    plans = [{"id": f"s{i}", "composition": panel, "objects": [{"kind": "viz", "id": "t", "request": {"family": "dumbbell", "datasets": ["ds.it.x", "ds.fr.x", "ds.de.x"]}, "draw": {"form": "rankTable"}}]} for i in range(4)]
    project = {"datasets": {f"ds.{g}.x": {"id": f"ds.{g}.x", "geo": g.upper()} for g in ("it", "fr", "de")}}
    out = "\n".join(deck.deck_checks(plans, project))
    assert "third slide in a row" in out and "commentary panel" in out and "without a photograph or map" in out and "without flags" in out


def test_forecast_editions_reuse_each_editions_evidence():
    import imf
    ev = lambda i, v: {"id": i, "statement": "s", "retrieval": {"note": "n"}, "value": v}  # noqa: E731
    p = {"datasets": {"ds.br.growth": {"entity": "Brazil", "unit": "%", "measure": {}, "source_url": "u", "observations": [{"date": "2026", "value": 2.2, "evidence_id": "e2"}]},
                      "ds.br.growth_oct25": {"observations": [{"date": "2026", "value": 1.9, "evidence_id": "e1"}]}},
         "evidence": {"e1": ev("e1", 1.9), "e2": ev("e2", 2.2)}}
    x = imf.forecast_editions(p, "BR", "growth", "2026")
    assert [o["date"] for o in x["dataset"]["observations"]] == ["2025-10", "2026-10"]
    assert [o["value"] for o in x["dataset"]["observations"]] == [1.9, 2.2]
    assert all("same value as" in e["retrieval"]["note"] for e in x["evidence"].values())
