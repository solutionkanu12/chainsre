# ChainSRE WSL and Codex Guide

This guide assumes Windows 11, Ubuntu in WSL, VS Code, and Codex CLI.

Do not run every phase prompt at once. We will use one prompt, inspect the result, fix issues, and only then continue.

## 1. Move the ZIP into WSL

Download `ChainSRE-Build-Pack.zip` into your Windows Downloads folder.

Open Ubuntu WSL and run:

```bash
mkdir -p ~/projects
cd ~/projects
cp /mnt/c/Users/<YOUR_WINDOWS_USERNAME>/Downloads/ChainSRE-Build-Pack.zip .
unzip ChainSRE-Build-Pack.zip
cd ChainSRE-Build-Pack
```

Replace `<YOUR_WINDOWS_USERNAME>` with your Windows username.

If you do not know it, run this in Windows PowerShell:

```powershell
$env:USERNAME
```

## 2. Open the folder in VS Code

From Ubuntu WSL:

```bash
code .
```

VS Code should show `WSL: Ubuntu` in the bottom-left corner.

If `code` is not found, open VS Code on Windows, install the **WSL** extension, press `Ctrl+Shift+P`, and select **WSL: Connect to WSL**. Then open `~/projects/ChainSRE-Build-Pack`.

## 3. Launch Codex

In the VS Code WSL terminal:

```bash
codex
```

Before the first prompt, tell Codex:

```text
Read README.md and the numbered planning files. Do not write code yet. Confirm the project scope, current phase, and hard boundaries in under 12 bullets.
```

## 4. How We Will Work

For every phase:

1. Paste only that phase's prompt.
2. Let Codex inspect the repository.
3. Review its plan before large changes.
4. Let it implement only the requested phase.
5. Run the verification commands it gives you.
6. Send me the terminal output or screenshot.
7. Fix failures before moving on.
8. Commit the completed phase.

Never paste API keys into Codex chat, GitHub, screenshots, or source files. Put secrets in `.env` files that are ignored by Git.

## Phase 0 Prompt: KeeperHub Feasibility

```text
Work only on Phase 0 from 04-Development-Roadmap.md. Do not scaffold the app. Create a concise verification checklist and small safe scripts or curl examples for KeeperHub chain discovery, one harmless Base Sepolia contract call, and guardian workflow triggering. Use environment variables for secrets. Update a PHASE-0-RESULTS.md file with verified facts, evidence links, blockers, and the final go/no-go result. Stop after Phase 0.
```

## Phase 1 Prompt: Repository Foundation

```text
Implement only Phase 1 from 04-Development-Roadmap.md. Create the pnpm monorepo with apps/web, apps/api, packages/contracts, and packages/shared. Add strict TypeScript, linting, formatting, env examples, shared schemas, logging, and CI. Keep starter apps minimal. Run install, lint, typecheck, tests, and builds. Fix failures and summarize changed files. Do not start contracts or KeeperHub integration.
```

## Phase 2 Prompt: Contracts

```text
Implement only Phase 2 from 04-Development-Roadmap.md using Foundry and OpenZeppelin. Build MockAsset, IntentRegistry, and DemoVault with the exact roles, events, pause behavior, deadline checks, and nonce protection in the PRD. Add complete unit tests, the 80M technically-valid over-mint test, TypeScript/Solidity hash vectors, and a Base Sepolia deployment script. Run all contract tests and stop before deploying until I provide the required environment values.
```

## Phase 3 Prompt: KeeperHub Integration

```text
Implement only Phase 3 from 04-Development-Roadmap.md. Build a typed server-side KeeperHub client for chain discovery, simulate-first contract calls, idempotent broadcast, poll-hint status polling, workflow execution, and normalized evidence. Never expose the API key. Add fixture-based tests for success, revert, timeout, 429, and idempotency conflict. Add a standalone verification script, but do not run real writes without showing me the exact command first.
```

## Phase 4 Prompt: Database

```text
Implement only Phase 4 from 04-Development-Roadmap.md. Add PostgreSQL migrations, enums, indexes, unique constraints, repositories, state transitions, append-only incident events, cursor persistence, and containment locking exactly as defined in the PRD. Use bigint-safe values. Add database integration tests and a protected-vault enrollment seed using environment values. Do not build the watcher or API routes yet.
```

## Phase 5 Prompt: Watcher and Guardian

```text
Implement only Phase 5 from 04-Development-Roadmap.md. Build the Base Sepolia event watcher with persisted cursors, backfill, confirmations, receipt decoding, typed semantic comparison, incident creation, one-time KeeperHub guardian triggering, and independent paused-state verification. Add tests for matching action, over-mint, duplicate logs, restart recovery, provider disconnect, and failed pause. Do not build the frontend or agent.
```

## Phase 6 Prompt: Agent and Demo

```text
Implement only Phase 6 from 04-Development-Roadmap.md. Add a provider-agnostic structured-output planner with one scoped commitAndExecuteMint tool. Implement normal, protected-attack, and control-attack scenarios. Keep the post-commit mutation explicit and documented, use the same path for both vaults, add the visible attack delay, and persist the real drain result. Add tests and stop before API or frontend work.
```

## Phase 7 Prompt: API and Authentication

```text
Implement only Phase 7 from 04-Development-Roadmap.md using Fastify, Zod, and viem. Add wallet challenge authentication, operator allowlist, secure sessions, security headers, CORS, rate limits, readiness, enrollment, fixed demo-run, intent, incident, timeline, and controlled retry routes. Reject arbitrary calldata. Add API contract and authorization tests. Do not build frontend screens.
```

## Phase 8 Prompt: Frontend

```text
Implement only Phase 8 from 04-Development-Roadmap.md. Follow the established ChainSRE design and brand rules. Build the landing page, static translucent navbar, logo/favicon, complete footer, readiness, operator sign-in, fixed scenario controls, live timeline, semantic diff, protected/control comparison, intent detail, and incident detail. Use only real API data. Add responsive, keyboard, focus, contrast, loading, empty, error, and reduced-motion states. Do not deploy yet.
```

## Phase 9 Prompt: Reliability and Security

```text
Implement only Phase 9 from 04-Development-Roadmap.md. Add end-to-end smoke tests for normal, protected, and control runs. Test watcher restart, duplicate events, idempotent replay, unauthorized writes, and secret exposure. Run lint, typecheck, all tests, builds, dependency audit, and secret scan. Fix failures without weakening tests. Produce PHASE-9-REPORT.md with commands, results, remaining risks, and demo readiness.
```

## Phase 10 Prompt: Deployment and Submission

```text
Work only on Phase 10 from 04-Development-Roadmap.md. Prepare Render, Supabase, Cloudflare Pages, migrations, environment documentation, production readiness checks, contract-address evidence, README, and the two-minute demo script. Show me every external deployment command or action before running it. Never reveal secrets. Finish with a submission checklist and verify every public link.
```

## Useful Commands

Check current folder:

```bash
pwd
ls -la
```

Check Git state:

```bash
git status
git diff
```

Save a completed phase:

```bash
git add .
git commit -m "complete phase N"
```

Do not commit until the phase gate passes.

## When Something Fails

Do not repeatedly rerun random commands. Copy the full command and error output and send them to me. We will diagnose it, give Codex one focused fix prompt, verify again, and continue.

