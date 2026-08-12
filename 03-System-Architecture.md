# ChainSRE System Architecture

## 1. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, Motion |
| Backend | Node.js, TypeScript, Fastify, Zod |
| Blockchain client | viem |
| Contracts | Solidity, Foundry, OpenZeppelin |
| Database | Supabase PostgreSQL |
| Agent | Provider-agnostic LLM planner with one scoped tool |
| Execution | KeeperHub Direct Execution API |
| Containment | KeeperHub stored workflow |
| Network | Base Sepolia, chain ID `84532` |
| Frontend deployment | Cloudflare Pages |
| Backend deployment | Always-on Render service |
| CI | GitHub Actions |

## 2. High-level Architecture

```text
Operator
   |
   v
Next.js command center
   |
   v
Fastify API and demo orchestrator
   |                     \
   v                      v
Agent planner          PostgreSQL
   |
   v
Scoped KeeperHub adapter
   |
   v
KeeperHub Direct Execution
   |
   v
Base Sepolia contracts
   |
   v
ChainSRE watcher and comparator
   |
   v
Guardian service
   |
   v
KeeperHub pause workflow
   |
   v
Protected vault pause()
```

## 3. Frontend

### Responsibilities

- Render landing page, command center, intent detail, incident detail, enrollment, and readiness.
- Authenticate the operator with a wallet signature.
- Start only fixed server-defined scenarios.
- Read normalized API state.
- Display KeeperHub IDs and BaseScan links.
- Use server-sent events or one-second polling for live status.

### Boundaries

- No KeeperHub API key.
- No direct database connection.
- No arbitrary contract address, ABI, function, amount, or calldata controls.
- Public visitors receive read-only access.

## 4. Backend API and Orchestrator

### Responsibilities

- Authentication, authorization, validation, CORS, and rate limits.
- Run and intent state machines.
- Agent planning and scoped tool invocation.
- KeeperHub simulation, broadcast, polling, and evidence storage.
- Attack fixture sequencing.
- Scheduled drain attempt.
- Public evidence API.

### Important separation

The orchestrator starts the action but does not decide whether it diverged. The independent event watcher performs that comparison using confirmed onchain evidence.

## 5. Agent Runtime

The LLM converts a fixed natural-language objective into `MintIntentV1` structured output.

It receives only one tool:

```text
commitAndExecuteMint(intent)
```

It never receives:

- KeeperHub credentials.
- A raw contract-call tool.
- Arbitrary ABI access.
- Database credentials.
- Guardian workflow control.

Adversarial mode visibly mutates the execution amount after commitment. This simulates compromised reasoning or prompt injection and must be disclosed in the README and demo.

## 6. KeeperHub Adapter

### Direct execution flow

1. Create the normalized contract-call request.
2. Send the same request with `simulate: true`.
3. Stop if simulation fails or would revert.
4. Remove simulation and add a stable idempotency key.
5. Broadcast once.
6. Poll execution status using KeeperHub's poll hint.
7. Persist execution ID, status, hash, link, gas, timestamps, and error.
8. Fetch or verify the receipt from Base Sepolia.

### Stable idempotency keys

Use one key per run step:

```text
chainsre:{runId}:commit
chainsre:{runId}:mint
chainsre:{runId}:pause
chainsre:{runId}:drain
```

Never reuse one key with a different request body.

## 7. Contracts

### `IntentRegistry.sol`

```solidity
function commitIntent(
    bytes32 intentId,
    address target,
    bytes4 selector,
    bytes32 paramsHash,
    uint64 deadline,
    uint64 nonce
) external;
```

Responsibilities:

- Anchor the declared intent.
- Reject reused agent nonces.
- Reject expired deadlines.
- Emit a correlation-friendly commitment event.

```solidity
event IntentCommitted(
    bytes32 indexed intentId,
    address indexed agent,
    address indexed target,
    bytes4 selector,
    bytes32 paramsHash,
    uint64 deadline,
    uint64 nonce
);
```

### `DemoVault.sol`

```solidity
function mintShares(bytes32 intentId, address receiver, uint256 shares) external;
function redeemShares(uint256 shares, address receiver) external;
function pause() external;
function paused() external view returns (bool);
```

Responsibilities:

- Hold seeded mock assets.
- Allow the configured minter to mint shares.
- Allow share redemption for assets.
- Allow the guardian to pause mint and redemption.
- Emit `intentId` with the actual mint values.

```solidity
event SharesMinted(
    bytes32 indexed intentId,
    address indexed operator,
    address indexed receiver,
    uint256 shares
);
```

### `MockAsset.sol`

Standard test ERC-20 used to make the control-vault loss visible. It must be clearly labeled as having no real value.

### Invariants

- One nonce per agent commitment.
- Only the minter can mint.
- Only the guardian can pause.
- Paused vaults reject mint and redemption.
- Protected and control vaults have identical code and initial balances.

## 8. Canonical Intent

```ts
type MintIntentV1 = {
  schema: "chainsre/mint-v1";
  intentId: `0x${string}`;
  chainId: 84532;
  agent: `0x${string}`;
  target: `0x${string}`;
  selector: `0x${string}`;
  receiver: `0x${string}`;
  shares: string;
  deadline: number;
  nonce: string;
};
```

### Encoding rules

- Encode addresses as Solidity `address`.
- Encode amounts, nonce, deadline, and chain as integers.
- `paramsHash = keccak256(abi.encode(receiver, shares))`.
- Include schema version in the full hash domain.
- Maintain shared Solidity and TypeScript golden test vectors.
- Never use JavaScript floating-point numbers for onchain values.

