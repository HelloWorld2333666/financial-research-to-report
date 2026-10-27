# Multi-slide preview and semantic content transfer (v0.1)

A project is now a small report of a few preview slides (typically 3–5). Dragging modules from one slide to another is an **instruction**, not just a move. A dense table dropped onto a new slide can mean "build a support page around this". A chart dropped onto another slide can mean "use this as one proof block". A metric card in a new context can mean "keep the evidence, rewrite the message". The editor asks which one you mean, applies the literal part right away, and stores the rest as a structured **Transfer Request** for a later AI step. Nothing in this prototype calls a model.

## 1. Project data model (`frr-slide/0.2`)

```jsonc
{
  "schema": "frr-slide/0.2",
  "id": "china_re_deck", "title": "…",
  "evidence": {…}, "sources": {…}, "claims": {…}, "gaps": {…},   // one research snapshot shared by all slides
  "snapshot_sha256": "…",
  "slides": [                                                      // page order
    {"id": "overview", "title": "Company overview"},
    {"id": "s-1a2b3c4d", "title": "Underwriting and capital", "created": "…"}
  ],
  "elements": [                                                    // flat list; each names its page
    {"id": "solv-table", "slide_id": "s-1a2b3c4d", "type": "table", "x": 32, "y": 96, …,
     "rows": [{"label": "Core", "cells": [{"evidence_id": "ev.cr.solvency_core.2024"}, …]}],
     "refs": {"evidence": […], "claims": ["c.cr.capital_buffer"]}},
    {"id": "takeaways", "slide_id": "s-1a2b3c4d", "group": "g-takeaways", "transfer_id": "tr-79c9f756", …}
  ],
  "annotations": [ {"id": "req-…", "slide_id": "…", "kind": "region", …} ],
  "research_requests": [ {…, "slide_id": "…", "transfer_id": "tr-…"} ],
  "research_results": [ … ],
  "transfer_requests": [ … ]                                       // section 3
}
```

Design choices:
- **Flat elements with a `slide_id`**, not nested per slide. Element ids stay unique across the project, so a moved module keeps its id, its evidence bindings and every reference to it: research placeholders, change requests and transfer requests. Integrity checks, evidence views and the research flow work unchanged across slides.
- **One research snapshot per project.** Every slide cites the same hash-guarded evidence, so copying a module never duplicates figures; the copy points at the same `evidence_id`s.
- **The source line is per slide.** A `sources` element lists only the pages cited by its own slide's elements. Every new slide starts with a title and a source line.
- **Groups move together.** A panel, its header and its text share a `group` (for example `g-takeaways`), so dragging any part moves the whole module.
- **Old projects upgrade on load.** `slidemodel.migrate()` turns a 0.1 single-slide project into one slide whose id is the project id. The server migrates projects on GET and PUT.

## 2. Drop menu: transfer modes

| Mode | Source | Target slide | Request |
|---|---|---|---|
| `move`: Move as-is | removed | the same elements (same ids and links), placed at their old position if free, else in the first free spot | none |
| `copy`: Copy as-is | kept | copies with new ids, the same `evidence_id`s and `refs`, plus `origin: {element_id, slide_id, via}` | none |
| `move_adapt`: Move and adapt to target slide | removed | the elements move and get `transfer_id`, shown with a "✦ pending adaptation" badge (editor only) | yes |
| `split`: Split into multiple modules | removed | as `move_adapt` | yes |
| `use_as_evidence`: Use as evidence for a new slide | kept | a **Pending AI adaptation** placeholder whose `refs` carry the modules' evidence, claim and gap ids | yes |
| `summarise`: Summarise for target slide | kept | a **Pending summary** placeholder with the same `refs` | yes |

Dropping on **＋ New slide** creates the page right after the source slide. Literal modes ignore the instruction box. Pending research placeholders can be moved, which also moves their research request, but they can't be copied. The generated source line can't be transferred.

## 3. Transfer Request (`project.transfer_requests[]`)

