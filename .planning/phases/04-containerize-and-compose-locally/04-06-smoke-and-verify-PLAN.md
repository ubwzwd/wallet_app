---
phase: 04-containerize-and-compose-locally
plan: 06
type: execute
wave: 3
depends_on:
  - "04-01"
  - "04-02"
  - "04-03"
  - "04-04"
  - "04-05"
files_modified:
  - infra/scripts/smoke.sh
autonomous: true
requirements:
  - DEPLOY-01
  - DEPLOY-03
  - DEPLOY-04
  - DOMAIN-04
  - OPS-04
  - SEC-01
tags:
  - smoke
  - verification
  - nyquist
must_haves:
  truths:
    - "`bash infra/scripts/smoke.sh` brings up the prod compose stack, exercises every Phase 4 success criterion, and tears down cleanly"
    - "Migrations run before API accepts traffic (`migrate` service exits 0 before api becomes healthy)"
    - "Postgres reports `shared_buffers = 3GB`"
    - "Frontend bundle (`frontend/dist/`) contains zero occurrences of `localhost:8000`"
    - "Caddy serves https://localhost with self-signed cert; `/api/v1/health` returns 200; `/` returns the SPA shell"
    - "infra/.env is gitignored; infra/.env.example is committed and covers every Settings field"
  artifacts:
    - path: "infra/scripts/smoke.sh"
      provides: "End-to-end orchestrator: compose up --wait, all Wave 0 verifications, teardown on success or failure"
      contains: "set -euo pipefail"
  key_links:
    - from: "infra/scripts/smoke.sh"
      to: "infra/docker-compose.prod.yml"
      via: "docker compose up -d --wait"
      pattern: "docker compose -f.*infra/docker-compose.prod.yml.*up"
    - from: "infra/scripts/smoke.sh"
      to: "infra/scripts/env-coverage.sh"
      via: "invocation as nested check"
      pattern: "env-coverage.sh"
---

<objective>
Author `infra/scripts/smoke.sh` — the Wave-0 end-to-end smoke test that satisfies every automated row in `04-VALIDATION.md`'s Per-Task Verification Map. It builds the API image, brings up the prod compose stack with `--wait`, asserts the migrate service exited 0, queries Postgres for `shared_buffers = 3GB`, hits `/api/v1/health` and `/` via the Caddy ingress (self-signed cert), greps `frontend/dist/` for `localhost:8000`, invokes `env-coverage.sh`, then tears down (on exit, including failure).

Purpose: This is the single executable proof that Phase 4 is done. The orchestrator (`/gsd-verify-work`) runs this as the gate. Without it, every other plan's automated verify is partial-success at best.
Output: One bash script that exits 0 only when all 5 ROADMAP success criteria for Phase 4 are observably true on the dev laptop.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md
@.planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md
@.planning/phases/04-containerize-and-compose-locally/04-VALIDATION.md
@.planning/phases/04-containerize-and-compose-locally/04-05-SUMMARY.md
@infra/docker-compose.prod.yml
@infra/scripts/env-coverage.sh
@infra/.env.example
</context>

