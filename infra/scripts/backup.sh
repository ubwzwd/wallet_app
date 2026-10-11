#!/usr/bin/env bash
# infra/scripts/backup.sh -- logical Postgres backup of the wallet database (run on the VM).
#
# Cron (installed by deploy.sh):  0 19 * * * <repo>/infra/scripts/backup.sh >> <repo>/backups/backup.log 2>&1
# Manual:                          bash infra/scripts/backup.sh
#
# Writes <backup dir>/wallet-<UTC timestamp>.dump (pg_dump custom format), atomically: the dump
# goes to a hidden .part file first and is renamed only after it was written and verified.
# Keeps the newest ${WALLET_BACKUP_KEEP:-14} dumps.
#
# Env (same contract as deploy.sh / restore.sh):
#   WALLET_REMOTE_DIR       repo dir                         (default /opt/wallet_app)
#   WALLET_COMPOSE_PROJECT  compose project name             (default wallet)
#   WALLET_ENV_FILE         env file                         (default $REPO/infra/.env)
#   WALLET_BACKUP_DIR       where dumps go                   (default $REPO/backups)
#   WALLET_BACKUP_KEEP      number of dumps to keep          (default 14)

set -euo pipefail

PROJECT="${WALLET_COMPOSE_PROJECT:-wallet}"
REPO="${WALLET_REMOTE_DIR:-/opt/wallet_app}"
ENV_FILE="${WALLET_ENV_FILE:-$REPO/infra/.env}"
BACKUP_DIR="${WALLET_BACKUP_DIR:-$REPO/backups}"
KEEP="${WALLET_BACKUP_KEEP:-14}"

usage() {
  cat <<USAGE
Usage: bash infra/scripts/backup.sh [--help]

Dumps the Postgres database of compose project '${PROJECT}' to
${BACKUP_DIR}/wallet-<UTC timestamp>.dump and keeps the newest ${KEEP}.
Restore with: bash infra/scripts/restore.sh <dump>

Env: WALLET_REMOTE_DIR, WALLET_COMPOSE_PROJECT, WALLET_ENV_FILE, WALLET_BACKUP_DIR, WALLET_BACKUP_KEEP
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
esac

err() { echo "backup.sh: ERROR: $*" >&2; }

[ -f "$ENV_FILE" ] || { err "env file not found: $ENV_FILE"; exit 1; }
case "$KEEP" in ''|*[!0-9]*) err "WALLET_BACKUP_KEEP must be a positive integer, got '$KEEP'"; exit 1 ;; esac
[ "$KEEP" -ge 1 ] || { err "WALLET_BACKUP_KEEP must be >= 1"; exit 1; }

# Read KEY from the env file without sourcing it (values may contain $, spaces, quotes...).
env_get() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  # Strip one pair of surrounding quotes, as docker compose would.
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

PGUSER_NAME="$(env_get POSTGRES_USER)"
PGDB_NAME="$(env_get POSTGRES_DB)"
[ -n "$PGUSER_NAME" ] || { err "POSTGRES_USER is not set in $ENV_FILE"; exit 1; }
[ -n "$PGDB_NAME" ]   || { err "POSTGRES_DB is not set in $ENV_FILE"; exit 1; }

compose() {
  WALLET_ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$REPO/infra/docker-compose.prod.yml" "$@"
}

umask 077   # dumps contain every user's financial data
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PART="$BACKUP_DIR/.wallet-$STAMP.dump.part"
FINAL="$BACKUP_DIR/wallet-$STAMP.dump"
trap 'rm -f "$PART"' EXIT

echo "backup.sh: dumping '$PGDB_NAME' (project $PROJECT) ..."
if ! compose exec -T db pg_dump -U "$PGUSER_NAME" -Fc "$PGDB_NAME" > "$PART"; then
  err "pg_dump failed (is the '$PROJECT' stack up? try: docker compose -p $PROJECT ps)"
  exit 1
fi
[ -s "$PART" ] || { err "pg_dump produced an empty file"; exit 1; }

# Sanity check: the archive's table of contents must be readable.
if ! compose exec -T db pg_restore -l < "$PART" >/dev/null; then
  err "the dump failed verification (pg_restore -l); it was discarded"
  exit 1
fi

mv "$PART" "$FINAL"
echo "backup.sh: wrote $FINAL ($(du -h "$FINAL" | cut -f1))"

# Retention: timestamps sort lexicographically, so the glob is oldest-first.
shopt -s nullglob
dumps=("$BACKUP_DIR"/wallet-*.dump)
excess=$(( ${#dumps[@]} - KEEP ))
if [ "$excess" -gt 0 ]; then
  for old in "${dumps[@]:0:excess}"; do
    rm -f -- "$old"
    echo "backup.sh: removed old backup $old"
  done
fi
echo "backup.sh: done (${#dumps[@]} dump(s) before pruning, keeping $KEEP)"
