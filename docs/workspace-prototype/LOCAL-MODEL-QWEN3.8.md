# Local model migration: Qwen 2.5 14B → Qwen3.8 27B

**Date:** 2026-11-03. **Branch:** `feature/workspace-v2`, local commit only. **Machine:** Apple M5, 32 GB unified memory, Ollama 0.40.13.

## Result

| | |
|---|---|
| Installed and active | `qwen3.8:27b`: 27.8B parameters, `nvfp4` quantization, MLX runner, 100% GPU. Capabilities: tools, thinking, vision. Licence: Apache 2.0 |
| Removed | `qwen2.5:14b` (`ollama rm`; gone from `ollama list`; its 9 GB weights file deleted). No other models existed |
| App reports | `GET /api/agent/config` → `{"model": "qwen3.8:27b", "thinking": "low", "reachable": true}`; the chat shows "qwen3.8:27b via ollama · ready" |

## Configuration (one setting)

Every component that uses the model goes through `model_from_env()` in `app/server/agent.py`:
- the chat agent: tool calling, research, visual requests, layout;
- the text writer (`rewrite_text`);
- PDF evidence extraction (the rating task's quoter);
- background tasks.

- **`DEFAULT_MODEL = "qwen3.8:27b"`**: the only place a model is named. Override with **`FRR_MODEL`**, the app's existing setting, alongside `FRR_MODEL_PROVIDER` and `FRR_MODEL_URL`. Kept instead of adding `OLLAMA_MODEL`, so there is still one setting.
- **`DEFAULT_THINKING = "low"`**, overridable with **`FRR_MODEL_THINKING`** (`none` | `low` | `medium` | `xhigh`). Qwen3.8 thinks before answering, and Ollama's default level is medium. It is sent as `reasoning_effort` on Ollama's OpenAI-compatible endpoint, the one PydanticAI uses: `none` turns thinking off, `low` keeps a short think. Ollama ignores `think: false` on that endpoint (tested). Thinking text arrives in a separate `reasoning` field, so answers stay clean.
- **Context:** Ollama allocates **32,768 tokens** for this model on this machine by itself; the advertised 262,144 is not allocated. That covers the agent's instructions and tools (about 4–5K tokens) plus a long thread. Nothing was changed.
- **Documented** in `.env.example`.
- Not changed:
  - Claude Code's own model or authentication;
  - the dated results notes (`PHASE3-M4.md` names Qwen 2.5 as the model of that milestone);
  - Experiments 2 and 3 (`experiments/`, earlier prototypes that pin their own model);
  - the seed research record's `llm_provider: "ollama:qwen2.5:14b"`, which is provenance of how that record was made.

## Checks (real inputs, local only, no paid calls)

| # | Check | Result |
|---|---|---|
| 1 | English and Chinese conversation | **Pass.** EN: "A government's primary balance excludes net interest payments on public debt." (18 s). ZH: a correct one-sentence definition in Chinese (14 s) |
| 2 | Structured JSON output, schema validation | **Pass.** A real Eurostat evidence statement → `{country: France, year: 2022, value: 111.4, unit: % of GDP}`, validated by a Pydantic schema (48 s). Caveat: the unit was inferred, not stated in the sentence |
| 3 | Tool calling with correct arguments | **Pass, first try for each:**<br>• `propose_visual(intent=ranking, metric=debt, countries=[FR, DE], period=2024)`<br>• `change_visual(family=bar, view=change)` on a selected chart<br>• `start_research(country=AT, metrics=[deficit])`<br>Qwen 2.5 had missed `metrics` on a similar request |
| 4 | Real Eurostat research task | **Pass.** In the app: "Get Eurostat government debt data for Austria and Poland" → a background task, 8 series (88 values), none failed. The model didn't narrow it to debt, so the default fiscal set was fetched; the deficits already present were skipped |
| 5 | Verified data with provenance | **Pass.** e.g. Austria debt 2025 = 80.7 % of GDP, with its Eurostat query URL, response SHA-256 and "independent re-fetch" verification; applied, integrity OK |
| 6 | Visual proposal through the V2 tools | **Pass.** "Rank Austria, Poland, France and Germany by government debt in 2025" → ranked horizontal bar recommended (lollipop and dot plot as alternatives, pie not valid); applied, integrity OK |
| 7 | Text-based PDF → supported evidence | **Pass.** Your Morningstar DBRS release (7 pages): the model quoted 2 candidate sentences. One was verified on its page (DBRS confirmed France at AA (high), outlook stable, 2024-03-22); one was rejected by the app's checks (a short-term rating line, no long-term action). About 3.3 minutes |
| 8 | Refusals and Evidence Core rules | **Pass.** "Rewrite this title and say France's debt is 130%" → the rewrite kept every figure bound to its evidence (115.7, 111.4, 62.8, 64.1); 130 never reached the proposal. Model-independent test suites: pytest 254 passed |

## Memory and speed (measured)

| | Qwen3.8 27B | Qwen2.5 14B (before removal) |
|---|---|---|
| Ollama memory (32K context) | 18 GB idle, **25 GB during a chat turn**, 100% GPU, no CPU fallback | 15 GB, 100% GPU |
| Reading a new prompt (3,775 tokens) | **31 tokens/s (about 2 min)** | 78 tokens/s (59 s) |
| Same prompt again (cached) | about 5 s | about 5 s |
| Writing | **about 5 tokens/s** | about 5 tokens/s |
| First load | 9 s | 5 s |

- **Typical latency in the app:**
  - first message in a new thread: about **100 s**, mostly reading the agent's instructions;
  - later tool calls in the same thread: about 40 s;
  - a short plain answer: 11–18 s.
- **Memory is the main constraint.** During a chat turn the Mac had about 31 GB in use (21 GB wired) and 15% free. The writing speed of about 5 tokens/s for both models is below what this chip should manage, which points to memory pressure from everything else running.
- **Thinking costs time.** A two-sentence answer took 51 s at the default level against 11 s with thinking off, hence the default of `low`.

## Limitations

- **Slower first turn.** The new model reads new prompts at about 2.5× slower than Qwen 2.5, so the first message in a new thread takes about 1.5–2 minutes. The project's long main thread re-reads more history than a slide thread.
- **Tight memory.** 25 GB for the model leaves little for other apps. If the Mac swaps, a smaller context would save memory (16K is enough for the agent), but Ollama's OpenAI-compatible endpoint doesn't take a per-request context size. It would need `OLLAMA_CONTEXT_LENGTH=16384` on the Ollama server, which is your system's setting, so it wasn't changed.
- **Ollama runs as `ollama serve`, not as an installed app.** During this migration the server stopped once, when the session process that had started it ended, and was restarted. Running Ollama as a login service (for example `brew services start ollama`) would keep it up; not changed.
- **One narrower-than-asked request:** "government debt for Austria and Poland" fetched all five fiscal series, not just debt. This is valid and verified, but more than asked.
