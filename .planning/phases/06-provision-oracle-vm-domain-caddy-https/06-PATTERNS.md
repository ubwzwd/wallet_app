# Phase 6: Provision Oracle VM + Domain + Caddy HTTPS - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 6 (2 modified, 3 created, 1 maybe-modified)
**Analogs found:** 5 / 6 (RUNBOOK.md has no direct analog — see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `infra/Caddyfile` (modified) | config | request-response (env-var interpolation at container start) | `infra/Caddyfile` (self) | exact (delta-edit) |
| `infra/.env.example` (modified) | config | env-var schema (read by compose `env_file:`, by `Settings`, and by `env-coverage.sh`) | `infra/.env.example` (self) | exact (delta-edit) |
| `infra/RUNBOOK.md` (created) | docs (operator playbook) | human read-only (no machine consumer) | — (no direct analog) | none — see "No Analog Found" |
| `infra/scripts/verify-phase6.sh` (created) | script (verifier) | one-shot CLI (exit-code semantics, stdout `==>` cadence, stderr `FAIL:`) | `infra/scripts/smoke.sh` | exact (same idiom, same dir) |
| `infra/runbook-evidence/.gitkeep` (created) | placeholder | filesystem-only (git only) | (convention; ubiquitous) | role-match |
| `.gitignore` (maybe-modified) | config | git-internal | `.gitignore` (self) | exact (one-line append) |

## Pattern Assignments

### `infra/Caddyfile` (config, env-var-driven, modified)

**Analog:** `infra/Caddyfile` (the file itself — Phase 4 D-10 designed this exact swap)
**Path:** `/home/ubwzwd/Code/wallet_app/infra/Caddyfile`

**Current full file (lines 1-27)** — the structural template the Phase 6 edits sit inside:

```caddy
{$CADDY_DOMAIN:localhost} {
    tls {$CADDY_TLS_MODE:internal}

    encode zstd gzip

    handle /api/* {
        reverse_proxy api:8000
    }

    handle /health {
        reverse_proxy api:8000
    }

    handle /docs* {
        reverse_proxy api:8000
    }

    handle /openapi.json {
        reverse_proxy api:8000
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

**Env-var interpolation pattern to copy (line 1, line 2):**
- `{$VAR_NAME:default}` — Caddy reads env var, falls through to `default` if unset/empty.
- `{$VAR_NAME}` — Caddy reads env var, expands to empty if unset (this is what `acme_ca {$CADDY_ACME_CA}` exploits: empty → Caddy default = LE prod).

**Phase 6 deltas (per RESEARCH Example 1, lines 532-567 of 06-RESEARCH.md):**

1. **Prepend a global block** (above the site block) for `acme_ca`:
   ```caddy
   {
       acme_ca {$CADDY_ACME_CA}
   }
   ```
   Insert **before** line 1 of the existing file. Two blank lines below for readability.

2. **Add HSTS header** inside the site block, between `tls` and `encode` (i.e., between current lines 2 and 4):
   ```caddy
       header Strict-Transport-Security "max-age=31536000; includeSubDomains"
   ```
   Indentation: 4 spaces, matching every other directive in the site block. No `; preload` (D-19, RESEARCH Pitfall 7).

**Structural rule:** Do NOT reorder or modify any of the existing `handle` blocks, `encode`, `tls`, or the domain placeholder. Phase 6 is **additive** to this file (2 directives added, 0 removed, 0 reordered).

**No CI / config-test for this file in the repo** — Caddy's own `caddy validate /etc/caddy/Caddyfile` is the only check, and it's invoked transitively by `docker compose up` (Caddy refuses to start on syntax error).

---

### `infra/.env.example` (config, env-var schema, modified)

**Analog:** `infra/.env.example` (the file itself; Phase 4 D-16 defined the schema)
**Path:** `/home/ubwzwd/Code/wallet_app/infra/.env.example`

**Current full file (lines 1-37)** — the existing structure Phase 6 extends:

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
...
# CORS allowlist (defense-in-depth; same-origin Caddy makes browser CORS moot but FastAPI still enforces)
ALLOWED_ORIGINS=https://localhost
...
# Caddy (Phase 4 laptop default: tls internal self-signed at https://localhost; Phase 6 narrows to real domain + ACME)
CADDY_DOMAIN=localhost
CADDY_TLS_MODE=internal
```

**Section-comment pattern to copy (lines 11, 19, 27, 34):**
Each logical group has a `# Section name (one-sentence rationale)` comment immediately above its variables. New variables follow this convention.

**`CHANGE_ME_*` sentinel pattern (lines 12-14, 20, 25):**
Values that the operator MUST replace use `CHANGE_ME_<HINT>` so a forgotten substitution fails loudly downstream (the `migrate` service will choke on `POSTGRES_USER=CHANGE_ME_POSTGRES_USER`, etc.). New "operator-must-fill" values follow the same pattern.

**In-line documented override pattern (lines 34-36):**
For values that have a sensible Phase 4 dev default but require a Phase 6 prod override, the file uses a multi-line comment immediately above explaining the swap. Phase 6's `CADDY_ACME_CA` and `ALLOWED_ORIGINS` documentation follows this style.

**Phase 6 deltas (per RESEARCH Example 2, lines 569-604 of 06-RESEARCH.md, and D-05/D-20):**

1. **Narrow `ALLOWED_ORIGINS`** — change the default value on the example from `https://localhost` to a `CHANGE_ME_*` form (because operators copying `.env.example → .env` for the VM must override it):
   ```bash
   # CORS — narrow from https://localhost to real prod domain on the VM (DOMAIN-04, defense-in-depth)
   ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN
   ```

2. **Document `CADDY_DOMAIN` / `CADDY_TLS_MODE` swap** — keep the laptop defaults present but add comments showing the VM override:
   ```bash
   # Caddy (laptop default: tls internal self-signed; VM swaps CADDY_DOMAIN to real domain, comments out CADDY_TLS_MODE)
   CADDY_DOMAIN=localhost
   CADDY_TLS_MODE=internal
   ```
   (RESEARCH Example 2 swaps `CADDY_DOMAIN` to a `CHANGE_ME_*` sentinel; planner decides whether the example file keeps the laptop default with a comment, or switches to the sentinel and forces operators to override on both laptop and VM — the latter is more consistent with the `CHANGE_ME_*` pattern but requires an extra step for Phase 4-style laptop bring-up. **Recommendation:** keep `CADDY_DOMAIN=localhost` as the default and document the VM override in the comment, since changing it would break Phase 4's smoke test.)

3. **Add new `CADDY_ACME_CA` variable** with documented prod/staging values:
   ```bash
   # Caddy ACME endpoint (Phase 6 NEW).
   #   - On laptop: leave UNSET — Caddy uses tls internal (no ACME).
   #   - On VM, first bring-up: set to staging URL below (D-05 staging-first pattern).
   #   - On VM, after staging cert verified: set empty (CADDY_ACME_CA=) — Caddy default = LE prod.
   # Staging: https://acme-staging-v02.api.letsencrypt.org/directory
   CADDY_ACME_CA=
   ```

**Downstream consumer to update:** `infra/scripts/env-coverage.sh` lines 17-20 extract Settings field names from `backend/app/core/config.py`. **`CADDY_ACME_CA` is read by Caddy directly (env var interpolation), not by FastAPI Settings**, so `env-coverage.sh` will not enforce its presence — no edit to `env-coverage.sh` needed. **But:** `infra/scripts/smoke.sh` line 41 hard-codes the list of `CHANGE_ME` keys to grep for; if `CADDY_ACME_CA` is added as a CHANGE_ME sentinel (it shouldn't be — it has an empty default per RESEARCH Pattern 1), this list would need updating. Recommended: leave smoke.sh untouched (Phase 4 verifier; Phase 6 verifier is the new `verify-phase6.sh`).

---

### `infra/scripts/verify-phase6.sh` (script, one-shot verifier, created)

**Analog:** `infra/scripts/smoke.sh`
**Path:** `/home/ubwzwd/Code/wallet_app/infra/scripts/smoke.sh`

**File-header pattern (lines 1-10 of smoke.sh):**

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
```

**Phase 6 verifier should copy:** shebang, header comment block (purpose + modes + exit semantics), `set -euo pipefail`.

**Argument-parsing pattern (line 13):**

```bash
MODE="${1:-full}"
```

Single positional arg with a default; new verifier picks its own modes (e.g., `local | vm` — local checks Caddyfile syntax + .env schema; vm checks DNS + TLS + HSTS + nmap).

**Repo-root resolution pattern (line 15):**

```bash
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
```

Use this verbatim — it lets the script run from any cwd.

**Stdout `==>` cadence pattern (every step in smoke.sh):**

```bash
echo "==> precondition: .env exists (operator must run cp infra/.env.example infra/.env first)"
test -f "$ENV_FILE" || { echo "FAIL: $ENV_FILE missing — run 'cp $ENV_EXAMPLE $ENV_FILE' and fill in real values"; exit 1; }
```

Each check is one line that emits `==> <step description>` to stdout (entry), then either silently passes (exit 0 propagates) or emits `FAIL: <reason>` and exits 1. **Inline-` || { echo FAIL...; exit 1; }`** is the standard pattern.

**Trap-teardown pattern (lines 24-28) — only if the verifier starts services:**

```bash
teardown() {
  echo "==> teardown"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap teardown EXIT
```

**WARNING — Phase 6 anti-pattern conflict:** `down -v` deletes the `caddy_data` volume, which is **forbidden on the VM** (RESEARCH Pitfall 8). The Phase 6 verifier (if run on the VM) MUST NOT include `down -v` in its teardown. If `verify-phase6.sh` runs only assertions against an already-running stack (no compose up/down), no teardown needed. Recommended: Phase 6 verifier is **assertion-only** (no compose start/stop) and assumes the operator has the stack up.

**Concrete check patterns to copy from smoke.sh:**

- HTTP probe with grep (lines 105-112):
  ```bash
  echo "==> caddy: https://localhost returns HTTP/2 200 (tls internal / row 04-04-02)"
  curl -sIk https://localhost | grep -qi '^HTTP/2 200' || { echo "FAIL: https://localhost did not return 200"; exit 1; }
  ```

  Phase 6 analog: `curl -sI https://<your-domain> | grep -qi '^HTTP/2 200'` (no `-k` — real cert is trusted).

- HSTS header check (new for Phase 6, follow same idiom):
  ```bash
  echo "==> caddy: HSTS header present (DOMAIN-03 / D-19)"
  curl -sI https://"$DOMAIN" | grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' || { echo "FAIL: HSTS header missing or wrong value"; exit 1; }
  ```

- `dig` propagation check (RESEARCH Example 5 already in research):
  ```bash
  echo "==> dns: $DOMAIN -> $EXPECTED_IP via 1.1.1.1"
  [ "$(dig @1.1.1.1 "$DOMAIN" +short | head -1)" = "$EXPECTED_IP" ] || { echo "FAIL: DNS does not resolve to $EXPECTED_IP"; exit 1; }
  ```

- nmap port-scan check (D-15):
  ```bash
  echo "==> nmap: only 23333/80/443 reachable on $VM_IP"
  scan=$(nmap -Pn -p 22,23333,80,443 "$VM_IP" -oG -)
  echo "$scan" | grep -qE '22/closed|22/filtered'      || { echo "FAIL: port 22 unexpectedly open"; exit 1; }
  echo "$scan" | grep -qE '23333/open'                  || { echo "FAIL: port 23333 not open"; exit 1; }
  echo "$scan" | grep -qE '80/open'                     || { echo "FAIL: port 80 not open"; exit 1; }
  echo "$scan" | grep -qE '443/open'                    || { echo "FAIL: port 443 not open"; exit 1; }
  ```

**End-of-script success marker (line 114 of smoke.sh):**

```bash
echo "OK: Phase 4 smoke green"
```

Phase 6 analog: `echo "OK: Phase 6 verify green"`.

**Permissions:** smoke.sh and env-coverage.sh are both `chmod 755` (`-rwxr-xr-x` per `ls -la`). New script must be made executable.

---

### `infra/runbook-evidence/.gitkeep` (placeholder, created)

**Analog:** Convention is ubiquitous; no first-party `.gitkeep` files exist in this repo outside `node_modules/` (which is gitignored). Roll-your-own:

**Content:** zero-byte file (`touch infra/runbook-evidence/.gitkeep`).

**Purpose:** Git does not track empty directories; `.gitkeep` is the convention to force tracking. The `uptime-alert.png` evidence file (D-22) lives in this directory; if the planner chooses to **gitignore** `*.png` (vs LFS), the `.gitkeep` ensures the directory still exists in the repo tree.

**No analog excerpt needed** — single empty file.

---

### `.gitignore` (config, maybe-modified)

**Analog:** `.gitignore` (the file itself)
**Path:** `/home/ubwzwd/Code/wallet_app/.gitignore`

**Current full file (16 non-empty lines):**

```gitignore
# Editor and IDE
.cursor/
.vscode/
.idea/
.claude/

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local

# Phase 4 infra
infra/.env

# Frontend web build artifacts
frontend/dist/

# Design package zips — extracted contents live in .planning/research/
wallet-ui-design.zip
```

**Section-comment pattern:** Each block of related entries has a `# Section name` header above it. Phase 6 addition (if planner picks gitignore over LFS for evidence images) follows the same shape:

```gitignore
# Phase 6 runbook evidence (UptimeRobot screenshots — keep dir, ignore PNGs)
infra/runbook-evidence/*.png
!infra/runbook-evidence/.gitkeep
```

The negation `!.gitkeep` ensures the directory tracker stays committed even though `*.png` is ignored.

**Planner decision (D-22, CONTEXT "Claude's Discretion"):** gitignore vs LFS. For a single ~100-300 KB PNG, **gitignore is the lighter touch** (LFS adds repo configuration and a server-side LFS quota dependency). Recommendation: gitignore.

---

## Shared Patterns

### Pattern A: Env-var-driven config (Phase 4 carry-forward)

**Source:** `infra/Caddyfile` (lines 1-2), `infra/docker-compose.prod.yml` (lines 11-14, 65-67), `infra/.env.example` (entire file)

**Apply to:** Caddyfile new directives (`acme_ca`), `.env.example` new vars, runbook env-authoring step.

**Principle (Phase 4 D-10, Phase 6 D-20):** Every environment-specific value is in `.env`; never hard-coded. Caddy's `{$VAR:default}` syntax reads env vars at container start, with a literal default for `:` form. Compose `env_file: ./.env` injects vars into all services.

**Excerpt — compose service reading env_file (docker-compose.prod.yml lines 10-14):**
```yaml
  db:
    image: postgres:15-alpine
    container_name: wallet_db_prod
    restart: unless-stopped
    env_file: ./.env
```

**Excerpt — Caddy service explicit env passthrough (docker-compose.prod.yml lines 64-67):**
```yaml
    environment:
      CADDY_DOMAIN: ${CADDY_DOMAIN:-localhost}
      CADDY_TLS_MODE: ${CADDY_TLS_MODE:-internal}
```

**Phase 6 implication:** Caddy service must also receive `CADDY_ACME_CA` — add it to the `environment:` block of the `caddy` service in `docker-compose.prod.yml`. **BUT:** docker-compose.prod.yml is listed as UNCHANGED in CONTEXT canonical_refs and RESEARCH §"Recommended File Structure". The cleaner alternative is to add the var to the `env_file`-loaded set (already happens via `env_file: ./.env` — but the Caddy service uses *both* `env_file` AND an explicit `environment:` block; explicit block overrides env_file for the listed keys but doesn't shadow other env_file keys). **Recommendation:** Add `CADDY_ACME_CA: ${CADDY_ACME_CA:-}` to the explicit `environment:` block to make the var visible+documented in compose (small one-line edit; planner decides whether to scope this in Phase 6 or treat docker-compose.prod.yml as truly UNCHANGED and rely on env_file alone — env_file injection should work either way per Docker Compose semantics).

### Pattern B: Procedural ordering enforcement (D-04 DNS-before-Caddy)

**Source (compose layer, Phase 4 D-13):** `infra/docker-compose.prod.yml` lines 51-53:
```yaml
    depends_on:
      migrate:
        condition: service_completed_successfully
```
Compose-encoded ordering: API only starts after `migrate` exits 0.

**Source (script layer, Phase 4):** `infra/scripts/smoke.sh` lines 31-46 — preconditions block:
```bash
echo "==> precondition: .env exists (operator must run cp infra/.env.example infra/.env first)"
test -f "$ENV_FILE" || { echo "FAIL: $ENV_FILE missing ..."; exit 1; }

echo "==> precondition: .env is gitignored (SEC-01 / row 04-06-01)"
git check-ignore -q "$ENV_FILE" || { echo "FAIL: $ENV_FILE is not gitignored"; exit 1; }
```

**Apply to:** Runbook DNS-propagation gate (RESEARCH Example 5) and verifier `dig` check.

**Phase 6 analog (markdown-encoded, since runbook is the orchestration layer):** A "Prerequisites" section at the top of each major runbook step that lists checks the operator must observe before proceeding. The runbook's "Before first `docker compose up`" gate restates D-04 verbatim.

### Pattern C: `==> step` / `FAIL: reason` cadence (verifier output convention)

**Source:** `infra/scripts/smoke.sh` (throughout), also `frontend/scripts/verify-pwa.mjs` lines 70-77:
```javascript
function fail(msg) {
  process.stderr.write('FAIL: ' + msg + '\n');
  process.exit(1);
}

function step(name) {
  process.stdout.write('==> ' + name + '\n');
}
```

**Apply to:** `infra/scripts/verify-phase6.sh` — match the exact prefix strings (`==> `, `FAIL: `). Downstream agents (and the verification doc) grep for these literals.

### Pattern D: `infra/` is the home for deployment artifacts (Phase 4 D-01)

**Source:** `.planning/codebase/STRUCTURE.md` (referenced; not re-read here), Phase 4 D-01.

**Apply to:** `infra/RUNBOOK.md` (sits at `infra/RUNBOOK.md`, NOT at repo root, NOT under `docs/` — neither exists). `infra/runbook-evidence/` (sits as a sibling of `infra/scripts/`, NOT under `docs/evidence/` or similar). `infra/scripts/verify-phase6.sh` (sits alongside `smoke.sh` and `env-coverage.sh`).

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md §"Quick-Reference Runbook Outline" / RESEARCH Pattern 1-8 instead):

| File | Role | Data Flow | Reason | Source of truth |
|------|------|-----------|--------|-----------------|
| `infra/RUNBOOK.md` | docs (operator playbook, copy-paste blocks) | human read-only | No existing operator-runbook precedent in the repo. The closest documents (`README.md`, `backend/README.md`, `.planning/codebase/STACK.md`) are **descriptive** (this is what the project IS), not **procedural** (do this, then this, then this). RUNBOOK.md is the latter. | RESEARCH.md §"Pattern 1-8" + §"Common Pitfalls" 1-9 (each Pitfall maps to a runbook callout); RESEARCH.md §"Recommended File Structure" lists exact deltas. |

**Proposed structural template for RUNBOOK.md** (based on RESEARCH §"Recommended File Structure" lines 165-178, D-16, and the linear story implied by D-01 through D-22):

```markdown
# infra/RUNBOOK.md — Provision a fresh wallet-app production VM

**Audience:** the operator (you, future-you, or a teammate).
**Estimated time:** ~60 min (clean re-provision; domain already owned, ssh key already exists).
**Outcome:** `https://<your-domain>` serves the app with a real LE cert; UptimeRobot monitor green.

## 0. Prerequisites checklist
- [ ] Oracle Cloud account, Always Free eligible (D-06)
- [ ] Local laptop has `ssh`, `dig`, `curl`, `nmap`, `git`, `docker`, `docker compose` v2
- [ ] No domain owned yet → §1; have one → skip to §2

## 1. Register the domain (Cloudflare Registrar) — D-01
   [copy-paste block: dash UI steps, no shell]

## 2. Provision the Oracle Cloud VM — D-06, D-07, D-08
   [Console click-through; OOC retry tactic per RESEARCH Pattern 8]

## 3. First SSH (port 22, default ubuntu user) — D-09
   [ssh-keygen, paste pubkey in console, ssh ubuntu@<ip>]

## 4. Harden SSH (port 23333, key-only) — D-09, D-11
   [Pattern 3 from RESEARCH: sshd_config.d drop-in + ssh.socket.d override]
   [⚠ SECOND-SESSION VERIFY before closing the first]

## 5. Create deploy user + ufw + unattended-upgrades — D-10, D-13, D-14
   [Patterns 5-6 from RESEARCH]

## 6. Install Docker + Compose v2 — Pattern 4 from RESEARCH

## 7. Add Cloudflare DNS A record (grey cloud) — D-02, D-03
   [Pattern 7 from RESEARCH]

## 8. Wait for DNS propagation — D-04 HARD PREREQUISITE
   [Example 5 from RESEARCH — the dig loop]

## 9. Clone repo + author .env (staging LE endpoint) — D-05, D-20
   [chmod 600, regenerate SECRET_KEY, set CADDY_ACME_CA=staging URL, set ALLOWED_ORIGINS]

## 10. First `docker compose up` → verify staging cert — D-05
    [docker compose -f infra/docker-compose.prod.yml up -d --wait]
    [docker compose logs caddy | grep "STAGING"]
    [browser test in INCOGNITO — RESEARCH Pitfall 7]

## 11. Flip to LE production — D-05 (TWO-COMMIT pattern)
    [Example 6 from RESEARCH: sed CADDY_ACME_CA= empty + docker compose restart caddy]
    [Verify cert issuer is Let's Encrypt R3 or similar prod issuer]

## 12. Verify /health DB-independence — D-18 / OPS-01
    [docker compose stop db, curl /health, docker compose start db]

## 13. External port scan from laptop — D-15
    [nmap -Pn -p 1-65535 <ip>; expect only 23333,80,443]

## 14. UptimeRobot signup + monitor — D-21

## 15. Deliberate downtime drill — D-22 / SC5
    [docker compose stop caddy; wait 5 min; screenshot alert email → infra/runbook-evidence/uptime-alert.png; docker compose start caddy]

## 16. Final verification script
    bash infra/scripts/verify-phase6.sh

## Appendix A: SSH config snippet (`~/.ssh/config`) — D-09
## Appendix B: Oracle A1.Flex Out-of-Capacity retry tactic — RESEARCH Pattern 8
## Appendix C: Common operational commands (logs, restart, env edit)
## Appendix D: Recovery — Oracle serial console (lockout fallback)
```

**Tone guidance** (from existing first-party markdown — `README.md` and `backend/README.md` use numbered steps with `### N. Step name` headings and code-fenced ` ```bash ` blocks; RUNBOOK.md should match this convention for visual continuity).

---

## Metadata

**Analog search scope:**
- `/home/ubwzwd/Code/wallet_app/infra/**`
- `/home/ubwzwd/Code/wallet_app/infra/scripts/**`
- `/home/ubwzwd/Code/wallet_app/frontend/scripts/**`
- `/home/ubwzwd/Code/wallet_app/*.md`, `/home/ubwzwd/Code/wallet_app/backend/README.md`
- `/home/ubwzwd/Code/wallet_app/.gitignore`
- `/home/ubwzwd/Code/wallet_app/.planning/codebase/STACK.md`

**Files scanned:** 9 (Caddyfile, .env.example, docker-compose.prod.yml, smoke.sh, env-coverage.sh, verify-pwa.mjs, .gitignore, README.md, backend/README.md, STACK.md)

**Pattern extraction date:** 2026-05-25
