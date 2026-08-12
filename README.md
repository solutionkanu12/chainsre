# ChainSRE Build Pack

This pack is the strict build plan for the ChainSRE hackathon project.

## Read in this order

1. `01-MVP-Feature-List.md`
2. `02-Hackathon-PRD.md`
3. `03-System-Architecture.md`
4. `04-Development-Roadmap.md`
5. `05-WSL-Codex-Guide-and-Prompts.md`

## Core project

ChainSRE is a semantic circuit breaker for onchain AI agents. An agent commits a typed intent before executing a real transaction through KeeperHub. ChainSRE compares the confirmed action with the committed intent and triggers a pre-authorized KeeperHub guardian workflow when they diverge.

The MVP demo uses two identical Base Sepolia vaults:

- Protected vault: over-mint detected, KeeperHub pauses it, follow-up drain reverts.
- Control vault: same over-mint, no protection, follow-up drain succeeds.

## Strict working rule

Complete and verify one roadmap phase before starting the next. Do not ask Codex to build the entire project in one prompt.

## Hard boundaries

- One chain: Base Sepolia.
- One typed action: `mintShares`.
- One guardian action: `pause()`.
- Real KeeperHub executions and transaction links only.
- No arbitrary contract-call endpoint exposed to the browser or agent model.
- The first divergent transaction cannot be reversed. ChainSRE contains later damage.

