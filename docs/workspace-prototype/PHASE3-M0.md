# Phase 3 · M0 Foundation: results

**Branch:** `feature/workspace-v2` (from `research/phase2b-experiments`). Local commits only.
**Date:** 2026-11-01.

## Delivered

| Item | What exists now |
|---|---|
| App skeleton | `app/web` (React 19, Vite 7, TypeScript; boots a blank deck in GenOffice `SlideCanvas`), `app/server/service.py` (Starlette: `/api/health`, serves the built client), `app/README.md` |
| GenOffice vendoring | `vendor/genoffice/manifest.json`: **292 files** at commit `36a509e8`, each with its sha256. `tools/manifest.py` regenerates it from the import closure of our entry points, ignoring type-only imports; that cut 50 files, including GenOffice's AI provider and Electron code. `tools/sync.py` fetches the commit, verifies every file and applies `patches/` |
| Engine patch 0001 | `0001-render-line-gaps.diff`: the engine now parses `c:dispBlanksAs`, and line charts break at missing values unless the file says `span`. This replaces Experiment 1's coordinate-search hack with segments built in the same loop |
| Browser shims | `buffer` (MIT); `src/platform/shims/crypto.ts` (sha256, randomUUID); `zlib.ts` (fflate) |
| npm policy | `app/web/.npmrc`: `ignore-scripts=true`. `legacy-peer-deps=true` is needed because npm 10's resolver crashes on vitest's optional browser peers (`Cannot read properties of null (reading 'edgesOut')`) |
| Licence report | `app/tools/licenses.py`: npm, Python and vendored entries checked against a permissive allow-list. **205 entries, all allowed** (`certifi` is MPL-2.0, unmodified). It writes `app/THIRD-PARTY-NOTICES.md`, including GenOffice's Apache-2.0 NOTICE |
| Tests | vitest `src/engine/gaps.test.ts` (3 tests), pytest `app/server/tests` (service, manifest, **headless Chrome boot**, licences) |

## Acceptance

| Criterion (PHASE3-PLAN M0) | Result |
|---|---|
| App boots a blank deck | **Pass.** The headless Chrome boot test reads `?selftest=1`: booted, canvas present, slides `["s_1"]`, width 800, API ok. In the browser pane (1440×900) the deck renders through the Python service, the app shows "Service connected", and the console has no errors |
| Licence report lists only permissive licences | **Pass.** 205/205 entries on the allow-list; enforced by `test_licenses.py` |
| Gap patch applies cleanly and a unit test proves gaps break lines | **Pass.** `sync.py` applied it to a fresh GitHub download (all 292 hashes matched). **With** the patch: 3/3 vitest pass (two segments plus the legend swatch around a missing value; one continuous line otherwise). **Without** it (reversed): 2/3 fail, so the test detects the bug |
| Whole repo suite | **179 passed** (174 earlier tests + 5 new), no warnings. Starlette's test client moved to `httpx2` |

## Deviations from the plan, and why

- **The GenOffice source is not committed; it's fetched and verified instead.** The repo is public. A 292-file manifest with hashes, plus patches and a sync script, reproduces the subset exactly, and keeps about 104k lines of third-party code out of our history. GenOffice's LICENSE and NOTICE are part of the manifest and carried into `THIRD-PARTY-NOTICES.md`.
- **The UI kit and i18n are still in the closure.** GenOffice's UI barrel (48 files) and i18n come in through the canvas's shape previews and labels. Tree-shaking keeps the bundle to what is used. Trimming them is a bundle-size task (plan §4).

## Next: M1 (document, store, persistence)

- Durable-id session store.
- Command layer with actor journal.
- Engine patches 0002–0005: group-child ids, independent pasted charts, axis-label thinning, chart hit area.
- Grouping of charts and tables (decision D2).
- Project bundle save/reopen.
- Sidecar schema v1.

Review stop after M1.
