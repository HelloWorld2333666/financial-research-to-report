# Phase 3 · M4 The AI loop as a product: results

**Branch:** `feature/workspace-v2`. Local commits only. **Review stop** (PHASE3-PLAN: stop after M4).
**Date:** 2026-11-02. Verified in the built-in Chromium at 1440×900 against `app/server/service.py`, with **local Qwen 2.5 14B through Ollama**. No paid API was called. "Real" means the browser tool's own mouse and keyboard.

## Delivered

| Area | What exists now |
|---|---|
| **Agent** (`app/server/agent.py`, `POST /api/agent`) | PydanticAI over AG-UI, as in Experiment 3, now inside the workspace service. **Provider is a setting (D1):** `FRR_MODEL_PROVIDER` = `ollama` (default, local `qwen2.5:14b`) or `openai-compatible`, plus `FRR_MODEL`, `FRR_MODEL_URL` and `FRR_MODEL_API_KEY`. `GET /api/agent/config` reports the model and whether it's reachable; the chat shows this |
| **Tools: proposals only** | `compose_deck` returns the deterministic composer's slides, each number bound to evidence (M3). `add_comparison` fetches from Eurostat **twice** and keeps only values both responses agree on; each value records query URL, time and **SHA-256 of the response**. `rewrite_text` (below). `layout_suggestion` aligns or distributes the selection (one `batch` step). `start_research` records a research request as a placeholder; it says plainly that no research ran, because tasks arrive in M5 |
| **Rewrite: wrong numbers impossible by construction** | The tool sends the model a **template** of the selected text in which every figure is a placeholder (`{n1}`, carrying its unit). It never sends the numbers themselves as editable text. Code validates the draft: a typed digit, an unknown placeholder, a year not in the original, or **a figure separated from its year** is refused, with the reason fed back, for up to 3 drafts **inside the tool**. Code then substitutes the exact figures and attaches their evidence references. Figures the browser sends are **re-checked against the saved project**; a forged or stale value is dropped. In the app, a rewrite card also runs the claim check and **Apply stays disabled unless it passes** |
| **Honest replies** | Each tool result carries a `summary` written by code ("Proposed adding Italy…: 4 values retrieved live from Eurostat and confirmed by an independent re-fetch. Preview and apply; nothing has changed yet."). In any turn that called a tool, **model prose is hidden**, including prose AG-UI delivers as a separate message after the tool result |
| **Chat UI** (`src/chat.tsx`) | assistant-ui threads: one for the project and one per slide, all kept mounted. The canvas selection rides as AG-UI state, and text selections include their sourced figures. Our proposal cards offer **Preview** (a real engine dry run, rendered and then restored), **Apply** (one journalled step, actor `ai`, with the proposal id) and **Reject** |
| **Persistence** | Thread transcripts (tool results included) and proposal states are saved in the bundle's `threads`. On reopen they are restored through assistant-ui's history adapter. **Undo of an applied proposal sets it to "undone"** (the card offers "Apply again"); Redo sets it back to applied |
| **Commands** | `batch` (several commands in one step; atomic) and `text.set` with `numbers` (a rewrite brings its evidence references) |
| **Dependencies** | `pydantic-ai-slim[ag-ui]` 2.64.0 + `openai` (MIT), plus `@assistant-ui/react` 0.15.32, `@assistant-ui/react-ag-ui` 0.1.1, `@ag-ui/client` 1.0.3 and `zod` (MIT), at Experiment 3's pinned versions, installed with scripts disabled. The `openai` extra would have pulled in `tiktoken` → `regex` (Apache-2.0 AND CNRI-Python), which we don't use (token counting, embeddings, realtime). Depending on `openai` directly avoids it, so the **licence allow-list is unchanged: 327/327** |

## Acceptance: the France scenario with real input

| Step (PHASE3-PLAN M4) | Result |
|---|---|
| 1. brief → 4 proposals → preview → apply | **Pass (real keyboard and mouse).** I typed "Analyze France's sovereign credit risk and create a professional four-slide presentation." in the project thread. In **5 s** the model called `compose_deck` and 4 cards appeared under the code-written summary. **Preview** rendered slide 1 while the live deck stayed empty (0 elements, 0 undo steps). Four real **Apply** clicks gave 4 slides, 4 undo steps and 4 journal entries (actor `ai`, each with its proposal id). Integrity OK, 14/14 figures sourced |
| 2. "compare with Italy" (live, verified) | **Pass (real).** With the debt chart selected by a real click, I typed "Compare this chart with Italy" in the Slide 1 thread. In **8 s**, `add_comparison("IT")` fetched Italy from Eurostat and confirmed 4 values by re-fetch. Apply gave 36 chart points. Each Italy evidence item has the query URL (`…gov_10dd_edpt1?…geo=IT…`), retrieval time and response hash `7e4fbc28…`, so the M3 Evidence panel shows them like any other source |
| 3. "rewrite this title more concisely": claims verified, wrong number impossible | **Pass (real), after two fixes found during the run.** Final run: 28 s. The conversation model's own draft was refused (figure separated from its year), and the tool's next draft passed: "France's debt ratio rose from 111.4% to 115.7% (2022–2025); Germany's was 62.8% in 2025 from 64.1% in 2022". The card read **"Verified: 4 figures bound to evidence; claim check passed"**. Apply was one `ai` step; the title binding holds all 4 evidence references; client and **server** integrity both OK (14/14). Real Cmd+Z reopened the card ("Apply again"); Cmd+Shift+Z re-applied it |
| 4. reload: threads and proposal states restored | **Pass.** After a full reload (and two server restarts), the project thread showed 4 applied cards, and the Slide 1 thread showed the Italy card (applied), the rejected rewrite and the applied rewrite, with every user message. Integrity OK |

