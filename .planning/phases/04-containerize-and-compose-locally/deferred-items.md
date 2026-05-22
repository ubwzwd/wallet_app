# Phase 4 Deferred Items

Out-of-scope discoveries encountered during plan execution — not fixed in-plan; logged here for future cleanup.

## From 04-02-relocate-dev-compose

- **SPEC.md (repo root) references `backend/docker-compose.yml` and lacks an `infra/` tree entry.**
  - File has ~850 lines of pre-existing uncommitted edits unrelated to this plan, so a targeted update would entangle this commit with prior-phase drift.
  - Action when ready: in a future phase or doc-sweep, sync SPEC.md §2.2 (Repository Structure) to show `infra/` and rename the backend `docker-compose.yml` line. Also update §2.1 "Container" line.
  - Not blocking — SPEC.md is a living spec, not run by tooling.

- **Top-level `README.md` markdownlint warnings (MD036, MD032, MD022, MD031, MD012).**
  - Pre-existing on lines 11-82, 114-128. My edit only touched lines 94-101 and did not introduce new warnings.
  - Action when ready: doc-sweep to add blank lines around headings/lists/fences.
