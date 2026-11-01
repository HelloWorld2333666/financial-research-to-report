# Experiment 3: vertical slice of the AI-native loop

This is throwaway experiment code. It joins five pieces:
- **Canvas:** GenOffice canvas and operations (from Experiment 1)
- **Evidence Core:** a project built from Experiment 2's verified record
- **Agent:** a PydanticAI agent on local Qwen 2.5 14B, served over **AG-UI**
- **Chat UI:** **assistant-ui** chat threads (one for the project, one per slide)
- **Checks:** a year-aware claim checker

Results are in `docs/workspace-prototype/PHASE2D-EXPERIMENT3.md`.

- `server/server.py` is the AG-UI endpoint (`AGUIAdapter.dispatch_request`). Its tools return proposals in our own vocabulary:
  - `compose_deck`
  - `add_comparison` (live Eurostat fetch with re-fetch validation)
  - `start_background_research`

  It also serves `/api/project` and `/api/tasks`.
- `web/src/engine.ts` compiles proposals into `pptx-ops` transactions. Every change is one validated, undoable step. Previews apply the change, render, then restore, so the live deck is never touched.
- `web/src/claims.ts` checks every number in slide text against the working value for its entity, metric and year, including direction words.
- `web/src/checks.ts` holds the scripted regression checks (open `/?checks=1`).

To reproduce:
1. Set up Experiment 1's `src-genoffice` (pinned, with the gap patch) and Experiment 2's `out/record.json`.
2. Create the server environment:

   ```bash
   uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "pydantic-ai-slim[openai,ag-ui]==2.64.0" starlette uvicorn httpx trafilatura
   ```

3. In `web/`, install with `npm install --ignore-scripts`, and copy `model.js` and the Liberation Sans fonts as in Experiment 1.
4. Start the server, then the web app (it proxies `/api` to port 8790):

   ```bash
   .venv/bin/python -I server.py
   ```

   ```bash
   npx vite --port 5182
   ```

No paid APIs are used. The model runs locally through Ollama.
