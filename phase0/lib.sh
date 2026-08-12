#!/usr/bin/env bash
# Phase 0 shared helpers. Sourced by the check scripts.
# - Loads env from a local .env if present (never committed).
# - Redacts secrets in any output.
# - Provides a hard safety gate for real writes.
set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env from the phase0/ dir if it exists. Values already in the
# environment take precedence (so `KEY=... ./script.sh` still works).
# ---------------------------------------------------------------------------
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${_here}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${_here}/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
info()  { printf '  %s\n' "$*"; }
ok()    { printf '  [OK] %s\n' "$*"; }
warn()  { printf '  [!!] %s\n' "$*" >&2; }
die()   { printf '  [XX] %s\n' "$*" >&2; exit 1; }
hr()    { printf -- '----------------------------------------------------------------\n'; }

# Redact a secret for display: show only first 4 chars, mask the rest.
redact() {
  local s="${1:-}"
  if [[ -z "$s" ]]; then printf '(empty)'; return; fi
  local n=${#s}
  if (( n <= 4 )); then printf '****'; else printf '%s%s' "${s:0:4}" "$(printf '%*s' $((n-4)) '' | tr ' ' '*')"; fi
}

# Require an env var to be set and non-empty, else fail with a clear message.
require_env() {
  local name="$1"
  local val="${!name:-}"
  [[ -n "$val" ]] || die "Missing required env var: ${name} (set it in phase0/.env)"
}

# Confirm curl exists.
need_curl() { command -v curl >/dev/null 2>&1 || die "curl is required but not found"; }

# ---------------------------------------------------------------------------
# Safety gate. Any real write (broadcast / workflow trigger) must call this.
# It refuses unless CONFIRM_BROADCAST == "yes".
# ---------------------------------------------------------------------------
assert_broadcast_confirmed() {
  if [[ "${CONFIRM_BROADCAST:-}" != "yes" ]]; then
    warn "REAL WRITE BLOCKED."
    warn "This step would broadcast a real Base Sepolia transaction / trigger a workflow."
    warn "It is intentionally disabled. To proceed, review the exact request printed above,"
    warn "then re-run with:  CONFIRM_BROADCAST=yes  in your environment."
    exit 3
  fi
}

# Substitute {executionId}/{workflowId} placeholders in a path template.
expand_path() {
  local tmpl="$1"; local key="$2"; local val="$3"
  printf '%s' "${tmpl//\{$key\}/$val}"
}
