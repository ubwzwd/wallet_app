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
