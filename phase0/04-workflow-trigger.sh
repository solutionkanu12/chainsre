#!/usr/bin/env bash
# Phase 0 — Check 3: trigger the guardian pause() workflow through KeeperHub.
#
# This is a REAL WRITE (it triggers a stored workflow that broadcasts a tx).
# It is GATED: it prints the exact request and refuses unless CONFIRM_BROADCAST=yes.
#
# Prereq: the guardian workflow must already be created + tested in the KeeperHub
# UI, and KEEPERHUB_GUARDIAN_WORKFLOW_ID set in .env.
#
# Usage:
#   ./04-workflow-trigger.sh          # dry run: prints request, then STOPS (no write)
#   CONFIRM_BROADCAST=yes ./04-workflow-trigger.sh   # actually triggers it
#
# Endpoint + body shape CONFIRMED against docs.keeperhub.com/api/workflows:
#   POST /api/workflows/{workflowId}/execute   body: { "input": { ... } } (input optional)
#   response: { "executionId": "exec_...", "status": "running" }
#   Idempotency uses the `Idempotency-Key` HTTP HEADER (not a body field).
#   Poll with ./03-status.sh workflow <executionId> (or the /wait long-poll endpoint).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need_curl
require_env KEEPERHUB_BASE_URL
require_env KEEPERHUB_API_KEY
require_env KEEPERHUB_GUARDIAN_WORKFLOW_ID
: "${KEEPERHUB_WORKFLOW_EXECUTE_PATH:=/api/workflows/{workflowId}/execute}"

path="$(expand_path "${KEEPERHUB_WORKFLOW_EXECUTE_PATH}" workflowId "${KEEPERHUB_GUARDIAN_WORKFLOW_ID}")"
url="${KEEPERHUB_BASE_URL%/}${path}"

# Body shape CONFIRMED: { "input": { ... } }, input optional. For a Phase-0
# harmless test, trigger a workflow that targets a THROWAWAY contract, not the
# real protected vault. Override the input via WORKFLOW_INPUT_JSON.
: "${WORKFLOW_INPUT_JSON:={} }"
idem_key="chainsre:phase0:workflow-trigger"
body=$(cat <<JSON
{
  "input": ${WORKFLOW_INPUT_JSON}
}
JSON
)

hr
info "Phase 0 / Check 3: guardian workflow trigger"
info "POST ${url}"
info "Auth: Authorization: Bearer $(redact "${KEEPERHUB_API_KEY}")   (redacted)"
info "Workflow ID: ${KEEPERHUB_GUARDIAN_WORKFLOW_ID}"
hr
warn "This WOULD trigger a real stored workflow (a real onchain write)."
info "Exact request:"
echo "  POST ${url}"
echo "  Header: Idempotency-Key: ${idem_key}"
echo "  Body:"
echo "${body}"
echo
info ">>> STOP AND SHOW THE USER THIS EXACT REQUEST BEFORE PROCEEDING. <<<"
info "Tip: for the first test, point the workflow at a THROWAWAY contract, not the real vault."
assert_broadcast_confirmed   # exits 3 unless CONFIRM_BROADCAST=yes

info "CONFIRM_BROADCAST=yes detected — triggering workflow..."
status="$(curl -sS -o /tmp/kh_wf.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Idempotency-Key: ${idem_key}" \
  -X POST --data "${body}" \
  "${url}" || true)"
info "HTTP ${status}"
if command -v jq >/dev/null 2>&1; then jq . /tmp/kh_wf.json || cat /tmp/kh_wf.json; else cat /tmp/kh_wf.json; fi
echo
[[ "${status}" =~ ^20 ]] || die "Workflow trigger failed (HTTP ${status})."
ok "Workflow trigger accepted. Extract the workflow executionId and poll its status."
hr
info "Record workflow executionId, node tx hash(es), and BaseScan link(s) in PHASE-0-RESULTS.md."
