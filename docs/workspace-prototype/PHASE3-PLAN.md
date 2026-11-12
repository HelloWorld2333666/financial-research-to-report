# Phase 3 plan: the product skeleton (Strategy D)

**Status:** proposal, awaiting approval. Nothing in this plan has been started.
**Goal:** turn the Experiment 3 slice into a usable, persistent, visually credible workspace. A person can research France's sovereign credit risk with the AI, review and apply proposals, edit everything by hand, close the app, reopen it, and find every number still traceable to a verified source.
**Built on:** PHASE2B (architecture), PHASE2C (Experiments 1–2) and PHASE2D (Experiment 3). Every decision below cites the experiment that grounds it.

---

## 1. What Phase 3 delivers

1. **One app** in `app/`, with a React web client and a Python service. It replaces the experiment harnesses. The Phase 1 editor (`editor/`) is frozen as reference and not deleted.
2. **Persistent projects:**
   - the deck (OOXML)
   - the Evidence Core project (datasets, evidence, working layer)
   - the bindings sidecar
   - a command journal
   - conversation threads

   All are saved together and reopen exactly.
3. **Editing quality fit for daily use:**
   - GenOffice's rich text editor
   - shipped fonts
   - a theme, plus table and chart styles
   - titles that fit
   - comfortable selection
4. **The AI loop as a product feature:**
   - project and slide threads, saved with the project
   - proposals with visual previews
   - claims bound to evidence when generated
   - honest assistant replies
   - persistent background tasks
5. **Research that captures evidence:**
   - the Experiment 2 pipeline as a service
   - live verified retrieval
   - **PDF upload as a source**, for rating actions, since agency sites are closed to automation (Experiment 2)
6. **A premium shell:** a design system and layout, replacing the experiment UI.

**Not in Phase 3:** real-time collaboration, PDF export, PPTX import of arbitrary decks beyond opening them, animations, paid models (see decision D1), and multi-user accounts.

---

## 2. Architecture (as built in the experiments, now made durable)

```
 app/web  (React 19 + Vite + TS)
   ├─ shell: slides rail · canvas · right panel (Chat · Data · Evidence · Claims · Tasks) · top bar
   ├─ canvas: GenOffice SlideCanvas + TextEditOverlay (vendored)      ◀─ RenderSlide (pptx-render)
   ├─ store: Session { deck(OpenedPptx), project, bindings, selection(durable ids), journal, history }
   ├─ commands: user/AI/research intents → validated pptx-ops txn + Evidence patch → one undo step
   ├─ claims: bound claims (generated) + heuristic checker (free text)
   └─ chat: assistant-ui threads ⇄ AG-UI  ─────────────────────────────┐
 app/server (Python, Starlette)                                        ▼
   ├─ agent: PydanticAI (Ollama default; provider configurable) · tools → proposals
   ├─ evidence: src/frr schema (extended) · validation · integrity · export policy
   ├─ research: plan → capture (Eurostat/SDMX, pages, PDFs) → deterministic validation → evidence
   ├─ tasks: persistent queue · progress events · results as proposals
   └─ projects: save/load bundle (deck.pptx, project.json, sidecar.json, journal.jsonl, threads.json)
 vendor/genoffice (pinned subset + patches/, Apache-2.0 NOTICE kept)
```

**Where the authority sits:**
- **Python owns:** evidence validity, integrity and export policy.
- **The browser owns:** the deck while editing; it persists through the server.
- **On save:** the server re-runs integrity against the saved deck and project (Experiment 1 showed the canvas can be verified from the file).

---

## 3. Milestones

Effort is in working days. Each milestone ends with a local commit, a short results note, and its acceptance checks green. I stop for review after M1 and after M4.

### M0: Foundation (2 days)
- Create `app/web` and `app/server`, plus `vendor/genoffice`. The vendored subset:
  - packages: `pptx-engine`, `pptx-ops`, `pptx-render`, `zip-gate`, `docx-engine` stubs
  - files: `SlideCanvas`, `konva-adapter`, `TextEditOverlay` and their helpers
  - pinned to the upstream commit
  - our changes kept as patch files in `vendor/genoffice/patches/`, plus a sync script
