# Experiment 2: evidence-capturing research agent

This is a throwaway spike. It sends a brief through four stages:
1. a research plan from a local LLM (Ollama, `qwen2.5:14b`)
2. a tool loop per question (the Eurostat statistics API, plus an allow-listed page fetch with Trafilatura)
3. evidence *candidates*
4. a **deterministic validator**, then an `frr` `ResearchRecord`

The model never writes evidence. A candidate is accepted only if it can be reproduced from what the tools captured and from an independent re-fetch, for API values, or found verbatim in the captured page text, for page excerpts. Every other candidate is rejected with a reason, and unanswered questions become gaps.

To reproduce:

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "pydantic-ai-slim[openai]" trafilatura httpx pypdf
```

```bash
ollama pull qwen2.5:14b
```

```bash
.venv/bin/python -I research_agent.py
```

Outputs go to `out/`: `record.json`, `summary.json` and `log.jsonl`. No paid APIs are used. Results are in `docs/workspace-prototype/PHASE2C-EXPERIMENTS.md`.
