// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Scaffold
/// @notice Placeholder so the Foundry workspace builds and CI has something to
///         compile. The real ChainSRE contracts (IntentRegistry and the
///         protected/control vaults) are implemented in Phase 2.
contract Scaffold {
    /// @notice Canonical schema id for the v1 mint intent, kept in sync with
    ///         the shared TypeScript schema (`chainsre/mint-v1`).
    string public constant INTENT_SCHEMA_ID = "chainsre/mint-v1";

    /// @dev Trivial pure function exercised by the sanity test.
    function version() external pure returns (uint256) {
        return 1;
    }
}
