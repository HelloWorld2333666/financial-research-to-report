"""Build the multi-slide demo projects from the China Re overview slide.

    python editor/build_deck.py

Writes two projects (both from the public-filing bundle; no fixtures):
  projects/china_re_deck.json       overview + two blank pages, ready to drag between
  projects/china_re_deck_demo.json  the same deck after four scripted drops:
      1. Move as-is:      solvency table, slide 1 -> slide 2
      2. New slide:       combined-ratio table dragged onto "New slide" (Move as-is)
      3. Move and adapt:  takeaways module -> slide 2, "keep the evidence, rewrite the message"
      4. Missing chart:   segment chart -> slide 3, "...add a regional bar chart" ->
                          transfer request + Research Request + "Pending research" placeholder
The drops go through transfer.transfer(), the same code the editor's drop menu calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import build_slide
import slidemodel as sm
import transfer as tf

PROJECTS = Path(__file__).resolve().parent / "projects"
GEO = "Turn this into a separate page focused on geographic exposure, and add a regional bar chart."


def deck() -> dict:
    p = build_slide.build(json.loads(build_slide.BUNDLE.read_text(encoding="utf-8")), build_slide.BUNDLE)
    p.update(id="china_re_deck", title="China Re credit review (FY2025) · preview deck")
    p, _ = sm.add_slide(p, "Underwriting and capital")
    p, _ = sm.add_slide(p, "Geographic exposure")
    return p


def demo(p: dict) -> tuple[dict, list[str]]:
    _, s2, s3 = sm.slide_ids(p)
    log = []
    p, r = tf.transfer(p, ["solv-table"], s2, "move")
    log.append(f"move as-is: {r['element_ids']} -> {s2}")
    p, r = tf.transfer(p, ["cr-table"], None, "move", new_slide_title="Combined ratio by segment")
    log.append(f"new slide {r['target_slide_id']}: {r['element_ids']}")
    p, r = tf.transfer(p, ["takeaways"], s2, "move_adapt",
                       instruction="Keep the evidence, but rewrite the message to focus on capital adequacy.")
    log.append(f"move and adapt: {r['transfer_request']['id']} ({len(r['module_ids'])} elements)")
    p, r = tf.transfer(p, ["seg-chart"], s3, "move_adapt", instruction=GEO)
    t = r["transfer_request"]
    log.append(f"missing chart: {t['id']} + research {t['research_request_ids']} + placeholder {t['placeholder_element_ids']}")
    p["id"] = "china_re_deck_demo"
    return p, log


def main() -> int:
    base = deck()
    shown, log = demo(base)
    for name, project in (("china_re_deck", base), ("china_re_deck_demo", shown)):
        errors = sm.validate_project(project)
        if errors:
            print("\n".join(errors))
            return 1
        (PROJECTS / f"{name}.json").write_text(json.dumps(project, indent=1, ensure_ascii=False), encoding="utf-8")
        issues = sm.check_integrity(project)
        print(f"wrote projects/{name}.json: {len(project['slides'])} slides, {len(project['elements'])} elements, "
              f"{len(project['transfer_requests'])} transfer request(s), integrity: "
              f"{', '.join(sorted({i['code'] for i in issues})) or 'clean'}")
    print("\n".join("  " + line for line in log))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
