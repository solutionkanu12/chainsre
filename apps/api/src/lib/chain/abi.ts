/**
 * Minimal ABI fragments for the deployed Phase 2 contracts. `packages/contracts`
 * is a Solidity-only workspace whose build output (`out/`) is git-ignored, so
 * these are hand-written from the verified source in `packages/contracts/src/`
 * rather than imported from a build artifact. Each fragment covers exactly the
 * functions Phase 3 calls — nothing exposes a generic "any function" surface.
 *
 * These double as the `abi` field KeeperHub needs for a contract-call request
 * (neither contract is verified on BaseScan yet — see `PHASE-2-RESULTS.md` §8 —
 * so KeeperHub cannot resolve the ABI itself) and as the ABI viem uses for
 * independent on-chain verification.
 */

export const intentRegistryAbi = [
  {
    type: 'function',
    name: 'commitIntent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'paramsHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint64' },
      { name: 'nonce', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'hashParams',
    stateMutability: 'pure',
    inputs: [
      { name: 'receiver', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'hashIntent',
    stateMutability: 'pure',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'agent', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'paramsHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint64' },
      { name: 'nonce', type: 'uint64' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'isCommitted',
    stateMutability: 'view',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isNonceUsed',
    stateMutability: 'view',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'nonce', type: 'uint64' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getCommitment',
    stateMutability: 'view',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'selector', type: 'bytes4' },
          { name: 'paramsHash', type: 'bytes32' },
          { name: 'deadline', type: 'uint64' },
          { name: 'nonce', type: 'uint64' },
          { name: 'committedAt', type: 'uint64' },
          { name: 'committedAtBlock', type: 'uint64' },
        ],
      },
    ],
  },
] as const;

export const demoVaultAbi = [
  {
    type: 'function',
    name: 'mintShares',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'receiver', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'redeemShares',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unpause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'sharesOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalShares',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
