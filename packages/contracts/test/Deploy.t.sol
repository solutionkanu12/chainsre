// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { Deploy } from "../script/Deploy.s.sol";
import { DemoVault } from "../src/DemoVault.sol";

/// @dev Exposes the script's internal deployment and verification steps so they can be
///      exercised locally, without broadcasting anything.
contract DeployHarness is Deploy {
    function deployForTest(
        address assetHolder,
        address admin,
        address minter,
        address guardian,
        uint256 seed
    ) external returns (Deployment memory) {
        return deployAll(assetHolder, admin, minter, guardian, seed);
    }

    function verifyForTest(
        Deployment memory d,
        address admin,
        address minter,
        address guardian,
        uint256 seed
    ) external view {
        verify(d, admin, minter, guardian, seed);
    }
}

/// @notice Exercises the Base Sepolia deployment script's logic locally, so a broken
///         wiring or an asymmetric seed is caught before any transaction is broadcast.
contract DeployTest is Test {
    DeployHarness internal harness;

    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");
    address internal guardian = makeAddr("guardian");

    uint256 internal constant SEED = 1_000_000 ether;

    function setUp() public {
        harness = new DeployHarness();
    }

    function _deploy() internal returns (Deploy.Deployment memory) {
        return harness.deployForTest(address(harness), admin, minter, guardian, SEED);
    }

    function test_DeploysAllFourContracts() public {
        Deploy.Deployment memory d = _deploy();

        assertTrue(address(d.registry).code.length > 0, "registry");
        assertTrue(address(d.asset).code.length > 0, "asset");
        assertTrue(address(d.protectedVault).code.length > 0, "protected vault");
        assertTrue(address(d.controlVault).code.length > 0, "control vault");
    }

    function test_VaultsAreIdenticalAndEquallySeeded() public {
        Deploy.Deployment memory d = _deploy();

        assertEq(
            keccak256(address(d.protectedVault).code),
            keccak256(address(d.controlVault).code),
            "vault implementations must be identical"
        );
        assertTrue(address(d.protectedVault) != address(d.controlVault), "distinct deployments");
        assertEq(d.protectedVault.totalAssets(), SEED);
        assertEq(d.controlVault.totalAssets(), SEED);
        assertEq(d.protectedVault.totalShares(), 0);
        assertEq(d.controlVault.totalShares(), 0);
        assertFalse(d.protectedVault.paused());
        assertFalse(d.controlVault.paused());
    }

    function test_RolesAreConfiguredOnBothVaults() public {
        Deploy.Deployment memory d = _deploy();

        DemoVault[2] memory vaults = [d.protectedVault, d.controlVault];
        for (uint256 i = 0; i < vaults.length; i++) {
            assertTrue(vaults[i].hasRole(vaults[i].DEFAULT_ADMIN_ROLE(), admin), "admin");
            assertTrue(vaults[i].hasRole(vaults[i].MINTER_ROLE(), minter), "minter");
            assertTrue(vaults[i].hasRole(vaults[i].GUARDIAN_ROLE(), guardian), "guardian");
            assertFalse(vaults[i].hasRole(vaults[i].MINTER_ROLE(), guardian), "role separation");
            assertFalse(vaults[i].hasRole(vaults[i].GUARDIAN_ROLE(), minter), "role separation");
        }
    }

    function test_VerificationPasses() public {
        Deploy.Deployment memory d = _deploy();
        harness.verifyForTest(d, admin, minter, guardian, SEED);
    }

    function test_RevertWhen_VerificationSeesAnUnequalSeed() public {
        Deploy.Deployment memory d = _deploy();

        // Simulate an asymmetric deployment and confirm verification refuses it.
        vm.prank(address(d.protectedVault));
        d.asset.transfer(address(0xdead), 1);

        vm.expectRevert(bytes("protected: wrong seed balance"));
        harness.verifyForTest(d, admin, minter, guardian, SEED);
    }

    function test_RevertWhen_VerificationSeesAWrongRole() public {
        Deploy.Deployment memory d = _deploy();

        vm.expectRevert(bytes("protected: minter unset"));
        harness.verifyForTest(d, admin, address(0xbeef), guardian, SEED);
    }

    function test_RevertWhen_VerificationSeesAPausedVault() public {
        Deploy.Deployment memory d = _deploy();

        vm.prank(guardian);
        d.protectedVault.pause();

        vm.expectRevert(bytes("protected: already paused"));
        harness.verifyForTest(d, admin, minter, guardian, SEED);
    }

    function test_MockAssetSupplyCoversBothVaultsExactly() public {
        Deploy.Deployment memory d = _deploy();
        assertEq(d.asset.totalSupply(), 2 * SEED);
        assertEq(d.asset.balanceOf(address(harness)), 0, "the deployer keeps nothing back");
    }
}
