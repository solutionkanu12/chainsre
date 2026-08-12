#!/usr/bin/env bash
# Phase 0 — Check 1: KeeperHub chain discovery (READ-ONLY, safe).
#
# Purpose: confirm the KeeperHub API key works AND that Base Sepolia (84532)
# is an enabled chain. This performs NO writes.
#
# Usage:
#   1) cp .env.example .env  &&  edit .env  (set KEEPERHUB_API_KEY, KEEPERHUB_BASE_URL)
#   2) ./01-chains.sh
#
# Endpoint + auth are CONFIRMED against docs.keeperhub.com/api/chains:
#   GET /api/chains  ->  bare JSON array of chain objects, each with a numeric
#   `chainId` and booleans `isEnabled` / `isTestnet`. Auth: Authorization: Bearer kh_...
# Override KEEPERHUB_CHAINS_PATH in .env only if the API changes.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need_curl
require_env KEEPERHUB_BASE_URL
require_env KEEPERHUB_API_KEY
: "${KEEPERHUB_CHAINS_PATH:=/api/chains}"
: "${CHAIN_ID:=84532}"

url="${KEEPERHUB_BASE_URL%/}${KEEPERHUB_CHAINS_PATH}"

hr
info "Phase 0 / Check 1: chain discovery (read-only)"
info "GET  ${url}"
info "Auth: Authorization: Bearer $(redact "${KEEPERHUB_API_KEY}")   (redacted)"
info "Looking for chain id: ${CHAIN_ID} (Base Sepolia)"
hr

# --- The request. Read-only GET; safe to run. -----------------------------
# Auth is Bearer with a kh_ org key (confirmed).
http_status="$(curl -sS -o /tmp/kh_chains.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Accept: application/json" \
  "${url}" || true)"

info "HTTP ${http_status}"
if [[ "${http_status}" != "200" ]]; then
  warn "Non-200 response. Body (secrets not echoed):"
  cat /tmp/kh_chains.json 2>/dev/null || true
  echo
  die "Chain discovery failed. Verify base URL, path, and auth against live KeeperHub docs."
fi

echo
info "Response body:"
if command -v jq >/dev/null 2>&1; then
  jq . /tmp/kh_chains.json || cat /tmp/kh_chains.json
  echo
  # Response is a bare array; each element has numeric chainId + isEnabled.
  if jq -e --argjson id "${CHAIN_ID}" 'any(.[]?; .chainId == $id and .isEnabled == true)' /tmp/kh_chains.json >/dev/null 2>&1; then
    ok "Base Sepolia (${CHAIN_ID}) is present AND isEnabled==true on this org."
  elif jq -e --argjson id "${CHAIN_ID}" 'any(.[]?; .chainId == $id)' /tmp/kh_chains.json >/dev/null 2>&1; then
    warn "Chain ${CHAIN_ID} is present but isEnabled is NOT true. Enable it in KeeperHub before proceeding."
  else
    warn "Chain id ${CHAIN_ID} not found. Re-run with ?includeDisabled=true, or enable it in KeeperHub."
    warn "(Set KEEPERHUB_CHAINS_PATH=/api/chains?includeDisabled=true to list disabled chains too.)"
  fi
else
  cat /tmp/kh_chains.json
  echo
  warn "jq not installed — inspect the JSON above and confirm 84532 is present with isEnabled:true."
fi

hr
info "Record the result (chains list + whether 84532 is enabled) in PHASE-0-RESULTS.md"
