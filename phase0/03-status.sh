#!/usr/bin/env bash
# Phase 0 — Check 3b: poll an execution or workflow-execution status (READ-ONLY).
#
# Usage:
#   ./03-status.sh execution <executionId>   # Direct Execution status
#   ./03-status.sh workflow  <executionId>   # Workflow execution status
#
# Read-only GETs; safe to run repeatedly. Paths CONFIRMED against
# docs.keeperhub.com. Execution status returns tx via `transactionHash` and an
# `X-Poll-Interval-Hint` response header (seconds; 0 = terminal). Workflow status
# returns a `transactionHashes[]` array and has NO poll-hint header — use the
# /wait long-poll endpoint instead for blocking waits.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need_curl
require_env KEEPERHUB_BASE_URL
require_env KEEPERHUB_API_KEY

kind="${1:-}"; exec_id="${2:-}"
[[ -n "$kind" && -n "$exec_id" ]] || die "Usage: ./03-status.sh <execution|workflow> <executionId>"

case "$kind" in
  execution)
    : "${KEEPERHUB_EXECUTION_STATUS_PATH:=/api/execute/{executionId}/status}"
    path="$(expand_path "${KEEPERHUB_EXECUTION_STATUS_PATH}" executionId "${exec_id}")" ;;
  workflow)
    : "${KEEPERHUB_WORKFLOW_STATUS_PATH:=/api/workflows/executions/{executionId}/status}"
    path="$(expand_path "${KEEPERHUB_WORKFLOW_STATUS_PATH}" executionId "${exec_id}")" ;;
  *) die "First arg must be 'execution' or 'workflow'." ;;
esac

url="${KEEPERHUB_BASE_URL%/}${path}"
hr
info "Phase 0 / status poll (${kind})"
info "GET ${url}"
hr
status="$(curl -sS -D /tmp/kh_status.headers -o /tmp/kh_status.json -w '%{http_code}' \
  -H "Authorization: Bearer ${KEEPERHUB_API_KEY}" \
  -H "Accept: application/json" \
  "${url}" || true)"
info "HTTP ${status}"
if command -v jq >/dev/null 2>&1; then jq . /tmp/kh_status.json || cat /tmp/kh_status.json; else cat /tmp/kh_status.json; fi
echo
# Surface the poll-interval hint header (direct execution only).
hint="$(grep -i '^X-Poll-Interval-Hint:' /tmp/kh_status.headers 2>/dev/null | tr -d '\r' | awk -F': ' '{print $2}')"
if [[ -n "${hint:-}" ]]; then
  if [[ "${hint}" == "0" ]]; then
    ok "X-Poll-Interval-Hint: 0 -> terminal state, stop polling."
  else
    info "X-Poll-Interval-Hint: ${hint}s -> wait this long before polling again."
  fi
fi
info "Look for: terminal status, tx hash, block number, gas, receipts."
info "Direct execution: honor X-Poll-Interval-Hint. Workflows: use the /wait long-poll endpoint."
