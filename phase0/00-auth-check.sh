#!/usr/bin/env bash
# Phase 0 — Check 0: API key health check (READ-ONLY, safest possible).
#
# Confirms the KeeperHub org key is valid before running anything else.
# CONFIRMED: GET /api/keys returns 200 if the credential is valid, 401 if not.
#
# Usage:
#   ./00-auth-check.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need_curl
require_env KEEPERHUB_BASE_URL
require_env KEEPERHUB_API_KEY
: "${KEEPERHUB_KEYS_PATH:=/api/keys}"

url="${KEEPERHUB_BASE_URL%/}${KEEPERHUB_KEYS_PATH}"
hr
info "Phase 0 / Check 0: API key health check (read-only)"
info "GET ${url}"
info "Auth: Authorization: Bearer $(redact "${KEEPERHUB_API_KEY}")   (redacted)"
hr
status="$(curl -sS -o /tmp/kh_keys.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Accept: application/json" \
  "${url}" || true)"
info "HTTP ${status}"
case "${status}" in
  200) ok "Key is valid. Proceed to ./01-chains.sh" ;;
  401) die "401 Unauthorized — the key is invalid/expired, or lacks scope. Check KEEPERHUB_API_KEY." ;;
  *)   warn "Unexpected HTTP ${status}. Body:"; cat /tmp/kh_keys.json 2>/dev/null || true; echo
       die "Could not confirm key validity. Check base URL and network." ;;
esac
