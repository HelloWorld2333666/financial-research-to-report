# Research-to-Report workspace (Phase 3)

This is the product app for Strategy D (see `docs/workspace-prototype/PHASE3-PLAN.md`):
- **Canvas:** GenOffice's slide engine and canvas
- **Authority:** our Evidence Core
- **AI:** an AG-UI agent

The Phase 1 editor in `editor/` is frozen as reference.

```
app/web      React 19 + Vite + TypeScript client (GenOffice SlideCanvas)
app/server   Python service (Starlette): /api and the built client
app/tools    licence report
vendor/genoffice   pinned GenOffice subset: manifest.json (files + sha256), patches/, tools/sync.py
```

## Setup

Requirements: Node 22, Python 3.11+, `uv`.

1. Fetch the pinned GenOffice subset and apply our patches. Each file is checked against its manifest sha256:

   ```bash
   python3 -I vendor/genoffice/tools/sync.py
   ```

2. Install the Python environment:

   ```bash
   uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev,pdf,app]"
   ```

3. Install the web client (install scripts are disabled by `app/web/.npmrc`):

   ```bash
   cd app/web && npm install
   ```

## Run

Build the client, then serve it with the API at http://127.0.0.1:8791:

```bash
cd app/web && npm run build
```

```bash
.venv/bin/python app/server/service.py
```

For development with hot reload (proxies `/api` to 8791):

```bash
cd app/web && npm run dev
```

## Checks

- Unit tests (engine and patches):

  ```bash
  cd app/web && npm test
  ```

- Service, headless boot (needs Chrome and a build) and licences, run with the rest of the repo's tests:

  ```bash
  .venv/bin/python -m pytest -q
  ```

- Regenerate `app/THIRD-PARTY-NOTICES.md` (the script fails on any licence that isn't on the allow-list):

  ```bash
  .venv/bin/python app/tools/licenses.py --write
  ```

## Policies

- npm install scripts stay off (`ignore-scripts=true`).
- Licences must be on the allow-list in `app/tools/licenses.py`.
- GenOffice changes live only as patch files in `vendor/genoffice/patches/`.
- GenOffice's `ee/` (Enterprise License) is never vendored.
- No paid APIs, and no push or merge without approval.
