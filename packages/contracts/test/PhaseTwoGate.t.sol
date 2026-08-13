// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { Fixture } from "./Fixture.sol";
import { DemoVault } from "../src/DemoVault.sol";

/// @notice The Phase 2 roadmap gate.
///
/// @dev The gate: *the protected vault blocks redemption after pause while the control
///      vault can drain when unpaused.* Both vaults here are the same bytecode with the
///      same constructor arguments, the same seeded balance, the same agent, the same
///      committed intent, and the same adversarial over-mint. The **only** difference is
///      that the protected vault receives the guardian's `pause()` — which in production
///      is ChainSRE reacting to the semantic divergence it detected, and which is
///      external to these contracts.
contract PhaseTwoGateTest is Fixture {
    /// @dev Amount the drain attempts to remove: the vault's entire seeded balance.
    uint256 internal constant DRAIN_ASSETS = SEED_ASSETS;

    /// @notice The gate assertion.
    function test_Gate_ProtectedVaultBlocksDrainWhileControlVaultDrains() public {
        // ---- Same starting state ------------------------------------------
        _assertVaultsIdentical();

        // ---- Same agent, same declared intent, on each vault ---------------
        uint64 deadline = _futureDeadline();
        bytes32 protectedIntent =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);
        bytes32 controlIntent =
            _commit(agent, address(controlVault), attacker, NORMAL_SHARES, deadline, 2);

        // ---- Same adversarial execution: 80,000,000 instead of 950 ---------
        // Technically valid on both. Neither contract objects; neither can.
        vm.startPrank(agent);
        protectedVault.mintShares(protectedIntent, attacker, OVERMINT_SHARES);
        controlVault.mintShares(controlIntent, attacker, OVERMINT_SHARES);
        vm.stopPrank();

        assertEq(protectedVault.sharesOf(attacker), OVERMINT_SHARES);
        assertEq(controlVault.sharesOf(attacker), OVERMINT_SHARES);

        // ---- ChainSRE contains only the enrolled (protected) vault ---------
        vm.prank(guardian);
        protectedVault.pause();

        assertTrue(protectedVault.paused(), "protected vault must be paused");
        assertFalse(controlVault.paused(), "control vault must be untouched");

        // ---- The scheduled drain fires against both ------------------------
        vm.prank(attacker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        protectedVault.redeemShares(DRAIN_ASSETS, attacker);

        vm.prank(attacker);
        uint256 drained = controlVault.redeemShares(DRAIN_ASSETS, attacker);

        // ---- Outcome -------------------------------------------------------
        assertEq(protectedVault.totalAssets(), SEED_ASSETS, "protected vault kept every asset");
        assertEq(controlVault.totalAssets(), 0, "control vault was drained");
        assertEq(drained, DRAIN_ASSETS);
        assertEq(asset.balanceOf(attacker), DRAIN_ASSETS, "attacker holds only the control loss");
    }

    /// @notice A matching action needs no containment: the normal run drains nothing.
    function test_NormalRunMintsAndRedeemsWithoutContainment() public {
        uint64 deadline = _futureDeadline();
        bytes32 intentId =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        protectedVault.mintShares(intentId, attacker, NORMAL_SHARES);

        assertEq(
            registry.getCommitment(intentId).paramsHash,
            registry.hashParams(attacker, NORMAL_SHARES),
            "executed params must reproduce the committed hash"
        );

        vm.prank(attacker);
        protectedVault.redeemShares(NORMAL_SHARES, attacker);

        assertFalse(protectedVault.paused(), "a matching action must not pause anything");
        assertEq(protectedVault.totalAssets(), SEED_ASSETS - NORMAL_SHARES);
    }

    /// @notice Both amounts are accepted on-chain. Only the committed hash tells them apart.
    function test_BothTheDeclaredAndTheDivergentAmountAreTechnicallyValid() public {
        uint64 deadline = _futureDeadline();
        bytes32 declared =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        protectedVault.mintShares(declared, attacker, NORMAL_SHARES);
        vm.prank(agent);
        protectedVault.mintShares(declared, attacker, OVERMINT_SHARES);

        assertEq(protectedVault.sharesOf(attacker), NORMAL_SHARES + OVERMINT_SHARES);

        // The divergence is only visible by comparing the action against the commitment.
        assertEq(
            registry.getCommitment(declared).paramsHash,
            registry.hashParams(attacker, NORMAL_SHARES)
        );
        assertTrue(
            registry.getCommitment(declared).paramsHash
                != registry.hashParams(attacker, OVERMINT_SHARES),
            "the executed over-mint must not match the commitment"
        );
    }

    /// @notice Without pause, the protected vault behaves exactly like the control vault.
    function test_ProtectedAndControlAreIndistinguishableBeforeContainment() public {
        _assertVaultsIdentical();

        uint64 deadline = _futureDeadline();
        bytes32 a = _commit(agent, address(protectedVault), attacker, OVERMINT_SHARES, deadline, 1);
        bytes32 b = _commit(agent, address(controlVault), attacker, OVERMINT_SHARES, deadline, 2);

        vm.startPrank(agent);
        protectedVault.mintShares(a, attacker, OVERMINT_SHARES);
        controlVault.mintShares(b, attacker, OVERMINT_SHARES);
        vm.stopPrank();

        // No guardian action anywhere. Both drain.
        vm.startPrank(attacker);
        protectedVault.redeemShares(SEED_ASSETS, attacker);
        controlVault.redeemShares(SEED_ASSETS, attacker);
        vm.stopPrank();

        assertEq(protectedVault.totalAssets(), 0, "unenrolled behaviour is identical");
        assertEq(controlVault.totalAssets(), 0);
    }

    /// @notice Pausing the control vault would also stop it — the code is the same.
    /// @dev Guards against the control vault having been quietly weakened.
    function test_ControlVaultIsNotWeakened() public {
        vm.prank(agent);
        controlVault.mintShares(keccak256("x"), attacker, OVERMINT_SHARES);

        vm.prank(guardian);
        controlVault.pause();

        vm.prank(attacker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        controlVault.redeemShares(SEED_ASSETS, attacker);

        assertEq(controlVault.totalAssets(), SEED_ASSETS);
    }

    /// @notice The two vaults are the same implementation, not merely similar contracts.
    function test_VaultsShareIdenticalRuntimeBytecode() public view {
        assertEq(
            keccak256(address(protectedVault).code),
            keccak256(address(controlVault).code),
            "protected and control vaults must be the same implementation"
        );
        assertTrue(address(protectedVault).code.length > 0, "no code at the protected vault");
        assertTrue(address(protectedVault) != address(controlVault), "must be distinct deployments");
    }

    /// @dev Same asset, same roles, same balances, same pause state, same share supply.
    function _assertVaultsIdentical() internal view {
        assertEq(
            keccak256(address(protectedVault).code),
            keccak256(address(controlVault).code),
            "bytecode differs"
        );
        assertEq(address(protectedVault.asset()), address(controlVault.asset()), "asset differs");
        assertEq(protectedVault.totalAssets(), controlVault.totalAssets(), "seeding differs");
        assertEq(protectedVault.totalShares(), controlVault.totalShares(), "share supply differs");
        assertEq(protectedVault.paused(), controlVault.paused(), "pause state differs");

        bytes32[3] memory roles = [
            protectedVault.DEFAULT_ADMIN_ROLE(),
            protectedVault.MINTER_ROLE(),
            protectedVault.GUARDIAN_ROLE()
        ];
        address[3] memory holders = [admin, agent, guardian];
        for (uint256 i = 0; i < roles.length; i++) {
            assertEq(
                protectedVault.hasRole(roles[i], holders[i]),
                controlVault.hasRole(roles[i], holders[i]),
                "role assignment differs"
            );
        }
    }

    /// @dev Sanity: the fixture really does seed both vaults equally.
    function test_VaultsAreSeededEqually() public view {
        assertEq(protectedVault.totalAssets(), SEED_ASSETS);
        assertEq(controlVault.totalAssets(), SEED_ASSETS);
    }

    /// @dev The demo asset must be the same token in both vaults, or the loss is not
    ///      comparable.
    function test_VaultsHoldTheSameAsset() public view {
        assertEq(address(protectedVault.asset()), address(asset));
        assertEq(address(controlVault.asset()), address(asset));
        assertEq(
            address(DemoVault(address(protectedVault)).asset()), address(IERC20(address(asset)))
        );
    }
}
