---
phase: 04-containerize-and-compose-locally
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/.env.example
  - infra/scripts/env-coverage.sh
autonomous: true
requirements:
  - SEC-01
  - DEPLOY-04
tags:
  - secrets
  - env
  - sec
must_haves:
  truths:
    - "infra/.env.example exists with all required CHANGE_ME_* placeholder keys for prod compose"
    - "Every Settings field in backend/app/core/config.py has a corresponding key in infra/.env.example"
    - "infra/scripts/env-coverage.sh exits 0 against the new .env.example (Wave 0 dependency for Plan 06)"
  artifacts:
    - path: "infra/.env.example"
      provides: "Canonical env template for prod compose (D-16)"
      contains: "POSTGRES_USER=CHANGE_ME_POSTGRES_USER"
    - path: "infra/scripts/env-coverage.sh"
      provides: "Static coverage check: Settings fields vs .env.example keys"
      contains: "set -euo pipefail"
  key_links:
    - from: "infra/.env.example"
      to: "backend/app/core/config.py Settings class"
      via: "all 8 Settings fields documented as keys"
      pattern: "DATABASE_URL|SECRET_KEY|ALGORITHM|ACCESS_TOKEN_EXPIRE_MINUTES|DEBUG|ALLOWED_ORIGINS|EXCHANGE_RATE_API_URL|ENVIRONMENT"
    - from: "infra/scripts/env-coverage.sh"
      to: "infra/.env.example"
      via: "grep declared keys"
      pattern: "grep -E '\\^\\[A-Z\\]\\[A-Z_0-9\\]+='"
---

<objective>
Author the canonical `infra/.env.example` per D-16 (all CHANGE_ME_* placeholders covering Postgres trio, FastAPI secrets, CORS, Caddy domain/TLS) and a Wave-0 `infra/scripts/env-coverage.sh` that diffs `Settings` fields in `backend/app/core/config.py` against keys declared in `.env.example` and exits 1 on drift.

Purpose: SEC-01 (secrets never in repo or image; canonical template with sentinel placeholders that fail loudly on miss-substitution) + DEPLOY-04 prereq (compose plan needs the .env.example as the schema reference). The env-coverage script is a Wave-0 missing-test scaffold (per 04-VALIDATION.md).
Output: `.env.example` template + executable bash coverage script.
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
@backend/app/core/config.py
@backend/env.example
</context>

