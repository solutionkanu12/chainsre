# ChainSRE — Phase 3 Results

**Status:** PASS. A standalone, no-frontend script authenticated to KeeperHub, committed a
fresh typed intent through it, executed the declared mint through it, triggered the real
guardian workflow through it, and independently verified `paused() == true` on Base Sepolia
— all against the real Phase 2 contracts, all real transactions.

**Network:** Base Sepolia, chain ID `84532`. **Date:** 2026-08-13.

Everything below is public, non-secret information. No API key, private key, or RPC
credential is recorded here or anywhere in the repository.

---

## 1. KeeperHub client

`apps/api/src/lib/keeperhub/` — a narrow, typed REST client. Every later phase (the
watcher, the guardian service, the demo orchestrator) is expected to call into it rather
than build its own KeeperHub requests, so the safe-execution lifecycle is enforced in one
place:

| File | Responsibility |
|---|---|
| `env.ts` | Loads `KEEPERHUB_API_KEY` / `KEEPERHUB_BASE_URL` / `KEEPERHUB_GUARDIAN_WORKFLOW_ID`. Fails with a clear, name-only error (never a value) when required config is missing. |
| `http.ts` | The only place an `Authorization` header is built. Never logged. Maps 401/409/429/5xx/network-failure/timeout/malformed-JSON to typed errors; 2xx and 400 pass through for the caller to interpret (a would-revert simulation is a normal 400). |
| `errors.ts` | `KeeperHubAuthError`, `RateLimitError`, `TransientError` (retryable), `TimeoutError`, `SimulationRevertError`, `IdempotencyConflictError` / `IdempotencyInProgressError`, `ExecutionFailedError`, `MalformedResponseError`, `ChainUnavailableError`. |
| `idempotency.ts` | `chainsre:{runId}:{step}` key builder, matching `03-System-Architecture.md` §6. Rejects unsafe characters so a key can never accidentally collide two runs. |
| `polling.ts` | Bounded polling (hard cap on attempts *and* total wall time — never unbounded). Retries a retryable error with backoff; propagates anything else immediately. |
| `client.ts` | `checkAuth`, `listChains` / `requireChainEnabled`, `simulateContractCall`, `broadcastContractCall`, `executeContractCallSafely` (simulate → require success/no-revert → broadcast with idempotency → poll → require `completed`), `executeWorkflow` / `executeWorkflowSafely`, execution-status polling honoring `X-Poll-Interval-Hint`. |

`apps/api/src/lib/chain/` provides independent, KeeperHub-free verification: a viem public
client plus hand-written ABI fragments for the exact functions Phase 3 calls (neither
contract is verified on BaseScan yet, so KeeperHub cannot resolve their ABIs itself).

### A field-shape correction to the Phase 0 scripts

The live docs (confirmed by two independent fetches of the same example) specify that
`functionArgs` and `abi` on `POST /api/execute/contract-call` are **JSON-encoded strings**,
e.g. `"functionArgs": "[\"0x...\"]"` — not raw JSON arrays. `phase0/02-harmless-call.sh`
embedded a raw array literal instead; that script was never run against the live API
(`PHASE-0-RESULTS.md` records it as `⬜ not run`), so the mistake was never exercised. The
Phase 3 client sends both fields correctly, `JSON.stringify`'d, and the real broadcast below
confirms KeeperHub accepts that shape.

---

## 2. Guardian workflow

Created in the KeeperHub console, targeting the **real** protected vault rather than the
Phase 0 throwaway target:

| Field | Value |
|---|---|
| Workflow | **ChainSRE Guardian - Protected Vault** — id `hlf2xtixpndbm24dmj5kg` |
| Trigger | Manual, disabled at rest (same safety posture as the Phase 0 guardian) |
| Action | Web3 "Write Contract" → `pause()` on `0x429F2b842e5B0BCfd5f8359736aCC444FB35fB4B`, network `84532`, using the org's existing web3 wallet integration |

The Phase 0 guardian workflow (`djicil86qilmi2q3akkt4`, still targeting its own throwaway
contract) was left untouched.

---

## 3. Live proof

`apps/api/scripts/phase3-live-proof.ts` — run via `pnpm --filter @chainsre/api proof:phase3`.
Safety model matches `phase0/*.sh`: a dry run prints the exact request and does nothing; a
real write requires `CONFIRM_BROADCAST=yes`; nothing secret is ever printed.

A dry run was executed first and confirmed the exact request shape (addresses, ABI,
function args) before any broadcast. The real run followed.

### Readiness

| Check | Result |
|---|---|
| `GET /api/keys` | 200 — credential valid |
| `GET /api/chains` | `84532` present, `isEnabled: true`, `usePrivateMempoolRpc: false` |

