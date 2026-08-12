# ChainSRE Hackathon PRD

## 1. Product Summary

**Name:** ChainSRE  
**Positioning:** Semantic incident response for autonomous onchain agents.  
**Network:** Base Sepolia, chain ID `84532`.  
**Primary infrastructure:** KeeperHub Direct Execution API and KeeperHub Workflows.

ChainSRE answers one question:

> Did the confirmed transaction do what the agent explicitly declared it would do?

An agent commits a typed intent before execution. ChainSRE watches the confirmed action, compares its actual parameters with the commitment, and triggers a pre-authorized KeeperHub workflow when they diverge.

## 2. Problem

Transaction simulation checks whether a call is technically valid. It cannot determine whether a valid call matches an agent's assigned objective. A compromised, prompt-injected, or mistaken agent can therefore perform a valid but semantically wrong action.

Example:

- Declared action: mint `950` shares.
- Confirmed action: mint `80,000,000` shares.
- Contract result: successful transaction.
- Semantic result: critical agent-policy violation.

## 3. Solution

1. Convert an agent objective into a typed intent.
2. Commit its hash to `IntentRegistry` onchain.
3. Execute the actual action through KeeperHub.
4. Decode the confirmed receipt and events.
5. Compare expected and actual typed fields deterministically.
6. Create an incident when they differ.
7. Trigger the enrolled KeeperHub guardian workflow.
8. Verify the vault is paused onchain.
9. Show the full evidence trail in the product.

## 4. Why KeeperHub Is Essential

- Executes the real intent commitment and vault transactions.
- Simulates technical validity before broadcasting.
- Supplies idempotent writes, execution IDs, statuses, receipts, gas data, hashes, and links.
- Executes the stored guardian workflow with managed transaction reliability.
- Demonstrates the product's key insight: successful simulation does not prove semantic correctness.

## 5. Goals

1. Demonstrate semantic divergence using real onchain transactions.
2. Contain a follow-up loss through a real KeeperHub guardian action.
3. Make every important claim independently verifiable.
4. Finish a repeatable judge demo in two minutes or less.
5. Build one narrow policy completely instead of an unreliable generic platform.

## 6. Non-goals

- Arbitrary contracts or calldata.
- Reversing the first divergent transaction.
- Protecting against atomic bundles.
- General AI threat detection.
- Mainnet production readiness.
- Permissionless enrollment.

## 7. Users

### Agent developer

Needs a typed commitment and reliable execution path for privileged agent actions.

### Protocol operator

Needs automatic containment when agent behavior violates an explicit policy.

### Auditor or risk reviewer

Needs a complete link between declared intent, confirmed action, detected difference, response, and final state.

### Hackathon judge

Needs an immediate, verifiable protected-versus-unprotected demonstration.

## 8. User Stories

| ID | Story | Acceptance criteria |
|---|---|---|
| US-01 | As an operator, I can enroll a supported vault. | Enrollment includes chain, vault, selector, policy version, and guardian workflow ID. |
| US-02 | As an agent, I commit a typed mint intent before acting. | Commitment confirms and appears before the mint transaction. |
| US-03 | As an agent, I execute the mint through KeeperHub. | Simulation succeeds, a real write confirms, and evidence is stored. |
| US-04 | As an operator, I see whether execution matches intent. | Every supported field is marked matched or divergent. |
| US-05 | As an operator, critical divergence triggers containment. | Exactly one guardian workflow runs and `paused()` becomes true. |
| US-06 | As a judge, I run the protected attack. | Over-mint confirms, pause confirms, and drain reverts. |
| US-07 | As a judge, I run the control attack. | The same over-mint and drain succeed on the unprotected twin. |
| US-08 | As an auditor, I verify every write. | Each step includes KeeperHub ID, hash, BaseScan link, block, status, and timestamp. |
| US-09 | As an operator, I safely retry interrupted requests. | Reusing an idempotency key does not issue a duplicate write. |
| US-10 | As a visitor, I cannot trigger testnet transactions. | Public access is read-only; operator routes require authentication. |

## 9. Product Flows

### One-time setup

1. Deploy registry, mock asset, protected vault, and control vault.
2. Seed both vaults equally.
3. Configure roles for the KeeperHub execution wallet.
4. Create and test the KeeperHub `pause()` workflow.
5. Confirm Base Sepolia is enabled through KeeperHub.
6. Enroll only the protected vault.
7. Run one normal matching transaction.

