# Phase 3 · M3 Evidence Core integration: results

**Branch:** `feature/workspace-v2`. Local commits only.
**Date:** 2026-11-02. Verified in the built-in Chromium at 1440×900 against the app served by `app/server/service.py`. "Real" means the browser tool's own mouse and keyboard; "scripted" is labelled where used.

## Delivered

| Area | What exists now |
|---|---|
| **Schema 0.2** (`src/frr/schema.py`) | All additions are optional, so 0.1 records still load. `Evidence.retrieval` records method, query URL, retrieval time, content hash and series key. `Derivation` holds a formula over named inputs (evidence or derivation ids), the value and its rounding. `Claim.numbers` is a list of `NumberRef`: the number as written plus exactly one evidence id or derivation id. `WorkingEdit` is a manual value kept next to the source, with status `manual_unverified` or `verified` (verified needs who and when) |
| **Validation** (`src/frr/validation.py`, `src/frr/derive.py`) | Derivations are recomputed from their inputs. The checks catch mismatches, cycles, unknown inputs, and formulas that aren't plain arithmetic: `derive.py` parses an AST allow-list and never calls `eval`. Each number in a claim must round to what it cites. Working edits must reference real evidence for the same period. Unverified edits produce a warning |
| **France seed** (`app/tools/seed_retrievals.py`) | All 64 evidence items carry the exact Eurostat API query URL and the time it ran, taken from Experiment 2's log. **The content hash is null:** Experiment 2 hashed page captures but not API responses, so no hash is invented. The Experiment 2 record never actually passed `validate_record`: it had no `metric_id`, and the yield unit was empty. The script fills both from each item's locator (the Eurostat dataset and filters) and nothing else. The seed now has 0 errors |
| **Composer** | Every number it writes comes with a reference, listed per text role. The computed figures are derivations: the change in the debt ratio (`end - start`), the size of the deficit (`abs(balance)`, because Eurostat records deficits as negative) and the spread (`(own - peer) * 100`). The spread bullet now shows both inputs: "76 bp in 2025 (France 3.35% − Germany 2.59%)" |
| **Server integrity** (`app/server/integrity.py`) | Reads the **saved `.pptx`** directly: durable ids (same rule as GenOffice), chart caches, table cells and text runs. Each is compared with the working layer. A figure in text must match its reference's **current** value (manual edits applied; derivations recomputed). Every save returns this server check, and `GET /api/projects/{id}/integrity` exposes it |
| **Working-data validation on save** | A bundle with a malformed manual value is refused (400): a non-numeric value, a missing author or time, an unknown status, or "verified" without a verifier. Formulas must name exactly their inputs |
| **Export policy** (`app/server/export.py`) | Phase 1's rule, now enforced by the server against the saved deck. `GET /api/projects/{id}/export` returns the policy, `POST` performs the export, and `GET …/exports/{file}` downloads it. **Draft:** always allowed; when anything is open, every slide gets a red "DRAFT" banner. **Final:** refused (409) while the saved deck disagrees with the data. Otherwise each open item must be acknowledged: unverified manual values, placeholders, and figures typed without a source. Acknowledgements and the integrity summary go to `exports/log.jsonl` |
| **Client** (`src/panels.tsx`) | **Evidence tab:** every number on the selected element, expandable to its evidence card (value, source, Eurostat query link, retrieval time, hash state, verifier). Derivations show formula and inputs, each with its own card. **Data tab:** source and working values side by side for any dataset (it follows the selected chart or table), with an editable working value, **Verify** and **Restore**, and a list of unverified values. **Export dialog:** shows the server's check and offers draft or final; final has an acknowledgement checkbox per item |
| **Commands** | `data.verify` (records verified_by and verified_at) and `data.restore` (drops the manual value and re-projects). Each is one undo step and one journal entry. `slide.compose` stores the proposal's derivations in the project and its number references on the text bindings |
| **Client integrity** | Also checks figures in text. A value edited under a sentence makes the sentence a mismatch. "Re-project from data" appears only when re-projection can fix the problem (charts and tables); stale text says it must be edited, or the value restored |

## Acceptance