<interfaces>
<!-- 04-VALIDATION.md Per-Task Verification Map — these rows must all pass via this script: -->
<!--   04-01-01 Dockerfile builds linux/arm64                                (build step) -->
<!--   04-01-02 Runs as uid 1000                                              (docker run id -u) -->
<!--   04-01-03 Architecture == arm64                                         (image inspect) -->
<!--   04-02-01 dev compose still lints                                       (compose config -q) -->
<!--   04-03-01 db -> migrate -> api -> caddy ordering                        (up --wait, ps) -->
<!--   04-03-02 shared_buffers == 3GB                                         (psql SHOW) -->
<!--   04-03-03 shm_size >= 1g                                                (docker inspect HostConfig.ShmSize) -->
<!--   04-03-04 migrate exited 0                                              (ps --format json) -->
<!--   04-04-01 /api/v1/health returns 200 same-origin                        (curl -fsk https://localhost/api/v1/health) -->
<!--   04-04-02 tls internal HTTPS path                                       (curl -sIk https://localhost) -->
<!--   04-05-01 no localhost:8000 in dist/                                    (npm run build:web + grep) -->
<!--   04-06-01 infra/.env gitignored                                         (git check-ignore) -->
<!--   04-06-02 .env.example contains placeholders                            (grep per key) -->
<!--   04-06-03 env-coverage.sh exits 0                                       (bash invocation) -->
<!-- -->
<!-- Bash conventions (04-PATTERNS.md lines 596-602): -->
<!--   #!/usr/bin/env bash -->
<!--   set -euo pipefail -->
<!-- -->
<!-- The script supports two modes via $1: -->
<!--   - `up`   : compose up --wait + healthchecks (used during interactive debug) -->
<!--   - `full` : up + full verification suite + teardown (default; CI mode) -->
<!-- The trap on EXIT must tear down the stack regardless of which check failed. -->
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Author infra/scripts/smoke.sh covering every Phase 4 success criterion</name>
  <files>infra/scripts/smoke.sh</files>
  <read_first>
    - .planning/phases/04-containerize-and-compose-locally/04-VALIDATION.md (Per-Task Verification Map — every row labeled `smoke` must be implemented here)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 262-306 — smoke.sh canonical pattern + bash conventions)
    - infra/docker-compose.prod.yml (service names: db, migrate, api, caddy; verify they match the script's invocations)
    - infra/.env.example (variable names referenced in `psql` exec)
    - .planning/phases/04-containerize-and-compose-locally/04-RESEARCH.md (search "Phase Requirements -> Test Map" — assembling the curl/docker checks)
  </read_first>
  <action>
    Create `infra/scripts/smoke.sh` (executable, mode 0755). The script must satisfy every `smoke`-row of 04-VALIDATION.md's Per-Task Verification Map. Exact content:

    ```bash
    #!/usr/bin/env bash
    # infra/scripts/smoke.sh — Phase 4 end-to-end verification
    #
    # Modes:
    #   bash infra/scripts/smoke.sh up      # compose up --wait only (debug)
    #   bash infra/scripts/smoke.sh full    # full verify + teardown (default)
    #
    # Exit 0  : every ROADMAP success criterion for Phase 4 observably true.
    # Exit !=0: the failing step is echoed; trap tears down the stack.

    set -euo pipefail

    MODE="${1:-full}"

    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    COMPOSE_FILE="${REPO_ROOT}/infra/docker-compose.prod.yml"
    DEV_COMPOSE="${REPO_ROOT}/infra/docker-compose.dev.yml"
    ENV_FILE="${REPO_ROOT}/infra/.env"
    ENV_EXAMPLE="${REPO_ROOT}/infra/.env.example"
    DOCKERFILE_API="${REPO_ROOT}/infra/Dockerfile.api"

    cd "$REPO_ROOT"

    teardown() {
      echo "==> teardown"
      docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
    }
    trap teardown EXIT

    # ---- preconditions ----
    echo "==> precondition: .env exists (operator must run cp infra/.env.example infra/.env first)"
    test -f "$ENV_FILE" || { echo "FAIL: $ENV_FILE missing — run 'cp $ENV_EXAMPLE $ENV_FILE' and fill in real values"; exit 1; }

    echo "==> precondition: .env is gitignored (SEC-01 / row 04-06-01)"
    git check-ignore -q "$ENV_FILE" || { echo "FAIL: $ENV_FILE is not gitignored"; exit 1; }

    echo "==> precondition: .env.example covers Settings fields (row 04-06-03)"
    bash "${REPO_ROOT}/infra/scripts/env-coverage.sh"

    echo "==> precondition: .env.example contains all CHANGE_ME placeholders (row 04-06-02)"
    for k in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SECRET_KEY ALLOWED_ORIGINS CADDY_DOMAIN CADDY_TLS_MODE; do
      grep -q "^${k}=" "$ENV_EXAMPLE" || { echo "FAIL: $ENV_EXAMPLE missing key $k"; exit 1; }
    done

    echo "==> precondition: dev compose still lints (row 04-02-01)"
    docker compose -f "$DEV_COMPOSE" config -q

    # ---- frontend bundle (rows 04-05-01..03) ----
    echo "==> frontend: npm run build:web (row 04-05-01)"
    ( cd frontend && npm run build:web ) >/tmp/smoke-build.log 2>&1 || { tail -50 /tmp/smoke-build.log; echo "FAIL: build:web"; exit 1; }
    test -d frontend/dist || { echo "FAIL: frontend/dist not created"; exit 1; }

    echo "==> frontend: no localhost:8000 in dist/ (row 04-05-01)"
    if grep -rq 'localhost:8000' frontend/dist/; then
      echo "FAIL: literal 'localhost:8000' found in frontend/dist/:"
      grep -rln 'localhost:8000' frontend/dist/
      exit 1
    fi

    echo "==> frontend: config.ts restored to config.dev.ts (row 04-05-03)"
    diff -q frontend/src/constants/config.ts frontend/src/constants/config.dev.ts >/dev/null

    # ---- backend image (rows 04-01-01..03) ----
    echo "==> backend: build linux/arm64 image (row 04-01-01)"
    docker build --platform linux/arm64 -f "$DOCKERFILE_API" backend/ -t wallet-app/api:local >/tmp/smoke-docker.log 2>&1 || { tail -50 /tmp/smoke-docker.log; echo "FAIL: docker build"; exit 1; }

    echo "==> backend: architecture is arm64 (row 04-01-03)"
    [ "$(docker image inspect wallet-app/api:local --format '{{.Architecture}}')" = "arm64" ] || { echo "FAIL: image not arm64"; exit 1; }

    echo "==> backend: container runs as uid 1000 (row 04-01-02)"
    [ "$(docker run --rm wallet-app/api:local id -u)" = "1000" ] || { echo "FAIL: not running as uid 1000"; exit 1; }

    if [ "$MODE" = "full" ] || [ "$MODE" = "up" ]; then
      # ---- compose stack ----
      echo "==> compose: config lint"
      docker compose -f "$COMPOSE_FILE" config -q

      echo "==> compose: up -d --wait (rows 04-03-01..04, 04-04-01..02)"
      docker compose -f "$COMPOSE_FILE" up -d --wait

      echo "==> compose: service states"
      docker compose -f "$COMPOSE_FILE" ps
    fi

    if [ "$MODE" = "full" ]; then
      # ---- migrate exit (row 04-03-04) ----
      echo "==> migrate: exited 0 (DEPLOY-04 / row 04-03-04)"
      migrate_state=$(docker compose -f "$COMPOSE_FILE" ps migrate --format json | python3 -c 'import sys,json; rows=json.load(sys.stdin); rows=rows if isinstance(rows,list) else [rows]; print(rows[0]["State"]+","+str(rows[0]["ExitCode"]))')
      echo "    migrate state=$migrate_state"
      echo "$migrate_state" | grep -q '^exited,0$' || { echo "FAIL: migrate did not exit 0"; exit 1; }

      # ---- Postgres tuning (rows 04-03-02..03) ----
      echo "==> postgres: shared_buffers == 3GB (OPS-04 / row 04-03-02)"
      set +u
      # shellcheck disable=SC1090
      . "$ENV_FILE"
      set -u
      docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW shared_buffers" | grep -q '^3GB$'

      echo "==> postgres: shm_size >= 1g (row 04-03-03)"
      shm=$(docker inspect "$(docker compose -f "$COMPOSE_FILE" ps -q db)" --format '{{.HostConfig.ShmSize}}')
      [ "$shm" -ge 1073741824 ] || { echo "FAIL: shm_size $shm < 1073741824"; exit 1; }

      # ---- ingress (rows 04-04-01..02) ----
      echo "==> caddy: https://localhost returns HTTP/2 200 (tls internal / row 04-04-02)"
      curl -sIk https://localhost | grep -qi '^HTTP/2 200' || { echo "FAIL: https://localhost did not return 200"; exit 1; }

      echo "==> caddy -> api: /api/v1/health returns healthy (DOMAIN-04 / row 04-04-01)"
      curl -fsk https://localhost/api/v1/health | grep -q '"status"' || { echo "FAIL: /api/v1/health did not return JSON status"; exit 1; }

      echo "==> caddy: / returns SPA shell"
      curl -ksf https://localhost/ | grep -qi '<html' || { echo "FAIL: SPA shell not served at /"; exit 1; }

      echo "OK: Phase 4 smoke green"
    fi
    ```

    Notes:
    - The trap-EXIT teardown means failure of any step still removes the stack — no orphaned containers.
    - `python3` is used to parse `docker compose ps --format json` (jq is not guaranteed on every dev laptop; python3 is, given the project is FastAPI). If the operator prefers jq, the line can be swapped without changing the contract.
    - `set +u` around the `. "$ENV_FILE"` sourcing is intentional — `set -u` would crash on any unset compose-defined var that .env doesn't define.
    - `MODE=up` is the operator-debug mode (bring stack up but don't run assertions or teardown); `MODE=full` (default) is what `/gsd-verify-work` invokes.
    - DOMAIN-04 manual verification (DevTools confirms zero CORS preflight) is documented in 04-VALIDATION.md "Manual-Only Verifications" — this script does NOT attempt to assert that automatically.

    After writing, run `chmod +x infra/scripts/smoke.sh`.
  </action>
  <verify>
    <automated>test -x infra/scripts/smoke.sh && bash -n infra/scripts/smoke.sh && cp infra/.env.example infra/.env && sed -i 's/CHANGE_ME_POSTGRES_USER/wallet/; s/CHANGE_ME_POSTGRES_PASSWORD/walletpw/; s/CHANGE_ME_POSTGRES_DB/wallet/; s/CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32/'"$(openssl rand -hex 32)"'/' infra/.env && bash infra/scripts/smoke.sh full; status=$?; rm -f infra/.env; exit $status</automated>
  </verify>
  <acceptance_criteria>
    - `test -x infra/scripts/smoke.sh` exits 0
    - `head -1 infra/scripts/smoke.sh | grep -q '^#!/usr/bin/env bash$'` exits 0
    - `grep -c '^set -euo pipefail$' infra/scripts/smoke.sh` returns 1
    - `grep -c 'trap teardown EXIT' infra/scripts/smoke.sh` returns 1
    - `grep -c 'docker compose -f.*infra/docker-compose.prod.yml.*up -d --wait' infra/scripts/smoke.sh` returns at least 1
    - `grep -c 'env-coverage.sh' infra/scripts/smoke.sh` returns at least 1
    - `grep -c 'git check-ignore' infra/scripts/smoke.sh` returns at least 1
    - `grep -c 'localhost:8000' infra/scripts/smoke.sh` returns at least 1 (the grep check)
    - `grep -c 'SHOW shared_buffers' infra/scripts/smoke.sh` returns 1
    - `grep -c '/api/v1/health' infra/scripts/smoke.sh` returns at least 1
    - `grep -c 'service_completed_successfully\|migrate.*exited' infra/scripts/smoke.sh` returns at least 1
    - `bash -n infra/scripts/smoke.sh` exits 0 (syntax check)
    - End-to-end: with a populated `infra/.env`, `bash infra/scripts/smoke.sh full` exits 0
  </acceptance_criteria>
  <done>smoke.sh is the single command that verifies all five ROADMAP success criteria; runs in <120s per 04-VALIDATION.md.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| smoke.sh -> .env (sourced) | Sources real secrets into bash; must run only on dev laptop, never in CI as-written (Phase 7 will adapt) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-24 | Information Disclosure | smoke.sh leaves the stack up with real secrets if a check fails | mitigate | `trap teardown EXIT` runs `docker compose down -v --remove-orphans` on ANY exit (success or failure). |
| T-04-25 | Information Disclosure | smoke.sh prints secrets to logs during sourcing of .env | mitigate | `. "$ENV_FILE"` is silent (no `set -x`); script does not echo $POSTGRES_PASSWORD or $SECRET_KEY anywhere. Acceptance: `grep -c 'echo.*POSTGRES_PASSWORD\|echo.*SECRET_KEY' infra/scripts/smoke.sh == 0` (implicit). |
| T-04-26 | Tampering | smoke.sh proceeds past a failing precondition because `set -e` is forgotten | mitigate | `set -euo pipefail` at top; every check is a single command (no `||` swallowing) so failures abort. |
| T-04-27 | Spoofing | A passing smoke.sh on amd64 dev laptop falsely implies arm64 compatibility | accept | Plan 01 acceptance test enforces `Architecture == arm64` via `--platform linux/arm64`; smoke.sh re-asserts. Phase 6 first VM deploy is the final cross-arch reality check. |
</threat_model>

<verification>
- `bash infra/scripts/smoke.sh full` exits 0 with a populated `infra/.env` on a clean working tree.
- Failure of any single check causes the trap to run `docker compose down -v` and exit non-zero with a labelled error.
- Total runtime <120 seconds (per 04-VALIDATION.md target).
</verification>

<success_criteria>
- All five ROADMAP Phase 4 success criteria observably true via a single command.
- DEPLOY-01 / DEPLOY-03 / DEPLOY-04 / DOMAIN-04 / OPS-04 / SEC-01 all exercised by automated checks.
- Manual-only verifications (DevTools CORS preflight check, browser self-signed cert flow) documented in 04-VALIDATION.md.
</success_criteria>

<output>
After completion, create `.planning/phases/04-containerize-and-compose-locally/04-06-SUMMARY.md`.

Then update `.planning/phases/04-containerize-and-compose-locally/04-VALIDATION.md` frontmatter to set `nyquist_compliant: true` and `wave_0_complete: true` (the env-coverage and smoke scripts now exist, all rows have automated commands).
</output>
