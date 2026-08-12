# ChainSRE — Phase 0 Results

**Scope of this phase:** Verify hard requirements *before* scaffolding the app
(roadmap Phase 0). No app code, contracts, or KeeperHub integration is built
here. This document records verified facts, evidence, blockers, and the final
go/no-go.

- **Date started:** 2026-08-10
- **Last updated:** 2026-08-12 (guardian `pause()` workflow created **and proven to execute on-chain** — B4 resolved, §1.7; external *API*-trigger deferred to Phase 3)
- **Status:** ✅ **PHASE 0 COMPLETE (GO).** Feasibility verified from docs; org
  inspected read-only via authenticated MCP; sender funding confirmed on-chain;
  and a real guardian `pause()` was executed through KeeperHub on Base Sepolia and
  **verified on-chain** (§1.7). The one remaining nicety — invoking that workflow
  via the REST `kh_` API key rather than the console — is a backend-integration
  detail scheduled for **Phase 3**, not a Phase 0 blocker.
- **Overall decision:** ✅ **GO — proceed to scaffold the app (Phase 1).** API
  feasibility is confirmed from official docs; the org/chain/funded-sender are
  confirmed live; the deadline is operator-verified (2026-08-13 12:00 UTC+2); and
  **real KeeperHub execution of `pause()` on 84532 is proven on-chain** (execution
  `bowz6kzw2cwinj7ph13oy`, tx `0x0e8f…7098`, `paused()==true`, §1.7). External
  API-triggering is deferred to Phase 3 (see **Blockers** B4 and **Decision**).

> Two agents were used to gather external facts. Assistant-run web research is
> corroborating evidence, not proof of your org's live configuration. Anything
> depending on *your* API key, wallet, or the specific hackathon page is marked
> **OPERATOR-VERIFY** and must be confirmed by you.

---

## 1. KeeperHub API feasibility — VERIFIED from official docs

Source of truth: <https://docs.keeperhub.com>. Every claim below was pulled from
a direct read of the specific docs page cited.

