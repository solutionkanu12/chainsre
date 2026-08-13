#!/usr/bin/env bash
#
# Independently verify a ChainSRE Phase 2 deployment by reading it back over RPC.
#
# This deliberately shares no code with Deploy.s.sol. The script's own in-run assertions
# only see forge's simulated state; this reads what actually landed on chain.
#
# Usage:
#   ./script/verify-deployment.sh
#
# Reads from the environment (or packages/contracts/.env):
#   BASE_SEPOLIA_RPC_HTTP    RPC endpoint
#   INTENT_REGISTRY_ADDRESS  deployed IntentRegistry
#   MOCK_ASSET_ADDRESS       deployed MockAsset
#   PROTECTED_VAULT_ADDRESS  deployed protected DemoVault
#   CONTROL_VAULT_ADDRESS    deployed control DemoVault
#   VAULT_ADMIN              expected DEFAULT_ADMIN_ROLE holder
#   VAULT_MINTER             expected MINTER_ROLE holder
#   VAULT_GUARDIAN           expected GUARDIAN_ROLE holder
#   SEED_ASSETS              expected per-vault balance (default 1,000,000e18)
#
# No secret is read or printed. DEPLOYER_PRIVATE_KEY is never referenced.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a && . ./.env && set +a
fi

EXPECTED_CHAIN_ID=84532
SEED_ASSETS="${SEED_ASSETS:-1000000000000000000000000}"