| Criterion (PHASE3-PLAN M3) | Result |
|---|---|
| Every number on a France slide resolves in the Evidence panel to its source with the Eurostat query URL | **Pass.** Browser check `every_number_resolves_to_source`: all 66 numbers (chart points, table cells, figures in text) resolve to evidence with an `ec.europa.eu/eurostat/api` query URL, or to a derivation whose inputs all do; none unresolved. **Real mouse:** on a newly composed France deck, the status line read "14/14 figures in text sourced". Clicking the spread bullet listed its three figures; expanding one showed the evidence card with the query link |
| The derived spread shows both inputs and the formula | **Pass (real mouse).** Expanding "76 · derived" showed `(own - peer) * 100`, then *own* = 3.34979 % (ev.exp2.52, query `…irt_lt_mcby_a?…geo=FR…`) and *peer* = 2.59206 % (ev.exp2.48, `geo=DE`), each with retrieval time and verifier. Browser check `spread_derivation_inputs` passes, and a unit test shows that editing an input recomputes the spread (76 → 101) and flags the sentence |
| A final export is blocked until unverified edits are acknowledged | **Pass (real mouse and keyboard).** I typed 109.9 into France's 2023 debt in the Data tab. Under Final report, "Export final" stayed disabled with only the placeholder ticked, and was enabled once the edit was ticked too. The export succeeded and the server log recorded both acknowledgements. **The server enforces this itself:** a final export without the edit acknowledged gets 409 (browser check `final_export_blocked_until_ack`, pytest). Typing 116.0 under a cited value made the dialog list all three stale figures, including the derived "+4.3 pp" (now 4.6), and final was impossible. **Restore** and **Verify** were each tested with a real click; after Verify, the server's count of unverified values dropped to 0 |
| Pytest covers the schema extensions | **Pass.** `tests/test_schema_v02.py` (13 tests): 0.1 compatibility, seed provenance, bad hash, API without a query, derivation recomputation, formula allow-list, dangling inputs and cycles, numbers in claims, NumberRef has exactly one origin, and working edits. `app/server/tests/test_m3.py` (11 tests): integrity read from a deck composed by the real client, stale text, derivation recomputation, Python and client formatting agree, every composer number resolves, refused working data, the export flow (final, draft banner, log, path traversal), and integrity blocking final but not draft |
| Tests overall | **Pytest 209** (M2: 186), including **27 headless browser checks** (5 new: `every_number_resolves_to_source`, `spread_derivation_inputs`, `final_export_blocked_until_ack`, `stale_text_blocks_final_export`, `server_integrity_matches_client`). **Vitest 29 + 1 skipped** (the skipped one regenerates the server fixture when run with `WRITE_FIXTURES=1`). `tsc`: 0 errors in our sources. Licence report: 207/207, no new dependencies |

## Found and fixed along the way

1. **Cycle detection in derivations never fired.** The memo lookup ran before the stack check, so a cycle returned "unknown" silently. Caught by a test; fixed.
2. **The heuristic claim checker misread the new spread bullet.** It counted both yields as spreads and gave both to France. Now, in a spread clause a percentage is a yield, and each figure belongs to the nearest country named before it, unless that country follows "over". The number references are now the exact check; the heuristic remains the fallback for typed text.
3. **Integrity now reports stale text.** Two M1 tests had assumed the deck stays OK after editing a value cited in a sentence. That assumption was the gap M3 closes, and the tests now expect the mismatch.

## Known limitations

- **Content hashes are absent for the France data** (not captured in Experiment 2). Future retrievals should hash the response body; the schema is ready for it.
- **Text references follow the text, not the meaning.** If you retype "115.7%" by hand it still counts as sourced, because it matches the reference's text and value. A figure typed fresh is "unsourced" until acknowledged. M4's AI edits should write references the same way the composer does.
- **The heuristic claim checker** (Claims tab) is still a heuristic. The Evidence tab is the source of truth.
- **Selection changes mark the project as changed**, which triggers an autosave. This predates M3 and is harmless, but it's an extra save.
- The France fixture for server tests (`app/server/tests/fixtures/france-bundle.json`, 131 KB) holds public Eurostat data only.

## Next: M4 (AI loop as a product)

Proposals with preview and accept/reject, AI text edits carrying number references, and the review stop after M4.
