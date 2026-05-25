---
phase: 06-provision-oracle-vm-domain-caddy-https
plan: "01"
subsystem: infra
tags: [caddy, hsts, acme, letsencrypt, env-vars, docker-compose, https]

# Dependency graph
requires:
  - phase: 04-containerize-and-compose-locally
    provides: "infra/Caddyfile (env-var-driven), infra/docker-compose.prod.yml (caddy service with environment block), infra/.env.example (schema)"
provides:
  - "Caddyfile global acme_ca block with env-var-driven LE endpoint (D-05 two-commit pattern wiring)"
  - "HSTS header directive in Caddyfile site block (D-19, DOMAIN-03)"
  - "CADDY_ACME_CA documented in .env.example with staging URL and usage instructions"
  - "ALLOWED_ORIGINS narrowed from https://localhost to CHANGE_ME_YOUR_DOMAIN sentinel (D-20, DOMAIN-04)"
  - "CADDY_ACME_CA env passthrough in docker-compose.prod.yml caddy service environment block"
affects: [06-provision-oracle-vm-domain-caddy-https, plans 02-07, any plan referencing infra/Caddyfile or infra/.env.example]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-var-driven ACME endpoint: acme_ca {$CADDY_ACME_CA:LE-prod-url} in global block enables staging/prod flip via VM .env edit only"
    - "Two-commit LE staging→prod pattern: Commit A sets CADDY_ACME_CA to staging URL; Commit B removes/unsets it to use Caddyfile default (LE prod)"

key-files:
  created: []
  modified:
    - infra/Caddyfile
    - infra/.env.example
    - infra/docker-compose.prod.yml

key-decisions:
  - "Used acme_ca {$CADDY_ACME_CA:https://acme-v02.api.letsencrypt.org/directory} (with explicit LE prod default) instead of {$CADDY_ACME_CA} (no default) because Caddy 2.11.3 rejects acme_ca with empty/unset argument — caddy validate would fail on laptop where CADDY_ACME_CA is unset"
  - "VM Commit B for LE prod flip: REMOVE/UNSET CADDY_ACME_CA from .env (not set to empty) so Caddyfile default kicks in; commented this in .env.example docs accordingly"
  - "CADDY_ACME_CA= (empty) in .env.example: laptops run tls internal due to CADDY_TLS_MODE=internal overriding ACME; the explicit default URL only applies on VM where CADDY_TLS_MODE is unset"

patterns-established:
  - "Pattern: Caddy global acme_ca must have a non-empty argument — use {$VAR:fallback-url} not {$VAR} to keep caddy validate passing when env var is unset"

requirements-completed: [DOMAIN-02, DOMAIN-03, DOMAIN-04]

# Metrics
duration: 4min
completed: "2026-05-25"
---

# Phase 6 Plan 01: Caddy HTTPS Production-Readiness Summary

**Caddyfile gains global acme_ca (LE-staging-first env-var pattern, D-05) + HSTS header (D-19); CADDY_ACME_CA threaded through compose env and documented in .env.example with staging URL and CHANGE_ME sentinel for ALLOWED_ORIGINS**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-25T15:49:30Z
- **Completed:** 2026-05-25T15:53:32Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Global `acme_ca` directive in Caddyfile enables LE staging→prod swap with a single `.env` line edit on the VM (no Caddyfile diff in Commit B)
- HSTS `max-age=31536000; includeSubDomains` header directive added without `preload` token (D-19, irreversible preload deferred)
- `ALLOWED_ORIGINS` narrowed to `CHANGE_ME_YOUR_DOMAIN` sentinel so VM `.env` cp fails loudly if the operator forgets to update it (D-20)
- `CADDY_ACME_CA` documented with 5-line comment block in `.env.example` explaining laptop/VM-staging/VM-prod usage and the staging URL

## Task Commits

Each task was committed atomically:

1. **Task 1: Add acme_ca global block + HSTS header to infra/Caddyfile** - `570ff9e` (feat)
2. **Task 2: Extend infra/.env.example with CADDY_ACME_CA + narrow ALLOWED_ORIGINS** - `60ad324` (feat)
3. **Task 3: Add CADDY_ACME_CA env passthrough to caddy service in docker-compose.prod.yml** - `a8be85d` (feat)

