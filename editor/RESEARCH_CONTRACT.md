# Research Request handoff contract (v0.1)

This contract covers how the Preview Editor asks for **new research-backed content** and how a future Research Engine answers. The Research Engine is **not implemented yet**. Today, responses can only come from a file written by hand or by a future engine, or from the clearly labelled TEST FIXTURES in `editor/fixtures/research_responses/`.

## 1. When a request is created

The user draws a region (or uses ✦ Ask AI on a selection) and types an instruction. `research.classify()` suggests one of three intents, and the user can switch it with one click:

| Intent | Meaning | What happens |
|---|---|---|
| `layout` | Rearrange, resize, restyle or rewrite content already on the slide | A layout change request (agent patch flow, see `README.md`) |
| `existing_data` | New content, but verified evidence already in the project covers it | A layout change request listing the evidence to use. **No research is triggered.** |
| `research` | The content needs data the project doesn't have (for example a geographic split) | A Research Request plus an editable **pending placeholder** in the region |

Classification is deterministic keyword and topic matching against the verified evidence. It makes no model calls and can be wrong; it's a suggestion only.

## 2. Research Request (stored in `project.research_requests`)

```jsonc
{
  "schema": "frr-research-request/0.1",
  "id": "rr-1a2b3c4d",
  "status": "pending_research",          // | partially_fulfilled | fulfilled | not_available
  "instruction": "Add a horizontal bar chart showing China Re's revenue distribution by country or region…",
  "slide_id": "overview",                // the slide holding the placeholder; follows it if the placeholder is moved
  "transfer_id": "tr-…",                 // only when a cross-slide drop opened it (TRANSFER_CONTRACT.md)
  "region": {"x": 32, "y": 513, "w": 384, "h": 84},     // slide px (1280×720)
  "placeholder_element_id": "pending-…",
  "content_type": "barchart",            // barchart | timeline | table | metric | text
  "visualization": "horizontal bar chart",
  "objective": "…",                      // the instruction, for now
  "company": "China Reinsurance (Group) Corporation",
  "period": "FY2025",                    // when identifiable
  "geographic_scope": "country",         // country | region | null
  "metric_definitions": [],
  "required_data": ["geography data (country level), FY2025"],
  "constraints": ["Do not estimate undisclosed values.", "Return only verified figures with source, page and excerpt."],
  "related_evidence_ids": ["ev.cr.insurance_revenue.fy2025", "…"],   // existing evidence to reuse
  "related_gaps": ["gap.cr.geography"],
  "classification": {"intent": "research", "topics": ["geography", "revenue"], "uncovered_topics": ["geography"], "reasons": ["…"]},
  "history": [{"at": "2026-10-27T…Z", "event": "created", "detail": "pending research"}],
  "unresolved": []                       // filled from a response's "unavailable" list
}
```

**Send to Research Engine** writes the handoff file `editor/research/<project>/<id>.request.json`. It contains the request plus `related_evidence` (full records), `existing_evidence_ids` (ids the engine must not reuse) and `response_schema`.

## 3. Research Engine response (`editor/research/<project>/<id>.response.json`)

```jsonc
{
  "schema": "frr-research-response/0.1",
  "request_id": "rr-1a2b3c4d",
  "status": "fulfilled",                 // | partially_fulfilled | not_available
  "produced_by": "research-engine vX / analyst name",
  "notes": "free text",
  "sources": [ {"id": "src.…", "title": "…", "publisher": "…", "url": "…", "published_date": "YYYY-MM-DD",
                "origin": "retrieved", "content_sha256": "…"} ],
  "evidence": [ {"id": "ev.…", "source_id": "src.…", "kind": "metric_value", "statement": "…",
                 "page": 27, "excerpt": "verbatim text", "subject": "Mainland China", "metric_id": "m.…",
                 "value": 61.0, "unit": "RMB billion", "period": "FY2025",
                 "verification": "verified", "verified_by": "…"} ],
  "visualization": {                     // omit or null when not_available
    "type": "barchart",                  // barchart | timeline | table | metric
    "title": "Insurance revenue by region, FY2025 (RMB bn)",
    "fmt": {"decimals": 1},
    "items": [ {"label": "Mainland China", "evidence_id": "ev.…"} ]
    // timeline: "events": [{"label": "Oct 2015", "text": "…", "evidence_id": "ev.…"}]
    // table:    "columns": [...], "rows": [{"label": "…", "evidence_ids": ["ev.…"]}]
    // metric:   "label": "…", "evidence_id": "ev.…"
  },
  "unavailable": [ {"description": "Revenue by country (top five), FY2025",
                    "reason": "not disclosed: filings give only a domestic/overseas aggregate",
                    "alternative": "show the domestic vs overseas aggregate"} ]
}
```

A visualization may reference new evidence from the response or existing project evidence (for example a timeline built only from `ev.cr.history` and `ev.cr.listing`).

## 4. Validation (`research.apply_response`, all-or-nothing)

A response is **rejected** if any of these hold:
- The schema or request id is wrong, or the request is not open.
- A new evidence or source id already exists. **Existing values are never overwritten.**
- Evidence isn't `verified`, cites an unknown source, or a `metric_value` lacks `metric_id`, `value`, `unit` or `period`.
- A bar chart mixes different `metric_id`, `unit` or `period` values. Incomparable metrics are never silently combined.
- The visualization references unknown or unverified evidence, or its labels or title contain a number that no cited evidence supports.
- A `not_available` response includes a visualization, or a `fulfilled` / `partially_fulfilled` response has none.

Warnings (shown but not blocking) cover fixture sources and evidence without a page and excerpt.

## 5. What applying a response does

- **fulfilled / partially_fulfilled:**
  - The placeholder is replaced, at its current position and size, by an editable chart, timeline, table or metric whose figures are `evidence_id` references.
  - The response is stored in `project.research_results` with a SHA-256. Its evidence joins the project's evidence view (`slidemodel.evidence_map`); the bundle snapshot is untouched.
- **not_available:** the placeholder stays, marked *Not available*, with the reason and the suggested alternative. No chart is created, and the request stays open in the Requests tab.
- **Revert** (Remove inserted content, or Reopen request):
  - the placeholder is restored, keeping any layout changes the user made
  - the stored result is marked `reverted`, so its evidence stops being active
  - the request returns to `pending_research`
  
  History keeps every step.

## 6. Data-integrity checks related to research

| Code | Level | Meaning |
|---|---|---|
| `pending_research` | warning | A placeholder is still waiting for research |
| `research_not_available` | info | Data was reported unavailable; placeholder kept |
| `fixture_data_on_slide` | **error** | An element shows TEST FIXTURE evidence (export asks for confirmation) |
| `research_result_modified` | **error** | A stored response was edited after acceptance |
