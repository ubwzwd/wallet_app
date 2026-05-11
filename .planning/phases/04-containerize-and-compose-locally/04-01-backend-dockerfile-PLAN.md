---
phase: 04-containerize-and-compose-locally
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/Dockerfile.api
  - backend/Dockerfile
autonomous: true
requirements:
  - DEPLOY-02
  - SEC-01
tags:
  - docker
  - python
  - uv
  - arm64
must_haves:
  truths:
    - "Backend container image builds for linux/arm64 only and runs as non-root user (uid 1000)"
    - "Image installs Python deps via uv from a poetry-exported requirements.txt (deterministic, locked)"
    - "Image contains NO Poetry / pip dev tooling and no secrets baked in"
  artifacts:
    - path: "infra/Dockerfile.api"
      provides: "Multi-stage arm64 backend image (uv builder -> python:3.11-slim runtime, non-root)"
      contains: "FROM --platform=linux/arm64 python:3.11-slim AS builder"
    - path: "backend/Dockerfile"
      provides: "Pointer stub or removed; old Poetry-in-image path retired"
      contains: ""
  key_links:
    - from: "infra/Dockerfile.api"
      to: "backend/pyproject.toml + backend/poetry.lock"
      via: "poetry export -> uv pip install --system"
      pattern: "poetry export.*--only main.*uv pip install --system"
    - from: "infra/Dockerfile.api"
      to: "non-root runtime user"
      via: "useradd + USER directive"
      pattern: "useradd -m -u 1000 appuser"
---

<objective>
Produce a production-shape backend container image: multi-stage arm64-only build that uses `uv` (Strategy B: poetry export -> uv pip install --system) for deterministic dependency installation, runs as non-root user uid 1000 in `python:3.11-slim` runtime, and exposes a urllib-only healthcheck against `/health`.

Purpose: DEPLOY-02 + SEC-01 base. Every other Phase 4 plan (compose, migrate service, smoke test) consumes this image.
Output: `infra/Dockerfile.api` plus retirement of the old Poetry-only `backend/Dockerfile`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md
@.planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md
@.planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md
@backend/Dockerfile
@backend/pyproject.toml
</context>

<interfaces>
<!-- Builder strategy locked by D-08 + RESEARCH.md Strategy B. -->
<!-- Carry forward verbatim from backend/Dockerfile (see 04-PATTERNS.md): -->
<!--   - useradd -m -u 1000 appuser ; WORKDIR /app ; COPY --from=builder ... ; COPY --chown=appuser:appuser . . ; USER appuser -->
<!--   - EXPOSE 8000 ; CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"] -->
<!-- Replace: -->
<!--   - Poetry-install in builder => poetry export -f requirements.txt --without-hashes --only main -o /tmp/requirements.txt + uv pip install --system --no-cache -r /tmp/requirements.txt -->
<!--   - HEALTHCHECK requests => urllib.request (no `requests` lib bloat) -->
<!-- Add --platform=linux/arm64 to BOTH FROM lines (D-09, OPS-04 platform lock). -->
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Author infra/Dockerfile.api (multi-stage, arm64, uv Strategy B, non-root)</name>
  <files>infra/Dockerfile.api</files>
  <read_first>
    - backend/Dockerfile (full file — current multi-stage Poetry pattern; preserve non-root order)
    - backend/pyproject.toml (verify [tool.poetry] sections + "main" group definition)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 32-110: Dockerfile pattern assignment)
    - .planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md (search "Strategy B" — verbatim uv install sequence and arm64 platform target)
  </read_first>
  <action>
    Create `infra/Dockerfile.api` implementing the canonical D-07/D-08/D-09 layout. Required content (per D-09 + 04-PATTERNS.md):

    Builder stage:
      - `FROM --platform=linux/arm64 python:3.11-slim AS builder`
      - `RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*`
      - `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/`
      - `RUN pip install --no-cache-dir poetry==1.7.1 "poetry-plugin-export>=1.8"`
      - `WORKDIR /app`
      - `COPY pyproject.toml poetry.lock ./`
      - `RUN poetry export -f requirements.txt --without-hashes --only main -o /tmp/requirements.txt`
      - `RUN uv pip install --system --no-cache -r /tmp/requirements.txt`

    Runtime stage:
      - `FROM --platform=linux/arm64 python:3.11-slim AS runtime`
      - `RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*`
      - `RUN useradd -m -u 1000 appuser`
      - `WORKDIR /app`
      - `COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages`
      - `COPY --from=builder /usr/local/bin /usr/local/bin`
      - `COPY --chown=appuser:appuser . .`
      - `USER appuser`
      - `EXPOSE 8000`
      - `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status == 200 else 1)"`
      - `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`

    The build context will be `backend/` (set in compose plan 03), so COPY paths reference the backend root. Do NOT introduce a Dockerfile.api in `backend/` — it lives under `infra/`. Make the ordering exactly: `useradd` -> `WORKDIR` -> `COPY --from=builder` -> `COPY --chown=appuser:appuser . .` -> `USER appuser` (Pitfall 7).

    Use a stable, named `runtime` stage so the compose `build:` block can `target: runtime` if desired. Do NOT add a `target` directive in the Dockerfile itself.
  </action>
  <verify>
    <automated>docker build --platform linux/arm64 -f infra/Dockerfile.api -t wallet-api:test backend/ && docker image inspect wallet-api:test --format '{{.Architecture}}' | grep -q '^arm64$' && docker run --rm wallet-api:test id -u | grep -q '^1000$'</automated>
  </verify>
  <acceptance_criteria>
    - `test -f infra/Dockerfile.api`
    - `grep -c '^FROM --platform=linux/arm64 python:3.11-slim AS builder$' infra/Dockerfile.api` returns 1
    - `grep -c '^FROM --platform=linux/arm64 python:3.11-slim AS runtime$' infra/Dockerfile.api` returns 1
    - `grep -c 'COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/' infra/Dockerfile.api` returns 1
    - `grep -c 'poetry export -f requirements.txt --without-hashes --only main' infra/Dockerfile.api` returns 1
    - `grep -c 'uv pip install --system --no-cache -r /tmp/requirements.txt' infra/Dockerfile.api` returns 1
    - `grep -c 'useradd -m -u 1000 appuser' infra/Dockerfile.api` returns 1
    - `grep -c '^USER appuser$' infra/Dockerfile.api` returns 1
    - `grep -c 'urllib.request.urlopen' infra/Dockerfile.api` returns 1
    - `grep -c 'CMD \["uvicorn", "app.main:app"' infra/Dockerfile.api` returns 1
    - `grep -v '^#' infra/Dockerfile.api | grep -c 'import requests'` returns 0 (no `requests` bloat in healthcheck)
    - `docker build --platform linux/arm64 -f infra/Dockerfile.api -t wallet-api:test backend/` exits 0
    - `docker image inspect wallet-api:test --format '{{.Architecture}}'` outputs `arm64`
    - `docker run --rm wallet-api:test id -u` outputs `1000`
    - `docker run --rm wallet-api:test test ! -f /app/.env` exits 0 (no .env baked into image)
  </acceptance_criteria>
  <done>Image builds for linux/arm64, runs as uid 1000, healthcheck uses urllib (not requests), no .env in image.</done>
