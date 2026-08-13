// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { DemoVault } from "../src/DemoVault.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";
import { MockAsset } from "../src/MockAsset.sol";

/// @title Deploy
/// @notice Deploys the ChainSRE Phase 2 contracts to Base Sepolia and proves the
///         protected and control vaults start out identical.
///
/// @dev Usage:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url "$BASE_SEPOLIA_RPC_HTTP" --broadcast
///
///      Required environment:
///        DEPLOYER_PRIVATE_KEY  deployer key. **Secret** — read, never printed.
///        VAULT_MINTER          address granted MINTER_ROLE (the agent's executor).
///        VAULT_GUARDIAN        address granted GUARDIAN_ROLE (the KeeperHub sender).
///      Optional environment:
///        VAULT_ADMIN           DEFAULT_ADMIN_ROLE holder. Defaults to the deployer.
///        SEED_ASSETS           assets seeded into *each* vault. Defaults to 1,000,000e18.
///
///      Nothing secret is ever logged: only addresses, amounts and role assignments,
///      all of which are public on-chain anyway.
contract Deploy is Script {
    /// @dev The only chain this script may broadcast to.
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    /// @dev Assets seeded into each vault when SEED_ASSETS is not set.
    uint256 internal constant DEFAULT_SEED_ASSETS = 1_000_000 ether;

    /// @dev Minimum deployer balance. Four deployments plus two ERC-20 transfers cost
    ///      well under this on Base Sepolia, but a non-zero floor beats a `> 0` check
    ///      that a dust balance would pass and that would then run out of gas mid-run,
    ///      leaving a half-deployed, asymmetric topology. A local dry run estimated
    ///      ~0.0077 ETH at 2 gwei; Base Sepolia normally prices well below that, so this
    ///      floor is generous. Override with MIN_DEPLOYER_BALANCE if needed.
    uint256 internal constant MIN_DEPLOYER_BALANCE = 0.01 ether;

    struct Deployment {
        IntentRegistry registry;
        MockAsset asset;
        DemoVault protectedVault;
        DemoVault controlVault;
    }

    function run() external returns (Deployment memory deployment) {
        require(
            block.chainid == BASE_SEPOLIA_CHAIN_ID,
            "Deploy: refusing to broadcast off Base Sepolia (84532)"
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address admin = vm.envOr("VAULT_ADMIN", deployer);
        address minter = vm.envAddress("VAULT_MINTER");
        address guardian = vm.envAddress("VAULT_GUARDIAN");
        uint256 seed = vm.envOr("SEED_ASSETS", DEFAULT_SEED_ASSETS);

        require(deployer != address(0), "Deploy: DEPLOYER_PRIVATE_KEY is invalid");
        require(
            deployer.balance >= vm.envOr("MIN_DEPLOYER_BALANCE", MIN_DEPLOYER_BALANCE),
            "Deploy: deployer balance is below the minimum for a full deployment"
        );
        require(minter != address(0), "Deploy: VAULT_MINTER is required");
        require(guardian != address(0), "Deploy: VAULT_GUARDIAN is required");
        require(seed > 0, "Deploy: SEED_ASSETS must be non-zero");

        vm.startBroadcast(deployerKey);
        deployment = deployAll(deployer, admin, minter, guardian, seed);
        vm.stopBroadcast();

        verify(deployment, admin, minter, guardian, seed);
        _report(deployment, deployer, admin, minter, guardian, seed);
    }

    /// @notice Deploy the full demo topology.
    /// @dev The two vaults are constructed from the same bytecode with byte-identical
    ///      constructor arguments and seeded with equal balances. Any asymmetry here
    ///      would invalidate the protected-versus-control comparison.
    /// @param assetHolder Receives the initial mock supply and seeds both vaults.
    function deployAll(
        address assetHolder,
        address admin,
        address minter,
        address guardian,
        uint256 seed
    ) internal returns (Deployment memory d) {
        d.registry = new IntentRegistry();
        d.asset = new MockAsset(assetHolder, 2 * seed);

        d.protectedVault = new DemoVault(IERC20(address(d.asset)), admin, minter, guardian);
        d.controlVault = new DemoVault(IERC20(address(d.asset)), admin, minter, guardian);

        SafeERC20.safeTransfer(IERC20(address(d.asset)), address(d.protectedVault), seed);
        SafeERC20.safeTransfer(IERC20(address(d.asset)), address(d.controlVault), seed);
    }

    /// @notice Re-read the deployed state and assert it is what was asked for.
    /// @dev This is an in-script guard, **not** independent confirmation. `forge script`
    ///      simulates the whole run before broadcasting, so these assertions read the
    ///      simulated post-deployment state and will abort the run before any transaction
    ///      is sent if the topology is wrong. Confirming what actually landed on-chain
    ///      requires reading the deployed addresses back over RPC afterwards (`cast code`,
    ///      `cast call`), which is a separate step and is where the real proof comes from.
    function verify(
        Deployment memory d,
        address admin,
        address minter,
        address guardian,
        uint256 seed
    ) internal view {
        require(address(d.registry).code.length > 0, "Deploy: no code at IntentRegistry");
        require(address(d.asset).code.length > 0, "Deploy: no code at MockAsset");
        require(address(d.protectedVault).code.length > 0, "Deploy: no code at protected vault");
        require(address(d.controlVault).code.length > 0, "Deploy: no code at control vault");

        require(
            keccak256(address(d.protectedVault).code) == keccak256(address(d.controlVault).code),
            "Deploy: vault implementations differ"
        );
        require(
            address(d.protectedVault) != address(d.controlVault),
            "Deploy: vaults must be distinct deployments"
        );

        require(
            keccak256(bytes(d.registry.INTENT_SCHEMA_ID())) == keccak256("chainsre/mint-v1"),
            "Deploy: registry schema drift"
        );

        _verifyVault(d.protectedVault, d.asset, admin, minter, guardian, seed, "protected");
        _verifyVault(d.controlVault, d.asset, admin, minter, guardian, seed, "control");

        require(
            d.protectedVault.totalAssets() == d.controlVault.totalAssets(),
            "Deploy: vaults are not seeded equally"
        );
    }

    function _verifyVault(
        DemoVault vault,
        MockAsset asset,
        address admin,
        address minter,
        address guardian,
        uint256 seed,
        string memory label
    ) private view {
        require(address(vault.asset()) == address(asset), string.concat(label, ": wrong asset"));
        require(vault.totalAssets() == seed, string.concat(label, ": wrong seed balance"));
        require(vault.totalShares() == 0, string.concat(label, ": shares already minted"));
        require(!vault.paused(), string.concat(label, ": already paused"));

        require(
            vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), admin), string.concat(label, ": admin unset")
        );
        require(vault.hasRole(vault.MINTER_ROLE(), minter), string.concat(label, ": minter unset"));
        require(
            vault.hasRole(vault.GUARDIAN_ROLE(), guardian), string.concat(label, ": guardian unset")
        );

        // Roles must be separated: the guardian may pause but must not be able to mint
        // unless it was deliberately configured as the minter too.
        if (guardian != minter) {
            require(
                !vault.hasRole(vault.MINTER_ROLE(), guardian),
                string.concat(label, ": guardian must not hold MINTER_ROLE")
            );
        }
    }

    /// @dev Public, non-secret deployment facts only.
    function _report(
        Deployment memory d,
        address deployer,
        address admin,
        address minter,
        address guardian,
        uint256 seed
    ) private view {
        console2.log("--- ChainSRE Phase 2 deployment ---");
        console2.log("chainId          ", block.chainid);
        console2.log("deployer         ", deployer);
        console2.log("IntentRegistry   ", address(d.registry));
        console2.log("MockAsset        ", address(d.asset));
        console2.log("DemoVault (prot) ", address(d.protectedVault));
        console2.log("DemoVault (ctrl) ", address(d.controlVault));
        console2.log("admin            ", admin);
        console2.log("minter           ", minter);
        console2.log("guardian         ", guardian);
        console2.log("seed per vault   ", seed);
        console2.log("vault codehash   ", vm.toString(keccak256(address(d.protectedVault).code)));
    }
}