- Add the browser shims (`buffer`, `crypto`, `zlib`), the dependency licence report, and `npm install --ignore-scripts` as policy.
- Set up the test harness:
  - pytest for the server
  - vitest for engine, commands and claims
  - headless-Chrome checks for the app (as in Phase 1)

**Accept when:**
- The app boots a blank deck.
- The licence report lists only permissive licences.
- The gap patch applies cleanly and its unit test proves gaps break lines.

### M1: Document, store, persistence (5 days)
- **Session store keyed by durable ids.** Experiment 3 showed selection and host state go stale on parse-time ids.
- **Command layer.** Every intent, whether user, AI or research, is a command `{kind, args, actor, proposalId?}`. It compiles to one validated `pptx-ops` transaction plus an Evidence patch. It produces one undo snapshot and one journal entry recording the actor.
- **Engine patches (we own these):**
  1. Durable ids for group children: read `a16:creationId` inside group XML. Experiment 1 found 2 of 9 bindings lost on group.
  2. Paste creates independent chart parts. Experiment 1 found pasted charts share `chart2.xml`.
  3. Axis-label thinning. Experiment 1 found 25 overlapping year labels.
  4. Chart click area covers the frame. Experiment 3 found thin lines hard to hit.
  5. Grouping graphic frames, **or** a clear "charts/tables can't be grouped" message (decision D2).
- **Project bundle save/reopen** (`.frr` folder or zip): deck, project, sidecar, journal and threads. Autosave plus explicit versions.
- **Sidecar schema v1:** element bindings, chart specs, table specs, text roles and claim bindings. All are versioned with a migration hook (Phase 1 defect 8: old projects not migrated).

**Accept when:**
- All 16 Experiment 3 checks pass on the new app.
- A France deck saved, closed and reopened gives integrity 100% and the same content, threads and journal.
- Grouping and ungrouping two bound text boxes keeps their bindings.
- A pasted chart edited alone leaves the original unchanged.

→ **Stop for review.**

