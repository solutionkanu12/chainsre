# ChainSRE Ordered Development Roadmap

Complete every phase gate before moving forward.

## Phase 0: Verify Hard Requirements

- [ ] Confirm DoraHacks deadline, required fields, video limit, and repository rules.
- [ ] Create KeeperHub organization and API key.
- [ ] Read enabled chains and confirm Base Sepolia.
- [ ] Record KeeperHub wallet address.
- [ ] Fund the wallet or verify sponsorship.
- [ ] Execute one harmless real KeeperHub testnet transaction.
- [ ] Confirm a stored workflow can call a Base Sepolia contract.
- [ ] Record actual routing configuration.
- [ ] Freeze the MVP claims and non-goals.

**Gate:** Do not scaffold the full app until real KeeperHub execution and external workflow triggering are confirmed.

## Phase 1: Repository Foundation

- [ ] Create GitHub repository.
- [ ] Initialize `pnpm` workspace.
- [ ] Create `apps/web`.
- [ ] Create `apps/api`.
- [ ] Create `packages/contracts`.
- [ ] Create `packages/shared`.
- [ ] Enable strict TypeScript.
- [ ] Configure linting and formatting.
- [ ] Add `.env.example`.
- [ ] Add GitHub Actions for lint, typecheck, tests, and builds.
- [ ] Add shared Zod schemas.
- [ ] Add chain constants and explorer helpers.
- [ ] Add structured secret-redacting logger.

**Gate:** A clean clone installs, lints, typechecks, tests, and builds.

## Phase 2: Smart Contracts

- [ ] Initialize Foundry.
- [ ] Install OpenZeppelin contracts.
- [ ] Implement `MockAsset.sol`.
- [ ] Implement `IntentRegistry.sol`.
- [ ] Add deadline validation.
- [ ] Add nonce replay protection.
- [ ] Implement `DemoVault.sol`.
- [ ] Add minter role.
- [ ] Add guardian pauser role.
- [ ] Add `intentId` to mint calls and events.
- [ ] Block mint and redemption while paused.
- [ ] Test allowed and forbidden roles.
- [ ] Test duplicate nonce rejection.
- [ ] Test expired commitment rejection.
- [ ] Test that the 80M over-mint is technically valid.
- [ ] Test successful unpaused redemption.
- [ ] Test paused redemption revert.
- [ ] Implement TypeScript intent canonicalizer.
- [ ] Add Solidity and TypeScript golden hash vectors.
- [ ] Write Base Sepolia deployment script.
- [ ] Deploy and verify all contracts.
- [ ] Seed both vaults equally.
- [ ] Grant KeeperHub wallet roles.

**Gate:** A local script proves the protected vault blocks redemption after pause while the control vault drains.

## Phase 3: KeeperHub Integration

- [ ] Implement authenticated KeeperHub client.
- [ ] Implement chain readiness discovery.
- [ ] Implement contract-call simulation.
- [ ] Block broadcast after failed simulation.
- [ ] Implement idempotent broadcast.
- [ ] Implement status polling with KeeperHub poll hints.
- [ ] Normalize successful execution evidence.
- [ ] Normalize failures and reverts.
- [ ] Create guardian `pause()` workflow.
- [ ] Implement workflow execution.
- [ ] Implement workflow status polling.
- [ ] Commit a real intent through KeeperHub.
- [ ] Mint normally through KeeperHub.
- [ ] Pause through the KeeperHub workflow.
- [ ] Save real transaction links.
- [ ] Test rate limit, timeout, revert, and idempotency-conflict responses.

**Gate:** A standalone script commits, mints, pauses, and returns real BaseScan links without any frontend.

## Phase 4: Database and State

- [ ] Create Supabase project.
- [ ] Configure pooled database connection.
- [ ] Add database migration system.
- [ ] Create enrollments table.
- [ ] Create demo runs table.
- [ ] Create intents table.
- [ ] Create executions table.
- [ ] Create incidents table.
- [ ] Create append-only incident events table.
- [ ] Create chain cursors table.
- [ ] Create auth challenges table.
- [ ] Add unique constraints and indexes.
- [ ] Seed protected enrollment only.
- [ ] Implement repositories.
- [ ] Implement safe run state transitions.
- [ ] Implement one-time containment lock.
- [ ] Add database integration tests.

**Gate:** Tests prove duplicate executions and duplicate containment cannot be stored.

## Phase 5: Watcher and Guardian

- [ ] Implement WebSocket event watcher.
- [ ] Add HTTP polling fallback.
- [ ] Persist block cursor.
- [ ] Backfill missed blocks after restart.
- [ ] Decode registry commitment events.
- [ ] Decode vault mint, pause, and redemption events.
- [ ] Correlate action with `intentId`.
- [ ] Implement deterministic semantic comparator.
- [ ] Produce field-level diff.
- [ ] Ignore unsupported actions safely.
- [ ] Create critical incident.
- [ ] Acquire containment lock.
- [ ] Trigger guardian workflow.
- [ ] Persist workflow transaction evidence.
- [ ] Verify `paused()` independently.
- [ ] Calculate detection and containment latency.
- [ ] Test duplicate logs.
- [ ] Test provider disconnect and restart.
- [ ] Test failed pause handling.

