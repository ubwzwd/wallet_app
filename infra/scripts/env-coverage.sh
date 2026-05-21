#!/usr/bin/env bash
# infra/scripts/env-coverage.sh — verify infra/.env.example covers every Settings field in backend/app/core/config.py
# Exit 0 = all required keys present. Exit 1 = drift (lists missing keys to stderr).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_PY="${REPO_ROOT}/backend/app/core/config.py"
ENV_EXAMPLE="${REPO_ROOT}/infra/.env.example"

test -f "$CONFIG_PY"   || { echo "missing $CONFIG_PY" >&2; exit 1; }
test -f "$ENV_EXAMPLE" || { echo "missing $ENV_EXAMPLE" >&2; exit 1; }

# Extract UPPER_SNAKE field names from the Settings class body. Excludes properties,
# dunders, and the API_V1_PREFIX / PROJECT_NAME defaults that are not phase-relevant
# (those have safe defaults in Settings and are intentionally absent from .env.example).
required=$(grep -E '^\s+[A-Z][A-Z_0-9]+:\s' "$CONFIG_PY" \
  | sed -E 's/^\s+([A-Z_0-9]+):.*/\1/' \
  | grep -Ev '^(API_V1_PREFIX|PROJECT_NAME)$' \
  | sort -u)

declared=$(grep -E '^[A-Z][A-Z_0-9]+=' "$ENV_EXAMPLE" \
  | sed -E 's/=.*//' \
  | sort -u)

missing=$(comm -23 <(echo "$required") <(echo "$declared") || true)

if [ -n "$missing" ]; then
  echo "MISSING in $ENV_EXAMPLE:" >&2
  echo "$missing" >&2
  exit 1
fi

echo "OK: all $(echo "$required" | wc -l) Settings fields in $CONFIG_PY appear in $ENV_EXAMPLE"
