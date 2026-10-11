#!/usr/bin/env bash
# infra/scripts/restore.sh -- restore a backup.sh dump into the running stack (run on the VM).
#
#     bash infra/scripts/restore.sh <dump> [--yes]
#
# Flow: confirm -> stop api -> safety dump of the current database -> drop and recreate the
# database -> pg_restore --exit-on-error -> start api -> wait for /health.
# The db and caddy containers keep running; only api is stopped, so nothing writes while the
# database is being replaced. Recreating the database (instead of pg_restore --clean) means
# the result is exactly the dump even when the live schema is newer than the dump, and any
# error aborts the restore instead of being "ignored".
#
# Before dropping anything, the current database is dumped to
# ${WALLET_BACKUP_DIR:-$REPO/backups}/pre-restore-<UTC timestamp>.dump, so a restore of the
# wrong file can be undone with the same script.
#
# The dump contains the alembic_version table, so right after pg_restore the schema is at the
# revision the dump was taken at. `compose start api` also starts api's dependencies, which
# includes the one-shot migrate service (`alembic upgrade head`), so a dump older than the code
# is upgraded automatically before the api comes back. A dump NEWER than the deployed code
# (a revision this code does not know) makes migrate fail; the api then stays stopped and the
# script says so: deploy the matching code first, or restore an older dump.
#
# Env (same contract as deploy.sh / backup.sh):
#   WALLET_REMOTE_DIR (default /opt/wallet_app), WALLET_COMPOSE_PROJECT (default wallet),
#   WALLET_ENV_FILE (default $REPO/infra/.env), WALLET_BACKUP_DIR (default $REPO/backups)

set -euo pipefail

PROJECT="${WALLET_COMPOSE_PROJECT:-wallet}"
REPO="${WALLET_REMOTE_DIR:-/opt/wallet_app}"
ENV_FILE="${WALLET_ENV_FILE:-$REPO/infra/.env}"
BACKUP_DIR="${WALLET_BACKUP_DIR:-$REPO/backups}"

usage() {
  cat <<USAGE
Usage: bash infra/scripts/restore.sh <dump> [--yes]

Replaces the contents of the wallet database (compose project '${PROJECT}') with the given
pg_dump custom-format file (see backup.sh). Stops api during the restore and starts it again.
A safety dump of the current database is written to ${BACKUP_DIR}/pre-restore-<UTC>.dump first.
  --yes   do not ask for confirmation (for scripts)

Env: WALLET_REMOTE_DIR, WALLET_COMPOSE_PROJECT, WALLET_ENV_FILE, WALLET_BACKUP_DIR
USAGE
}

err() { echo "restore.sh: ERROR: $*" >&2; }

DUMP=""
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    -*) err "unknown option: $1"; usage >&2; exit 1 ;;
    *)  [ -z "$DUMP" ] || { err "only one dump file may be given"; exit 1; }
        DUMP="$1" ;;
  esac
  shift
done

[ -n "$DUMP" ]    || { usage >&2; exit 1; }
[ -f "$DUMP" ]    || { err "dump file not found: $DUMP"; exit 1; }
[ -s "$DUMP" ]    || { err "dump file is empty: $DUMP"; exit 1; }
[ -f "$ENV_FILE" ] || { err "env file not found: $ENV_FILE"; exit 1; }

# Read KEY from the env file without sourcing it (values may contain $, spaces, quotes...).
env_get() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
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

# The db container must be up, and the dump must be a readable archive.
compose exec -T db true 2>/dev/null || { err "the db service of project '$PROJECT' is not running (start the stack first)"; exit 1; }
compose exec -T db pg_restore -l < "$DUMP" >/dev/null 2>&1 \
  || { err "$DUMP is not a valid pg_dump custom-format archive"; exit 1; }

if [ "$ASSUME_YES" -ne 1 ]; then
  echo "This will OVERWRITE the database '$PGDB_NAME' (project '$PROJECT') with:"
  echo "    $DUMP"
  echo "All data written since that backup is lost. The api is stopped during the restore."
  printf "Type 'yes' to continue: "
  read -r answer || answer=""
  [ "$answer" = "yes" ] || { echo "aborted"; exit 1; }
fi

echo "restore.sh: stopping api ..."
compose stop api

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# Safety net: dump what is there now, so this restore itself can be undone.
umask 077
mkdir -p "$BACKUP_DIR"
SAFETY="$BACKUP_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "restore.sh: saving the current database to $SAFETY ..."
if ! compose exec -T db pg_dump -U "$PGUSER_NAME" -Fc "$PGDB_NAME" > "$SAFETY"; then
  rm -f "$SAFETY"
  err "could not dump the current database; nothing was changed. The api was left STOPPED (start it with: docker compose -p $PROJECT start api)"
  exit 1
fi

# Drop and recreate, so the restore starts from an empty database. The api is stopped and
# migrate only runs when api starts, so FORCE only has to clear stray sessions (psql etc.).
echo "restore.sh: recreating database '$PGDB_NAME' ..."
if ! compose exec -T db psql -U "$PGUSER_NAME" -d postgres -v ON_ERROR_STOP=1 -q \
     -c "DROP DATABASE IF EXISTS \"$PGDB_NAME\" WITH (FORCE);" \
     -c "CREATE DATABASE \"$PGDB_NAME\" OWNER \"$PGUSER_NAME\";" >"$OUT" 2>&1; then
  cat "$OUT" >&2
  err "could not recreate the database. The api was left STOPPED; the pre-restore dump is $SAFETY"
  exit 1
fi

echo "restore.sh: restoring $DUMP into '$PGDB_NAME' ..."
if ! compose exec -T db pg_restore -U "$PGUSER_NAME" -d "$PGDB_NAME" --no-owner --exit-on-error < "$DUMP" >"$OUT" 2>&1; then
  cat "$OUT" >&2
  err "pg_restore failed; the database is INCOMPLETE and the api was left STOPPED."
  err "Restore the pre-restore dump to get back to where you were:  bash infra/scripts/restore.sh $SAFETY --yes"
  exit 1
fi

# The restored database must carry a migration revision, otherwise this is not a wallet dump.
if ! REV="$(compose exec -T db psql -U "$PGUSER_NAME" -d "$PGDB_NAME" -tA -c 'SELECT version_num FROM alembic_version' 2>"$OUT")"; then
  cat "$OUT" >&2
  err "alembic_version could not be read after the restore"
  err "the api was left STOPPED"
  exit 1
fi
echo "restore.sh: restored schema revision: ${REV:-<none>}"

echo "restore.sh: starting api (this re-runs the migrate service first) ..."
if ! compose start api; then
  compose logs --no-color --tail=30 migrate >&2 || true
  err "the api could not be started. If migrate failed above, the dump's revision (${REV:-<none>}) is not"
  err "known to the deployed code: deploy the code the dump was taken with, or restore an older dump."
  err "the api was left STOPPED"
  exit 1
fi

# Probe /health from inside the api container (nothing is published on the host).
healthy=0
for _ in $(seq 1 30); do
  if compose exec -T api python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  err "api did not become healthy within 60 s; check: docker compose -p $PROJECT logs --tail=100 api"
  exit 1
fi

NOW_REV="$(compose exec -T db psql -U "$PGUSER_NAME" -d "$PGDB_NAME" -tA -c 'SELECT version_num FROM alembic_version' 2>/dev/null | tr -d '\r' || true)"
echo "restore.sh: done (schema revision now: ${NOW_REV:-<unknown>})."