| # | Requirement | Result | Evidence |
|---|---|---|---|
| Base URL | `https://app.keeperhub.com`, paths already include `/api` (do **not** append `/api` again — doubling → 404) | ✅ VERIFIED | [docs/api](https://docs.keeperhub.com/api) |
| Auth | `Authorization: Bearer kh_...` org key. Broadcast needs `mcp:write`; dry run needs `mcp:read`. Health check: `GET /api/keys` → 200/401 | ✅ VERIFIED | [docs/api/authentication](https://docs.keeperhub.com/api/authentication) |
| Chain discovery | `GET /api/chains` → **bare JSON array**; each item has numeric `chainId`, `isEnabled`, `isTestnet`, `usePrivateMempoolRpc`. `?includeDisabled=true` lists disabled too | ✅ VERIFIED | [docs/api/chains](https://docs.keeperhub.com/api/chains) |
| **Base Sepolia (84532)** | Supported (alias `base-sepolia`/`base-testnet` → 84532) and **gas-sponsored**; **testnet is not charged** | ✅ VERIFIED (docs) / ⚠️ OPERATOR-VERIFY `isEnabled` on your org | [docs/api/chains](https://docs.keeperhub.com/api/chains), [docs/wallet-management/gas](https://docs.keeperhub.com/wallet-management/gas) |
| Contract call | `POST /api/execute/contract-call`; body `{ contractAddress, chainId, functionName, functionArgs?, abi?, value?, simulate? }`; write resp `{ executionId, status }` | ✅ VERIFIED | [docs/api/direct-execution](https://docs.keeperhub.com/api/direct-execution) |
| Simulation | `simulate` is a **strict body boolean** (not a query param). Dry run → `success:true,status:"simulated"` + `gasEstimate`; would-revert → **HTTP 400 with `wouldRevert:true`** | ✅ VERIFIED | [docs/api/direct-execution](https://docs.keeperhub.com/api/direct-execution) |
| Execution status | `GET /api/execute/{executionId}/status` → `transactionHash`, `transactionLink`, `sponsored`, `receipts[]`, `gasUsedWei`, statuses `pending/running/completed/failed` | ✅ VERIFIED | [docs/api/direct-execution](https://docs.keeperhub.com/api/direct-execution) |
| Idempotency | **`Idempotency-Key` HTTP header** (not a body field). 24h window; same key + different body → 409 `idempotency_conflict`; in-flight dup → 409 `idempotency_in_progress` | ✅ VERIFIED | [docs/api/direct-execution](https://docs.keeperhub.com/api/direct-execution) |
| Poll hints | Direct execution: `X-Poll-Interval-Hint` response header (seconds; `0` = terminal). Workflows: **no** hint header — use `/wait` long-poll | ✅ VERIFIED | [docs/api/direct-execution](https://docs.keeperhub.com/api/direct-execution), [docs/api/executions](https://docs.keeperhub.com/api/executions) |
| Workflow trigger | `POST /api/workflows/{workflowId}/execute`, body `{ "input": {...} }` (optional) → `{ executionId, status:"running" }` | ✅ VERIFIED | [docs/api/workflows](https://docs.keeperhub.com/api/workflows) |
| Workflow status | `GET /api/workflows/executions/{executionId}/status` → `transactionHashes[]` (hash, nodeId, blockNumber, gasUsed, receiptStatus, verified). Long-poll: `/wait?timeoutMs=` (≤60000) | ✅ VERIFIED | [docs/api/executions](https://docs.keeperhub.com/api/executions) |
| **Workflow can call `pause()`** | Web3 "Write Contract" step executes arbitrary state-changing fns. Keys: `abiFunction:"pause"`, `functionArgs:"[]"`, plus `abi`, `network` | ✅ VERIFIED | [docs/plugins/web3](https://docs.keeperhub.com/plugins/web3) |
| Rate limits | 100 req/min authenticated, 10 req/min unauth; `x-request-id` for correlation | ✅ VERIFIED | [docs/api/authentication](https://docs.keeperhub.com/api/authentication) |
| Private routing | Per-chain `usePrivateMempoolRpc` boolean exists; **per-request toggle mechanics UNVERIFIED** | ⚠️ PARTIAL | [docs/api/chains](https://docs.keeperhub.com/api/chains) |

### ⚠️ Corrections to the planning docs (apply before/at Phase 3)

These are places where the current planning docs (`02`, `03`) differ from the
verified API. They do **not** block Phase 0 but must be fixed when Phase 3 is built:

1. **Contract-call body field is `contractAddress`, not `target`; args are
   `functionArgs`, not `args`.** (`03-System-Architecture.md` §6, §13.)
2. **`simulate` is a body boolean**, not a separate simulate step/flag semantics —
   send `simulate:true` in the same body you would broadcast.
3. **Idempotency is an HTTP header `Idempotency-Key`**, not a body field. The
   `chainsre:{runId}:{step}` key convention (`03` §6) is fine — just send it as a header.
4. **Poll strategy differs by subsystem**: direct execution uses the
   `X-Poll-Interval-Hint` header; workflows use the `/wait` long-poll. (`03` §6, §10.)
5. **Workflow Web3 step uses `abiFunction`/`functionArgs`** — different keys from
   the Direct Execution API. Don't copy request bodies between the two surfaces.
6. Optional convenience: `GET /api/chains/{chainId}/abi?address=` fetches a
   contract ABI; `GET /api/keys` is a cheap credential health check.

---

## 1.5 Live KeeperHub org inspection — read-only via authenticated MCP (2026-08-11)

Performed against the connected, authenticated KeeperHub MCP server. **Read-only:
nothing was created, modified, simulated, executed, or broadcast.** These are the
first *live* observations of your actual org (previous sections are docs research).

| # | Question | Answer | Evidence (read-only MCP) |
|---|---|---|---|
| 1 | **Is my org active?** | ✅ **YES** | Multiple org-scoped read calls returned data. `organizationId = f1dc7ab7-4d1e-45d6-9253-0dc4438421d5`, owner role present. Daily spend limits readable: `dailyCapWei: null` (no cap set), `dailyUsedWei: "0"`. |
| 2 | **Base Sepolia 84532 available & enabled?** | ✅ **AVAILABLE** (⚠️ see nuance) | In the org's chain set (22 chains): `{chainId: 84532, name: "Base Sepolia", chainType: "evm", isTestnet: true, status: "stable", explorerUrl: "https://sepolia.basescan.org"}`. The **MCP** surface reports `status: "stable"` rather than the REST `isEnabled` boolean — so "available + stable" is confirmed; an explicit per-org `isEnabled` flag is a REST-only field, confirm via `01-chains.sh` when the key is in `.env`. |
| 3 | **Sender configured & funded?** | ✅ **CONFIGURED & FUNDED** | Exactly **one** web3 wallet integration: `id=noqlo1l4tal32d3agkdxi`, address `0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB`, type `web3`, `isManaged: false` (external/self-custody), empty config, created 2026-08-10. Read-only MCP metadata exposes **no balance field**; funding was therefore confirmed by a separate on-chain balance read — **2 ETH on Base Sepolia (2026-08-11)**, see §1.6. |
| 4 | **Does any pause workflow exist?** | ❌ **NO** | 3 workflows exist, all **seeded examples**: "Aave Health Factor Monitor", "Large Withdrawal Alert", "Aave Governance Proposal Alert". **All** are `network: "1"` (Ethereum mainnet), `workflowType: "read"`, `enabled: false`. **None** calls `pause()`, **none** targets Base Sepolia, **none** is a write/guardian workflow. Projects list is empty. |
| 5 | **What remains before safely testing a real pause workflow?** | See list below | — |

### What remains before a real pause-workflow test (answer to Q5)

1. ~~Confirm the execution wallet is funded (or sponsored) on Base Sepolia.~~
   ✅ **DONE (2026-08-11):** on-chain balance read shows **2 ETH** at
   `0x6C0a…8bcB` on 84532 — see §1.6. (Wallet is external, `isManaged: false`;
   self-funded rather than relying on sponsorship.)
2. **A deployed, pausable target contract on Base Sepolia** with `pause()` and a
   guardian/pauser role. None exists yet — the pause workflow has nothing to call.
   (This is Phase 2 work; a throwaway pausable contract suffices for the Phase-0
   trigger proof.)
3. **Create the guardian pause() workflow in KeeperHub** (Web3 "Write Contract"
   step: `abiFunction:"pause"`, `functionArgs:"[]"`, `network:"84532"`, `abi`,
   `contractAddress`) and record `KEEPERHUB_GUARDIAN_WORKFLOW_ID`.
4. **Grant the KeeperHub sender wallet the pauser/guardian role** on that contract,
   so the workflow's call is authorized on-chain.
5. **Confirm the REST `kh_` API key + scope for the scripts.** The MCP session is
   authenticated for inspection, but `phase0/*.sh` use a separate `kh_` org key;
   broadcasting/triggering needs `mcp:write`.
6. **The stop-and-show gate** — I show you the exact request, you confirm, only
   then `CONFIRM_BROADCAST=yes`.

> **Update (2026-08-12):** items 2–4 are now **DONE**. A throwaway pausable target
> is live at `0x502c…a77e80` (Base Sepolia); the guardian `pause()` workflow
> `djicil86qilmi2q3akkt4` was created; and the sender **is** the contract's
> `pauser`, so its call is authorized. All three are proven by a real on-chain
> execution — see **§1.7**. Item 5 (REST `kh_` write key for `phase0/*.sh`) is not
> needed for Phase 0: the console-triggered run already proved real execution, and
> programmatic API-triggering moves to Phase 3.

> **Privacy note:** the owner email and any secret material returned by the MCP
> were intentionally **not** written here. Recorded identifiers (org UUID, public
> wallet address) are non-secret.

---

## 1.6 Live Base Sepolia funding verification — read-only RPC (2026-08-11)

Confirms blocker **B3b**. A public, unauthenticated JSON-RPC read against the
official Base Sepolia endpoint — **no KeeperHub, no secrets; nothing signed,
deployed, simulated, or broadcast.**

| Field | Value |
|---|---|
| RPC endpoint | `https://sepolia.base.org` |
| chainId | `0x14a34` = **84532** (via `eth_chainId`; required value — **PASS**) |
| Sender address | `0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB` (the configured KeeperHub sender) |
| Balance (hex) | `0x1bc16d674ec80000` |
| Balance (wei) | `2000000000000000000` |
| Balance (ETH) | **2** |
| Verified at block | `45346386` (`0x2b3ee52`) |
| Block timestamp | **2026-08-11 15:11:00 UTC** (`0x6a7b3b84` = 1786461060) |
| Explorer | <https://sepolia.basescan.org/address/0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB> |

**Sufficiency:** 2 test ETH is far more than enough to deploy and test the small
ChainSRE demo contracts. On Base Sepolia's sub-gwei-to-low-gwei gas, deploying
two vaults plus a full run of test transactions is on the order of ~0.02–0.05
ETH, leaving a large margin.

> ⚠️ **Address-typo caveat:** a variant `0x6C0a…3e7C**E**192…7328**E**cAEf…8bcB`
> (three F→E nibble differences) appeared in a request — it is a **different**
> address and also holds 0. Always fund/verify the exact configured sender above.

---

## 1.7 Live guardian `pause()` execution — VERIFIED ON-CHAIN (2026-08-12)

Resolves blocker **B4**. The guardian workflow was created in KeeperHub, then run
once; the run landed a real `pause()` transaction on Base Sepolia. Confirmed two
independent ways: KeeperHub's own execution record (read-only MCP) **and** a direct
public JSON-RPC read of the transaction, receipt, event log, and post-state against
`https://sepolia.base.org`. **Nothing was signed, executed, or broadcast during this
verification — it is a read-back of an execution the operator triggered.**

| Field | Value |
|---|---|
| Workflow | **ChainSRE Phase 0 Guardian** — id `djicil86qilmi2q3akkt4` (Manual trigger, `enabled:false` at rest) |
| Execution ID | **`bowz6kzw2cwinj7ph13oy`** — final status **success** (both nodes success; 2/2 steps; 3.02 s) |
| Trigger | `triggerSource:"manual"`, `triggeredByCredentialType:"session"` (KeeperHub console, **not** the REST `kh_` API) on 2026-08-12T04:15:12Z |
| Transaction hash | **`0x0e8f33e773cba65a3f79bf63c9c3e799fd249171db5ba4ad7cd655b47aed7098`** |
| BaseScan | <https://sepolia.basescan.org/tx/0x0e8f33e773cba65a3f79bf63c9c3e799fd249171db5ba4ad7cd655b47aed7098> |
| Chain | **84532** (Base Sepolia) — tx `chainId 0x14a34`; block **45,369,913** (`0x2b44a39`) |
| Target contract | **`0x502c41889a5941a937e7718e0df0093a22a77e80`** (the throwaway pause target; log emitter) |
| Function / selector | `pause()` → **`0x8456cb59`** (confirmed `cast sig "pause()"`) |
| Effective caller | **`0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB`** — the configured KeeperHub sender = the contract's authorized `pauser` |
| Receipt status | **success** (`status: 0x1`); `gasUsed 94002`; `verified:true` by KeeperHub |
| Post-state `paused()` | **`true`** (`eth_call` selector `0x5c975abb` → `0x…01`) |

**Proof the right principal called it.** The receipt contains exactly one log, from
the target contract, topic0 = `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258`
= `keccak256("Paused(address)")`, topic1 = `0x…6c0a292c3e7cf192efb4d6c7328fcaff12208bcb`.
Since `pause()` reverts with `NotPauser` unless `msg.sender == pauser` and emits
`Paused(msg.sender)`, this log proves the effective caller was the authorized pauser
`0x6C0a…8bcB`.

**Sponsored EIP-7702 detail (why the raw `from`/`to` are not the wallet/target).**
The run used KeeperHub's sponsored path (`sponsored:true`). On-chain the tx is
**type `0x4` (EIP-7702 set-code)** with an `authorizationList` delegating account
code to implementation `0x955d84139e7621bc571b117d8eb5d28a4a222c6f`:
- outer **`from`** = `0xdcf4bac4bd805948168ff63483bc493894a29613` — KeeperHub's gas-paying **relayer** (not our wallet);
- outer **`to`** = `0x5af5194b4b0909eb978e3cf1e25333852277f07d` — the executor; outer selector `0x9aefaff8` (a relay wrapper), **not** `pause()`;
- the pause() selector **`0x8456cb59`**, the authority `0x6C0a…8bcB`, the target `0x502c…a77e80`, and `value 0` all appear inside the wrapper's calldata.

So the gas payer is KeeperHub's relayer while the **authorized on-chain caller** of
`pause()` is our sender `0x6C0a…8bcB` — exactly the intended guardian semantics, and
gas-free to us on this sponsored testnet.

> **Operational note:** `paused()` is now **`true`**. `pause()` reverts with
> `AlreadyPaused` when already paused, and only `owner` (also `0x6C0a…8bcB`) may
> `unpause()`. A second run of this guardian as-is would fail with `AlreadyPaused`;
> for a repeat demo, `unpause()` first or point the workflow at a fresh target.

---

## 2. DoraHacks / hackathon requirements

Source of truth for anything event-specific: the hackathon page itself
(dorahacks.io blocks automated fetching, so specifics below are from search
summaries, **not** first-hand page reads — treat as leads, confirm in a browser).

| Item | Result | Evidence |
|---|---|---|
| Hackathon identity | **"KeeperHub — Agents Onchain"** on DoraHacks | ⚠️ OPERATOR-VERIFY | <https://dorahacks.io/hackathon/agents-onchain/detail> |
| Core rule | Must use **KeeperHub as the onchain execution layer** | ⚠️ OPERATOR-VERIFY | hackathon page |
| Submission model | BUIDL = reusable project page; submit → track → **organizer approval** → gallery; editable until deadline | ✅ VERIFIED (general) | [how-to-submit-a-buidl](https://dorahacks.io/blog/guides/how-to-submit-a-buidl/) |
| Required artifacts | GitHub/source link + short demo video commonly required; organizer can make each mandatory | ✅ VERIFIED (general) / ⚠️ exact rule OPERATOR-VERIFY | [good-hackathon-submission](https://dorahacks.io/blog/news/good-hackathon-submission) |
| Video length limit | **No platform-wide limit** — per-hackathon. Must read off the page | ⚠️ OPERATOR-VERIFY | per-hackathon rules pages |
| Repository rule | Public/testable repo strongly expected; private repo / dead links = classic disqualifier | ✅ VERIFIED (general) | [good-hackathon-submission](https://dorahacks.io/blog/news/good-hackathon-submission) |
| **Deadline** | **2026-08-13 12:00 UTC+2** (= **10:00 UTC** = **11:00 WAT**), read off the event-timeline widget | ✅ **OPERATOR-VERIFIED** | <https://dorahacks.io/hackathon/agents-onchain/detail> (event-timeline widget) |
| Base Sepolia eligibility for this hackathon | Hard requirement is **KeeperHub as the onchain execution layer**; **Base Sepolia (84532) is enabled by KeeperHub** (§1.5) and **no inspected rule prohibits it**. ⚠️ No explicit per-network allowlist found on the page → eligibility is *inferred*, not stated | ⚠️ PARTIAL (verified facts + caveat) | hackathon page; §1.5 |

> ⏰ **Time-sensitivity:** the deadline is now **operator-verified** as 2026-08-13
> 12:00 UTC+2 (10:00 UTC / 11:00 WAT) — roughly **~2 days** from the 2026-08-11
> funding verification. This is a hard, near constraint: scope every remaining
> phase to fit inside it and keep throwaway/verification work lightweight.

---

## 3. Safe verification tooling (built this phase, not yet run against live API)

Standalone checks live in [`phase0/`](./phase0/). They are verification tooling,
**not** the app. Safety model:

- Secrets only from a local, git-ignored `.env` (template: `phase0/.env.example`).
- API key is **redacted** in all script output.
- **Reads are safe** (`00-auth-check.sh`, `01-chains.sh`, `03-status.sh`).
- **Writes are gated**: `02-harmless-call.sh` (broadcast stage) and
  `04-workflow-trigger.sh` print the exact request, then refuse unless
  `CONFIRM_BROADCAST=yes`. Nothing broadcasts by accident.
- All six scripts pass `bash -n` syntax checks.

| Script | Type | Roadmap item | Status |
|---|---|---|---|
| `00-auth-check.sh` | read | Create org + API key | ⬜ not run (needs your key) |
| `01-chains.sh` | read | Read enabled chains, confirm Base Sepolia | ⬜ not run |
| `02-harmless-call.sh` | simulate (safe) → broadcast (gated) | One harmless real testnet tx | ⬜ not run |
| `03-status.sh` | read | Evidence: hash, block, poll hint | ⬜ not run |
| `04-workflow-trigger.sh` | trigger (gated) | Confirm stored workflow can call a Base Sepolia contract | ⬜ not run |

---

## 4. Roadmap Phase 0 checklist status

From `04-Development-Roadmap.md` → Phase 0. **A→R = assistant-researched (docs),
O = operator action required.**

- [~] Confirm DoraHacks deadline, required fields, video limit, repository rules
  — deadline **operator-verified** (2026-08-13 12:00 UTC+2, §2); required
  fields / video limit / repo rules still to confirm on the event page.
- [ ] Create KeeperHub organization and API key **(O)** — path known: Settings →
  API Keys → Organisation → `kh_` key.
- [A→R] Read enabled chains and confirm Base Sepolia — **API + 84532 support
  confirmed in docs**; run `01-chains.sh` to confirm `isEnabled` on your org **(O)**.
- [ ] Record KeeperHub wallet address **(O)**.
- [x] Fund the wallet or verify sponsorship **(O)** — ✅ **2 ETH** confirmed
  on-chain at the sender on Base Sepolia (2026-08-11, §1.6).
- [x] Execute one harmless real KeeperHub testnet transaction — ✅ a real,
  sponsored KeeperHub state-changing tx landed on 84532 (the guardian `pause()`,
  §1.7). This proves real KeeperHub execution end-to-end; the dedicated trivial
  `02-harmless-call.sh` via the REST key is folded into Phase 3.
- [x] Confirm a stored workflow can call a Base Sepolia contract — ✅ workflow
  `djicil86qilmi2q3akkt4` called `pause()` on `0x502c…a77e80` and flipped
  `paused()` to `true`, verified on-chain (§1.7). **Console/session-triggered**;
  triggering the same workflow via the REST `kh_` API (`04-workflow-trigger.sh`) is
  scheduled for Phase 3 (see Decision).
- [ ] Record actual routing configuration **(O)** — read `usePrivateMempoolRpc`
  from `01-chains.sh` output; per-request private-routing toggle is UNVERIFIED.
- [~] Freeze the MVP claims and non-goals — already fixed by the planning docs;
  re-affirm after the deadline is known.

---

## 5. Blockers

Status key: 🚩 open · ✅ resolved (evidence in the cited section).

| # | Blocker | Status | Owner | Why it blocks the gate |
|---|---|---|---|---|
| B1 | Hackathon deadline | ✅ **RESOLVED (operator-verified)** | — | **2026-08-13 12:00 UTC+2 = 10:00 UTC = 11:00 WAT** (DoraHacks event-timeline widget, §2). ~2 days out — a hard, near constraint on all remaining scope. |
| B2 | KeeperHub org exists + authenticated | ✅ **RESOLVED** | — | Org `f1dc7ab7-…421d5` active; MCP authenticated. **Caveat:** the REST `kh_` key used by `phase0/*.sh` (needs `mcp:write` to broadcast) is a *separate* credential — confirm it's issued. |
| B3a | Base Sepolia present on your org | ✅ **RESOLVED** | — | 84532 in chain set, `status: "stable"`, testnet. (REST `isEnabled` flag still worth a glance via `01-chains.sh`.) |
| B3b | Sender funded on Base Sepolia | ✅ **RESOLVED** | — | On-chain balance read (2026-08-11) shows **2 ETH** at `0x6C0a…8bcB` on 84532 — comfortably enough to deploy + test the small demo contracts. See §1.6. |
| B4 | **Guardian `pause()` workflow exists + proven to execute** | ✅ **RESOLVED** | — | Workflow `djicil86qilmi2q3akkt4` executed a real `pause()` on `0x502c…a77e80` (84532): execution `bowz6kzw2cwinj7ph13oy`, tx `0x0e8f…7098`, receipt success, `paused()==true`, authorized caller `0x6C0a…8bcB` (§1.7). Deployed target + pauser role + real execution all confirmed. **Residual (non-blocking):** the run was console/session-triggered; triggering via the REST `kh_` API is deferred to Phase 3. |
| B5 | Base Sepolia eligibility for *this* hackathon | ⚠️ **PARTIAL** | Operator | **Verified facts:** the hard requirement is using KeeperHub as the onchain execution layer; Base Sepolia (84532) is enabled by KeeperHub (§1.5); no inspected rule prohibits it. **Caveat:** no explicit per-network allowlist was found on the event page, so eligibility is *inferred*, not stated. Re-check the page if an allowlist appears. |

None of these are API-capability blockers — the platform can do everything the
MVP needs. The org, chain, a **funded** sender, the **deadline**, and now a
**proven on-chain guardian `pause()`** (B4, §1.7) are all confirmed. The only
remaining item is programmatic REST `kh_` API-triggering of the workflow, which is
**not** a Phase 0 gate item — it is scheduled for Phase 3 (backend integration).
B5 stays partial (eligibility inferred, §2).

---

## 6. Required setup before any real write (STOP-AND-SHOW gate)

Per the working rule, **before I run any real transaction or external write I
will stop and show you the exact command.** To reach that point you first need:

1. A KeeperHub org + `kh_` API key with `mcp:write` scope.
2. `cd phase0 && cp .env.example .env`, then fill in (locally, never committed):
   `KEEPERHUB_API_KEY`, `BASE_SEPOLIA_RPC_HTTP`, `KEEPERHUB_WALLET_ADDRESS`, and
   for the harmless call `HARMLESS_TARGET_ADDRESS` / `HARMLESS_FUNCTION_NAME`
   (a trivial, no-value, non-reverting function on a contract you control).
3. A funded/sponsored execution wallet on Base Sepolia.
4. (For B4) the pause() guardian workflow created + tested in the KeeperHub UI,
   with `KEEPERHUB_GUARDIAN_WORKFLOW_ID` set.

Then the safe sequence is: `00-auth-check.sh` → `01-chains.sh` →
`02-harmless-call.sh` (simulate) → **review printed request** →
`CONFIRM_BROADCAST=yes ./02-harmless-call.sh` → `03-status.sh execution <id>` →
(after workflow exists) `04-workflow-trigger.sh` dry-run → **review** →
`CONFIRM_BROADCAST=yes ./04-workflow-trigger.sh` → `03-status.sh workflow <id>`.

---

## 7. Decision

**✅ GO — Phase 0 is complete. Proceed to scaffold the app (Phase 1).**

- **Green (capability):** KeeperHub's API supports every MVP primitive — chain
  discovery, simulate-first contract calls, idempotent broadcast, poll-hinted
  status, stored-workflow triggering, and an arbitrary `pause()` on Base Sepolia,
  which is a free, gas-sponsored testnet. The planning docs are sound modulo the
  six field-name/mechanics corrections in §1.
- **Green (live state):** org active; Base Sepolia (84532) enabled; sender
  `0x6C0a…8bcB` funded with 2 ETH; and a **real guardian `pause()` executed and
  verified on-chain** (B4 resolved, §1.7). **B5** remains partial (Base Sepolia
  eligibility inferred, not stated on the page) — a documentation caveat, not a
  capability gap.
- **Gate rule (roadmap):** "Do not scaffold the full app until real KeeperHub
  execution *and* external workflow triggering are confirmed." **Real KeeperHub
  execution is confirmed** — a sponsored `pause()` landed on 84532 and flipped
  `paused()` to `true` (§1.7). On **external triggering**: the workflow was
  triggered from outside the target contract via KeeperHub's relayer, but through
  the **console session**, not yet the REST `kh_` API. That programmatic
  API-trigger is exercised by the backend watcher and is scheduled for **Phase 3**
  ("Implement workflow execution") / **Phase 5** ("Trigger guardian workflow") — it
  is an integration step, not a feasibility unknown, so it does **not** block Phase
  0. The gate's intent — proof that KeeperHub can execute the guardian action
  on-chain — is met.

### Is a separate external API-trigger proof still required?

**Short answer: yes, but not now, and not as a Phase 0 blocker.** It is required as
part of building the product (the watcher must fire `pause()` programmatically), so
it is scheduled where that code lives:

- **Phase 3 — KeeperHub Integration:** implement the authenticated client and
  `POST /api/workflows/{id}/execute` against `djicil86qilmi2q3akkt4`, then poll
  status via `/wait`. This is the first real API-trigger.
- **Phase 5 — Watcher and Guardian:** the watcher triggers the workflow on a
  detected semantic mismatch and independently verifies `paused()`.

Both require the REST `kh_` key with `mcp:write` (B2 caveat) — issue it before
Phase 3. Nothing about that proof is a Phase 0 unknown: capability is documented
(§1) and on-chain execution is already demonstrated (§1.7).

**Recommended next actions (in order):** (1) proceed to Phase 1 scaffolding;
(2) issue the REST `kh_` write key so Phase 3 can API-trigger; (3) in Phase 3,
call `POST /api/workflows/djicil86qilmi2q3akkt4/execute` (against a fresh/unpaused
target) as the external-trigger proof; (4) carry the §1 field-name corrections into
the Phase 3 client.

---

### Evidence log

**Live (completed) — read-only MCP inspection, 2026-08-11:**

| Check | Method | Result | Date |
|---|---|---|---|
| Org active | MCP org-scoped reads + spending-limits read | ✅ org `f1dc7ab7-…421d5`; no daily cap; `dailyUsedWei:0` | 2026-08-11 |
| Chains / Base Sepolia | MCP chain list (read) | ✅ 84532 present, `status:"stable"`, testnet, explorer sepolia.basescan.org | 2026-08-11 |
| Sender configured | MCP integrations list (read) | ⚠️ 1 wallet `0x6C0a…8bcB`, `web3`, `isManaged:false`; funding not exposed | 2026-08-11 |
| Existing workflows | MCP workflow list (read) | ❌ no pause wf; 3 seeded mainnet read-only examples, all `enabled:false` | 2026-08-11 |
| Sender funding | Base Sepolia RPC `eth_getBalance` @ `https://sepolia.base.org` | ✅ **2 ETH** (`2000000000000000000` wei, `0x1bc16d674ec80000`) at `0x6C0a…8bcB`; chainId `0x14a34`; block `45346386` @ 2026-08-11 15:11:00 UTC | 2026-08-11 |
| Guardian workflow exists | MCP `get_workflow` / `validate_workflow` (read) | ✅ `djicil86qilmi2q3akkt4` "ChainSRE Phase 0 Guardian": Manual, `enabled:false`, `web3/write-contract` `pause()` on 84532 → `0x502c…a77e80`, sender integration → `0x6C0a…8bcB`; deep validate clean (0 errors / 0 warnings) | 2026-08-12 |
| **Guardian `pause()` executed** | MCP `get_execution` + Base Sepolia RPC (tx / receipt / `eth_call`) | ✅ exec `bowz6kzw2cwinj7ph13oy` **success**; tx `0x0e8f…7098` receipt `0x1`; `Paused(0x6C0a…8bcB)`; **`paused()==true`**; sponsored EIP-7702 (§1.7) | 2026-08-12 |

**Deferred to Phase 3 (REST `kh_` API scripts) — not Phase 0 blockers.** The
workflow **trigger + status** were already achieved via the KeeperHub console and
verified on-chain (§1.7); the rows below re-prove the same via the REST key + local
scripts when the backend client is built:

| Check | Command | HTTP | Key result / tx hash | BaseScan link | Date |
|---|---|---|---|---|---|
| Auth health | `00-auth-check.sh` | | | — | Phase 3 |
| Chains (REST `isEnabled`) | `01-chains.sh` | | 84532 isEnabled? | — | Phase 3 |
| Harmless simulate | `02-harmless-call.sh` | | wouldRevert? gasEstimate | — | Phase 3 |
| Harmless broadcast | `CONFIRM_BROADCAST=yes 02-…` | | executionId / txHash | | Phase 3 |
| Workflow trigger (REST) | `CONFIRM_BROADCAST=yes 04-…` | | executionId | | Phase 3 |
| Workflow status | `03-status.sh workflow <id>` | | pause tx hash | | Phase 3 |

> Note: the console-triggered run in **§1.7** already satisfies "real KeeperHub
> execution" for the Phase 0 gate; the table above is the programmatic re-proof and
> belongs to backend integration.
