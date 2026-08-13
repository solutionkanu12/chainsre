# ChainSRE — Phase 2 Results

**Status:** PASS. Contracts implemented, tested, deployed to Base Sepolia, and the Phase 2
gate proven both locally and on-chain.

**Network:** Base Sepolia, chain ID `84532`. **Date:** 2026-08-13.

Everything below is public, non-secret information. No key, RPC credential, or API token is
recorded here or anywhere in the repository.

---

## 1. Deployed demo topology

All four contracts were deployed by `script/Deploy.s.sol:Deploy`, which refuses to broadcast
on any chain other than 84532.

| Contract | Address | Deploy tx |
|---|---|---|
| `IntentRegistry` | [`0x6A78fCF6Cb1BF7b45b98E262Ee65965263BB23F9`](https://sepolia.basescan.org/address/0x6A78fCF6Cb1BF7b45b98E262Ee65965263BB23F9) | [`0x301c04d0…f6b92`](https://sepolia.basescan.org/tx/0x301c04d05baffbbb14e0813c18abe54993838aa1acdc6adee7fa27f26bdf6b92) |
| `MockAsset` | [`0x961fA7f8cDcbA67717cE92c249443F74F3D448C5`](https://sepolia.basescan.org/address/0x961fA7f8cDcbA67717cE92c249443F74F3D448C5) | [`0xf00d1272…cf72f`](https://sepolia.basescan.org/tx/0xf00d1272ce2b284129d03513a6dc15c6f5694948c5f79ba9f710bc87d1ecf72f) |
| `DemoVault` (protected) | [`0x429F2b842e5B0BCfd5f8359736aCC444FB35fB4B`](https://sepolia.basescan.org/address/0x429F2b842e5B0BCfd5f8359736aCC444FB35fB4B) | [`0x454637b5…a1676`](https://sepolia.basescan.org/tx/0x454637b5bca1426f9b463c6000752749e4cb3cecd9865b408abd6fb442fa1676) |
| `DemoVault` (control) | [`0xF0Dd43FBbEA515f2fa8e2c0C0a2C60f5eFC6f3b5`](https://sepolia.basescan.org/address/0xF0Dd43FBbEA515f2fa8e2c0C0a2C60f5eFC6f3b5) | [`0xc435915b…9242c`](https://sepolia.basescan.org/tx/0xc435915bc1fec7ace7f3483f6573115460994e625c6efcc4f588f50aecf9242c) |

Seeding transactions (1,000,000e18 `csMOCK` into each vault):

- protected: [`0x3c270db7…26ae6`](https://sepolia.basescan.org/tx/0x3c270db7939f65674ce2ea7b8d50c4fb8fe0ff4e30cd72efbbaae91425c26ae6)
- control: [`0x6f71f8f1…ae023`](https://sepolia.basescan.org/tx/0x6f71f8f1df78bf6cc575a04a339f9d8500b3b92f0a34d2e1ecf1d36da62ae023)

All six transactions confirmed with status `0x1`, blocks 45,412,091–45,412,098.
Total deployment cost was well under 0.001 ETH at ~0.011 gwei.

Machine-readable copy: `packages/contracts/deployments/base-sepolia.json`.

### Roles

`DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` and `GUARDIAN_ROLE` on **both** vaults are held by
`0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB` — the KeeperHub execution wallet recorded in
Phase 0, which was also the deployer.

> **Disclosed limitation.** Agent and guardian custody are *not* separated in the MVP. The
> KeeperHub organization has exactly one web3 wallet integration, and that single sender must
> both execute the agent's mint and run the guardian `pause()` workflow. ChainSRE's threat
> model already states it protects against a bad agent *decision*, not against theft of the
> KeeperHub credential. Separating the two wallets is listed as a future hardening step.

### Initial state (verified on-chain)

| Property | Protected | Control |
|---|---|---|
| `asset()` | `0x961fA7f8…448C5` | `0x961fA7f8…448C5` |
| `totalAssets()` | 1,000,000e18 | 1,000,000e18 |
| `totalShares()` | 0 | 0 |
| `paused()` | false | false |
| runtime codehash | `0xdd39c02a…53252` | `0xdd39c02a…53252` |

---

## 2. Independent verification

`script/verify-deployment.sh` reads the deployment back over JSON-RPC using `cast`. It shares
no code with the deploy script — the deploy script's own assertions only observe forge's
*simulated* state, so they are a pre-broadcast guard, not proof of what landed.

Result: **DEPLOYMENT VERIFIED**, covering chain ID, bytecode presence at all four addresses,
protected/control runtime-bytecode equality, distinct addresses, registry schema id and hash,
per-vault asset/balance/shares/pause state, all three role assignments on both vaults, the
advertised `mintShares` selector, and equal seeding.

Re-run after the on-chain gate proof to confirm the demo topology was untouched: still
**DEPLOYMENT VERIFIED**.

---

## 3. Phase 2 gate

> **Gate:** a script proves the protected vault blocks redemption after pause while the
> control vault drains.

### Local

`test/PhaseTwoGate.t.sol::test_Gate_ProtectedVaultBlocksDrainWhileControlVaultDrains` —
passes. Same bytecode, same constructor arguments, same seed, same agent, same committed
intent, same 80,000,000 over-mint on both vaults; only the protected vault receives the
guardian `pause()`.

### On Base Sepolia

Run against a **disposable pair of vaults** deployed from the same bytecode, so the demo
vaults keep their pristine initial state for Phase 3. The registry and mock asset are the
real deployed ones.

| Address | Role |
|---|---|
| `0x9F1Cc80A9752Ce4502F6fB44C533943B71d5004D` | gate-proof protected vault |
| `0x3062B18AC4470c9C522682e4E0c5C8BA9469D6DD` | gate-proof control vault |

| Step | Transaction | Outcome |
|---|---|---|
| commit intent (declared **950**) | [`0x1d15b01d…a359`](https://sepolia.basescan.org/tx/0x1d15b01d7062db894bfb514e865e179e89e0c2e46f935d969194842eb9cda359) | `isCommitted = true`, nonce spent |
| protected over-mint **80,000,000** | [`0x6ab8825d…a98a`](https://sepolia.basescan.org/tx/0x6ab8825decbf89ac37d7693626100f8a7b165801f81d49d5a5547ffa4320a98a) | success — technically valid |
| control over-mint **80,000,000** | [`0xe95bcb43…1690`](https://sepolia.basescan.org/tx/0xe95bcb43c867c069f645ace1be309d666c6a5eb4c363683009b9d6a505001690) | success — technically valid |
| guardian `pause()` (protected only) | [`0x9b2cf352…88bb`](https://sepolia.basescan.org/tx/0x9b2cf3529ec172f2a5a90e4d84d07e18098611b6062454ff8cd79d9d81ae88bb) | `paused() = true` |
| protected drain attempt | — | **reverted `EnforcedPause()`** (`0xd93c0665`) |
| control drain | [`0xc80cec81…3d9e`](https://sepolia.basescan.org/tx/0xc80cec81e768de94eed59e960471f51dfe1b17567a02f8251beface985713d9e) | success — vault drained to 0 |

Committed intent `0xa41c3dd65683eaf5e62f0bebbc5c281a585c4f84285fc7fcc1a70bc3a101d8d5`.
Declared `paramsHash` `0x2b0abf93…ff52` (950) versus executed `0xe920044c…93b8`
(80,000,000) — the two differ, which is precisely the divergence ChainSRE detects.

Final state: gate-proof protected `totalAssets = 1,000,000e18` (intact), gate-proof control
`totalAssets = 0` (drained). **Gate passes on real Base Sepolia.**

The protected drain was confirmed to revert with `EnforcedPause()` specifically, not merely
"some revert" — an important distinction, since an unseeded vault would also revert, but with
`ERC20InsufficientBalance`.

> **Honest note.** A first gate attempt (proof vaults `0xb2cBE5d9…3c8D` and `0x78786494…9337`)
> was abandoned when the public `sepolia.base.org` endpoint returned a burst of 502s during
> seeding, leaving those vaults unseeded; its control-drain step therefore failed with
> `ERC20InsufficientBalance` rather than proving anything. The run above is a clean repeat on
> fresh vaults with state-driven retries. The abandoned pair is left on-chain and is not part
> of the demo topology.

---

## 4. Contracts

| File | Purpose |
|---|---|
| `src/IntentHashLib.sol` | Canonical `MintIntentV1` encoding — the single source of truth for hashing. |
| `src/IntentRegistry.sol` | Typed intent commitment registry: deterministic id, deadline validation, per-agent nonce replay protection, duplicate-commitment rejection, correlation events. |
| `src/DemoVault.sol` | `mintShares` / `redeemShares` / `pause` / `paused`, minter and guardian roles, `intentId` in mint events. |
| `src/MockAsset.sol` | Valueless testnet ERC-20 that makes the control-vault loss visible. |

Dependencies are pinned git submodules: OpenZeppelin `v5.1.0` (`AccessControl`, `Pausable`,
`ReentrancyGuard`, `ERC20`, `SafeERC20`) and forge-std `v1.9.6`.

### Two deliberate design decisions

**No mint cap.** `mintShares` accepts 80,000,000 exactly as it accepts 950. A hard-coded
`950` limit would move the policy into the contract and destroy the thing being demonstrated:
technical validity is not semantic correctness. The semantic policy belongs to ChainSRE —
off-chain, versioned, per-enrollment.

**The vault never reads the registry.** `intentId` on `mintShares` is an unverified
correlation tag, not an authorization. If the vault enforced the commitment on-chain, the
divergence would be blocked and there would be nothing for ChainSRE to detect. Correlation
and comparison happen off-chain against confirmed events.

---

## 5. Cross-language intent hashing

`packages/shared/src/intent-hash.ts` implements the TypeScript half of the canonicalizer on
the existing `MintIntentV1` Zod schema. On-chain integers are carried as `bigint` or base-10
strings and never as JavaScript `number`; passing a `number` for `shares` or `nonce` throws,
because 950e18 is not exactly representable as a double.

Encoding, identical in both languages:

```
paramsHash = keccak256(abi.encode(receiver, shares))
intentId   = keccak256(abi.encode(schemaHash, chainId, agent, target,
                                  selector, paramsHash, deadline, nonce))
```

Only `abi.encode` is used — never `encodePacked` — so distinct field tuples cannot collide.
The schema id is folded into the hash domain so a future v2 can never collide with v1.

`packages/contracts/test/fixtures/intent-vectors.json` holds six golden vectors (the demo
950 mint, the 80,000,000 over-mint, the control vault, a cross-chain case, all-zero edges,
and uint256/uint64 maxima) together with the hashes produced by the **TypeScript**
implementation. `IntentVectors.t.sol` recomputes them in **Solidity** and requires equality;
`intent-hash.test.ts` checks the same file from the other side. Both suites pass, so the two
implementations provably agree.

---

## 6. Verification summary

| Check | Result |
|---|---|
| `forge fmt --check` | clean |
| `forge build` (`deny = "warnings"`, lint clean) | pass |
| Foundry tests | 61 passed, 0 failed (5 suites) |
| TypeScript tests | 75 passed (shared 52, db 12, api 10, web 1) |
| `pnpm format:check` / `lint` / `typecheck` | clean |
| `pnpm test` / `pnpm build` | pass |
| Secret scan of the committed diff | clean |
| Solidity ↔ TypeScript golden hashes | match, 6 vectors, both directions |
| Local Phase 2 gate | pass |
| On-chain Base Sepolia Phase 2 gate | pass |
| Deployment verification over RPC | verified (twice) |

---

## 7. Security review

Reviewed for access-control mistakes, replay and nonce bugs, deadline bugs, unsafe casting,
integer precision, hash encoding ambiguity, event correlation, and secret exposure.

Findings fixed during the phase:

1. **Misleading verification claim.** The deploy script documented its post-broadcast
   assertions as reading "real post-deployment state". `forge script` simulates the run
   first, so they observe simulated state. Corrected, and `verify-deployment.sh` added as
   genuinely independent RPC confirmation.
2. **Weak gas check.** `deployer.balance > 0` would pass on dust and then run out mid-run,
   leaving a half-deployed asymmetric topology. Now a `0.01 ether` floor, overridable.
3. **Case-sensitive address comparison** in the verification script — `cast` returns EIP-55
   checksummed addresses, so a correct deployment could be reported as a mismatch. Fixed.
4. **Verification aborted on transient RPC errors.** A public-endpoint 502 was reported as a
   contract failure. All reads now retry with backoff.
5. **Unchecked ERC-20 transfer return values** in the test fixture, flagged by `forge lint`.
   Now checked; the deploy script uses `SafeERC20`.

Properties confirmed:

- Only `MINTER_ROLE` can mint; admin and guardian cannot. Only `GUARDIAN_ROLE` can pause; the
  guardian cannot unpause (admin-only), so the guardian is scoped to containment.
- Nonces are per-agent and never cleared; a reused nonce reverts `NonceAlreadyUsed`, a
  repeated intent reverts `IntentAlreadyCommitted`.
- `commitIntent` rebuilds the hash from `msg.sender` and `block.chainid`, so a commitment can
  never claim a different agent or chain. Impersonation reverts.
- `deadline <= block.timestamp` is rejected; deadline-exactly-now is rejected.
- `redeemShares` follows checks-effects-interactions and carries `nonReentrant`.
- `uint64(block.timestamp)` / `uint64(block.number)` cannot truncate on any reachable state.
- No secret is committed. Forge writes the deployer key to
  `packages/contracts/cache/Deploy.s.sol/<chain>/run-latest.json`; that path is confirmed
  git-ignored, as are `broadcast/` and `out/`.

`MockAsset.mint` is a permissionless faucet. That is deliberate and safe here: minting the
mock token to yourself moves no vault assets, since draining a vault requires vault *shares*,
which only the authorized minter can create. It is documented in the contract and the token
is labelled as having no value.

---

## 8. Not in scope for Phase 2

KeeperHub API integration, the watcher, the comparator, database state, agent orchestration,
and the frontend are Phase 3 and later. The on-chain gate above was driven directly with
`cast`; routing the same steps through KeeperHub Direct Execution and the guardian workflow
is Phase 3 work.

Contract source verification on BaseScan is a Phase 9 checklist item and has not been done
yet.
