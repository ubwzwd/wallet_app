#!/usr/bin/env bash
# infra/scripts/smoke.sh -- local end-to-end smoke test of the production-shape stack (v3).
#
#     bash infra/scripts/smoke.sh [--no-web] [--keep] [--help]
#
# Runs on the laptop, from anywhere inside the repo (the script cd's to the repo root).
# Brings up infra/docker-compose.prod.yml (db -> migrate -> api -> caddy) under its OWN
# compose project `wallet-smoke` on ports 18080 / 18443, so it never collides with the
# VM-style project `wallet`, the dev database or any other local container. Then it
# asserts the things production depends on (TLS front door, SPA fallback, cache and
# security headers, auth, per-IP login rate limit, migrations, non-root api with proxy
# headers) and does a backup.sh / restore.sh round trip against the running stack.
#
# Every check prints `PASS <what>` or `FAIL <what>`; any FAIL makes the exit status 1.
# The stack (containers + volumes) and the temp dir are removed on exit unless --keep.
#
#   --no-web  skip `npm run build:web` and reuse the existing frontend/dist
#   --keep    leave the stack running after the run (prints how to tear it down)
#
# Needs: docker compose v2, curl, openssl, python3 (JSON parsing), and
# frontend/node_modules (only when building the web bundle).

set -euo pipefail

usage() { sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

BUILD_WEB=1
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --no-web) BUILD_WEB=0 ;;
    --keep)   KEEP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "smoke.sh: unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

PROJECT=wallet-smoke
HTTP_PORT=18080
HTTPS_PORT=18443
B="https://localhost:${HTTPS_PORT}"
COMPOSE_FILE="$REPO/infra/docker-compose.prod.yml"
START=$SECONDS

S=""          # temp dir, created below
STACK_UP=0    # set once `compose up` was attempted, so cleanup knows to tear down
PASSES=0
FAILS=0
FAILED_CHECKS=()

log()  { printf '\n==> %s\n' "$*"; }
die()  { echo "smoke.sh: ERROR: $*" >&2; exit 1; }
pass() { PASSES=$((PASSES + 1)); echo "PASS $*"; }
fail() { FAILS=$((FAILS + 1)); FAILED_CHECKS+=("$*"); echo "FAIL $*"; }
# check "<description>" <command...>: PASS when the command succeeds.
check() { local d="$1"; shift; if "$@"; then pass "$d"; else fail "$d"; fi; }