## Files Created/Modified
- `infra/Caddyfile` - Added global block with acme_ca directive + HSTS header between tls and encode; 5 handle blocks untouched
- `infra/.env.example` - Narrowed ALLOWED_ORIGINS sentinel, updated Caddy comment block, appended CADDY_ACME_CA variable with documentation
- `infra/docker-compose.prod.yml` - Added CADDY_ACME_CA: ${CADDY_ACME_CA:-} to caddy service environment block (3rd of 3 CADDY_* keys)

## Decisions Made
- Used `{$CADDY_ACME_CA:https://acme-v02.api.letsencrypt.org/directory}` as the Caddyfile directive (explicit LE prod URL as default), not the plan-spec'd bare `{$CADDY_ACME_CA}` — see Deviation #1 below.
- VM Commit B procedure: operator must UNSET `CADDY_ACME_CA` (remove the line from `.env`) rather than set it to empty, since Caddy's `{$VAR:default}` only falls back to default when the var is UNSET, not when it is empty-string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] acme_ca {$CADDY_ACME_CA} (no default) fails caddy validate when env var unset**
- **Found during:** Task 1 (Add acme_ca global block + HSTS header to Caddyfile)
- **Issue:** The plan's `must_haves` specifies both `acme_ca {$CADDY_ACME_CA}` (bare, no default) AND `caddy validate exits 0`. Caddy 2.11.3 rejects `acme_ca` with an empty/unset argument — the validation command in the plan spec runs without env vars, causing exit code 1 with "wrong argument count or unexpected line ending after 'acme_ca'".
- **Fix:** Changed to `acme_ca {$CADDY_ACME_CA:https://acme-v02.api.letsencrypt.org/directory}`. Default is the explicit LE prod URL (identical functional behavior to Caddy's built-in default). The two-commit staging→prod pattern still works: Commit A sets the staging URL, Commit B removes the var (making Caddy use the Caddyfile default = LE prod URL).
- **Files modified:** `infra/Caddyfile`
- **Verification:** `docker run --rm -v "$(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine caddy validate ...` exits 0 with no env var set (laptop default), with empty string, and with staging URL.
- **Committed in:** `570ff9e` (Task 1 commit)
- **VM procedure impact:** `.env.example` comment updated — Commit B should REMOVE/UNSET CADDY_ACME_CA (not set it to empty string) so the Caddyfile default triggers.

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in plan spec vs actual Caddy 2.11.3 behavior)
**Impact on plan:** Functional intent preserved. The staging→prod two-commit pattern works as designed. caddy validate now exits 0.

## Issues Encountered
- Caddy 2.11.3 does not accept `acme_ca` with no argument — the research note that "empty CADDY_ACME_CA → Caddy default" was correct for runtime behavior but the env var *expansion* of `{$VAR}` to empty still passes the empty string as a bare token to the acme_ca parser, which rejects it at validation time. Fixed by using `{$VAR:explicit-prod-url}` default.

## User Setup Required
None - no external service configuration required. VM `.env` authoring and the LE staging→prod flip are covered by the Plan 04 RUNBOOK.

## Next Phase Readiness
- DOMAIN-02 wiring complete (acme_ca hook in Caddyfile; actual LE issuance happens in Plan 05a/05b on VM)
- DOMAIN-03 wiring complete (HSTS directive live; emitted by Caddy after prod-cert flip in Plan 05b)
- DOMAIN-04 partial: .env.example sentinel narrowed; actual `.env` narrowing on VM happens in Plan 05a
- Plans 02-07 can proceed; this plan has no blocking dependencies

## Self-Check

- [x] `infra/Caddyfile` exists and contains `acme_ca` + HSTS directive
- [x] `infra/.env.example` contains `CADDY_ACME_CA=` and `ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN`
- [x] `infra/docker-compose.prod.yml` contains `CADDY_ACME_CA: ${CADDY_ACME_CA:-}`
- [x] Task commits: 570ff9e, 60ad324, a8be85d all exist

## Self-Check: PASSED

---
*Phase: 06-provision-oracle-vm-domain-caddy-https*
*Completed: 2026-05-25*