### Protected attack

1. Operator starts the protected scenario.
2. Agent plans `mint 950 shares`.
3. Intent is committed through KeeperHub.
4. Adversarial mode mutates the execution amount to `80,000,000`.
5. KeeperHub simulation succeeds because the contract accepts the call.
6. KeeperHub confirms the over-mint.
7. ChainSRE detects the exact amount mismatch.
8. ChainSRE triggers the approved KeeperHub pause workflow.
9. KeeperHub confirms `pause()`.
10. ChainSRE verifies `paused()` onchain.
11. Scheduled redemption is attempted and reverts.
12. UI marks the incident contained.

### Control attack

1. Use the same objective, mutation, timing, and execution path.
2. Target the unprotected twin vault.
3. ChainSRE sees no enrollment and takes no action.
4. Scheduled redemption succeeds.
5. UI shows the loss beside the protected result.

### Incident review

1. Open the incident page.
2. Read the plain-language summary.
3. Inspect expected and actual values.
4. Follow the commitment, action, pause, and drain-attempt links.
5. Inspect measured detection and containment times.

## 10. Functional Requirements

### Intent

- Generate a unique `bytes32 intentId`.
- Canonicalize fields identically in Solidity and TypeScript.
- Include schema, chain, agent, target, selector, parameters, deadline, and nonce.
- Commit before target execution.
- Reject expired intents and reused nonces.

### KeeperHub execution

- Discover enabled chains before the first run.
- Simulate the same body that will be broadcast.
- Broadcast only after a successful non-reverting simulation.
- Use a stable idempotency key for every run step.
- Honor KeeperHub polling guidance.
- Store authoritative hash and transaction link.
- Keep API keys server-side.

### Detection

- Watch registry and vault events.
- Resume from a persisted block cursor.
- Wait for the configured confirmation count.
- Correlate actions by intent ID, chain, and target.
- Compare values with deterministic code, not an LLM.
- Create a field-level diff.
- Ignore unsupported contracts and selectors safely.

### Containment

- Load the guardian workflow from enrollment data.
- Lock the incident before triggering it.
- Trigger once and poll to a terminal state.
- Store workflow and node transaction evidence.
- Verify the final paused state independently.
- Expose a controlled operator retry after failure.

### Demo

- Support `normal`, `protected_attack`, and `control_attack` fixtures.
- Keep the attack delay visible and documented.
- Use the same code path for protected and control runs except enrollment.
- Never fabricate hashes, statuses, or metrics.

## 11. Core Screens

1. Landing page with the product thesis and honest boundary.
2. Command center showing the current run and vault state.
3. Intent detail with typed fields and commitment proof.
4. Incident detail with semantic diff and response evidence.
5. Protected-versus-control result view.
6. Enrollment setup for the operator.
7. System readiness page.

## 12. Database Requirements

Use PostgreSQL through Supabase.

### `enrollments`

- `id`
- `chain_id`
- `contract_address`
- `action_selector`
- `policy_version`
- `guardian_workflow_id`
- `status`
- `created_at`

Unique: chain, contract, selector.

### `demo_runs`

- `id`
- `mode`
- `status`
- `vault_address`
- `declared_amount`
- `executed_amount`
- `started_by`
- `started_at`
- `completed_at`

### `intents`

- `id`
- `run_id`
- `agent_address`
- `chain_id`
- `target_address`
- `selector`
- `params`
- `params_hash`
- `intent_hash`
- `nonce`
- `deadline`
- `status`
- `created_at`

### `executions`

- `id`
- `run_id`
- `intent_id`
- `kind`: commit, action, guardian, drain attempt
- `provider_execution_id`
- `idempotency_key`
- `function_name`
- `function_args`
- `status`
- `tx_hash`
- `tx_link`
- `block_number`
- `gas_used_wei`
- `error`
- `raw_receipt`
- `created_at`
- `completed_at`

### `incidents`

- `id`
- `run_id`
- `intent_id`
- `severity`
- `state`
- `expected`
- `actual`
- `mismatch_fields`
- `action_tx_hash`
- `guardian_execution_id`
- `detected_at`
- `containment_started_at`
- `contained_at`
- `detection_latency_ms`
- `containment_latency_ms`

