---
phase: 04-containerize-and-compose-locally
plan: 01
subsystem: infra
tags: [docker, python, uv, poetry, arm64, multi-stage, non-root, healthcheck]

requires: []

provides:
  - infra/Dockerfile.api — production backend image (multi-stage, arm64-only, uv-built, non-root)
  - backend/.dockerignore — keeps secrets and dev artifacts out of the image build context
  - retirement of Poetry-only backend/Dockerfile

affects:
  - 04-05-prod-compose-and-caddy — consumes the image via `build: { context: ../backend, dockerfile: ../infra/Dockerfile.api }`
  - 04-04-env-secrets — env_file: target loaded at runtime since .env is no longer baked in
  - 04-06-smoke-and-verify — verifies architecture, uid, healthcheck against the built image

tech-stack:
  added:
    - uv (astral-sh, v latest pinned at build time) — replaces Poetry as the in-image installer
    - poetry-plugin-export >=1.8 — emits lock-derived requirements.txt in builder stage only
  patterns:
    - "Strategy B (Poetry export -> uv pip install --system) — deterministic deps from poetry.lock without carrying Poetry into the runtime image"
    - "Non-root user ordering: useradd -> WORKDIR -> COPY --from=builder -> COPY --chown -> USER (Pitfall 7)"
    - "Stdlib urllib healthcheck — no `requests` package bloat in runtime"
    - ".dockerignore-driven secret exclusion — .env, *.db, caches, .git never enter build context"

key-files:
  created:
    - infra/Dockerfile.api
    - backend/.dockerignore
  modified: []
  deleted:
    - backend/Dockerfile

key-decisions:
  - "Bumped Poetry to 1.8.5 (plan pinned 1.7.1 with incompatible plugin>=1.8 — combination unresolvable)"
  - "Stripped poetry binary + uv shims from builder /usr/local/bin post-install so runtime carries only resolved app deps + uvicorn"
  - "Added backend/.dockerignore to honor T-04-01 (no .env in image) — plan threat model required this but did not list the file"

patterns-established:
  - "Strategy B uv builder: Poetry only exports the lock, never installs into the runtime"
  - "Multi-stage arm64 pin on BOTH FROM lines (OPS-04 platform lock)"
  - "Healthcheck uses stdlib urllib (no transport-library bloat)"

requirements-completed:
  - DEPLOY-02
  - SEC-01

duration: 15min
completed: 2026-05-11
---

# Phase 04 Plan 01: Backend Dockerfile Summary

**Multi-stage arm64-only backend image with uv-built deps (Strategy B), non-root uid 1000 runtime, urllib healthcheck, and no Poetry / no .env / no dev tooling in the production image.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-11T15:11:11Z
- **Completed:** 2026-05-11T15:25:58Z
- **Tasks:** 2 of 2
- **Files modified:** 3 (1 created Dockerfile, 1 created .dockerignore, 1 deleted)

## Accomplishments

- Authored `infra/Dockerfile.api`: linux/arm64-pinned multi-stage build using `python:3.11-slim` builder and runtime. Builder runs `poetry export --without-hashes --only main` then `uv pip install --system --no-cache`; runtime carries only resolved site-packages plus uvicorn.
- Locked in T-04-02 (non-root): `useradd -m -u 1000 appuser` placed BEFORE the final `COPY --chown=appuser:appuser . .`, with `USER appuser` directly after — Pitfall 7 ordering preserved verbatim. Verified `docker run --rm wallet-api:test id -u` returns `1000`.
- Locked in T-04-04 (no `requests` bloat): HEALTHCHECK uses `urllib.request.urlopen`. `grep -v '^#' infra/Dockerfile.api | grep -c 'import requests'` returns 0.
- Locked in T-04-05 (arm64 only): `--platform=linux/arm64` on both FROM lines. `docker image inspect wallet-api:test --format '{{.Architecture}}'` returns `arm64`.
- Locked in T-04-01 (no secrets in image): added `backend/.dockerignore` excluding `.env*`, `*.db`, `__pycache__`, `.git`, etc. `docker run --rm wallet-api:test test ! -f /app/.env` exits 0.
- Locked in "no Poetry/dev tooling in runtime" must_have: after `uv pip install` completes, the builder stage runs `pip uninstall -y poetry poetry-plugin-export poetry-core` and `rm -f /usr/local/bin/poetry*` so the runtime's `COPY --from=builder /usr/local/bin` carries only the runtime CLIs (uvicorn et al). `which poetry` in the running container returns nothing.
- Deleted the legacy Poetry-only `backend/Dockerfile`. The image build path is now solely `infra/Dockerfile.api`, eliminating the drift hazard the plan called out (two Dockerfiles = SEC-01 risk if the old one ships).