compose() {
  WALLET_ENV_FILE="$S/.env" docker compose -p "$PROJECT" --env-file "$S/.env" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  local rc=$?
  set +e
  if [ "$STACK_UP" -eq 1 ]; then
    if [ "$KEEP" -eq 1 ]; then
      echo
      echo "smoke.sh: --keep: the stack is still running. Tear it down with:"
      echo "  WALLET_ENV_FILE=$S/.env docker compose -p $PROJECT --env-file $S/.env -f $COMPOSE_FILE down -v --remove-orphans"
      echo "  rm -rf $S"
      exit "$rc"
    fi
    log "teardown (project $PROJECT)"
    compose down -v --remove-orphans >/dev/null 2>&1 \
      || echo "smoke.sh: WARNING: teardown failed; run: docker compose -p $PROJECT down -v" >&2
  fi
  [ -n "$S" ] && rm -rf "$S"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- HTTP helpers --------------------------------------------------------------
# fetch <url> [curl args...]: status code into $CODE, headers into $S/h, body into $S/b.
fetch() {
  local url="$1"; shift
  CODE="$(curl -ks --max-time 10 -o "$S/b" -D "$S/h" -w '%{http_code}' "$@" "$url" || true)"
  [ -n "$CODE" ] || CODE=000
}
# header <name>: value of a response header from the last fetch (case-insensitive, no CR).
header() { grep -i "^$1:" "$S/h" | tail -n1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true; }
code_is()      { [ "$CODE" = "$1" ]; }
header_has()   { header "$1" | grep -qi -- "$2"; }
body_has()     { grep -q -- "$1" "$S/b"; }
body_lacks()   { ! grep -qi -- "$1" "$S/b"; }
no_header()    { ! grep -qi "^$1:" "$S/h"; }
# json <python expression over `d`>: evaluates against the last body, prints the result.
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$S/b" "$1" 2>/dev/null; }

# =============================================================================
log "preflight"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
for t in curl openssl python3; do command -v "$t" >/dev/null || die "$t is required"; done
bash infra/scripts/env-coverage.sh
grep -q CHANGE_ME infra/.env.example || die "infra/.env.example lost its CHANGE_ME placeholders (it must stay a template)"
if [ "$BUILD_WEB" -eq 1 ]; then
  [ -d frontend/node_modules ] || die "frontend/node_modules is missing; run 'npm ci' in frontend/ first"
fi
if docker ps -a --format '{{.Label "com.docker.compose.project"}}' | grep -qx "$PROJECT"; then
  die "containers of project '$PROJECT' already exist (a --keep run?); remove them first: docker compose -p $PROJECT down -v"
fi

# =============================================================================
log "generate env file"
S="$(mktemp -d /tmp/wallet-smoke.XXXXXX)"
PG_PASS="$(openssl rand -hex 32)"
SECRET="$(openssl rand -hex 32)"

# Keys only (comments mention CHANGE_ME too); then fill / override values.
grep -Ev '^[[:space:]]*(#|$)' infra/.env.example > "$S/.env"
set_env() {  # set_env KEY VALUE: replace the KEY= line or append it
  KEY="$1" VAL="$2" awk -F= '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VAL"]; done = 0 }
    $1 == k { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$S/.env" > "$S/.env.tmp" && mv "$S/.env.tmp" "$S/.env"
}
env_val() { grep -E "^$1=" "$S/.env" | tail -n1 | cut -d= -f2-; }
set_env POSTGRES_PASSWORD "$PG_PASS"
set_env SECRET_KEY "$SECRET"
set_env CADDY_DOMAIN localhost
set_env CADDY_HTTP_PORT "$HTTP_PORT"
set_env CADDY_HTTPS_PORT "$HTTPS_PORT"
set_env ALLOWED_ORIGINS "$B"
set_env DEBUG false
set_env ENVIRONMENT production
set_env REGISTRATION_OPEN true
PG_USER="$(env_val POSTGRES_USER)"
PG_DB="$(env_val POSTGRES_DB)"
set_env DATABASE_URL "postgresql://${PG_USER}:${PG_PASS}@db:5432/${PG_DB}"
chmod 600 "$S/.env"
! grep -q CHANGE_ME "$S/.env" || { grep CHANGE_ME "$S/.env" >&2; die "unfilled CHANGE_ME placeholder in the generated env"; }
echo "env file: $S/.env ($(wc -l < "$S/.env") keys, user=$PG_USER db=$PG_DB)"

# =============================================================================
if [ "$BUILD_WEB" -eq 1 ]; then
  log "build the web bundle (npm run build:web)"
  (cd frontend && npm run build:web)
else
  log "--no-web: reusing the existing frontend/dist"
fi
for f in index.html sw.js manifest.json; do
  [ -f "frontend/dist/$f" ] || die "frontend/dist/$f is missing (run without --no-web)"
done
! grep -rq 'localhost:8000' frontend/dist || die "frontend/dist points at localhost:8000; it must be built with EXPO_PUBLIC_API_BASE_URL=/api/v1"
ENTRY="$(cd frontend/dist/_expo/static/js/web && ls entry-*.js 2>/dev/null | head -n1 || true)"
[ -n "$ENTRY" ] || die "no _expo/static/js/web/entry-*.js in frontend/dist"
echo "dist OK (entry bundle: $ENTRY)"

# =============================================================================
log "compose up (project $PROJECT, https://localhost:$HTTPS_PORT)"
STACK_UP=1
if ! compose up -d --build --wait --wait-timeout 300; then
  echo "smoke.sh: compose up failed; state and logs follow" >&2
  compose ps -a >&2 || true
  for svc in db migrate api caddy; do
    echo "----- logs: $svc -----" >&2
    compose logs --no-color --tail=100 "$svc" >&2 || true
  done
  exit 1
fi

# =============================================================================
log "assertions"

# --- container state
PS_JSON="$(compose ps -a --format json)"
svc_field() {  # svc_field <service> <field>: from `compose ps --format json` (array or JSON lines)
  printf '%s' "$PS_JSON" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
rows = json.loads(raw) if raw.startswith("[") else [json.loads(l) for l in raw.splitlines() if l.strip()]
for r in rows:
    if r.get("Service") == sys.argv[1]:
        print(r.get(sys.argv[2], "")); break
' "$1" "$2"
}
check "migrate exited with code 0" \
  test "$(svc_field migrate State)" = exited -a "$(svc_field migrate ExitCode)" = 0
check "db is healthy"     test "$(svc_field db Health)" = healthy
check "api is healthy"    test "$(svc_field api Health)" = healthy
check "caddy is running"  test "$(svc_field caddy State)" = running

# --- health through Caddy, and the http -> https redirect
fetch "$B/health"
check "GET /health is 200"                         code_is 200
check "/health says status healthy"                body_has '"status":"healthy"'
check "/health says environment production"        body_has '"environment":"production"'
fetch "http://localhost:${HTTP_PORT}/health"
check "http://:${HTTP_PORT}/health is a 308 redirect"  code_is 308
check "the redirect Location is https://"          header_has location '^https://'

# --- SPA hosting, fallback and caching
fetch "$B/"
check "GET / is 200"                               code_is 200
check "/ is text/html"                             header_has content-type text/html
check "/ contains the React root"                  body_has '<div id="root"'
check "/ has Cache-Control no-cache"               header_has cache-control no-cache
check "Strict-Transport-Security header present"   header_has strict-transport-security max-age
check "X-Content-Type-Options: nosniff"            header_has x-content-type-options nosniff
check "no Server header on static responses"       no_header server
fetch "$B/transactions/not-a-real-id"
check "deep link /transactions/not-a-real-id is 200 (SPA fallback)" code_is 200
check "deep link serves the html shell"            body_has '<div id="root"'
check "deep link has Cache-Control no-cache"       header_has cache-control no-cache
fetch "$B/manifest.json"
check "GET /manifest.json is 200"                  code_is 200
check "/manifest.json content-type is json"        header_has content-type json
fetch "$B/sw.js"
check "GET /sw.js is 200"                          code_is 200
check "/sw.js content-type is javascript"          header_has content-type javascript
check "/sw.js has Cache-Control no-cache"          header_has cache-control no-cache
fetch "$B/_expo/static/js/web/$ENTRY"
check "GET entry bundle is 200"                    code_is 200
check "entry bundle Cache-Control is immutable"    header_has cache-control immutable

# --- the interactive API docs are not exposed
fetch "$B/docs"
check "/docs is the SPA shell (text/html)"         header_has content-type text/html
check "/docs is not Swagger UI"                    body_lacks swagger
fetch "$B/openapi.json"
check "/openapi.json is not the OpenAPI schema"    body_lacks '"openapi"'

# --- public API endpoints through the proxy
fetch "$B/api/v1/config"
check "GET /api/v1/config is 200"                  code_is 200
check "/api/v1/config is JSON with registration_open" test "$(json 'd["registration_open"]')" = True
check "no Server header on proxied API responses"  no_header server
check "HSTS also on proxied API responses"         header_has strict-transport-security max-age
fetch "$B/api/v1/categories"
check "GET /api/v1/categories is 200"              code_is 200
fetch "$B/api/v1/import-format"
check "GET /api/v1/import-format is 200 (skills/ is in the image)" code_is 200
fetch "$B/api/v1/rates/currencies"
check "GET /api/v1/rates/currencies is 200"        code_is 200

# --- register, login, ledgers
# RegisterRequest (03 §5.1) takes base_currency; a new account gets one ledger.
EMAIL="smoke-$(date +%s)@example.com"
PASSWORD="smoke-pass-1234"
fetch "$B/api/v1/auth/register" -X POST -H 'Content-Type: application/json' \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"base_currency\":\"CNY\"}"
check "register $EMAIL is 2xx (got $CODE)"         test "${CODE:0:1}" = 2
fetch "$B/api/v1/auth/login" -X POST -H 'Content-Type: application/json' \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
TOKEN="$(json 'd["access_token"]' || true)"
check "login returns an access_token"              test -n "$TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN")
ledger_count() { fetch "$B/api/v1/ledgers" "${AUTH[@]}"; [ "$CODE" = 200 ] && json 'len(d["items"])'; }
check "GET /api/v1/ledgers lists exactly 1 ledger" test "$(ledger_count)" = 1

# --- login rate limit is per client IP (needs uvicorn --proxy-headers behind Caddy)
LOGIN_BAD="{\"email\":\"$EMAIL\",\"password\":\"wrong-password-0\"}"
bad_login() { fetch "$B/api/v1/auth/login" -X POST -H 'Content-Type: application/json' --data "$LOGIN_BAD" "$@"; }
codes=""
for _ in $(seq 1 10); do bad_login; codes="$codes $CODE"; done
check "10 wrong-password logins are all 401 (got:$codes)" test "$codes" = "$(printf ' 401%.0s' $(seq 1 10))"
bad_login; c11="$CODE"
check "11th wrong login is 401 or 429 (got $c11)"  test "$c11" = 401 -o "$c11" = 429
bad_login
check "the next wrong login is 429 (got $CODE)"    code_is 429
check "429 body code is login_rate_limited"        test "$(json 'd["code"]')" = login_rate_limited
check "429 carries Retry-After"                    header_has retry-after '[0-9]'
# A spoofed X-Forwarded-For from the client must not escape the limit: Caddy does not
# trust incoming forwarding headers and rewrites them with the real peer address.
bad_login -H 'X-Forwarded-For: 203.0.113.7'
check "a spoofed X-Forwarded-For is still 429 (got $CODE)" code_is 429
# A different client IP (the api container, talking TLS to caddy over the compose
# network) is NOT locked out: the bucket is keyed by the forwarded client IP, not by
# Caddy's address.
OTHER_IP_CODE="$(compose exec -T api python - "$LOGIN_BAD" <<'PY' 2>/dev/null || true
import socket, ssl, sys
body = sys.argv[1].encode()
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
with socket.create_connection(("caddy", 443), timeout=10) as raw:
    with ctx.wrap_socket(raw, server_hostname="localhost") as s:
        s.sendall(b"POST /api/v1/auth/login HTTP/1.1\r\nHost: localhost\r\n"
                  b"Content-Type: application/json\r\nConnection: close\r\n"
                  b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        print(s.recv(64).split(b" ")[1].decode())
PY
)"
check "a different client IP still gets 401, not 429 (got ${OTHER_IP_CODE:-none})" test "$OTHER_IP_CODE" = 401

# --- database and migrations
psql_q() { compose exec -T db psql -U "$PG_USER" -d "$PG_DB" -Atc "$1" 2>/dev/null | tr -d '\r'; }
check "alembic_version has exactly one row"        test "$(psql_q 'select count(*) from alembic_version')" = 1
TABLES="$(psql_q '\dt' | cut -d'|' -f2)"
for t in transactions ledgers import_batches; do
  check "table $t exists"                          grep -qx "$t" <<<"$TABLES"
done

# --- api container hardening
check "api runs as uid 1000"                       test "$(compose exec -T api id -u | tr -d '\r')" = 1000
API_CID="$(compose ps -q api)"
API_CMD="$(docker inspect --format '{{json .Config.Cmd}}' "$API_CID")"
check "api command has --proxy-headers ($API_CMD)" grep -q -- '--proxy-headers' <<<"$API_CMD"
check "api command has --forwarded-allow-ips"      grep -q -- '--forwarded-allow-ips' <<<"$API_CMD"
check "api command has no --workers"               bash -c '! grep -q -- --workers <<<"$1"' _ "$API_CMD"
check "api container has no volumes"               test "$(docker inspect --format '{{len .Mounts}}' "$API_CID")" = 0
check "api container name comes from the project (no container_name)" \
  grep -q "^/${PROJECT}-api-" <<<"$(docker inspect --format '{{.Name}}' "$API_CID")"
check "api logs rotate (json-file, max-size 10m)" \
  grep -q 'max-size:10m' <<<"$(docker inspect --format '{{.HostConfig.LogConfig.Config}}' "$API_CID")"

# =============================================================================
log "backup / restore round trip (infra/scripts/backup.sh + restore.sh)"
script_env() {
  WALLET_REMOTE_DIR="$REPO" WALLET_COMPOSE_PROJECT="$PROJECT" \
    WALLET_ENV_FILE="$S/.env" WALLET_BACKUP_DIR="$S/backups" "$@"
}
check "backup.sh exits 0"                          script_env bash infra/scripts/backup.sh
DUMP="$(ls "$S"/backups/wallet-*.dump 2>/dev/null | tail -n1 || true)"
check "backup produced a wallet-*.dump"            test -n "$DUMP"
check "the dump is larger than 1 KB"               test "$(stat -c %s "${DUMP:-/dev/null}" 2>/dev/null || echo 0)" -gt 1024

fetch "$B/api/v1/ledgers" -X POST "${AUTH[@]}" -H 'Content-Type: application/json' \
  --data '{"name":"smoke-2","base_currency":"CNY"}'
check "POST /api/v1/ledgers creates a second ledger (got $CODE)" code_is 201
check "the user now has 2 ledgers"                 test "$(ledger_count)" = 2

check "restore.sh --yes exits 0"                   script_env bash infra/scripts/restore.sh "${DUMP:-/nonexistent}" --yes
check "after the restore the user has 1 ledger again" test "$(ledger_count)" = 1
fetch "$B/health"
check "/health is 200 after the restore"           code_is 200
compose ps -a --format '{{.Service}} {{.State}}' | grep -q '^caddy running$' \
  && pass "caddy is still running after the restore" || fail "caddy is still running after the restore"

# Last, so it also covers everything above (restore restarts the api).
check "api logs contain no Traceback"              bash -c '! grep -q Traceback' < <(compose logs --no-color api 2>&1)

# =============================================================================
ELAPSED=$((SECONDS - START))
echo
echo "smoke.sh: ${PASSES} passed, ${FAILS} failed in ${ELAPSED}s"
if [ "$FAILS" -gt 0 ]; then
  printf '  FAILED: %s\n' "${FAILED_CHECKS[@]}"
  exit 1
fi
echo "smoke.sh: all checks passed"