### M2: Editing quality (6 days)
- **Text editing:** integrate GenOffice `TextEditOverlay`. It has no Electron calls and is controlled by its host (`node`, `onCommit(paragraphs)`). It gives rich runs, caret placement and links. Commits go to `setText` with styled runs. Escape cancels.
- **Typography:** ship OFL fonts (decision D3), with metrics **and** drawing from the same font files (Experiment 1: real metrics fixed collisions). Titles use `autoFit: shrink`, which `pptx-render` already supports, so they no longer spill into the subtitle (Experiment 3).
- **Theme and styles:** set the deck theme through `applyTheme`, and add our own table style and chart style (colours from Design DNA, gridlines, label sizes). The default PowerPoint orange is gone.
- **Selection UX:**
  - comfortable chart and table hit areas
  - Shift-click and marquee (marquee wasn't verifiable in Experiment 1, so it needs a real-mouse check)
  - durable-id selection chips
- **Layout aids:** snapping and alignment, which come with `SlideCanvas`. Add align/distribute commands to the toolbar.

**Accept when:**
- Real-mouse tests pass for: rich text edit (bold run, caret placement), resize/rotate, marquee, align.
- Long titles shrink to fit.
- Every slide in the France deck shows no overlapping axis labels and no default table style.
- Drag stays at 50 fps or more with 30 elements.

### M3: Evidence Core integration (5 days)
- **Extend `src/frr/schema.py`:**
  - API provenance: query URL, retrieval time, content hash
  - derivations, for example the spread, recorded from input evidence ids, formula and result
  - claim bindings: claim → numbers → evidence or derivation
  - working-layer records, with status `manual_unverified` / `verified`
- **Server endpoints:** project read/write, working-data patches validated server-side, integrity, and the export policy (draft or final, final needs acknowledgement), ported from `slidemodel.py`.
- **Data workspace:** a grid for datasets showing source and working values side by side, plus verify/restore actions. It's the evidence inspector for any selected number. Click a value and see source, query and retrieval time.

**Accept when:**
- Every number on a France slide resolves in the Evidence panel to its source, with the Eurostat query URL.
- The derived spread shows both inputs and the formula.
- A final export is blocked until unverified edits are acknowledged.
- pytest covers the schema extensions.

### M4: The AI loop as a product (5 days)
- **Agent tools** (proposals only; the model never writes numbers, per Experiment 2):
  - `compose_deck`
  - `add_comparison`
  - `rewrite_text` (the proposal carries claim bindings, so numbers come from evidence)
  - `layout_suggestion` (move/resize/align operations with a preview)
  - `start_research`
- **Claims bound at generation.** Composer and rewrite output carry evidence refs per number. The heuristic checker remains for human-typed text (Experiment 3: the heuristic alone gave false positives).
- **Honest replies.** Assistant text after a tool call is a template built from the tool result ("Proposed: …; review and apply"), not free model prose (Experiment 3: "has been added" before Apply).
- **Threads saved per project and slide.** Proposal state (open, applied, rejected) is restored on reopen.
- **Model configuration:** Ollama Qwen 2.5 14B by default; the provider is a setting (decision D1).

**Accept when:** the full France scenario passes with real input:
1. brief → 4 proposals → preview → apply
2. "compare with Italy" (live, verified)
3. "rewrite this title more concisely": its claims are verified, and a wrong number is impossible by construction
4. reload: threads and proposal states restored

→ **Stop for review.**

### M5: Research and tasks (5 days)
- **Research service:** the Experiment 2 pipeline (plan → capture → validate). Sources: Eurostat (and SDMX for ECB/IMF if needed), allow-listed pages and **uploaded PDFs**.
- **PDF evidence:** text with page numbers from pypdf. A local model *quotes*, and `sourcecheck.py` verifies excerpt, page and value (decision D4 decides whether Docling is used).
- **Persistent task centre:** queue, progress, cancel, and results as proposals. Tasks survive a reload. A research request placed on a slide can be completed by uploading the agency PDF, which turns the placeholder into verified rating evidence.

**Accept when:**
- An uploaded rating-agency press release PDF yields at least one verified rating-action evidence item (page + excerpt) that replaces the ratings placeholder through a proposal.
- A background task keeps running while the user edits and reloads.

### M6: Premium shell and final acceptance (4 days)
- **Design system:**
  - tokens, light and dark chrome
  - Radix primitives (MIT): menus, dialogs, tooltips
  - top bar (project, save state, export)
  - a responsive layout that collapses panels below 1,280 px (Phase 1 defect 1)
- **End-to-end acceptance pass:** the France scenario, full regression (unit + headless + real-mouse script), and a performance check.

**Accept when:**
- The scenario runs start to finish with real input.
- The app looks like a creative tool, not a dashboard (screenshots attached for your review).
- All tests are green.

**Total: about 32 working days (6–7 weeks)**, with reviews after M1 and M4.

---

## 4. Risks and how each is handled

| Risk | Mitigation |
|---|---|
| GenOffice upstream moves fast (about 370 commits a month) | Pinned vendored subset, patches as files, sync only on purpose with tests |
| Our engine patches diverge from upstream | Keep patches small and tested; offer them upstream (Apache-2.0) when stable |
| Local model quality limits storyline and rewrite | The model only picks tools and wording; numbers and claims come from evidence; templates as fallback; provider configurable (D1) |
| `TextEditOverlay` extraction pulls in more of GenOffice than expected | Time-box 1 day in M2; fallback is TipTap (MIT) behind the same `onCommit(paragraphs)` contract |
| Rating sources stay closed | PDF upload path (M5) or a licensed feed later |
| Bundle size (1.25 MB gzip today) | Code-split chat and data panels; drop unused GenOffice i18n |

---

## 5. Decisions needed from you

| # | Decision | My recommendation |
|---|---|---|
| D1 | Model provider for Phase 3 | **Local Qwen 2.5 14B only**, provider configurable. Evaluate a paid model for rewrite and storyline quality later, at your call |
| D2 | Charts and tables in groups | **Patch the engine** to allow it (PowerPoint-compatible); fall back to a clear message if the patch proves invasive |
| D3 | Fonts | **Inter** (OFL) for slides and UI, **Liberation Sans** as the metric-compatible fallback for Arial/Helvetica decks |
| D4 | PDF extraction | **pypdf + our source check first**; Docling only if rating-agency PDFs have tables that pypdf can't read |
| D5 | Branch | New branch **`feature/workspace-v2`** from `research/phase2b-experiments`; local commits only, as before |

Standing rules carry over:
- no paid APIs
- no push or merge without approval
- no AGPL code
- `--ignore-scripts` installs
- no Claude attribution in commits
