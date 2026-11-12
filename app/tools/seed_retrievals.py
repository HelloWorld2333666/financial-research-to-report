"""Upgrade the France seed to schema 0.2: retrieval provenance from Experiment 2's run log.

Each evidence item cites a source whose URL is the exact Eurostat API query; the log records when
that query ran. Experiment 2 did not hash API responses (only page captures), so content_sha256
stays null rather than being made up.

Experiment 2's record also never named metrics (metric_id) and left the yield unit empty, so it did
not pass ``validate_record``. The evidence locator names the Eurostat dataset and filters exactly;
metric ids, definitions and missing units are filled from the workspace's metric table
(``app/server/evidence.py``), nothing else. Idempotent; run from the repo root:

    .venv/bin/python app/tools/seed_retrievals.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "app/server/seeds/france-record.json"
LOG = ROOT / "experiments/exp2-research/out/log.jsonl"
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "app/server"))

from evidence import METRICS, metric_of  # noqa: E402
from frr.schema import ResearchRecord  # noqa: E402
from frr.validation import has_errors, validate_record  # noqa: E402


def main() -> int:
    record = json.loads(SEED.read_text())
    calls: dict[str, str] = {}
    for line in LOG.read_text().splitlines():
        e = json.loads(line)
        if e.get("event") == "tool_call" and e.get("tool") == "eurostat_series":
            calls.setdefault(e["url"], e["t"])  # first time the exact query ran
    sources = {s["id"]: s for s in record["sources"]}
    used = set()
    for ev in record["evidence"]:
        dataset, filters = ev["locator"].split(" @ ")[0].split(" ", 1)
        key = metric_of(dataset, json.loads(filters))
        if key:
            ev["metric_id"], used = key, used | {key}
            ev["unit"] = ev.get("unit") or METRICS[key][3]
    have = {m["id"] for m in record["metrics"]}
    for key in sorted(used - have):
        dataset, fixed, label, unit = METRICS[key]
        record["metrics"].append({"id": key, "name": label, "unit": unit,
                                  "definition": f"Eurostat {dataset}" + (f" with {json.dumps(fixed)}" if fixed else ""),
                                  "formula": None, "caveats": None})
    added = 0
    for ev in record["evidence"]:
        url = sources[ev["source_id"]].get("url")
        if url not in calls:
            continue
        ev["retrieval"] = {"method": "api", "query_url": url, "retrieved_at": calls[url], "content_sha256": None,
                           "series_key": (ev.get("locator") or "").split(" @ ")[0] or None,
                           "note": "Eurostat dissemination API (JSON-stat); response hash not captured in Experiment 2"}
        added += 1
    record["schema_version"] = "0.2"
    rec = ResearchRecord.model_validate(record)
    issues = validate_record(rec)
    if has_errors(issues):
        print("\n".join(f"{i.code} {i.object_id}: {i.message}" for i in issues if i.level == "error"))
        return 1
    SEED.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    warnings = Counter(i.code for i in issues if i.level == "warning")
    print(f"retrieval added to {added}/{len(record['evidence'])} evidence items; metrics {sorted(used)}; 0 errors; warnings {dict(warnings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
