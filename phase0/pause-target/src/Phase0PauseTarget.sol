// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Phase0PauseTarget
/// @notice THROWAWAY verification contract for ChainSRE Phase 0 ONLY. This is not
///         the production vault and holds no funds. Its single job is to give a
///         KeeperHub guardian workflow something to call `pause()` on so we can
///         prove external workflow triggering works on Base Sepolia (84532).
/// @dev    Access model:
///           - `pauser` (set at construction) is the ONLY address that may pause.
///             In this project the intended pauser is the funded KeeperHub sender
///             0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB (Base Sepolia).
///           - `owner` (the deployer) is the ONLY address that may unpause.
contract Phase0PauseTarget {
    /// @notice Deployer; the only address allowed to unpause.
    address public immutable owner;

    /// @notice Authorized pauser; the only address allowed to pause.
    ///         Intended to be the KeeperHub execution wallet.
    address public immutable pauser;

    /// @notice Current paused state.
    bool public paused;

    /// @notice Emitted when the contract is paused. `caller` is the pauser.
    event Paused(address indexed caller);

    /// @notice Emitted when the contract is unpaused. `caller` is the owner.
    event Unpaused(address indexed caller);

    /// @notice Thrown when a non-pauser calls `pause()`.
    error NotPauser(address caller);

    /// @notice Thrown when a non-owner calls `unpause()`.
    error NotOwner(address caller);

    /// @notice Thrown when `pause()` is called while already paused.
    error AlreadyPaused();

    /// @notice Thrown when `unpause()` is called while not paused.
    error NotPaused();

    /// @notice Thrown when the pauser is set to the zero address.
    error ZeroAddress();

    /// @param pauser_ The address authorized to call `pause()` (the KeeperHub sender).
    constructor(address pauser_) {
        if (pauser_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        pauser = pauser_;
    }

    /// @notice Pause the contract. Only callable by `pauser`.
    function pause() external {
        if (msg.sender != pauser) revert NotPauser(msg.sender);
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause the contract. Only callable by `owner`.
    function unpause() external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }
}
