// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockAsset
/// @notice Valueless ERC-20 test asset that makes the ChainSRE control-vault loss
///         visible on Base Sepolia.
///
/// @dev THIS TOKEN HAS NO VALUE AND IS FOR TESTNET DEMONSTRATION ONLY.
///      {mint} is intentionally permissionless so demo fixtures can be reset without a
///      privileged key. That is safe here: minting to yourself does not move any vault's
///      assets — draining a {DemoVault} still requires vault shares, which only the
///      vault's authorized minter can create. Never deploy this contract to mainnet.
contract MockAsset is ERC20 {
    /// @param initialHolder Receives the initial supply (the deployer, which then seeds
    ///                      the protected and control vaults equally).
    /// @param initialSupply Amount minted to `initialHolder`, in 18-decimal units.
    constructor(address initialHolder, uint256 initialSupply)
        ERC20("ChainSRE Mock Asset", "csMOCK")
    {
        _mint(initialHolder, initialSupply);
    }

    /// @notice Permissionless testnet faucet. See the contract-level warning.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