fail=0
pass() { printf '  ok    %s\n' "$1"; }
bad() {
    printf '  FAIL  %s\n' "$1"
    fail=1
}
check() { # check <label> <actual> <expected>
    if [ "$2" = "$3" ]; then pass "$1 = $2"; else bad "$1: got '$2', expected '$3'"; fi
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Public RPC endpoints return transient 5xx errors. A verification run must not report a
# contract failure because a gateway hiccuped, so every read is retried with backoff and
# only a persistent failure is treated as real. stderr is dropped: provider error pages
# are HTML and would otherwise flood the report.
RPC_RETRIES="${RPC_RETRIES:-5}"
rpc() { # rpc <cast args...>  -> echoes trimmed stdout, non-zero on persistent failure
    local attempt out
    for ((attempt = 1; attempt <= RPC_RETRIES; attempt++)); do
        if out=$(cast "$@" "${RPC[@]}" 2>/dev/null) && [ -n "$out" ]; then
            printf '%s' "$out"
            return 0
        fi
        [ "$attempt" -lt "$RPC_RETRIES" ] && sleep "$attempt"
    done
    printf '<rpc-unavailable after %s attempts>' "$RPC_RETRIES"
    return 1
}

# Addresses are compared case-insensitively: `cast` returns EIP-55 checksummed values
# while configured addresses may be in any casing. Only the 20 bytes matter.
check_addr() { # check_addr <label> <actual> <expected>
    check "$1" "$(lower "$2")" "$(lower "$3")"
}

require_env() {
    for name in "$@"; do
        if [ -z "${!name:-}" ]; then
            echo "missing required environment variable: $name" >&2
            exit 2
        fi
    done
}

require_env BASE_SEPOLIA_RPC_HTTP INTENT_REGISTRY_ADDRESS MOCK_ASSET_ADDRESS \
    PROTECTED_VAULT_ADDRESS CONTROL_VAULT_ADDRESS VAULT_MINTER VAULT_GUARDIAN

RPC=(--rpc-url "$BASE_SEPOLIA_RPC_HTTP")
VAULT_ADMIN="${VAULT_ADMIN:-}"

echo "== chain =="
check "chainId" "$(rpc chain-id)" "$EXPECTED_CHAIN_ID"

echo "== bytecode present =="
for pair in \
    "IntentRegistry:$INTENT_REGISTRY_ADDRESS" \
    "MockAsset:$MOCK_ASSET_ADDRESS" \
    "protected DemoVault:$PROTECTED_VAULT_ADDRESS" \
    "control DemoVault:$CONTROL_VAULT_ADDRESS"; do
    name="${pair%%:*}"
    addr="${pair##*:}"
    code="$(rpc code "$addr")"
    if [ "${#code}" -gt 2 ]; then
        pass "$name at $addr has ${#code} hex chars of code"
    else
        bad "$name at $addr has NO code"
    fi
done

echo "== protected and control are the same implementation =="
prot_code="$(rpc code "$PROTECTED_VAULT_ADDRESS")"
ctrl_code="$(rpc code "$CONTROL_VAULT_ADDRESS")"
if [ "$prot_code" = "$ctrl_code" ]; then
    pass "runtime bytecode identical (keccak $(cast keccak "$prot_code"))"
else
    bad "runtime bytecode DIFFERS between protected and control"
fi
if [ "$(lower "$PROTECTED_VAULT_ADDRESS")" = "$(lower "$CONTROL_VAULT_ADDRESS")" ]; then
    bad "protected and control are the same address"
else
    pass "distinct deployments"
fi

echo "== registry =="
check "INTENT_SCHEMA_ID" \
    "$(rpc call "$INTENT_REGISTRY_ADDRESS" "INTENT_SCHEMA_ID()(string)")" \
    '"chainsre/mint-v1"'
check "INTENT_SCHEMA_HASH" \
    "$(rpc call "$INTENT_REGISTRY_ADDRESS" "INTENT_SCHEMA_HASH()(bytes32)")" \
    "$(cast keccak 'chainsre/mint-v1')"

echo "== vault state and roles =="
DEFAULT_ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
MINTER_ROLE="$(cast keccak 'MINTER_ROLE')"
GUARDIAN_ROLE="$(cast keccak 'GUARDIAN_ROLE')"

for pair in "protected:$PROTECTED_VAULT_ADDRESS" "control:$CONTROL_VAULT_ADDRESS"; do
    label="${pair%%:*}"
    addr="${pair##*:}"
    echo "-- $label ($addr)"
    check_addr "$label asset" \
        "$(rpc call "$addr" "asset()(address)")" "$MOCK_ASSET_ADDRESS"
    check "$label totalAssets" \
        "$(rpc call "$addr" "totalAssets()(uint256)" | cut -d' ' -f1)" "$SEED_ASSETS"
    check "$label totalShares" \
        "$(rpc call "$addr" "totalShares()(uint256)" | cut -d' ' -f1)" "0"
    check "$label paused" "$(rpc call "$addr" "paused()(bool)")" "false"
    check "$label MINTER_ROLE -> VAULT_MINTER" \
        "$(rpc call "$addr" "hasRole(bytes32,address)(bool)" "$MINTER_ROLE" "$VAULT_MINTER")" \
        "true"
    check "$label GUARDIAN_ROLE -> VAULT_GUARDIAN" \
        "$(rpc call "$addr" "hasRole(bytes32,address)(bool)" "$GUARDIAN_ROLE" "$VAULT_GUARDIAN")" \
        "true"
    if [ -n "$VAULT_ADMIN" ]; then
        check "$label DEFAULT_ADMIN_ROLE -> VAULT_ADMIN" \
            "$(rpc call "$addr" "hasRole(bytes32,address)(bool)" "$DEFAULT_ADMIN_ROLE" "$VAULT_ADMIN")" \
            "true"
    fi
    check "$label MINT_SHARES_SELECTOR" \
        "$(rpc call "$addr" "MINT_SHARES_SELECTOR()(bytes4)")" \
        "$(cast sig 'mintShares(bytes32,address,uint256)')"
done

echo "== equal seeding =="
prot_assets="$(rpc call "$PROTECTED_VAULT_ADDRESS" "totalAssets()(uint256)" | cut -d' ' -f1)"
ctrl_assets="$(rpc call "$CONTROL_VAULT_ADDRESS" "totalAssets()(uint256)" | cut -d' ' -f1)"
check "protected == control balance" "$prot_assets" "$ctrl_assets"

echo
if [ "$fail" -eq 0 ]; then
    echo "DEPLOYMENT VERIFIED"
else
    echo "DEPLOYMENT VERIFICATION FAILED"
    exit 1
fi