### Step 1 — fresh intent commitment through KeeperHub

A new `MintIntentV1` was built with a fresh nonce (`Date.now()`, so it can never collide
with any prior run's nonce for this agent) and a fresh deadline — **not** a reuse of any
Phase 2 transaction.

| Field | Value |
|---|---|
| intentId | `0x6563b3c06e1076b3db8bb4d8ea65fc9b9862f92104565a2f22365e68d91f19cd` |
| Declared shares | `950000000000000000000` (950 × 10¹⁸) |
| KeeperHub execution ID | `kvfmkyil9f6l3dlkaok7n` |
| Transaction | [`0x685a566d…397a5fc`](https://sepolia.basescan.org/tx/0x685a566d0dac5f5e89385f929137bdaac088b9d4adf0b1158374469cd397a5fc) |
| Independent verification | `IntentRegistry.isCommitted(intentId)` read directly over RPC → **`true`** |

### Step 2 — declared mint executed through KeeperHub

Against the real protected vault, simulated first, then broadcast through
`executeContractCallSafely`.

| Field | Value |
|---|---|
| KeeperHub execution ID | `0ceujj9asga1yoahgw5pm` |
| Transaction | [`0xa313eff4…a790269`](https://sepolia.basescan.org/tx/0xa313eff427b25cc6983c320f8faee8a8cefc302cb4c7c24eb51db8adfa790269) |
| Independent verification | `sharesOf(agent)` read before and after: `0 → 950000000000000000000`, delta = exactly the declared amount |

### Step 3 — real guardian workflow triggered through KeeperHub

`POST /api/workflows/hlf2xtixpndbm24dmj5kg/execute`, polled to a terminal state via
`executeWorkflowSafely`.

| Field | Value |
|---|---|
| Workflow execution ID | `adk2h05a9qnmrnab0h1in` |
| Node transaction | [`0x745271a6…8281dd`](https://sepolia.basescan.org/tx/0x745271a6cacb06e610fb1b841b3c89dc8e3895c9275ebb04caf6af8ee38281dd) |
| KeeperHub-reported receipt status | `success` |

### Step 4 — independent containment verification

An HTTP 2xx and a `completed` workflow status are not treated as proof. The script makes a
separate, independent `eth_call` to `DemoVault.paused()`:

**`paused() == true`** — confirmed directly against Base Sepolia, not inferred from
KeeperHub's report.

### Step 5 — canonical demo state restored

Pausing the real protected vault through the guardian is a genuine state change; leaving it
paused would break later phases' need for an unpaused starting point. `DemoVault.unpause()`
is `DEFAULT_ADMIN_ROLE`-gated by design specifically for this reset path (`DemoVault.sol`:
*"Admin-only so the guardian role stays scoped to containment; used to reset demo fixtures
between runs"*). Restored with a direct admin call using the Phase 2 deployer key (which
holds `DEFAULT_ADMIN_ROLE`) — **not** routed through KeeperHub, since the guardian role
itself cannot unpause.

| Field | Value |
|---|---|
| Unpause transaction | [`0xe168e3a4…3dcf76e8c`](https://sepolia.basescan.org/tx/0xe168e3a4f9e10c0c17c60569da1408d3f605fbc16748736737247de3dcf76e8c) |
| `paused()` after | **`false`** |

### Final independently-verified state

| Property | Protected vault | Control vault |
|---|---|---|
| `paused()` | `false` | `false` |
| `totalShares()` | `950000000000000000000` (the legitimate Step 2 mint) | `0` — untouched |
| `totalAssets()` | `1000000000000000000000000` (unchanged — minting moves no assets) | `1000000000000000000000000` — untouched |
| Runtime bytecode | identical to control | identical to protected |
| `MINTER_ROLE` / `GUARDIAN_ROLE` / `DEFAULT_ADMIN_ROLE` on the KeeperHub wallet | all `true`, unchanged | — |

The control vault is completely untouched by Phase 3. The protected vault carries one
legitimate 950-share mint — the PRD's own "normal run" scenario (*"a matching action creates
no incident"*) — and is otherwise back to its Phase 2 initial state, unpaused and ready for
Phase 4 onward.

---

## 4. Reliability

- **Simulation-first, always.** `executeContractCallSafely` refuses to broadcast unless the
  simulation reports `success:true` and `wouldRevert:false`; tested to confirm the broadcast
  call is never even made otherwise.
- **Idempotency.** `chainsre:{runId}:{step}` keys, one per logical step, sent as the
  `Idempotency-Key` header. Retrying the same step with the same key either replays the
  original result (`idempotentReplay:true`, surfaced in the type) or fails loudly with
  `idempotency_conflict`/`idempotency_in_progress` — never silently double-broadcasts.
- **Bounded everything.** All polling has both a max-attempt cap and a max-wall-time cap
  (default 20 attempts / 5 minutes); a retryable failure encountered mid-poll (rate limit,
  transient 5xx) is retried with backoff without resetting those bounds.
- **Poll-hint aware.** Direct-execution polling honors `X-Poll-Interval-Hint`; workflow
  polling (which has no hint header) uses jittered exponential backoff.
- **A 2xx is never the proof.** Both the mint and the guardian trigger are followed by an
  independent on-chain read; the live run above demonstrates this is not just a test-suite
  claim — `paused()` was actually re-read from Base Sepolia, not trusted from KeeperHub's
  response.

---

## 5. Tests and verification

| Check | Result |
|---|---|
| Mocked KeeperHub client tests | **54 passed** (44 KeeperHub-specific: http transport, polling, idempotency, client lifecycle + 10 pre-existing) |
| Coverage | simulate success/revert, auth failure, 429 + `Retry-After`, 409 `idempotency_conflict`/`idempotency_in_progress`, transient 5xx, network failure, timeout, malformed JSON, idempotent-replay detection, workflow success/failure, poll-terminal, poll-timeout, functionArgs/abi wire-shape |
| Full JS/TS suite | **119 passed** (shared 52, db 12, api 54, web 1) — no live network calls required |
| `forge fmt --check` / `forge build` / Foundry tests | clean / clean / **61 passed** (unaffected by Phase 3) |
| `pnpm format:check` / `lint` / `typecheck` | clean |
| `pnpm build` (api + web) | pass |
| `pnpm audit --prod` | no known vulnerabilities |
| Secret scan of the staged diff | clean — no key, no `.env`, no credential value present |
| Live proof (`CONFIRM_BROADCAST=yes`) | **PASS** — see §3 |

---

## 6. Security review

Reviewed for: KeeperHub key leaks, `Authorization` header logging, arbitrary contract-call
exposure, arbitrary ABI/function exposure, SSRF via a configurable base URL, idempotency
mistakes, unbounded retries/polling, unsafe JSON parsing, uint256 precision loss, accidental
browser imports of server secrets, verbose provider-error leakage, and test fixtures
containing real credentials.

Findings and how they're addressed:

- **No route exposes this client.** Phase 3 adds no Fastify routes — everything is a library
  (`apps/api/src/lib/`) plus a standalone script. There is no HTTP path by which an
  end-user-supplied `contractAddress`/`functionName`/`abi` could reach KeeperHub with the
  org's key. Every call site in the codebase supplies a fully-formed, hardcoded request.
- **No SSRF surface.** `KEEPERHUB_BASE_URL` is fixed once per client at construction from
  validated env; nothing in `client.ts` accepts a caller-supplied base URL or lets one
  request redirect the org's bearer token to a different host.
- **The key never reaches an error, a log line, or a test fixture.** `http.ts` builds the
  `Authorization` header in exactly one place and never serializes it into a thrown error;
  a dedicated test asserts the serialized form of a thrown `KeeperHubAuthError` does not
  contain the key. Test fixtures use an obviously-fake `kh_test_…` value. `console.log` calls
  in the live-proof script print only addresses, execution/workflow IDs, tx hashes, and
  booleans — never an env object or a raw KeeperHub response body wholesale.
- **`apps/web` cannot import this code.** It has no dependency on `@chainsre/api`; the
  KeeperHub and chain libraries live under `apps/api/src/lib`, never under the shared
  package that ships to the browser.
- **Bounded retries and polling**, checked above — no `while(true)`, every loop has both an
  attempt cap and a wall-clock cap.
- **uint256 precision.** Share amounts flow through the live proof as `bigint` (viem's
  `readContract` return type) or decimal strings end to end; the before/after delta
  assertion in the script (and the equivalent test) compares `bigint` values, never `number`.
- **Correction applied:** `checkAuth`'s not-a-401 branch now checks `instanceof
  KeeperHubAuthError` directly rather than a string comparison on `.name`, closing a
  brittleness risk (refactors that miss updating `.name` would silently break the check).

---

## 7. Not in scope for Phase 3

Database persistence of executions/incidents (Phase 4), the event watcher and automatic
semantic comparator (Phase 5), agent/LLM orchestration (Phase 6), and any frontend or new
Fastify routes exposing this client over HTTP are explicitly out of scope here. This phase
proves KeeperHub execution works end to end from a script; wiring it into the product's
run/incident state machine is later-phase work.
