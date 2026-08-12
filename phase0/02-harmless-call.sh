#!/usr/bin/env bash
# Phase 0 — Check 2: ONE harmless contract call through KeeperHub.
#
# Two stages, both important:
#   A) SIMULATE  (simulate:true) — safe, no broadcast, always runs.
#   B) BROADCAST (real testnet write) — GATED. Prints the exact request and
#      refuses unless CONFIRM_BROADCAST=yes.
#
# "Harmless" = a trivial, no-value, non-destructive function on a contract you
# control. Do NOT point this at anything with real value or irreversible effects.
#
# Usage:
#   ./02-harmless-call.sh            # simulate only (safe)
#   CONFIRM_BROADCAST=yes ./02-harmless-call.sh   # simulate, then real broadcast
#
# Endpoint + body shape CONFIRMED against docs.keeperhub.com/api/direct-execution:
#   POST /api/execute/contract-call
#   body: { contractAddress, chainId, functionName, functionArgs?, abi?, value?, simulate? }
#   - `simulate` is a strict BODY BOOLEAN (true = dry run; strings/numbers -> 400).
#   - Idempotency uses the `Idempotency-Key` HTTP HEADER (not a body field).
#   - A would-revert dry run returns HTTP 400 with { "wouldRevert": true }.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need_curl
require_env KEEPERHUB_BASE_URL
require_env KEEPERHUB_API_KEY
require_env HARMLESS_TARGET_ADDRESS
require_env HARMLESS_FUNCTION_NAME
: "${KEEPERHUB_CONTRACT_CALL_PATH:=/api/execute/contract-call}"
: "${HARMLESS_FUNCTION_ARGS:=[]}"
: "${CHAIN_ID:=84532}"

url="${KEEPERHUB_BASE_URL%/}${KEEPERHUB_CONTRACT_CALL_PATH}"

# Build request bodies (field names CONFIRMED: contractAddress / chainId /
# functionName / functionArgs / simulate).
sim_body=$(cat <<JSON
{
  "chainId": ${CHAIN_ID},
  "contractAddress": "${HARMLESS_TARGET_ADDRESS}",
  "functionName": "${HARMLESS_FUNCTION_NAME}",
  "functionArgs": ${HARMLESS_FUNCTION_ARGS},
  "simulate": true
}
JSON
)

# Stable idempotency key for the (potential) real broadcast — sent as an HTTP
# header (Idempotency-Key), NOT a body field. One key per purpose.
idem_key="chainsre:phase0:harmless-call"
broadcast_body=$(cat <<JSON
{
  "chainId": ${CHAIN_ID},
  "contractAddress": "${HARMLESS_TARGET_ADDRESS}",
  "functionName": "${HARMLESS_FUNCTION_NAME}",
  "functionArgs": ${HARMLESS_FUNCTION_ARGS}
}
JSON
)

hr
info "Phase 0 / Check 2: harmless contract call"
info "POST ${url}"
info "Auth: Authorization: Bearer $(redact "${KEEPERHUB_API_KEY}")   (redacted)"
info "Target: ${HARMLESS_TARGET_ADDRESS}  fn=${HARMLESS_FUNCTION_NAME}  args=${HARMLESS_FUNCTION_ARGS}"
hr

# --- Stage A: SIMULATE (safe) ---------------------------------------------
info "Stage A — SIMULATE (simulate:true, no broadcast)"
info "Request body:"
echo "${sim_body}"
echo
sim_status="$(curl -sS -o /tmp/kh_sim.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -X POST --data "${sim_body}" \
  "${url}" || true)"
info "HTTP ${sim_status}"
info "Response:"
if command -v jq >/dev/null 2>&1; then jq . /tmp/kh_sim.json || cat /tmp/kh_sim.json; else cat /tmp/kh_sim.json; fi
echo
if [[ "${sim_status}" == "200" ]]; then
  ok "Simulation returned 200 (status:simulated). Non-reverting — target/fn are valid."
elif [[ "${sim_status}" == "400" ]] && command -v jq >/dev/null 2>&1 && jq -e '.wouldRevert == true' /tmp/kh_sim.json >/dev/null 2>&1; then
  die "Simulation says the call WOULD REVERT (wouldRevert:true). Pick a genuinely harmless, non-reverting function."
else
  die "Simulation did not return 200. Fix before considering a broadcast (check auth, chainId, ABI)."
fi

# --- Stage B: BROADCAST (gated real write) --------------------------------
hr
info "Stage B — REAL BROADCAST (gated)"
warn "The following request WOULD broadcast a real Base Sepolia transaction:"
echo "  POST ${url}"
echo "  Header: Idempotency-Key: ${idem_key}"
echo "  Body:"
echo "${broadcast_body}"
echo
info ">>> STOP AND SHOW THE USER THIS EXACT REQUEST BEFORE PROCEEDING. <<<"
assert_broadcast_confirmed   # exits 3 unless CONFIRM_BROADCAST=yes

info "CONFIRM_BROADCAST=yes detected — broadcasting the harmless call..."
bc_status="$(curl -sS -o /tmp/kh_bcast.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Idempotency-Key: ${idem_key}" \
  -X POST --data "${broadcast_body}" \
  "${url}" || true)"
info "HTTP ${bc_status}"
if command -v jq >/dev/null 2>&1; then jq . /tmp/kh_bcast.json || cat /tmp/kh_bcast.json; else cat /tmp/kh_bcast.json; fi
echo
[[ "${bc_status}" =~ ^20 ]] || die "Broadcast request failed (HTTP ${bc_status}). Note: broadcasting needs an org key with mcp:write scope; a dry run only needs mcp:read."
ok "Broadcast accepted. Extract the executionId and poll ./03-status.sh execution <executionId>."
hr
info "The status endpoint returns an X-Poll-Interval-Hint header (seconds; 0 = terminal)."
info "Record executionId, tx hash, and BaseScan link in PHASE-0-RESULTS.md."