<interfaces>
<!-- D-16 canonical .env.example key list (must appear verbatim, in this order, with CHANGE_ME_* sentinels): -->
<!--   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB -->
<!--   DATABASE_URL (composed: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}) -->
<!--   SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM -->
<!--   ALLOWED_ORIGINS (Phase 4 default: https://localhost) -->
<!--   EXCHANGE_RATE_API_URL, ENVIRONMENT, DEBUG -->
<!--   CADDY_DOMAIN, CADDY_TLS_MODE -->
<!-- Settings fields in backend/app/core/config.py (lines 11-31) to cover: -->
<!--   DATABASE_URL, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, DEBUG, ALLOWED_ORIGINS, EXCHANGE_RATE_API_URL, ENVIRONMENT -->
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Author infra/.env.example with D-16 canonical key list</name>
  <files>infra/.env.example</files>
  <read_first>
    - backend/app/core/config.py (full file — enumerate every uppercase Settings field; lines 11-31 contain the class body)
    - backend/env.example (full file — section-header convention to carry forward)
    - .planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md (D-16 verbatim key list, D-17 chmod note)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 213-258: .env.example pattern + Settings coverage list)
  </read_first>
  <action>
    Create `infra/.env.example` (must be tracked by git; the live `infra/.env` is gitignored — see Plan 02). Exact content (preserve section-header convention from `backend/env.example`):

    ```bash
    # infra/.env.example — Phase 4 production-shape compose env template
    #
    # USAGE:
    #   1. cp infra/.env.example infra/.env
    #   2. Replace every CHANGE_ME_* placeholder with a real value.
    #   3. chmod 600 infra/.env  (enforced on the VM in Phase 6; on a dev laptop this is best-effort)
    #
    # NOTE: infra/.env is gitignored. This file (.env.example) IS committed and serves as the schema.
    #       A missed substitution will fail loudly because CHANGE_ME_* values are sentinels, not defaults.

    # Postgres
    POSTGRES_USER=CHANGE_ME_POSTGRES_USER
    POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD
    POSTGRES_DB=CHANGE_ME_POSTGRES_DB

    # Database URL (consumed by FastAPI via pydantic-settings) — host is compose service name `db`, NOT localhost
    DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

    # JWT / Auth
    SECRET_KEY=CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32
    ACCESS_TOKEN_EXPIRE_MINUTES=30
    ALGORITHM=HS256

    # CORS allowlist (defense-in-depth; same-origin Caddy makes browser CORS moot but FastAPI still enforces)
    ALLOWED_ORIGINS=https://localhost

    # Exchange-rate API (Frankfurter — ECB data, no key required)
    EXCHANGE_RATE_API_URL=https://api.frankfurter.app

    # Environment metadata
    ENVIRONMENT=production
    DEBUG=False

    # Caddy (Phase 4 laptop default: tls internal self-signed at https://localhost; Phase 6 narrows to real domain + ACME)
    CADDY_DOMAIN=localhost
    CADDY_TLS_MODE=internal
    ```

    Key requirements:
    - Every key list above MUST appear, in this order.
    - `CHANGE_ME_*` placeholders are SENTINELS — if accidentally shipped, FastAPI will fail to start (bcrypt rejects a non-32-byte SECRET_KEY) or Postgres will reject the credentials. That loud failure is the design.
    - No `API_V1_PREFIX` or `PROJECT_NAME` keys — they have safe defaults in `Settings` and are not phase-relevant (per 04-PATTERNS.md).
  </action>
  <verify>
    <automated>test -f infra/.env.example && for k in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL SECRET_KEY ACCESS_TOKEN_EXPIRE_MINUTES ALGORITHM ALLOWED_ORIGINS EXCHANGE_RATE_API_URL ENVIRONMENT DEBUG CADDY_DOMAIN CADDY_TLS_MODE; do grep -q "^${k}=" infra/.env.example || { echo "missing $k"; exit 1; }; done</automated>
  </verify>
  <acceptance_criteria>
    - `test -f infra/.env.example` exits 0
    - `grep -c '^POSTGRES_USER=CHANGE_ME_POSTGRES_USER$' infra/.env.example` returns 1
    - `grep -c '^POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD$' infra/.env.example` returns 1
    - `grep -c '^POSTGRES_DB=CHANGE_ME_POSTGRES_DB$' infra/.env.example` returns 1
    - `grep -c '^DATABASE_URL=postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@db:5432/\${POSTGRES_DB}$' infra/.env.example` returns 1
    - `grep -c '^SECRET_KEY=CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32$' infra/.env.example` returns 1
    - `grep -c '^ALLOWED_ORIGINS=https://localhost$' infra/.env.example` returns 1
    - `grep -c '^ENVIRONMENT=production$' infra/.env.example` returns 1
    - `grep -c '^DEBUG=False$' infra/.env.example` returns 1
    - `grep -c '^CADDY_DOMAIN=localhost$' infra/.env.example` returns 1
    - `grep -c '^CADDY_TLS_MODE=internal$' infra/.env.example` returns 1
    - `grep -c '^API_V1_PREFIX=' infra/.env.example` returns 0
    - `grep -v '^#' infra/.env.example | grep -c 'localhost:8000'` returns 0
  </acceptance_criteria>
  <done>Canonical .env.example exists with every D-16 key as a CHANGE_ME_* sentinel.</done>
</task>

