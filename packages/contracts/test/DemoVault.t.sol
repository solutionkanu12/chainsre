// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { Fixture } from "./Fixture.sol";
import { DemoVault } from "../src/DemoVault.sol";

/// @notice Security boundaries of the demo vault: who may mint, who may pause, and what
///         pausing actually stops.
contract DemoVaultTest is Fixture {
    event SharesMinted(
        bytes32 indexed intentId, address indexed operator, address indexed receiver, uint256 shares
    );
    event SharesRedeemed(
        address indexed operator, address indexed receiver, uint256 shares, uint256 assets
    );

    // --------------------------------------------------------------------- //
    // Construction and roles                                                //
    // --------------------------------------------------------------------- //

    function test_InitialState() public view {
        assertEq(address(protectedVault.asset()), address(asset));
        assertEq(protectedVault.totalAssets(), SEED_ASSETS);
        assertEq(protectedVault.totalShares(), 0);
        assertFalse(protectedVault.paused());

        assertTrue(protectedVault.hasRole(protectedVault.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(protectedVault.hasRole(protectedVault.MINTER_ROLE(), agent));
        assertTrue(protectedVault.hasRole(protectedVault.GUARDIAN_ROLE(), guardian));
        assertFalse(protectedVault.hasRole(protectedVault.MINTER_ROLE(), attacker));
        assertFalse(protectedVault.hasRole(protectedVault.GUARDIAN_ROLE(), attacker));
    }

    function test_MintSelectorMatchesSignature() public view {
        assertEq(
            protectedVault.MINT_SHARES_SELECTOR(),
            DemoVault.mintShares.selector,
            "advertised selector must match the real function"
        );
    }

    function test_RevertWhen_ConstructedWithZeroAddress() public {
        vm.expectRevert(DemoVault.ZeroAddress.selector);
        new DemoVault(IERC20(address(0)), admin, agent, guardian);

        vm.expectRevert(DemoVault.ZeroAddress.selector);
        new DemoVault(IERC20(address(asset)), address(0), agent, guardian);

        vm.expectRevert(DemoVault.ZeroAddress.selector);
        new DemoVault(IERC20(address(asset)), admin, address(0), guardian);

        vm.expectRevert(DemoVault.ZeroAddress.selector);
        new DemoVault(IERC20(address(asset)), admin, agent, address(0));
    }

    // --------------------------------------------------------------------- //
    // Minting                                                               //
    // --------------------------------------------------------------------- //

    function test_AuthorizedMinterMints950() public {
        bytes32 intentId = keccak256("normal");

        vm.expectEmit(true, true, true, true, address(protectedVault));
        emit SharesMinted(intentId, agent, attacker, NORMAL_SHARES);

        vm.prank(agent);
        protectedVault.mintShares(intentId, attacker, NORMAL_SHARES);

        assertEq(protectedVault.sharesOf(attacker), NORMAL_SHARES);
        assertEq(protectedVault.totalShares(), NORMAL_SHARES);
        // Minting does not move assets; only redemption does.
        assertEq(protectedVault.totalAssets(), SEED_ASSETS);
    }

    /// @notice The core ChainSRE thesis, asserted in code.
    /// @dev An 80,000,000-share mint is *technically valid* and the contract accepts it.
    ///      There is no on-chain cap to catch it, and there must not be: the semantic
    ///      policy belongs to ChainSRE, not to a hard-coded `950` limit here.
    function test_OverMintOf80MillionIsTechnicallyValid() public {
        bytes32 intentId = keccak256("declared-950-but-executed-80m");

        vm.prank(agent);
        protectedVault.mintShares(intentId, attacker, OVERMINT_SHARES);

        assertEq(protectedVault.sharesOf(attacker), OVERMINT_SHARES, "over-mint must succeed");
        assertEq(protectedVault.totalShares(), OVERMINT_SHARES);
        assertTrue(
            protectedVault.totalShares() > protectedVault.totalAssets(),
            "shares are now unbacked, yet the transaction was valid"
        );
    }

    function test_RevertWhen_UnauthorizedMinterMints() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, minterRole
            )
        );
        protectedVault.mintShares(keccak256("nope"), attacker, NORMAL_SHARES);
    }

    function test_RevertWhen_GuardianTriesToMint() public {
        // Roles are separated: the pauser is not a minter.
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, minterRole
            )
        );
        protectedVault.mintShares(keccak256("nope"), guardian, NORMAL_SHARES);
    }

    function test_RevertWhen_AdminTriesToMint() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, minterRole
            )
        );
        protectedVault.mintShares(keccak256("nope"), admin, NORMAL_SHARES);
    }

    function test_RevertWhen_MintingZeroOrToZeroAddress() public {
        vm.prank(agent);
        vm.expectRevert(DemoVault.ZeroShares.selector);
        protectedVault.mintShares(keccak256("zero"), attacker, 0);

        vm.prank(agent);
        vm.expectRevert(DemoVault.ZeroAddress.selector);
        protectedVault.mintShares(keccak256("zero"), address(0), NORMAL_SHARES);
    }

    function test_RevertWhen_MintingWhilePaused() public {
        vm.prank(guardian);
        protectedVault.pause();

        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        protectedVault.mintShares(keccak256("blocked"), attacker, NORMAL_SHARES);
    }

    // --------------------------------------------------------------------- //
    // Pausing                                                               //
    // --------------------------------------------------------------------- //

    function test_GuardianCanPause() public {
        assertFalse(protectedVault.paused());
        vm.prank(guardian);
        protectedVault.pause();
        assertTrue(protectedVault.paused());
    }

    function test_RevertWhen_UnauthorizedAccountPauses() public {
        address[3] memory unauthorized = [attacker, agent, stranger];
        for (uint256 i = 0; i < unauthorized.length; i++) {
            vm.prank(unauthorized[i]);
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector,
                    unauthorized[i],
                    guardianRole
                )
            );
            protectedVault.pause();
        }
        assertFalse(protectedVault.paused(), "vault must still be live");
    }

    function test_RevertWhen_GuardianUnpauses() public {
        // The guardian may contain, but may not undo containment.
        vm.prank(guardian);
        protectedVault.pause();

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, adminRole
            )
        );
        protectedVault.unpause();
        assertTrue(protectedVault.paused());
    }

    function test_AdminCanUnpauseToResetFixtures() public {
        vm.prank(guardian);
        protectedVault.pause();
        vm.prank(admin);
        protectedVault.unpause();
        assertFalse(protectedVault.paused());
    }

    // --------------------------------------------------------------------- //
    // Redemption                                                            //
    // --------------------------------------------------------------------- //

    function test_UnpausedRedemptionSucceeds() public {
        vm.prank(agent);
        protectedVault.mintShares(keccak256("normal"), attacker, NORMAL_SHARES);

        vm.expectEmit(true, true, true, true, address(protectedVault));
        emit SharesRedeemed(attacker, attacker, NORMAL_SHARES, NORMAL_SHARES);

        vm.prank(attacker);
        uint256 assets = protectedVault.redeemShares(NORMAL_SHARES, attacker);

        assertEq(assets, NORMAL_SHARES, "shares redeem 1:1");
        assertEq(asset.balanceOf(attacker), NORMAL_SHARES);
        assertEq(protectedVault.totalAssets(), SEED_ASSETS - NORMAL_SHARES);
        assertEq(protectedVault.sharesOf(attacker), 0);
        assertEq(protectedVault.totalShares(), 0);
    }

    function test_RedemptionCanPayADifferentReceiver() public {
        vm.prank(agent);
        protectedVault.mintShares(keccak256("normal"), attacker, NORMAL_SHARES);

        vm.prank(attacker);
        protectedVault.redeemShares(NORMAL_SHARES, stranger);

        assertEq(asset.balanceOf(stranger), NORMAL_SHARES);
        assertEq(asset.balanceOf(attacker), 0);
    }

    function test_RevertWhen_RedeemingWhilePaused() public {
        vm.prank(agent);
        protectedVault.mintShares(keccak256("normal"), attacker, NORMAL_SHARES);

        vm.prank(guardian);
        protectedVault.pause();

        vm.prank(attacker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        protectedVault.redeemShares(NORMAL_SHARES, attacker);

        assertEq(protectedVault.totalAssets(), SEED_ASSETS, "no assets may leave a paused vault");
    }

    function test_RevertWhen_RedeemingMoreSharesThanHeld() public {
        vm.prank(agent);
        protectedVault.mintShares(keccak256("normal"), attacker, NORMAL_SHARES);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                DemoVault.InsufficientShares.selector, NORMAL_SHARES, NORMAL_SHARES + 1
            )
        );
        protectedVault.redeemShares(NORMAL_SHARES + 1, attacker);
    }

    function test_RevertWhen_RedeemingZeroOrToZeroAddress() public {
        vm.prank(attacker);
        vm.expectRevert(DemoVault.ZeroShares.selector);
        protectedVault.redeemShares(0, attacker);

        vm.prank(attacker);
        vm.expectRevert(DemoVault.ZeroAddress.selector);
        protectedVault.redeemShares(NORMAL_SHARES, address(0));
    }

    function test_RevertWhen_RedeemingBeyondVaultAssets() public {
        // Shares can be over-minted beyond backing; the asset transfer is what fails.
        vm.prank(agent);
        protectedVault.mintShares(keccak256("overmint"), attacker, OVERMINT_SHARES);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector,
                address(protectedVault),
                SEED_ASSETS,
                OVERMINT_SHARES
            )
        );
        protectedVault.redeemShares(OVERMINT_SHARES, attacker);
    }

    function test_OverMintedSharesCanDrainTheWholeVault() public {
        vm.prank(agent);
        protectedVault.mintShares(keccak256("overmint"), attacker, OVERMINT_SHARES);

        vm.prank(attacker);
        protectedVault.redeemShares(SEED_ASSETS, attacker);

        assertEq(protectedVault.totalAssets(), 0, "vault drained");
        assertEq(asset.balanceOf(attacker), SEED_ASSETS);
    }

    function testFuzz_MintThenRedeemConservesAssets(uint256 shares) public {
        shares = bound(shares, 1, SEED_ASSETS);

        vm.prank(agent);
        protectedVault.mintShares(keccak256("fuzz"), attacker, shares);
        vm.prank(attacker);
        protectedVault.redeemShares(shares, attacker);

        assertEq(protectedVault.totalShares(), 0);
        assertEq(asset.balanceOf(attacker) + protectedVault.totalAssets(), SEED_ASSETS);
    }
}