## Task Commits

1. **Task 1: Author infra/Dockerfile.api (multi-stage, arm64, uv Strategy B, non-root)** — `2a0755f` (feat)
2. **Task 2: Retire backend/Dockerfile** — `bc97cde` (chore)

_Note: docs commit for SUMMARY.md / STATE.md / ROADMAP.md is added after this section by the executor protocol._

## Files Created/Modified

- `infra/Dockerfile.api` (created) — multi-stage arm64 image: `python:3.11-slim` builder (gcc + libpq-dev + Poetry 1.8.5 + poetry-plugin-export + uv via the astral-sh image; exports requirements.txt then `uv pip install --system`; strips Poetry/uv from `/usr/local/bin` before stage transition) + `python:3.11-slim` runtime (libpq5, appuser uid 1000, `COPY --from=builder` site-packages + bin, `COPY --chown` app code, USER appuser, EXPOSE 8000, urllib HEALTHCHECK, uvicorn CMD).
- `backend/.dockerignore` (created) — keeps `.env*`, `*.db`, `*.sqlite*`, Python caches, `.git`, editor / OS files out of the build context. Required for T-04-01.
- `backend/Dockerfile` (deleted) — old Poetry-only single-stage build path retired.

## Decisions Made

- **Poetry 1.8.5 over plan-specified 1.7.1.** The plan asked for `poetry==1.7.1` AND `poetry-plugin-export>=1.8` simultaneously. pip resolves this as `ResolutionImpossible`: plugin-export 1.8.0 requires `poetry>=1.8.0` (plugin was extracted from Poetry core in the 1.8 release; in 1.7.x the `export` command lives inside Poetry itself, so the plugin is not needed and 1.8.0 cannot install). 1.8.5 is the highest 1.x release at execution time, keeps the plugin contract intact, and preserves every other constraint in the plan (the export invocation, the runtime image shape, and the acceptance grep set).
- **Strip Poetry from builder before the cross-stage COPY rather than filter at COPY time.** The plan instructed `COPY --from=builder /usr/local/bin /usr/local/bin` (broad) to bring uvicorn into the runtime. Without a counter-step, the poetry shim also makes the jump. A targeted `pip uninstall` + `rm -f` in the builder achieves the must_have ("no Poetry in runtime") without altering the runtime stage at all — keeps the runtime layer count minimal and matches the plan's explicit COPY pattern.
- **README tree-line `Dockerfile` reference left for plan 04-02.** Plan 04-02 (relocate-dev-compose) is the canonical owner of README docker-path edits — scope-boundary rule says leave it to that plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's Poetry version pin is internally inconsistent**
- **Found during:** Task 1 (first docker build attempt)
- **Issue:** Plan locked `poetry==1.7.1` AND `poetry-plugin-export>=1.8`. `pip install` returns `ResolutionImpossible` — plugin-export 1.8.0 depends on `poetry>=1.8.0`, plugin 1.9.0 on `>=2.0`, plugin 1.10.0 on `>=2.1`. The combination cannot be installed.
- **Fix:** Bumped to `poetry==1.8.5` (latest 1.x; minimum-drift fix). Plugin pin `>=1.8` preserved. Documented the rationale inline in the Dockerfile.
- **Files modified:** `infra/Dockerfile.api`
- **Verification:** `docker build --platform linux/arm64 -f infra/Dockerfile.api -t wallet-api:test backend/` exits 0; `poetry export` runs cleanly and emits a requirements.txt that `uv pip install` consumes without complaint.
- **Committed in:** `2a0755f`

**2. [Rule 2 - Missing Critical] No .dockerignore — T-04-01 mitigation incomplete**
- **Found during:** Task 1 (first runtime check after successful build)
- **Issue:** Acceptance criterion `docker run --rm wallet-api:test test ! -f /app/.env` failed: `COPY --chown=appuser:appuser . .` swept the developer-local `backend/.env` (a real secrets file, 399 bytes) into the production image at `/app/.env`. The plan's threat model T-04-01 said "No `COPY .env` in Dockerfile" but did not specify the .dockerignore that makes this true.
- **Fix:** Created `backend/.dockerignore` excluding `.env*`, `*.pem`, `*.key`, `*.db`, `*.sqlite*`, `__pycache__`, `.pytest_cache`, `.git`, editor / OS files, and `tests/`.
- **Files modified:** `backend/.dockerignore` (new)
- **Verification:** `docker run --rm wallet-api:test test ! -f /app/.env` exits 0. `docker run --rm wallet-api:test test ! -f /app/wallet_dev.db` also exits 0 (extra defense — dev SQLite was an unstated bonus risk).
- **Committed in:** `2a0755f`

