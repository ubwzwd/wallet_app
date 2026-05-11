---
phase: 04-containerize-and-compose-locally
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/docker-compose.yml
  - infra/docker-compose.dev.yml
  - backend/README.md
  - .gitignore
autonomous: true
requirements:
  - DEPLOY-01
tags:
  - docker-compose
  - repo-layout
must_haves:
  truths:
    - "Dev (db-only) compose lives at infra/docker-compose.dev.yml; backend/docker-compose.yml no longer exists"
    - "Both compose files (dev + prod) share the infra/ directory (D-01, D-02)"
    - "backend/README.md and any other doc references point at the new path"
    - ".gitignore protects infra/.env and frontend/dist/"
  artifacts:
    - path: "infra/docker-compose.dev.yml"
      provides: "Local dev Postgres container (preserved volume `postgres_data`)"
      contains: "image: postgres:15-alpine"
    - path: ".gitignore"
      provides: "Phase 4 infra hygiene"
      contains: "infra/.env"
  key_links:
    - from: "infra/docker-compose.dev.yml"
      to: "named volume postgres_data"
      via: "volumes: section"
      pattern: "postgres_data:"
    - from: "backend/README.md"
      to: "infra/docker-compose.dev.yml"
      via: "documented command paths"
      pattern: "infra/docker-compose.dev.yml"
---

<objective>
Relocate the existing db-only dev compose from `backend/docker-compose.yml` to `infra/docker-compose.dev.yml` (per D-02), update documentation references, and append Phase 4 entries to `.gitignore` (`infra/.env`, `frontend/dist/`). Drops the obsolete `version:` line.

Purpose: Establish the `infra/` repo layout (D-01) so the prod compose plan can land alongside the dev compose without confusion. Pure refactor — no behavioural change for the dev workflow.
Output: Moved compose file, README updates, .gitignore additions.
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
@backend/docker-compose.yml
@backend/README.md
@.gitignore
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move backend/docker-compose.yml -> infra/docker-compose.dev.yml + cleanup</name>
  <files>backend/docker-compose.yml, infra/docker-compose.dev.yml</files>
  <read_first>
    - backend/docker-compose.yml (full file — preserves volume name `postgres_data`)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 170-178: dev compose move pattern)
    - .planning/phases/04-containerize-and-compose-locally/04-CONTEXT.md (D-02 verbatim)
  </read_first>
  <action>
    Use `git mv backend/docker-compose.yml infra/docker-compose.dev.yml` (create `infra/` directory if missing — `mkdir -p infra` first).

    Then edit `infra/docker-compose.dev.yml`:
    - Drop the top-level `version: '3.8'` line (Compose v2 ignores it; emits warning if present).
    - Keep volume name `postgres_data` (NOT renamed — preserves existing dev DB state).
    - Keep service block `db` exactly as-is (`image: postgres:15-alpine`, literal `wallet_user`/`wallet_password`/`wallet_db`, `ports: 5432:5432`, `pg_isready` healthcheck).
    - Update inline comment on the commented `# api:` block (if present) to point at `infra/docker-compose.prod.yml` for the real prod-shape API service.

    Do NOT introduce env_file or rename volumes. This is a verbatim relocate with `version:` strip only.
  </action>
  <verify>
    <automated>test ! -f backend/docker-compose.yml && test -f infra/docker-compose.dev.yml && docker compose -f infra/docker-compose.dev.yml config -q</automated>
  </verify>
  <acceptance_criteria>
    - `test ! -f backend/docker-compose.yml` exits 0
    - `test -f infra/docker-compose.dev.yml` exits 0
    - `grep -c '^version:' infra/docker-compose.dev.yml` returns 0
    - `grep -c 'image: postgres:15-alpine' infra/docker-compose.dev.yml` returns 1
    - `grep -c 'postgres_data:' infra/docker-compose.dev.yml` returns 1
    - `docker compose -f infra/docker-compose.dev.yml config -q` exits 0
    - `git log --diff-filter=R --summary -- infra/docker-compose.dev.yml | grep -q 'rename backend/docker-compose.yml'` (rename detected by git, preserving history)
  </acceptance_criteria>
  <done>Dev compose is in `infra/`; `docker compose -f infra/docker-compose.dev.yml config` lints clean.</done>