</task>

<task type="auto">
  <name>Task 2: Retire backend/Dockerfile (delete or redirect to infra/Dockerfile.api)</name>
  <files>backend/Dockerfile</files>
  <read_first>
    - backend/Dockerfile (verify it is the Poetry-based version superseded by infra/Dockerfile.api)
    - backend/README.md (check whether it references `docker build` against backend/Dockerfile)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (line 461-462: planner discretion on delete vs in-place edit)
  </read_first>
  <action>
    Delete the old Poetry-based `backend/Dockerfile` outright (`git rm backend/Dockerfile`). The new image is built from `infra/Dockerfile.api` against context `backend/`. Do NOT keep two Dockerfiles — that creates a drift hazard and a SEC-01 risk if the old Poetry-pinned version gets shipped.

    No stub file. After deletion, the canonical container build path is documented in the next plan's compose `build:` block (`context: ../backend`, `dockerfile: ../infra/Dockerfile.api`).
  </action>
  <verify>
    <automated>test ! -f backend/Dockerfile && test -f infra/Dockerfile.api</automated>
  </verify>
  <acceptance_criteria>
    - `test ! -f backend/Dockerfile` exits 0
    - `test -f infra/Dockerfile.api` exits 0
    - `git status backend/Dockerfile` shows the file as deleted
    - `grep -rn 'backend/Dockerfile' .planning/ infra/ 2>/dev/null | grep -v '04-PATTERNS.md\|SUMMARY' | wc -l` returns 0 (no stale references in plan or infra dirs)
  </acceptance_criteria>
  <done>Old Poetry Dockerfile removed; only infra/Dockerfile.api remains as the production build path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| build-time -> runtime image | Builder stage pulls poetry plugins + uv; runtime stage must contain neither — only resolved site-packages |
| container -> host | Non-root uid 1000 inside container; any escape lands as unprivileged user |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01 | Information Disclosure | Image layers contain `.env` or secrets | mitigate | No `COPY .env` in Dockerfile; `.env` ingested only at compose runtime via `env_file:` (Plan 03 + 06). Acceptance test `docker run ... test ! -f /app/.env`. |
| T-04-02 | Elevation of Privilege | Container running as root | mitigate | `useradd -m -u 1000 appuser` + `USER appuser` AFTER final COPY (Pitfall 7); acceptance test `id -u == 1000`. |
| T-04-03 | Tampering | Drift between poetry.lock and runtime deps | mitigate | Builder uses `poetry export --only main` from `poetry.lock` then `uv pip install -r` — single source of truth; no second resolver step. |
| T-04-04 | Information Disclosure | `requests` library carried into runtime image purely for HEALTHCHECK enlarges attack surface | mitigate | Healthcheck uses stdlib `urllib.request`; acceptance test `grep -v '^#' infra/Dockerfile.api \| grep -c 'import requests'` returns 0. |
| T-04-05 | Spoofing | Cross-arch image accidentally shipped (amd64 instead of arm64) hits Oracle VM and silently emulates | mitigate | `--platform=linux/arm64` pinned on both FROM lines; acceptance test `docker image inspect ... Architecture == arm64`. |
</threat_model>

<verification>
- `docker build --platform linux/arm64 -f infra/Dockerfile.api -t wallet-api:test backend/` succeeds.
- `docker image inspect wallet-api:test --format '{{.Architecture}}'` outputs `arm64`.
- `docker run --rm wallet-api:test id -u` outputs `1000`.
- `docker run --rm wallet-api:test test ! -f /app/.env` exits 0.
- Old `backend/Dockerfile` is removed from the repo.
</verification>

<success_criteria>
- Image is arm64-only, non-root, uv-built, urllib-healthchecked.
- No Poetry artifacts and no `.env` in the runtime image.
- Only `infra/Dockerfile.api` remains as the production Dockerfile.
</success_criteria>

<output>
After completion, create `.planning/phases/04-containerize-and-compose-locally/04-01-SUMMARY.md`.
</output>
