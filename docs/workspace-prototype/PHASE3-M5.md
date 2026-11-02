# Phase 3 · M5 Research and tasks: results

**Branch:** `feature/workspace-v2`. Local commits only.
**Date:** 2026-11-02. Verified in the built-in Chromium against `app/server/service.py`, with local Qwen 2.5 14B (Ollama). No paid API was called. Both acceptance checks pass, the second with a **real Morningstar DBRS press release** that you downloaded and uploaded.

## Delivered

| Area | What exists now |
|---|---|
| **Task centre** (`app/server/tasks.py`) | Tasks are JSON files in `<project>/tasks/`, written atomically: kind, params, status (queued, running, done, failed, cancelled, interrupted), progress, a timestamped log and, when done, a **result proposal**. They run in the server's event loop, with blocking work in threads, so **editing or reloading the page doesn't touch them**. Cancel and retry are supported. If the **server** stops, running tasks are marked `interrupted` at the next start and can be retried, never silently lost or half-applied. Endpoints: `GET`/`POST /api/projects/{id}/tasks`, `…/tasks/{task}/cancel`, `…/tasks/{task}/retry` |
| **Eurostat data pack** | Several series for a country, each **fetched twice** and kept only where both responses agree, with query URL, time and response hash per value. One failing series doesn't sink the pack, and requests are politely paced. The agent's `start_research("Spain fiscal data")` now **starts this task** instead of only recording a request |
| **Rating actions from PDFs** (`app/server/research_runs.py`, decision D4) | Upload (`POST /api/projects/{id}/uploads`, PDF only, under 20 MB, stored by content hash outside the bundle). **pypdf** extracts each page. Candidates come from the **local model** (asked to quote) and from a **pattern finder** (rating verb plus rating token, from sentences and single lines). **Every candidate is verified in code:** the excerpt must be on that page verbatim (ignoring whitespace, quote style and line hyphenation), the rating token and action verb must be in the excerpt, the agency must be named in the document, and the entity on the page. Excerpts about **an earlier action** ("previously…", or another year) are rejected, not dated as this release. Verified items become evidence with page, excerpt, file SHA-256, origin user-provided, and who found it (model or pattern). If the model is unavailable, the pattern finder still runs |
| **Schema** | `Evidence.rating: RatingAction{agency, action, rating, outlook, date}`. Validation: a rating needs page and excerpt, and the rating must appear in the excerpt (`rating_not_in_excerpt`). |
| **Ratings table** (new binding `ratings`) | `placeholder.fill` turns a research placeholder into a table whose **rows are verified evidence**. It also sets the slide's title, subtitle and source line, as **one undoable step** with actor `research`. Integrity (client **and** server, from the saved `.pptx`) checks every cell against its evidence, and a filled placeholder no longer needs acknowledging at export |
| **Client** | **Tasks tab**: live progress bar and log (polls while tasks run), Cancel, Retry, and result cards with Preview, Apply and Reject (state saved like chat proposals). **Placeholder**: the Evidence tab offers "Upload the agency press release (PDF)". **Evidence cards** show the quoted excerpt with its page and the file hash. Chat shows "Background task started → Open Tasks". `data.addDatasets` adds a pack's datasets in one step |

## Acceptance

| Criterion (PHASE3-PLAN M5) | Result |
|---|---|
| A background task keeps running while the user edits and reloads | **Pass (real keyboard).** In the project thread I typed "Research Spain's fiscal and economic data from Eurostat". The model called `start_research`, and the chat showed "Started a background task…". At 60% (Spain · growth) I pressed real Cmd+Z on the canvas and reloaded the page. After the reload the task was **still running at 60% on the same step**, and finished 23 s after it started: 5 series, 55 values, each confirmed by re-fetch, logged per series. A real **Apply** in Tasks added the 5 datasets as one `research` step. Each value carries its query URL (`…irt_lt_mcby_a?…geo=ES…`), time and response hash `fab2e89f…` |
| An uploaded rating-agency press release PDF yields at least one verified rating-action evidence item (page + excerpt) that replaces the ratings placeholder through a proposal | **Pass, with a real agency PDF and your own clicks.** You downloaded Morningstar DBRS's public release "Morningstar DBRS Confirms Republic of France at AA (high), Stable Trend" (22 March 2024; `430026.pdf`, 7 pages, 50 KB, SHA-256 `cc703928a54a…`) and uploaded it on the placeholder. The local model quoted 3 candidates and the pattern finder 6. Verified: **"Morningstar DBRS Confirms Republic of France at AA (high)," (p. 1)**, plus the ratings-table line on p. 6 ("22-Mar-24 Long-Term Local Currency - Issuer Rating Confirmed AA (high) Stb…"). You applied it: the placeholder became the ratings table with the title "Rating actions: Morningstar DBRS confirmed France at AA (high), outlook stable". Client and **server** integrity OK (22 table cells), 0 placeholders, and export has nothing blocking or to acknowledge. **Rejected, correctly:** the model's quote of the main sentence was shortened ("Morningstar DBRS confirmed…" where the page says "DBRS Ratings GmbH (Morningstar DBRS) confirmed…"), so it isn't verbatim. A short-term R-1 (high) sentence is outside the long-term scales, and "The trend on all ratings is Stable." states no rating. Earlier, I also ran the same path on the fictional-agency test PDF (attached by script; Apply by real click), then undid it |

