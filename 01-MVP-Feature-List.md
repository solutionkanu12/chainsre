# ChainSRE MVP Feature List

## Must Have

### Intent and agent execution

1. Typed `MintIntentV1` containing:
   - Intent ID
   - Chain ID
   - Agent address
   - Vault address
   - Function selector
   - Receiver
   - Share amount
   - Deadline
   - Nonce
2. `IntentRegistry` contract that immutably commits the intent hash.
3. Normal agent mode that executes the declared amount.
4. Adversarial mode that commits `950` shares but executes `80,000,000` shares.
5. Real KeeperHub simulation and contract-call execution.
6. Stable KeeperHub idempotency key for every write.
7. Persisted KeeperHub execution ID, transaction hash, explorer link, receipt, and timestamps.

### Contracts and demonstration

8. `DemoVault` with `mintShares`, `redeemShares`, `pause`, and `paused`.
9. `MockAsset` used as visible testnet vault assets.
10. Protected and control vaults with identical bytecode and initial balances.
11. Only the protected vault is enrolled in ChainSRE.
12. A visible delay between over-mint confirmation and the follow-up drain attempt.

### Detection and containment

13. Base Sepolia event watcher with a persisted block cursor.
14. Deterministic comparison of committed and confirmed action fields.
15. Field-level semantic diff, for example:
    - Expected shares: `950`
    - Actual shares: `80,000,000`
16. Critical incident creation for supported divergences.
17. Preconfigured KeeperHub workflow that calls `pause()`.
18. One-time guardian trigger protected by database locking and idempotency.
19. Onchain verification that `paused() == true` before declaring containment.
20. Protected drain reverts while control drain succeeds.

### Product and evidence

21. Public landing page explaining semantic intent divergence.
22. Live command center for the current run.
23. Expected-versus-actual comparison.
24. Timestamped incident and containment timeline.
25. KeeperHub execution IDs and BaseScan links for every meaningful write.
26. Readiness screen for database, RPC, KeeperHub, contracts, watcher, and wallet balance.
27. Public read-only access.
28. Operator write access through an allowlisted wallet signature.
29. Fixed server-side demo scenarios instead of arbitrary browser calldata.
30. Public source repository, short demo video, deployed addresses, and real transaction proof.

## Nice to Have

1. Server-sent events for live updates with polling fallback.
2. Normal run showing that a matching action creates no incident.
3. Discord, Slack, or email incident notification.
4. Downloadable JSON incident evidence.
5. Shareable historical incident pages.
6. Detection and containment latency charts.
7. Receiver-mismatch and expired-intent policies.
8. Private routing only if KeeperHub reports it enabled for the selected route.
9. Gas sponsorship for eligible public-mempool transactions.
10. Narrow KeeperHub MCP tool for the agent.
11. One-click testnet fixture reset.

## Future Features

1. Atomic onchain enforcement that rejects mismatched calldata before execution.
2. Transfers, swaps, approvals, bridges, treasury actions, and governance adapters.
3. Multiple agents, protocols, organizations, and chains.
4. Rolling spend limits, rate limits, and multi-step intent graphs.
5. Separate agent and guardian wallets or Safe-based custody.
6. Human approval for medium-severity incidents.
7. Multi-chain containment.
8. KeeperHub marketplace policy templates.
9. x402 or MPP paid guardian services.
10. Security-monitoring and incident-management integrations.
11. Formal verification of canonical intent encoding.
12. Auditor and governance-grade forensic reports.

## Explicit Non-goals

- Protecting arbitrary contracts.
- Reversing a confirmed transaction.
- Detecting every prompt injection or stolen key.
- Preventing atomic bundled attacks.
- Claiming production or mainnet readiness.
- Replacing KeeperHub simulation, contract audits, or general threat monitoring.

