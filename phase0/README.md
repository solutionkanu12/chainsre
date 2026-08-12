# Phase 0 verification scripts

Safe, standalone checks to prove KeeperHub feasibility **before** scaffolding the
app (roadmap Phase 0). These are verification tooling — **not** the ChainSRE app.

## Safety model

- **Secrets come only from a local `.env`** (copy from `.env.example`). Never
  commit `.env`; never paste keys into chat, screenshots, or source.
- Scripts **redact** the API key in all output.
- **Reads are safe** (`01-chains.sh`, `03-status.sh`).
- **Writes are gated.** `02-harmless-call.sh` (broadcast stage) and
  `04-workflow-trigger.sh` print the exact request and then **refuse** unless
  `CONFIRM_BROADCAST=yes` is set. Nothing broadcasts by accident.
- All endpoint paths + request-body field names are **assumptions from the
  planning docs** and must be reconciled with the live KeeperHub API reference
  (`docs.keeperhub.com`). Override any path via the `KEEPERHUB_*_PATH` env vars.

## Setup

```bash
cd phase0
cp .env.example .env
# edit .env: set KEEPERHUB_API_KEY, KEEPERHUB_BASE_URL, RPC, target, etc.
chmod +x *.sh
```

## Run order

```bash
# 0) READ-ONLY: confirm the org key is valid (GET /api/keys -> 200/401)
./00-auth-check.sh

# 1) READ-ONLY: confirm Base Sepolia (84532) is present + isEnabled==true
./01-chains.sh

# 2) Harmless contract call — SIMULATE only (safe, simulate:true body boolean):
./02-harmless-call.sh
#    then, only after reviewing the printed request, the real write:
CONFIRM_BROADCAST=yes ./02-harmless-call.sh
./03-status.sh execution <executionId>

# 3) Guardian workflow trigger — dry run prints request then STOPS:
./04-workflow-trigger.sh
#    real trigger (point at a THROWAWAY target for the first test):
CONFIRM_BROADCAST=yes ./04-workflow-trigger.sh
./03-status.sh workflow <executionId>
```

## Confirmed API facts (docs.keeperhub.com)

- Auth: `Authorization: Bearer kh_...` (org key). Broadcast needs `mcp:write` scope; dry run needs `mcp:read`.
- `simulate` is a **body boolean** on `/api/execute/contract-call` (not a query param). A would-revert dry run returns HTTP 400 with `wouldRevert:true`.
- Idempotency is the **`Idempotency-Key` HTTP header** (24h window; same key + different body → 409).
- Direct-execution status carries an `X-Poll-Interval-Hint` header (`0` = terminal). Workflow status has no hint — use the `/wait` long-poll.
- Base Sepolia (84532) is supported and gas-sponsored; **testnet is not charged**.
- Web3 workflow "Write Contract" step uses `abiFunction`/`functionArgs` keys (different from the Direct API's `functionName`/`functionArgs`).

## Before any real write

Show the operator the exact `POST` URL + body the script prints, confirm the
target is harmless/throwaway, confirm the wallet is funded, **then** set
`CONFIRM_BROADCAST=yes`. Record every executionId, tx hash, and BaseScan link in
`../PHASE-0-RESULTS.md`.

Requires `bash`, `curl`; `jq` optional (nicer output). On Windows, run under WSL
or Git Bash.
