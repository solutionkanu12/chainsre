// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DemoVault
/// @notice The vault ChainSRE demonstrates on. It holds {MockAsset}, lets an authorized
///         agent mint shares against a committed intent, lets share holders redeem those
///         shares 1:1 for assets, and lets a guardian pause both.
///
/// @dev **The same bytecode is deployed twice** — once as the *protected* vault (enrolled
///      in ChainSRE) and once as the *control* vault (not enrolled). They are constructed
///      with identical arguments and seeded with identical balances. Nothing in this
///      contract knows or cares which one it is. That is the point: the hackathon
///      comparison is only honest if the sole difference between the two runs is ChainSRE
///      enrollment and the resulting guardian response, never the contract logic.
///
/// @dev **There is deliberately no mint cap.** Minting 80,000,000 shares while unpaused
///      is a *technically valid* transaction and this contract will accept it, exactly as
///      it accepts the declared 950. That is the ChainSRE thesis: technical validity is
///      not semantic correctness. A hard-coded `950` limit here would silently move the
///      policy into the contract and destroy the thing being demonstrated. The semantic
///      policy belongs to ChainSRE — off-chain, versioned, and per-enrollment.
contract DemoVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice May call {mintShares}. Held by the agent's KeeperHub execution wallet.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice May call {pause}. Held by the KeeperHub guardian workflow's sender.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /// @notice Selector of {mintShares}, i.e. the one action ChainSRE supervises.
    /// @dev Mirrors the `selector` field of the shared `MintIntentV1` schema.
    bytes4 public constant MINT_SHARES_SELECTOR =
        bytes4(keccak256("mintShares(bytes32,address,uint256)"));

    /// @notice The ERC-20 this vault holds and pays redemptions in.
    IERC20 public immutable asset;

    /// @notice Share balance per holder.
    mapping(address => uint256) public sharesOf;

    /// @notice Total shares outstanding. May exceed {totalAssets} after an over-mint.
    uint256 public totalShares;

    /// @notice Emitted on every mint, carrying the `intentId` the action claims to fulfil.
    /// @dev The watcher correlates this against `IntentRegistry.IntentCommitted` and
    ///      compares `receiver`/`shares` with the committed `paramsHash` preimage.
    event SharesMinted(
        bytes32 indexed intentId, address indexed operator, address indexed receiver, uint256 shares
    );

    /// @notice Emitted on every redemption, including the assets actually paid out.
    event SharesRedeemed(
        address indexed operator, address indexed receiver, uint256 shares, uint256 assets
    );

    /// @notice A required address argument was the zero address.
    error ZeroAddress();
    /// @notice Share amount must be non-zero.
    error ZeroShares();
    /// @notice Caller does not hold enough shares to redeem.
    error InsufficientShares(uint256 available, uint256 requested);

    /// @param asset_   ERC-20 the vault holds.
    /// @param admin    Receives `DEFAULT_ADMIN_ROLE` (may re-grant roles and {unpause}).
    /// @param minter   Receives {MINTER_ROLE}.
    /// @param guardian Receives {GUARDIAN_ROLE}.
    constructor(IERC20 asset_, address admin, address minter, address guardian) {
        if (address(asset_) == address(0)) revert ZeroAddress();
        if (admin == address(0)) revert ZeroAddress();
        if (minter == address(0)) revert ZeroAddress();
        if (guardian == address(0)) revert ZeroAddress();

        asset = asset_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    /// @notice Mint `shares` to `receiver` on behalf of the intent identified by `intentId`.
    /// @dev Blocked while paused. Accepts any non-zero amount by design — see the
    ///      contract-level note on why there is no cap.
    /// @dev `intentId` is an **unverified correlation tag**, not an authorization. The
    ///      vault deliberately does not read `IntentRegistry`: if it did, the divergence
    ///      would be blocked on-chain and there would be nothing for ChainSRE to detect.
    ///      A caller may pass an id that was never committed, or one whose committed
    ///      parameters differ from these — which is exactly the attack being demonstrated.
    ///      Correlation and comparison happen off-chain, against confirmed events.
    function mintShares(bytes32 intentId, address receiver, uint256 shares)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroShares();

        sharesOf[receiver] += shares;
        totalShares += shares;

        emit SharesMinted(intentId, msg.sender, receiver, shares);
    }

    /// @notice Burn `shares` from the caller and pay out an equal amount of assets.
    /// @dev Shares redeem 1:1 for assets. Blocked while paused — this is what containment
    ///      buys: the over-minted shares still exist, but they can no longer be drained.
    ///      If the vault holds fewer assets than requested the ERC-20 transfer reverts.
    function redeemShares(uint256 shares, address receiver)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroShares();

        uint256 available = sharesOf[msg.sender];
        if (available < shares) revert InsufficientShares(available, shares);

        // Effects before interaction. Left checked on purpose: clarity beats the gas.
        sharesOf[msg.sender] = available - shares;
        totalShares -= shares;
        assets = shares;

        emit SharesRedeemed(msg.sender, receiver, shares, assets);
        asset.safeTransfer(receiver, assets);
    }

    /// @notice Halt minting and redemption. The ChainSRE guardian's containment action.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /// @notice Resume the vault. Admin-only so the guardian role stays scoped to
    ///         containment; used to reset demo fixtures between runs.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Assets currently held by the vault.
    function totalAssets() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
