#!/usr/bin/env bash
# infra/scripts/deploy.sh -- push the repo to the VM and (re)start the production stack.
#
# Run from the laptop (any cwd; the script locates the repo root itself):
#     bash infra/scripts/deploy.sh [--no-web] [--dry-run] [--bootstrap] [--help]
#
# Flow: preflight ssh -> (bootstrap VM) -> build frontend -> rsync backend/ skills/ infra/
# frontend/dist/ -> remote `docker compose up -d --build --wait` -> cron backup line ->
# public /health check.
#
# Safety: the VM's infra/.env is never overwritten (rsync --exclude=/.env also protects it
# from --delete). The VM never needs git or Node; the image is built natively on the VM.
#
# Exit codes: 0 ok, 1 generic failure, 2 ssh unreachable / docker missing on the VM,
#             3 infra/.env missing on the VM.

set -euo pipefail

HOST="${WALLET_SSH_HOST:-wallet-vm}"
REMOTE_DIR="${WALLET_REMOTE_DIR:-/opt/wallet_app}"
PROJECT="${WALLET_COMPOSE_PROJECT:-wallet}"

NO_WEB=0
DRY_RUN=0
BOOTSTRAP=0

usage() {
  cat <<USAGE
Usage: bash infra/scripts/deploy.sh [--no-web] [--dry-run] [--bootstrap] [--help]

  --no-web      do not rebuild the frontend; push the existing frontend/dist
  --dry-run     rsync with -n -v, print remote commands instead of running them
                (the read-only ssh preflight still runs)
  --bootstrap   run infra/scripts/vm-bootstrap.sh on the VM first (first deploy only)
  --help        show this help

Environment:
  WALLET_SSH_HOST         ssh alias or host of the VM        (default: wallet-vm)
  WALLET_REMOTE_DIR       repo directory on the VM           (default: /opt/wallet_app)
  WALLET_COMPOSE_PROJECT  compose project name               (default: wallet)

The VM needs ${REMOTE_DIR}/infra/.env before the stack can start; see infra/RUNBOOK.md.
USAGE
}

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { local code="$1"; shift; printf 'ERROR: %s\n' "$*" >&2; exit "$code"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-web)    NO_WEB=1 ;;
    --dry-run)   DRY_RUN=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    -h|--help)   usage; exit 0 ;;
    *) printf 'unknown argument: %s\n\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

# (a) repo root = this script's directory/../..
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

command -v rsync >/dev/null 2>&1 || die 1 "rsync is not installed on this machine"
command -v ssh   >/dev/null 2>&1 || die 1 "ssh is not installed on this machine"

# Quote-safe positional args for `ssh host bash -s -- ARGS` (ssh joins argv into one string
# that the remote shell parses again).
q() { printf '%q ' "$@"; }

# (b) preflight: ssh reachable (never prompts, fails within ~10 s)
log "checking ssh access to '${HOST}'"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true; then
  cat >&2 <<MSG
ERROR: cannot reach '${HOST}' over ssh (non-interactive, 10 s timeout).
  - Check the '${HOST}' entry in ~/.ssh/config (HostName = the VM's public IP, User ubuntu,
    IdentityFile ~/.ssh/wallet_app_oci), or set WALLET_SSH_HOST to a working alias.
  - Try it by hand:  ssh ${HOST}
  - Check the VM is running and the OCI Security List allows tcp 22.
MSG
  exit 2
fi