### `incident_events`

Append-only timeline with incident, sequence, type, status, message, evidence, and occurrence time.

### `chain_cursors`

Chain, contract, event name, last processed block, and update time.

### `auth_challenges`

Address, nonce hash, expiry, and used time.

### Data rules

- Store onchain integers as strings or `numeric(78,0)`, never JavaScript numbers.
- Normalize addresses for lookup and checksum them for display.
- Never store secrets or authorization headers.
- Treat chain receipts as authoritative proof.
- Keep incident events append-only.

## 13. Application APIs

### Authentication

- `POST /v1/auth/challenge`
- `POST /v1/auth/verify`
- `POST /v1/auth/logout`

### System and configuration

- `GET /v1/system/readiness`
- `GET /v1/enrollments`
- `POST /v1/enrollments`
- `PATCH /v1/enrollments/:id`

### Demo and evidence

- `POST /v1/demo/runs`
- `GET /v1/demo/runs/:id`
- `GET /v1/demo/runs/:id/events`
- `GET /v1/intents/:id`
- `GET /v1/incidents`
- `GET /v1/incidents/:id`
- `GET /v1/incidents/:id/export`
- `POST /v1/incidents/:id/retry-containment`

### KeeperHub calls

- `GET /api/chains`
- `POST /api/execute/contract-call` for simulation
- `POST /api/execute/contract-call` for broadcast
- `GET /api/execute/{executionId}/status`
- `POST /api/workflows/{workflowId}/execute`
- `GET /api/workflows/executions/{executionId}/status`

## 14. Authentication and Security

- No public signup for the MVP.
- Public evidence pages are read-only.
- Operators sign a short-lived wallet challenge.
- Backend verifies the signature and allowlisted address.
- Session uses a secure HttpOnly cookie.
- Browser cannot submit arbitrary contract addresses, ABIs, functions, or calldata.
- LLM receives one scoped mint tool and never receives KeeperHub credentials.
- Strict validation, origin checking, rate limits, request limits, and secret redaction.

Threat boundary: this MVP protects against a bad agent decision, not theft of the backend or KeeperHub organization credential.

## 15. Success Criteria

### Technical

1. Three consecutive protected runs succeed without manual repair.
2. Commitment, over-mint, pause, and failed-drain evidence are real and linked.
3. Control drain succeeds with no containment.
4. Semantic diff identifies the exact changed field.
5. At most one guardian workflow runs per incident.
6. Watcher restart backfills the incident.
7. No secret appears in the browser, repository, logs, or video.
8. Every transaction is independently verifiable.

### Demo

1. Problem is understandable within 20 seconds.
2. Protected and control outcomes are visibly different.
3. Full presentation takes two minutes or less.
4. KeeperHub is visibly responsible for execution and containment.
5. Product limitations are stated honestly.

### Submission

- Public repository.
- Short demo video.
- Real KeeperHub-executed transaction proof.
- Deployed contract addresses.
- Clear README and reproduction steps.
- Final DoraHacks deadline and form fields rechecked before submission.

## 16. Main Risks

| Risk | Mitigation |
|---|---|
| Pause confirms after drain | Use a visible fixed attack window; describe the external-response limitation honestly. |
| Base Sepolia or private routing unavailable | Verify with KeeperHub before building; never claim unavailable behavior. |
| Wallet lacks gas or roles | Readiness checks balance, roles, simulation, and workflow execution. |
| Duplicate triggers | Database uniqueness, state machine, locks, and KeeperHub idempotency. |
| Event provider disconnects | Persist cursor and backfill from the last processed block. |
| Demo looks scripted | Use an LLM planner and real KeeperHub actions; disclose the adversarial mutation fixture. |
| Scope grows | Freeze one chain, one action, and one guardian response. |

## 17. Two-minute Demo Story

1. Explain that technical validity is not semantic correctness.
2. Show the agent committing `mint 950`.
3. Show KeeperHub successfully executing `mint 80,000,000`.
4. Show ChainSRE's exact semantic diff.
5. Show KeeperHub pausing the protected vault.
6. Show the protected drain revert.
7. Show the same control vault drain succeed.
8. Close with: “KeeperHub makes agent transactions reliable. ChainSRE makes sure reliable execution still matches declared intent.”