<task type="auto">
  <name>Task 2: Author infra/scripts/env-coverage.sh (Wave-0 coverage check)</name>
  <files>infra/scripts/env-coverage.sh</files>
  <read_first>
    - backend/app/core/config.py (lines 11-31 — Settings class field declarations to parse)
    - infra/.env.example (must exist — from Task 1)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 309-337: env-coverage.sh pattern)
    - .planning/phases/04-containerize-and-compose-locally/04-VALIDATION.md (Wave 0 Requirements section)
  </read_first>
  <action>
    Create `infra/scripts/env-coverage.sh` (executable, mode 0755):

    ```bash
    #!/usr/bin/env bash
    # infra/scripts/env-coverage.sh — verify infra/.env.example covers every Settings field in backend/app/core/config.py
    # Exit 0 = all required keys present. Exit 1 = drift (lists missing keys to stderr).

    set -euo pipefail

    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    CONFIG_PY="${REPO_ROOT}/backend/app/core/config.py"
    ENV_EXAMPLE="${REPO_ROOT}/infra/.env.example"

    test -f "$CONFIG_PY"   || { echo "missing $CONFIG_PY" >&2; exit 1; }
    test -f "$ENV_EXAMPLE" || { echo "missing $ENV_EXAMPLE" >&2; exit 1; }

    # Extract UPPER_SNAKE field names from the Settings class body. Excludes properties,
    # dunders, and the API_V1_PREFIX / PROJECT_NAME defaults that are not phase-relevant.
    required=$(grep -E '^\s+[A-Z][A-Z_0-9]+:\s' "$CONFIG_PY" \
      | sed -E 's/^\s+([A-Z_0-9]+):.*/\1/' \
      | sort -u)

    declared=$(grep -E '^[A-Z][A-Z_0-9]+=' "$ENV_EXAMPLE" \
      | sed -E 's/=.*//' \
      | sort -u)

    missing=$(comm -23 <(echo "$required") <(echo "$declared") || true)

    if [ -n "$missing" ]; then
      echo "MISSING in $ENV_EXAMPLE:" >&2
      echo "$missing" >&2
      exit 1
    fi

    echo "OK: all $(echo "$required" | wc -l) Settings fields in $CONFIG_PY appear in $ENV_EXAMPLE"
    ```

    After writing, run `chmod +x infra/scripts/env-coverage.sh`. The script is consumed by Plan 06 smoke test 04-06-03 (per 04-VALIDATION.md row "infra/.env.example contains required CHANGE_ME placeholders").
  </action>
  <verify>
    <automated>test -x infra/scripts/env-coverage.sh && bash infra/scripts/env-coverage.sh</automated>
  </verify>
  <acceptance_criteria>
    - `test -x infra/scripts/env-coverage.sh` exits 0
    - `head -1 infra/scripts/env-coverage.sh | grep -q '^#!/usr/bin/env bash$'` exits 0
    - `grep -c '^set -euo pipefail$' infra/scripts/env-coverage.sh` returns 1
    - `bash infra/scripts/env-coverage.sh` exits 0 (i.e. .env.example covers all Settings fields)
    - Tampering test: `tmp=$(mktemp) && head -n -2 infra/.env.example > $tmp && cp $tmp infra/.env.example && ! bash infra/scripts/env-coverage.sh && git checkout -- infra/.env.example` — i.e. removing CADDY_DOMAIN / CADDY_TLS_MODE causes the script to exit non-zero, then restore
  </acceptance_criteria>
  <done>env-coverage.sh exits 0 on a clean tree and exits 1 when .env.example drifts from Settings.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| committed repo -> production secrets file | `.env.example` is the template; `.env` (live secrets) must stay out of git and out of image layers |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-11 | Information Disclosure | Real secrets accidentally committed via `.env.example` (operator overwrites the template) | mitigate | `.env.example` contains ONLY `CHANGE_ME_*` placeholders — visible at code review; `.env` is gitignored (Plan 02). |
| T-04-12 | Tampering | `Settings` class gains a new required field; `.env.example` is not updated; deploy crashes at startup with cryptic error | mitigate | `env-coverage.sh` runs as Wave-0 smoke test (Plan 06 row 04-06-03) — drift exits 1 with named missing keys. |
| T-04-13 | Information Disclosure | Default SECRET_KEY value (e.g. `your-secret-key-here`) silently used in production because operator never substituted | mitigate | `CHANGE_ME_GENERATE_VIA_openssl_rand_-hex_32` sentinel will fail bcrypt JWT signing — loud crash on first auth request rather than silent weak-key compromise. |
| T-04-14 | Information Disclosure | `.env.example` accidentally includes a live URL like `localhost:8000` that leaks into prod docs | mitigate | Acceptance test `grep -v '^#' infra/.env.example \| grep -c 'localhost:8000' == 0`. |
</threat_model>

<verification>
- `bash infra/scripts/env-coverage.sh` exits 0.
- All D-16 keys present with `CHANGE_ME_*` sentinels (no live values).
- Script exits 1 if any Settings field is missing from `.env.example`.
</verification>

<success_criteria>
- SEC-01: secrets template uses sentinel placeholders; real `.env` is gitignored (Plan 02).
- DEPLOY-04 prereq: compose plan can reference `env_file: ../infra/.env` with the schema established.
</success_criteria>

<output>
After completion, create `.planning/phases/04-containerize-and-compose-locally/04-04-SUMMARY.md`.
</output>
