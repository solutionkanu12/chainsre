// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { DemoVault } from "../src/DemoVault.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";
import { MockAsset } from "../src/MockAsset.sol";

/// @notice Shared setup for the Phase 2 contract tests.
/// @dev Deploys the exact demo topology: one registry, one mock asset, and two vaults
///      built from identical bytecode with identical constructor arguments and identical
///      seed balances. Nothing distinguishes `protectedVault` from `controlVault` here —
///      the difference is ChainSRE enrollment, which is off-chain.
abstract contract Fixture is Test {
    MockAsset internal asset;
    IntentRegistry internal registry;
    DemoVault internal protectedVault;
    DemoVault internal controlVault;

    address internal admin;
    address internal agent;
    address internal guardian;
    address internal attacker;
    address internal stranger;

    /// @dev Cached so helpers never make an external call. A `staticcall` between
    ///      `vm.prank` and the pranked call would consume the prank.
    bytes4 internal mintSelector;
    bytes32 internal adminRole;
    bytes32 internal minterRole;
    bytes32 internal guardianRole;

    /// @dev Assets seeded into each vault. Equal by construction.
    uint256 internal constant SEED_ASSETS = 1_000_000 ether;
    /// @dev The amount the agent declares in the demo.
    uint256 internal constant NORMAL_SHARES = 950 ether;
    /// @dev The amount the compromised agent actually executes.
    uint256 internal constant OVERMINT_SHARES = 80_000_000 ether;

    function setUp() public virtual {
        admin = makeAddr("admin");
        agent = makeAddr("agent");
        guardian = makeAddr("guardian");
        attacker = makeAddr("attacker");
        stranger = makeAddr("stranger");

        // Move off timestamp 0 so deadlines in the past are expressible.
        vm.warp(1_700_000_000);

        asset = new MockAsset(address(this), 10 * SEED_ASSETS);
        registry = new IntentRegistry();

        protectedVault = new DemoVault(IERC20(address(asset)), admin, agent, guardian);
        controlVault = new DemoVault(IERC20(address(asset)), admin, agent, guardian);

        require(asset.transfer(address(protectedVault), SEED_ASSETS), "seed protected failed");
        require(asset.transfer(address(controlVault), SEED_ASSETS), "seed control failed");

        mintSelector = protectedVault.MINT_SHARES_SELECTOR();
        adminRole = protectedVault.DEFAULT_ADMIN_ROLE();
        minterRole = protectedVault.MINTER_ROLE();
        guardianRole = protectedVault.GUARDIAN_ROLE();
    }

    /// @dev Selector of the one action ChainSRE supervises.
    function _mintSelector() internal view returns (bytes4) {
        return mintSelector;
    }

    /// @dev A deadline comfortably in the future.
    function _futureDeadline() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    /// @dev Compute the canonical id for an intent as `commitIntent` would.
    function _intentId(
        address agent_,
        address target,
        address receiver,
        uint256 shares,
        uint64 deadline,
        uint64 nonce
    ) internal view returns (bytes32) {
        return registry.hashIntent(
            block.chainid,
            agent_,
            target,
            _mintSelector(),
            registry.hashParams(receiver, shares),
            deadline,
            nonce
        );
    }

    /// @dev Commit an intent as `agent_` and return its id.
    function _commit(
        address agent_,
        address target,
        address receiver,
        uint256 shares,
        uint64 deadline,
        uint64 nonce
    ) internal returns (bytes32 intentId) {
        bytes32 paramsHash = registry.hashParams(receiver, shares);
        intentId = registry.hashIntent(
            block.chainid, agent_, target, _mintSelector(), paramsHash, deadline, nonce
        );
        vm.prank(agent_);
        registry.commitIntent(intentId, target, _mintSelector(), paramsHash, deadline, nonce);
    }
}
