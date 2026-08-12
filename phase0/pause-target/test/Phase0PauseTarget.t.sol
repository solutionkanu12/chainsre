// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Phase0PauseTarget} from "../src/Phase0PauseTarget.sol";

/// @dev Minimal cheatcode interface — the subset of Foundry's `Vm` we use here.
///      Declared inline so this project needs no forge-std dependency.
interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
}

/// @notice Focused tests for the Phase 0 throwaway pause target.
contract Phase0PauseTargetTest {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    /// @dev Intended pauser = the funded KeeperHub Base Sepolia sender.
    address internal constant PAUSER = 0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB;
    address internal constant ATTACKER = address(0xBAD);

    Phase0PauseTarget internal target;

    /// @dev This test contract is the deployer, hence the `owner`.
    function setUp() public {
        target = new Phase0PauseTarget(PAUSER);
    }

    /// @notice Authorized pause: the pauser can pause and state flips to true.
    function test_PauserCanPause() public {
        vm.prank(PAUSER);
        target.pause();
        require(target.paused(), "expected paused == true");
    }

    /// @notice Unauthorized pause: a non-pauser is rejected with NotPauser.
    function test_NonPauserCannotPause() public {
        vm.prank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(Phase0PauseTarget.NotPauser.selector, ATTACKER));
        target.pause();
    }

    /// @notice Unpause: after a pause, the owner (this contract) can unpause.
    function test_OwnerCanUnpause() public {
        vm.prank(PAUSER);
        target.pause();
        require(target.paused(), "precondition: expected paused");

        // msg.sender here is this test contract == owner (the deployer).
        target.unpause();
        require(!target.paused(), "expected paused == false after unpause");
    }

    /// @notice Repeated pause: pausing twice reverts with AlreadyPaused.
    function test_RepeatedPauseReverts() public {
        vm.prank(PAUSER);
        target.pause();

        vm.prank(PAUSER);
        vm.expectRevert(abi.encodeWithSelector(Phase0PauseTarget.AlreadyPaused.selector));
        target.pause();
    }
}