## 9. Event Watcher and Comparator

### Watched events

- `IntentCommitted`
- `SharesMinted`
- `Paused`
- Redemption success or failure evidence

### Processing

1. Resume from the stored block cursor.
2. Backfill missed blocks.
3. Wait for configured confirmation.
4. Decode the event and receipt.
5. Find the committed intent by `intentId`.
6. Confirm chain and target match.
7. Compare target, selector, receiver, amount, deadline, and nonce.
8. Persist the field-level result.
9. Create one critical incident when supported fields diverge.
10. Advance the cursor only after durable processing.

The comparison is deterministic TypeScript. The LLM is never asked whether an action is safe.

## 10. Guardian Service

1. Load the active enrollment.
2. Read its approved KeeperHub workflow ID.
3. Acquire a database incident lock.
4. Trigger the workflow with the enrolled vault address.
5. Poll workflow execution.
6. Persist node transaction hashes and errors.
7. Read `paused()` through an independent RPC.
8. Mark containment successful only when the onchain state is true.

Unknown contracts and unsupported selectors are not contained automatically.

## 11. Database

PostgreSQL stores:

- Enrollments and guardian workflow mapping.
- Demo run state.
- Human-readable intent fields and hashes.
- KeeperHub execution IDs and onchain receipts.
- Incidents and field-level semantic differences.
- Append-only incident timelines.
- Event watcher cursors.
- Short-lived authentication challenges.

The database coordinates the application. The blockchain receipt remains the authority for whether a transaction happened.

## 12. Authentication

### Operator sign-in

1. Browser requests a short-lived nonce.
2. Operator signs the challenge with an allowlisted wallet.
3. Backend verifies the signature using viem.
4. Challenge becomes unusable.
5. Backend issues a short-lived Secure, HttpOnly, SameSite cookie.

### Authorization

- Public: readiness summary, runs, intents, incidents, and evidence.
- Operator: start fixed scenarios, manage enrollment, retry failed containment.
- Internal: KeeperHub credentials, database, RPC, watcher, and guardian.

## 13. API Surface

```text
POST /v1/auth/challenge
POST /v1/auth/verify
POST /v1/auth/logout

GET  /v1/system/readiness
GET  /v1/enrollments
POST /v1/enrollments
PATCH /v1/enrollments/:id

POST /v1/demo/runs
GET  /v1/demo/runs/:id
GET  /v1/demo/runs/:id/events
GET  /v1/intents/:id
GET  /v1/incidents
GET  /v1/incidents/:id
GET  /v1/incidents/:id/export
POST /v1/incidents/:id/retry-containment
```

## 14. State Machines

### Demo run

```text
created
-> planning
-> committing
-> committed
-> executing
-> confirmed
-> evaluating
-> responding
-> testing_containment
-> completed
```

Explicit failure states:

- `planning_failed`
- `commit_failed`
- `action_failed`
- `detection_timeout`
- `containment_failed`
- `demo_failed`

### Incident

```text
detected
-> containment_queued
-> containment_running
-> containment_confirmed
-> state_verified
-> contained
```

## 15. Deployment

### Cloudflare Pages

- Hosts Next.js frontend and public assets.
- Contains only public chain, explorer, contract, and API values.

### Render

- Runs Fastify and the event watcher in one always-on service for the MVP.
- Must use an instance that does not sleep during judging.
- Readiness fails if the watcher becomes unhealthy.

### Supabase

- Managed Postgres with migrations and connection pooling.
- Browser does not connect directly.

### Base Sepolia

- Contracts verified on BaseScan.
- HTTP RPC for reads and fallback polling.
- Stable WebSocket RPC preferred for event watching.

### KeeperHub

- Organization API key stored only in Render.
- Execution wallet funded or sponsorship verified.
- Guardian workflow tested before deployment.
- Private routing claimed only when configuration confirms it.

## 16. Environment Variables

### Public frontend

```text
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_EXPLORER_URL=https://sepolia.basescan.org
NEXT_PUBLIC_INTENT_REGISTRY_ADDRESS
NEXT_PUBLIC_PROTECTED_VAULT_ADDRESS
NEXT_PUBLIC_CONTROL_VAULT_ADDRESS
```

### Backend secrets

```text
DATABASE_URL
KEEPERHUB_API_KEY
KEEPERHUB_BASE_URL=https://app.keeperhub.com
KEEPERHUB_GUARDIAN_WORKFLOW_ID
BASE_SEPOLIA_RPC_HTTP
BASE_SEPOLIA_RPC_WS
OPERATOR_ALLOWLIST
SESSION_SECRET
INTENT_REGISTRY_ADDRESS
PROTECTED_VAULT_ADDRESS
CONTROL_VAULT_ADDRESS
MOCK_ASSET_ADDRESS
ATTACK_WINDOW_MS
CONFIRMATION_COUNT
```

## 17. Reliability and Observability

- Persisted block cursor with backfill.
- Stable execution idempotency keys.
- Unique incident and containment constraints.
- Structured logs with run, intent, incident, KeeperHub execution, and transaction IDs.
- Bounded external timeouts and retries.
- Readiness checks for database, RPC, KeeperHub, contract code, roles, wallet balance, and watcher lag.
- Metrics for detection time, containment time, run success, watcher lag, duplicate triggers prevented, and KeeperHub failures.

## 18. Security Boundary

ChainSRE can contain downstream damage after the first divergent transaction confirms. It cannot reverse that transaction or guarantee a response before an atomic bundled drain. Production hardening should move validation into an atomic onchain guard and separate agent and guardian custody.