# (c) optional VM bootstrap
if [ "$BOOTSTRAP" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would run on ${HOST}: bash -s < infra/scripts/vm-bootstrap.sh"
  else
    log "bootstrapping the VM (infra/scripts/vm-bootstrap.sh)"
    ssh "$HOST" "bash -s -- $(q)" < infra/scripts/vm-bootstrap.sh
  fi
fi

# Docker must be usable (without sudo) by the login user. Skipped in a bootstrap dry-run,
# where the bootstrap did not actually happen.
if [ "$BOOTSTRAP" -eq 1 ] && [ "$DRY_RUN" -eq 1 ]; then
  log "[dry-run] skipping the remote docker check (bootstrap not executed)"
elif ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'docker compose version' >/dev/null 2>&1; then
  die 2 "'docker compose' is not usable on ${HOST}. On a fresh VM run: bash infra/scripts/deploy.sh --bootstrap
       (after a bootstrap, open a NEW ssh session so the docker group takes effect)."
fi

# (d) frontend build + dist assertions
if [ "$NO_WEB" -eq 0 ]; then
  log "building the web frontend (npm run build:web)"
  (cd frontend && npm run build:web)
  for f in index.html sw.js; do
    [ -f "frontend/dist/$f" ] || die 1 "frontend/dist/$f is missing after the build"
  done
else
  [ -d frontend/dist ] || die 1 "frontend/dist does not exist; build it first (cd frontend && npm run build:web) or drop --no-web"
  for f in index.html sw.js; do
    [ -f "frontend/dist/$f" ] || die 1 "frontend/dist/$f is missing; rebuild the frontend or drop --no-web"
  done
fi

# (e) rsync
RSYNC_OPTS=(-az --delete)
if [ "$DRY_RUN" -eq 1 ]; then
  RSYNC_OPTS+=(-n -v)
fi
COMMON_EXCLUDES=(--exclude='__pycache__/' --exclude='.pytest_cache/' --exclude='*.pyc'
                 --exclude='*.db' --exclude='tests/' --exclude='.venv/')

if [ "$DRY_RUN" -eq 1 ]; then
  if ! ssh -o BatchMode=yes "$HOST" "test -d $(q "$REMOTE_DIR")"; then
    log "[dry-run] ${HOST}:${REMOTE_DIR} does not exist yet (first deploy needs --bootstrap); nothing to compare against"
    log "[dry-run] done"
    exit 0
  fi
else
  log "creating ${REMOTE_DIR} layout on ${HOST}"
  ssh "$HOST" "mkdir -p $(q "$REMOTE_DIR/backend" "$REMOTE_DIR/skills" "$REMOTE_DIR/infra" "$REMOTE_DIR/frontend/dist" "$REMOTE_DIR/backups")"
fi

log "rsync backend/ skills/ infra/ frontend/dist/ -> ${HOST}:${REMOTE_DIR}"
# Anchored /.env* excludes keep a local backend/.env (secrets) off the VM.
rsync "${RSYNC_OPTS[@]}" "${COMMON_EXCLUDES[@]}" --exclude=/.env --exclude='/.env.*' \
  backend/ "$HOST:$REMOTE_DIR/backend/"
rsync "${RSYNC_OPTS[@]}" "${COMMON_EXCLUDES[@]}" \
  skills/ "$HOST:$REMOTE_DIR/skills/"
# infra/: --exclude=/.env keeps the VM's real .env out of both the transfer and --delete
# (rsync never deletes excluded files on the receiver); .env.example IS pushed.
rsync "${RSYNC_OPTS[@]}" "${COMMON_EXCLUDES[@]}" --exclude=/.env \
  infra/ "$HOST:$REMOTE_DIR/infra/"
rsync "${RSYNC_OPTS[@]}" \
  frontend/dist/ "$HOST:$REMOTE_DIR/frontend/dist/"
rsync "${RSYNC_OPTS[@]}" \
  .dockerignore "$HOST:$REMOTE_DIR/"

# (f) remote: .env check, compose up, prune, cron, chmod. Positional args: $1 = remote dir,
# $2 = compose project. The heredoc is quoted so nothing is expanded locally.
read -r -d '' REMOTE_SCRIPT <<'EOF' || true
set -euo pipefail
# Wrapped in main() with stdin from /dev/null so nothing can swallow the piped script.
main() {
REMOTE_DIR="$1"
PROJECT="$2"
ENV_FILE="$REMOTE_DIR/infra/.env"
cd "$REMOTE_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE on the VM" >&2
  exit 3
fi
chmod 600 "$ENV_FILE"
chmod +x infra/scripts/vm-bootstrap.sh infra/scripts/deploy.sh infra/scripts/backup.sh infra/scripts/restore.sh 2>/dev/null || true

compose() {
  WALLET_ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$REMOTE_DIR/infra/docker-compose.prod.yml" "$@"
}

echo "==> docker compose up -d --build --wait (project $PROJECT)"
if ! compose up -d --build --wait; then
  echo "ERROR: the stack did not become healthy" >&2
  compose ps >&2 || true
  compose logs --tail=100 >&2 || true
  exit 1
fi

docker image prune -f

# Daily backup at 19:00 UTC (= 03:00 Beijing time), added once.
mkdir -p "$REMOTE_DIR/backups"
CRON_LINE="0 19 * * * $REMOTE_DIR/infra/scripts/backup.sh >> $REMOTE_DIR/backups/backup.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
  if crontab -l 2>/dev/null | grep -qF backup.sh; then
    echo "==> backup cron entry already present"
  else
    { crontab -l 2>/dev/null || true; echo "$CRON_LINE"; } | crontab -
    echo "==> backup cron entry added: $CRON_LINE"
  fi
else
  echo "WARNING: crontab is not installed on the VM; automatic backups are NOT scheduled" >&2
fi

compose ps
}
main "$@" </dev/null
EOF

if [ "$DRY_RUN" -eq 1 ]; then
  log "[dry-run] would run on ${HOST} (args: ${REMOTE_DIR} ${PROJECT}):"
  printf '%s\n' "$REMOTE_SCRIPT" | sed 's/^/    | /'
  log "[dry-run] done"
  exit 0
fi

set +e
ssh "$HOST" "bash -s -- $(q "$REMOTE_DIR" "$PROJECT")" <<<"$REMOTE_SCRIPT"
rc=$?
set -e
if [ "$rc" -eq 3 ]; then
  cat >&2 <<MSG
ERROR: ${REMOTE_DIR}/infra/.env does not exist on ${HOST}. The files are synced; create the
env file once, then re-run this script:
    ssh ${HOST}
    cd ${REMOTE_DIR}/infra && cp .env.example .env && nano .env && chmod 600 .env
See infra/RUNBOOK.md ("首次部署") for which values to set (SECRET_KEY, POSTGRES_PASSWORD, CADDY_DOMAIN).
MSG
  exit 3
elif [ "$rc" -ne 0 ]; then
  die 1 "remote deploy step failed (exit ${rc}); see the output above"
fi

# (g) public check
DOMAIN="$(ssh -o BatchMode=yes "$HOST" "grep '^CADDY_DOMAIN=' $(q "$REMOTE_DIR/infra/.env") | tail -n1 | cut -d= -f2-" 2>/dev/null | tr -d '\r"'"'" || true)"
if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
  log "checking https://${DOMAIN}/health"
  if curl -fsS --max-time 15 "https://${DOMAIN}/health"; then
    echo
  else
    warn "https://${DOMAIN}/health did not answer. First certificate issuance can take a minute;
         also check DNS for ${DOMAIN}, the OCI Security List (80/443) and: on the VM run 'docker ps' and 'docker logs --tail=50 <the caddy container>' (see infra/RUNBOOK.md)"
    exit 1
  fi
else
  log "CADDY_DOMAIN is '${DOMAIN:-unset}'; skipping the public health check"
fi

log "deployed"
