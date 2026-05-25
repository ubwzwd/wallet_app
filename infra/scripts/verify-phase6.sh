#!/usr/bin/env bash
# infra/scripts/verify-phase6.sh — Phase 6 verification
#
# Modes:
#   bash infra/scripts/verify-phase6.sh quick               # local pre-commit check (~5s); no VM needed
#   bash infra/scripts/verify-phase6.sh full <domain> <ip>  # full SC1–SC5 verification against live VM
#
# Exit 0  : all assertions for the selected mode observably true.
# Exit !=0: the failing step is echoed to stderr.
#
# WARNING: This script is ASSERTION-ONLY. It does NOT call 'docker compose down' or 'down -v'.
# WARNING: Pitfall 8: 'docker compose down -v' would delete the caddy_data volume and burn the
# WARNING: Let's Encrypt issuance/rate-limit budget. This script never calls compose lifecycle
# WARNING: commands (up, down, stop, start, restart, rm). It assumes the stack is already running
# WARNING: (full mode) or operates on static files only (quick mode).

set -euo pipefail

# --- arg parsing ---
MODE="${1:-quick}"
DOMAIN="${2:-}"
VM_IP="${3:-}"

if [ "$MODE" = "full" ] && { [ -z "$DOMAIN" ] || [ -z "$VM_IP" ]; }; then
  echo "FAIL: full mode requires DOMAIN and VM_IP args"
  echo "Usage: bash infra/scripts/verify-phase6.sh full <your-domain> <vm-ip>"
  exit 1
fi

if [ "$MODE" != "quick" ] && [ "$MODE" != "full" ]; then
  echo "FAIL: unknown mode '$MODE' — valid modes: quick, full"
  echo "Usage: bash infra/scripts/verify-phase6.sh [quick|full <your-domain> <vm-ip>]"
  exit 1
fi

# --- repo-root resolution ---
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# === QUICK MODE BLOCK ===
# Always runs regardless of mode — validates local static files.

echo "==> caddy: Caddyfile syntactically valid"
docker run --rm \
  -v "$REPO_ROOT/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || { echo "FAIL: caddy validate — Caddyfile has syntax errors"; exit 1; }

echo "==> caddy: HSTS directive present (DOMAIN-03 / D-19)"
grep -q 'Strict-Transport-Security "max-age=31536000; includeSubDomains"' "$REPO_ROOT/infra/Caddyfile" \
  || { echo "FAIL: HSTS directive missing or wrong value in Caddyfile — expected: Strict-Transport-Security \"max-age=31536000; includeSubDomains\""; exit 1; }

echo "==> caddy: HSTS preload absent (D-19 / Pitfall 7 — irreversible)"
! grep -q 'preload' "$REPO_ROOT/infra/Caddyfile" \
  || { echo "FAIL: HSTS preload token must NOT be in Caddyfile — preload submission is irreversible"; exit 1; }

echo "==> caddy: acme_ca global block present (D-05 / env-var driven ACME endpoint)"
grep -q 'acme_ca {$CADDY_ACME_CA}' "$REPO_ROOT/infra/Caddyfile" \
  || { echo "FAIL: acme_ca env-var directive missing from global block in Caddyfile"; exit 1; }

echo "==> env: .env.example has CADDY_ACME_CA key"
grep -q '^CADDY_ACME_CA=' "$REPO_ROOT/infra/.env.example" \
  || { echo "FAIL: CADDY_ACME_CA key missing from infra/.env.example"; exit 1; }

echo "==> env: .env.example has narrowed ALLOWED_ORIGINS sentinel"
grep -q '^ALLOWED_ORIGINS=https://CHANGE_ME_YOUR_DOMAIN$' "$REPO_ROOT/infra/.env.example" \
  || { echo "FAIL: ALLOWED_ORIGINS not narrowed to CHANGE_ME_YOUR_DOMAIN in infra/.env.example"; exit 1; }

echo "==> compose: prod compose lints clean"
docker compose -f "$REPO_ROOT/infra/docker-compose.prod.yml" config -q \
  || { echo "FAIL: docker compose config — infra/docker-compose.prod.yml has errors"; exit 1; }

if [ "$MODE" = "quick" ]; then
  echo "OK: Phase 6 quick verify green"
  exit 0
fi