## What the run taught (fixed, not hidden)

1. **The model wrote a wrong direction word with right numbers.** The first rewrite said Germany's ratio was 62.8% in 2025 "(up from 64.1%)", but it fell. The numbers were correct by construction; the wording was not. The claim check caught it (the figure lost its year), and **Apply stayed disabled**. I added a server rule, "a figure's year stays in its clause", so such drafts are refused before a card is shown.
2. **Local Qwen doesn't reliably call a tool again after a retry prompt.** After a `ModelRetry` it answered in prose instead, so the user saw only the hint. The draft-and-check loop now runs **inside** the tool, invisible to the chat.
3. **Old transcripts teach old tool shapes.** In a thread containing earlier `rewrite_text(text=…)` calls, the model reused that argument after the signature changed, and the call was rejected before the tool ran. The tool now also accepts a `text` draft (checked like any other draft), and the card explains malformed calls instead of "returned nothing".
4. **AG-UI sends post-tool prose as a separate message.** Hiding text per message missed it; hiding now covers the whole assistant turn.

## Tests

- **Pytest 219** (M3: 209). `app/server/tests/test_m4.py` (10 tests) scripts the model with PydanticAI `FunctionModel`, using a fake Eurostat and no network. It covers:
  - `compose_deck` binds all 14 figures;
  - `add_comparison` fetches twice, rejects a value the second response disagrees with, and hashes the first response;
  - project data is reused without fetching;
  - the rewrite loop refuses a typed number and a figure without its year, then accepts a valid draft (3 attempts);
  - the rewrite gives up honestly after 3 drafts;
  - a conversation-model draft is checked first;
  - forged browser figures are dropped;
  - the placeholder rules;
  - layout and research proposals;
  - **the AG-UI endpoint end to end** (RUN_STARTED → TOOL_CALL_* → RUN_FINISHED, with the deck proposal in TOOL_CALL_RESULT).
- **28 headless browser checks** (new: `proposals_and_threads_survive_reopen`, through the real service).
- **Vitest 33 + 1 skipped** (new `m4.test.ts`: proposal states through apply, undo, redo and reject; transcripts stored as JSON; rewrite with references keeps integrity; atomic `batch`).
- `tsc`: 0 errors in our sources. Licences: 327/327.

## Measurements

- **Latency** (local Qwen 2.5 14B, warm): compose 5 s, add_comparison 8 s (including two Eurostat requests), rewrite 12–28 s (more when a draft is refused).
- **Tool use:** in 8 direct probes of "rewrite this title more concisely", 7 called the tool and 1 answered without one. In the app, every request in the scenario called the right tool.
- **Bundle:** 1.28 MB gzip (M3: 1.06 MB; assistant-ui and AG-UI add about 0.22 MB), close to Experiment 3's 1.25 MB.

## Known limitations (for your review)

- **Rewrite quality is limited by the local model.** "More concise" mostly drops a few words ("of GDP"); phrasing can be clumsy ("62.8% in 2025 from 64.1% in 2022"). Numbers and years are guaranteed, and wording is gated by the claim check, but style isn't. A stronger model is a provider setting away (D1), at your call.
- **The claim check on wording is still a heuristic** (direction words, entity, year). It caught the wrong "up from", but it isn't proof of meaning.
- **The agent reads the saved project.** Autosave runs 1.5 s after a change; a request sent sooner sees the previous save. Rewrite figures are re-checked, so a value changed in that window is left out rather than misused.
- **A transcript keeps failed attempts.** That's honest, but long threads grow. Thread trimming or summarising is future work.
- **`start_research` only records a request** (placeholder). The task queue and research runs are M5.
- **Proposals don't expire.** A card can still be applied later on a changed deck. It applies to the current state, as one step, refusing when its element no longer exists.

## Next (after your review): M5 Research and tasks

A persistent task queue with progress, research runs whose results arrive as proposals, and PDF upload for ratings (pypdf first, D4).