</task>

<task type="auto">
  <name>Task 2: Update backend/README.md doc references + append .gitignore entries</name>
  <files>backend/README.md, .gitignore</files>
  <read_first>
    - backend/README.md (lines 1-200 — search for `docker-compose`, `docker compose`, `Dockerfile`)
    - .gitignore (full file — see current entries)
    - .planning/phases/04-containerize-and-compose-locally/04-PATTERNS.md (lines 466-475: README sections to update; lines 480-509: .gitignore append)
  </read_first>
  <action>
    Edit `backend/README.md`:
    - Change any command referencing `docker-compose up -d db` or `docker compose up -d db` invoked from `backend/` to `docker compose -f ../infra/docker-compose.dev.yml up -d db`.
    - Update the "Project Structure" code block (around line 119): remove `docker-compose.yml` and `Dockerfile` entries from the tree; add a line `(see ../infra/ for Docker / compose files)`.
    - Update the "Docker Development" section (around lines 134-141) to point at `../infra/docker-compose.prod.yml` for the prod-shape stack (note: that file lands in Plan 03; this is the canonical path).
    - Update the Troubleshooting section (around lines 192-198) `docker-compose ps` / `docker compose down -v` commands to include `-f ../infra/docker-compose.dev.yml`.

    Run `grep -rn "backend/docker-compose.yml\|cd backend && docker compose" .` during the edit pass and update every hit (other than this plan and the SUMMARY for it).

    Edit `.gitignore` — append at the end:

    ```
    # Phase 4 infra
    infra/.env

    # Frontend web build artifacts
    frontend/dist/
    ```

    `.env` is already globally ignored (`.env` line near top), which transitively covers `infra/.env`. The explicit line documents intent and survives `git check-ignore` smoke tests.
  </action>
  <verify>
    <automated>grep -c '^infra/.env$' .gitignore | grep -q '^1$' && grep -c '^frontend/dist/$' .gitignore | grep -q '^1$' && git check-ignore -q infra/.env || touch infra/.env && git check-ignore -q infra/.env</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '^infra/.env$' .gitignore` returns 1
    - `grep -c '^frontend/dist/$' .gitignore` returns 1
    - `touch infra/.env && git check-ignore -q infra/.env` exits 0 (then `rm infra/.env` cleanup)
    - `grep -c 'backend/docker-compose.yml' backend/README.md` returns 0
    - `grep -c 'infra/docker-compose.dev.yml' backend/README.md` returns at least 1
    - `grep -rn 'cd backend && docker compose' . 2>/dev/null | grep -v '.planning\|node_modules' | wc -l` returns 0
  </acceptance_criteria>
  <done>All doc references point at `infra/`; gitignore protects infra secrets + frontend dist.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo working tree -> git history | `infra/.env` must never enter version control |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-06 | Information Disclosure | Future contributor commits `infra/.env` containing real secrets | mitigate | Explicit `infra/.env` line in `.gitignore` (in addition to the global `.env`); acceptance test `git check-ignore -q infra/.env` exits 0. |
| T-04-07 | Tampering | Stale doc paths cause future operator to run dev compose from `backend/` (file no longer there) and accidentally `docker compose up` against the prod compose by mistake | mitigate | README updated to canonical `infra/docker-compose.dev.yml`; acceptance test `grep -c backend/docker-compose.yml backend/README.md == 0`. |
</threat_model>

<verification>
- `docker compose -f infra/docker-compose.dev.yml config -q` exits 0.
- `.gitignore` blocks `infra/.env` and `frontend/dist/`.
- `backend/README.md` references `infra/docker-compose.dev.yml` (not the moved path).
- `git mv` preserves history of the compose file.
</verification>

<success_criteria>
- Dev compose lives under `infra/`.
- Docs and gitignore reflect the new layout.
- No behavioural regression for the existing dev workflow.
</success_criteria>

<output>
After completion, create `.planning/phases/04-containerize-and-compose-locally/04-02-SUMMARY.md`.
</output>