# === FULL MODE BLOCK ===
# Runs assertions against a live, deployed VM. Requires DOMAIN and VM_IP args.
# The stack must already be running on the VM — this script does NOT start/stop it.

echo "==> dns: $DOMAIN -> $VM_IP via 1.1.1.1 (DOMAIN-01)"
[ "$(dig @1.1.1.1 "$DOMAIN" +short | head -1)" = "$VM_IP" ] \
  || { echo "FAIL: DNS for $DOMAIN does not resolve to $VM_IP via 1.1.1.1 — check Cloudflare A record (D-04 prerequisite)"; exit 1; }

echo "==> https: $DOMAIN returns HTTP/2 200 (SC1)"
curl -sI "https://$DOMAIN/" | grep -qi '^HTTP/2 200' \
  || { echo "FAIL: https://$DOMAIN/ did not return HTTP/2 200 — check Caddy is up and DNS resolves to the VM"; exit 1; }

echo "==> tls: LE production cert (not staging) — DOMAIN-02 / D-05"
out=$(curl -vI "https://$DOMAIN/" 2>&1)
echo "$out" | grep -qi "issuer.*Let.s Encrypt" \
  || { echo "FAIL: TLS cert issuer is not Let's Encrypt — check CADDY_ACME_CA env var on VM"; exit 1; }
if echo "$out" | grep -qiE 'STAGING|Fake LE|Pretend Pear'; then
  echo "FAIL: TLS cert is from LE STAGING — flip CADDY_ACME_CA to empty in VM .env then: docker compose restart caddy"
  exit 1
fi

echo "==> hsts: response header present with correct value (DOMAIN-03)"
curl -sI "https://$DOMAIN/" | grep -qi '^strict-transport-security:.*max-age=31536000.*includeSubDomains' \
  || { echo "FAIL: HSTS response header missing or wrong value — check Caddy Caddyfile HSTS header directive"; exit 1; }

echo "==> ports: nmap shows only 23333/80/443 reachable on $VM_IP (SEC-02 / D-15)"
scan=$(nmap -Pn -p 22,23333,80,443 "$VM_IP" -oG -)
echo "$scan" | grep -qE '22/(closed|filtered)' \
  || { echo "FAIL: port 22 is unexpectedly open on $VM_IP — check ufw and Oracle security list"; exit 1; }
echo "$scan" | grep -qE '23333/open' \
  || { echo "FAIL: port 23333 is not open on $VM_IP — check ufw and Oracle security list"; exit 1; }
echo "$scan" | grep -qE '80/open' \
  || { echo "FAIL: port 80 is not open on $VM_IP — required for Let's Encrypt HTTP-01 challenge"; exit 1; }
echo "$scan" | grep -qE '443/open' \
  || { echo "FAIL: port 443 is not open on $VM_IP — required for HTTPS traffic"; exit 1; }

echo "==> health: /health returns 200 and JSON status (OPS-01)"
curl -sf "https://$DOMAIN/health" | grep -q '"status"' \
  || { echo "FAIL: https://$DOMAIN/health did not return JSON with 'status' field — check FastAPI /health endpoint"; exit 1; }

echo "==> health: /health response time < 500ms from external network (OPS-01)"
# NOTE: 500ms threshold accounts for network RTT from operator laptop.
# ROADMAP SC4's <100ms is the LAN-local measurement (run this script from inside the VM via ssh to test that).
t=$(curl -sf -o /dev/null -w '%{time_total}' "https://$DOMAIN/health")
awk -v t="$t" 'BEGIN { exit (t < 0.5) ? 0 : 1 }' \
  || { echo "FAIL: /health response took ${t}s (>500ms) — check API startup and DB connection"; exit 1; }

echo "==> evidence: infra/runbook-evidence/uptime-alert.png exists and is non-empty (OPS-02 / SC5)"
# This is the last gate: the operator must complete the UptimeRobot drill per RUNBOOK §15 and
# commit the screenshot before this check passes.
test -s "$REPO_ROOT/infra/runbook-evidence/uptime-alert.png" \
  || { echo "FAIL: SC5 evidence screenshot missing or empty — operator must complete UptimeRobot downtime drill per RUNBOOK §15 and place the screenshot at infra/runbook-evidence/uptime-alert.png"; exit 1; }

echo "OK: Phase 6 full verify green"
