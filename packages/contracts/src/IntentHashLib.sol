// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IntentHashLib
/// @notice Canonical encoding for ChainSRE's `MintIntentV1` typed intent.
/// @dev This library is the single source of truth for how an intent is hashed.
///      The TypeScript canonicalizer in the shared workspace package must produce byte-for-byte
///      identical results; `test/IntentVectors.t.sol` and the matching TypeScript test
///      both check the same golden vector file to prove it.
///
///      Encoding rules (see `03-System-Architecture.md` §8):
///      - Only `abi.encode` is used. `abi.encodePacked` is deliberately avoided so that
///        no two distinct field tuples can ever collide onto the same preimage.
///      - Every field occupies one full 32-byte word.
///      - The schema id is folded into the hash domain, so a future `MintIntentV2`
///        can never collide with a v1 intent.
library IntentHashLib {
    /// @notice Human-readable schema discriminant, mirrored by the shared Zod schema.
    string internal constant SCHEMA_ID = "chainsre/mint-v1";

    /// @notice Domain separator for v1 mint intents: `keccak256(bytes(SCHEMA_ID))`,
    ///         precomputed at compile time.
    bytes32 internal constant SCHEMA_HASH = keccak256(bytes("chainsre/mint-v1"));

    /// @notice Hash of the action parameters that the agent declares it will use.
    /// @dev `paramsHash = keccak256(abi.encode(receiver, shares))`.
    function hashParams(address receiver, uint256 shares) internal pure returns (bytes32) {
        return keccak256(abi.encode(receiver, shares));
    }

    /// @notice Deterministic `intentId` for a v1 mint intent.
    /// @param chainId    Chain the action will execute on (84532 for the demo).
    /// @param agent      Address that commits and then executes the action.
    /// @param target     Contract the action targets (the vault).
    /// @param selector   4-byte selector of the function the agent intends to call.
    /// @param paramsHash Result of {hashParams}.
    /// @param deadline   Unix seconds after which the intent is no longer valid.
    /// @param nonce      Per-agent replay-protection nonce.
    function hashIntent(
        uint256 chainId,
        address agent,
        address target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(SCHEMA_HASH, chainId, agent, target, selector, paramsHash, deadline, nonce)
        );
    }
}