**3. [Rule 2 - Missing Critical] Poetry binary survived into runtime — must_have violated**
- **Found during:** Task 1 (post-build inspection)
- **Issue:** The plan's must_have truths state "Image contains NO Poetry / pip dev tooling and no secrets baked in." The directive `COPY --from=builder /usr/local/bin /usr/local/bin` (required to bring uvicorn over) silently transferred the Poetry pip-installed entry-point shim too. `command -v poetry` inside the container returned `/usr/local/bin/poetry`.
- **Fix:** After `uv pip install` completes in the builder, run `pip uninstall -y poetry poetry-plugin-export poetry-core` and `rm -f /usr/local/bin/poetry /usr/local/bin/poetry-* /bin/uv /bin/uvx`. The site-packages directory used by `uv pip install --system` is untouched, so the runtime still has all resolved app deps; only the Poetry resolver and the uv binary itself are stripped.
- **Files modified:** `infra/Dockerfile.api`
- **Verification:** `docker run --rm wallet-api:test sh -c 'command -v poetry'` returns empty (NO_POETRY). `docker run --rm wallet-api:test sh -c 'command -v uv'` returns empty (NO_UV). `docker run --rm wallet-api:test sh -c 'command -v uvicorn'` returns `/usr/local/bin/uvicorn` (CMD will resolve at boot).
- **Committed in:** `2a0755f`

---

**Total deviations:** 3 auto-fixed (1 plan-bug, 2 missing-critical mitigations explicitly required by the plan threat model but not by the file inventory)
**Impact on plan:** All three were prerequisites for the plan's own acceptance criteria and threat-model mitigations to pass. None expanded scope; all stayed within `infra/Dockerfile.api` and one new `backend/.dockerignore` (a defensible companion to the Dockerfile per industry convention).

## Issues Encountered

- **Host platform is amd64, not arm64 as the executor prompt asserted.** `docker version` host is `linux/amd64/v3`; the Dockerfile builds for arm64 via Docker Desktop's qemu emulation. `docker image inspect ... --format '{{.Architecture}}'` correctly reports `arm64` (the image *is* arm64; only the host running it is amd64). Each `docker run` against the test image emits a "platform does not match" WARNING but proceeds via emulation. This is acceptable for development verification — the image will run natively on Oracle A1.Flex. Documented here so a future native-arm64 reviewer doesn't read the warnings as failures.

## User Setup Required

None. No external service configuration. The image is built locally; consumed by upcoming plan 04-05 via compose.

## Known Stubs

None. Every directive in the Dockerfile is live and verified.

## Next Phase Readiness

- `infra/Dockerfile.api` is the canonical build path for plans 04-05 (prod compose) and 04-06 (smoke).
- `backend/.dockerignore` is in place; compose `build:` blocks against `context: ../backend` will inherit it.
- Image tag for local consumption: `wallet-app/api:local` (planner to set in compose). The current test tag `wallet-api:test` was used only for verification and can be discarded.

## Self-Check: PASSED

Verified before reporting completion:

- `test -f infra/Dockerfile.api` → FOUND
- `test -f backend/.dockerignore` → FOUND
- `test ! -f backend/Dockerfile` → confirmed deleted
- `git log --oneline | grep 2a0755f` → FOUND (`feat(04-01): author infra/Dockerfile.api ...`)
- `git log --oneline | grep bc97cde` → FOUND (`chore(04-01): retire backend/Dockerfile ...`)
- `docker image inspect wallet-api:test --format '{{.Architecture}}'` → `arm64`
- `docker run --rm wallet-api:test id -u` → `1000`
- `docker run --rm wallet-api:test test ! -f /app/.env` → exit 0
- `docker run --rm wallet-api:test sh -c 'command -v poetry'` → empty (NO_POETRY)

---
*Phase: 04-containerize-and-compose-locally*
*Completed: 2026-05-11*