```jsonc
{
  "schema": "frr-transfer-request/0.1",
  "id": "tr-7cc74c63",
  "status": "pending_adaptation",            // | cancelled  (future: adapted)
  "mode": "move_adapt", "mode_label": "Move and adapt to target slide",
  "intent": "Rework these modules to fit the target slide's message and layout. Keep every evidence binding…",
  "instruction": "Turn this into a separate page focused on geographic exposure, and add a regional bar chart.",
  "created": "2026-10-27T…Z",
  "source_slide_id": "overview", "source_slide_title": "Company overview",
  "target_slide_id": "s-…", "target_slide_title": "Geographic exposure", "target_is_new_slide": false,
  "module_ids": ["seg-chart"],                // after expanding groups
  "modules": [{"id": "seg-chart", "type": "barchart", "label": "Insurance revenue by segment, FY2025 …"}],
  "module_snapshots": [ { …the elements as they were before the drop… } ],
  "source_kept": false,
  "target_element_ids": ["seg-chart"],        // modules now on the target slide
  "placeholder_element_ids": ["pending-…"],   // placeholders this drop inserted
  "linked": {                                 // structured provenance carried by the modules
    "evidence_ids": ["ev.cr.seg_rev.lh_re.fy2025", …],
    "claim_ids": [], "metric_ids": ["m.insurance_revenue"],
    "source_ids": ["src.cr.fy2025_results"], "gap_ids": []
  },
  "classification": {"intent": "research", "content_type": "barchart", "uncovered_topics": ["geography"], …},
  "research_request_ids": ["rr-…"],
  "history": [{"at": "…", "event": "created", "detail": "Move and adapt…: 1 module(s) from overview to s-…"}]
}
```

**Send to AI (write handoff)** writes `editor/transfers/<project>/<id>.request.json`, which is git-ignored. The file holds the request plus:
- the modules' current state
- an outline of the target slide
- the full evidence and claim records for `linked`
- any research requests it opened
- the adaptation rules
- the expected response shape

**Cancel request** removes the drop's placeholders and closes a research request the drop opened if that request is still pending. Moved modules stay where they are and lose their flag; Undo (⌘Z) moves them back. History records each step.

## 4. Placeholders for content that doesn't exist yet

When an adaptive drop comes with an instruction, `research.classify()` reads it with the same deterministic rules as the AI region. It makes no model call.

| The instruction reads as | Inserted on the target slide |
|---|---|
| **Needs research**, e.g. "add a regional bar chart" when no geographic evidence exists | A normal **Research Request** (`frr-research-request/0.1`) with `transfer_id`, plus its **Pending research** placeholder in free space. It then follows [RESEARCH_CONTRACT.md](RESEARCH_CONTRACT.md): handoff, response, validated insertion, revert. |
| **New exhibit from existing evidence**, e.g. "add a bar chart of combined ratio by segment" | A **Pending horizontal bar chart (from existing evidence)** placeholder whose `refs.evidence` lists the matching verified evidence |
| **Rework existing content**, e.g. "rewrite the message" | Nothing extra; the moved modules are flagged |

Placeholders go into the first free rectangle in the content area (below the title band, above the source line). They are editable elements like any other: move or resize them as you like. Data shows them as `pending_adaptation` or `pending_research`, and Export asks before including them in a PNG.

## 5. Where this fits: Research Engine → Slide Planning → Preview → Final Rendering

```
Research Engine ──► evidence bundle (sources, evidence, claims, gaps)
        ▲                       │
        │ Research Requests     ▼
        │              Slide Planning (future): proposes 3–5 slides of modules bound to evidence ids
        │                       │
        │                       ▼
        └──────────────── Preview Editor (this prototype)
                          • review, rearrange and restyle each slide
                          • drag modules between slides → literal move/copy, or a Transfer Request
                          • missing exhibits → Research Requests + visible placeholders
                                  │ Transfer Requests (handoff files)
                                  ▼
                          Slide Planning / AI adaptation (future): returns a patch for the target slide,
                          validated like region change requests (scope, no rebinding, verified evidence,
                          no unsourced numbers)
                                  │
                                  ▼
                          Final Rendering: renders the saved slide specifications
```

- **Research Engine.** It sees only Research Requests. A drop that needs new data produces the same request type as the AI region, so the engine has one contract.
- **Slide Planning / AI adaptation.** It receives Transfer Requests with everything it needs: the modules, their provenance, the target slide outline and the user's words. Its answer should be a patch confined to the target slide's `target_element_ids` and placeholders. `slidemodel.validate_patch` already enforces the safety rules for region requests; wiring a transfer response through it is the next step and is **not implemented**.
- **Final Rendering.** It reads `slides` in order and each slide's elements. Pending placeholders and adaptation flags tell it a slide isn't final.

## 6. Not implemented

- No AI adaptation step: transfer requests are stored and exported, never fulfilled automatically.
- No way to mark a transfer `adapted`; status is only `pending_adaptation` or `cancelled`.
- Placement is a simple first-free-rectangle search. On a dense slide it may overlap content when nothing is free.
- PNG export renders the slide shown; there is no whole-deck export.