## Found and fixed along the way

1. **A field named `date` shadowed the `date` type** in `RatingAction`: pydantic read the annotation as `None` and rejected every dated rating. Caught by a test; fixed with a module-level alias.
2. **A historical mention was dated as this release.** "Example Ratings previously downgraded France to AA- in 2024" got the release's date (14 March 2025). Such excerpts are now rejected with the reason "refers to an earlier action, not this release's".
3. **Headline excerpts ran into the next sentence** (headlines have no full stop). Single lines are now candidates too, and the shortest valid excerpt wins.
4. **Reloading within the autosave delay lost the last change** (seen during the reload test). Leaving the page with unsaved changes now warns and saves at once.
5. **Two older store bugs found while fixing 4:**
   - Selecting an element marked the project as changed, so a leave warning would have fired on a mere click.
   - A change made **while a save was in flight** was marked saved without being written.

   Selection now isn't a document change, and an in-flight save records only what it sent (new vitest).
6. **The real DBRS PDF found two more gaps** (fixed after your apply; your table predates them):
   - **No date:** the PDF's text reads "MARCH 22, 2024PRESS RELEASE", with the year running into the next word, so the date pattern now ends the year at "no further digit".
   - **Near-duplicate rows:** the headline and the ratings-table line state the same action, so rows are now merged by (rating, action).

   Re-run on the same file, the result is **one row: Morningstar DBRS · 2024-03-22 · confirmed · AA (high) · stable (p. 1)**. Your applied table still shows the earlier two undated rows. Undo history isn't kept across reloads, so replacing it would need a "replace ratings table" command, which isn't built.
7. `editor/research.py` already existed, and both folders put bare module names on `sys.path` in one pytest run, so mine is `research_runs.py`.

## Tests

- **Pytest 229** (M4: 219), including **29 headless browser checks** (new: `ratings_placeholder_replaced_and_server_agrees`).
- `app/server/tests/test_m5.py` (11 tests) uses a synthetic fictional-agency PDF (`tests/pdfgen.py`, a minimal PDF writer, no new dependency), a scripted model and a fake Eurostat. It covers:
  - pypdf pages, agency and date;
  - only verbatim on-page excerpts survive (wrong page, invented quote, no action, earlier action, page out of range, wrong entity);
  - rating evidence passes schema validation, and a wrong rating fails it;
  - upload → rating task → proposal end to end, with the model's invented quote rejected;
  - the pattern-only path when the model is down;
  - an Eurostat pack with a failing series;
  - cancel, retry and **restart recovery** (interrupted);
  - bad task kinds and unknown ids refused;
  - ratings-table integrity on a saved deck;
  - the agent starting a background task.
- **Vitest 37 + 2 skipped** fixture writers (new `m5.test.ts`: fill as one step, undo restores the placeholder, table mismatch detected, `data.addDatasets` once; plus the save and selection test).
- `tsc` 0 errors in our sources. Licences 327/327 (no new dependencies).

## Known limitations

- **No OCR.** Scanned PDFs (no text layer) fail with a clear message; D4's lightweight path doesn't include OCR or Docling.
- **Tables in PDFs** aren't parsed. Rating actions are read from sentences, which is how press releases state them; multi-row rating histories in tables aren't extracted.
- **The pattern finder knows S&P/Fitch/Scope, Moody's and DBRS rating scales** and common action verbs; unusual wording may need the model's quote.
- **Tasks live in the single server process.** A restart interrupts them (marked, retryable); there is no distributed queue.
- **The uploaded file is trusted as the user's choice.** Verification proves the evidence matches the document, not that the document is authentic.

## Uploads in this project

`app/server/projects/` is gitignored; uploads stay there and are never committed. This project now holds three uploads: the fictional test PDF, the DBRS release, and a third PDF you uploaded ("Deep Research Backing Conversation…"). Its task found no rating action, and I have not opened it.