**Gate:** Starting only from confirmed events, the worker detects one over-mint and produces exactly one verified pause.

## Phase 6: Agent and Demo Orchestration

- [ ] Define `MintIntentV1` structured planner output.
- [ ] Implement provider-agnostic LLM planner.
- [ ] Expose only `commitAndExecuteMint` tool.
- [ ] Reject invalid model output safely.
- [ ] Implement normal scenario.
- [ ] Implement protected attack fixture.
- [ ] Implement control attack fixture.
- [ ] Document post-commit mutation.
- [ ] Implement visible attack delay.
- [ ] Execute drain attempt through KeeperHub.
- [ ] Persist drain success or revert evidence.
- [ ] Confirm normal run creates no incident.
- [ ] Confirm protected run is contained.
- [ ] Confirm control run drains.
- [ ] Add disclosed deterministic fallback if the LLM provider fails.

**Gate:** All three scenarios work from the backend without the product interface.

## Phase 7: API and Authentication

- [ ] Create Fastify server.
- [ ] Add standardized errors and graceful shutdown.
- [ ] Add CORS and origin allowlist.
- [ ] Add security headers and body limits.
- [ ] Add rate limiting.
- [ ] Implement wallet challenge creation.
- [ ] Implement signature verification.
- [ ] Enforce operator allowlist.
- [ ] Issue secure session cookie.
- [ ] Implement logout.
- [ ] Implement readiness endpoint.
- [ ] Implement enrollment routes.
- [ ] Implement fixed demo-run route.
- [ ] Implement run, intent, and incident reads.
- [ ] Implement controlled containment retry.
- [ ] Implement SSE or polling endpoint.
- [ ] Add authorization and API contract tests.

**Gate:** Public users can only read. Only the allowlisted operator can start scenarios or change enrollment.

## Phase 8: Frontend

- [ ] Apply agreed brand tokens and typography.
- [ ] Add the simple logo and favicon.
- [ ] Build static translucent navigation.
- [ ] Build complete footer with real GitHub and X icons.
- [ ] Add Terms and Privacy links.
- [ ] Build landing page.
- [ ] Build readiness state.
- [ ] Build operator wallet sign-in.
- [ ] Build scenario selector.
- [ ] Build live run timeline.
- [ ] Build semantic diff.
- [ ] Build protected/control comparison.
- [ ] Build intent detail.
- [ ] Build incident detail.
- [ ] Add real KeeperHub IDs and explorer links.
- [ ] Add loading, empty, degraded, failure, and success states.
- [ ] Add responsive behavior.
- [ ] Add keyboard, focus, contrast, and reduced-motion support.
- [ ] Remove every fake metric, hash, and placeholder status.

**Gate:** A non-technical viewer can understand the protected/control difference without developer tools.

## Phase 9: Reliability and Security Testing

- [ ] Automate normal-run smoke test.
- [ ] Automate protected-run smoke test.
- [ ] Automate control-run smoke test.
- [ ] Complete three consecutive protected runs.
- [ ] Measure actual latency.
- [ ] Restart watcher mid-run and verify recovery.
- [ ] Replay idempotent request and verify no duplicate transaction.
- [ ] Deliver duplicate event and verify one incident.
- [ ] Verify unauthorized writes fail.
- [ ] Inspect browser bundles and network traffic for secrets.
- [ ] Run dependency audit and secret scan.
- [ ] Run lint, typecheck, contract tests, API tests, and production builds.
- [ ] Verify contract source on BaseScan.
- [ ] Freeze demo contract addresses and workflow ID.

**Gate:** The production candidate completes the full demo three times with no manual repair.

## Phase 10: Deployment and Submission

- [ ] Deploy always-on API and watcher to Render.
- [ ] Apply production database migrations.
- [ ] Deploy frontend to Cloudflare Pages.
- [ ] Configure production CORS and security headers.
- [ ] Verify public readiness.
- [ ] Run the exact two-minute production demo.
- [ ] Finish README and setup instructions.
- [ ] Add deployed addresses and real transaction evidence.
- [ ] Record one clear demo video.
- [ ] Add captions where useful.
- [ ] Recheck DoraHacks form and deadline.
- [ ] Submit repository, video, description, and proof.
- [ ] Verify every submitted link in incognito mode.
- [ ] Keep services awake and wallet funded during judging.

## Definition of Done

A fresh judge can open the deployed product, run the protected and control scenarios, see real KeeperHub-backed transaction evidence, understand the semantic mismatch, and verify that the protected vault paused before the scheduled drain while the identical unprotected vault lost assets.

