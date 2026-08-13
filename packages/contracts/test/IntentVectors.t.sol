// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { stdJson } from "forge-std/StdJson.sol";

import { DemoVault } from "../src/DemoVault.sol";
import { IntentHashLib } from "../src/IntentHashLib.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";

/// @notice Cross-language golden vectors.
///
/// @dev `test/fixtures/intent-vectors.json` holds intents together with the `paramsHash`
///      and `intentId` produced by the **TypeScript** canonicalizer. This suite recomputes
///      both in **Solidity** and requires them to be identical. The matching TypeScript
///      suite (`packages/shared/test/intent-hash.test.ts`) checks the same file from the
///      other side. If both pass, the two implementations provably agree — which is what
///      lets ChainSRE compare an off-chain declaration with an on-chain commitment.
contract IntentVectorsTest is Test {
    using stdJson for string;

    string internal constant FIXTURE = "test/fixtures/intent-vectors.json";

    IntentRegistry internal registry;
    string internal json;

    function setUp() public {
        registry = new IntentRegistry();
        json = vm.readFile(FIXTURE);
    }

    function test_FixtureHeaderMatchesContracts() public view {
        assertEq(json.readString("$.schema"), registry.INTENT_SCHEMA_ID(), "schema id drift");
        assertEq(json.readBytes32("$.schemaHash"), IntentHashLib.SCHEMA_HASH, "schema hash drift");
        assertEq(
            bytes4(json.readBytes("$.mintSharesSelector")),
            DemoVault.mintShares.selector,
            "mintShares selector drift"
        );
    }

    /// @dev One decoded golden vector.
    struct Vector {
        string name;
        uint256 chainId;
        address agent;
        address target;
        address receiver;
        bytes4 selector;
        uint256 shares;
        uint64 deadline;
        uint64 nonce;
        bytes32 paramsHash;
        bytes32 intentId;
    }

    /// @dev Number of vectors, declared in the fixture. The TypeScript suite asserts it
    ///      equals the actual array length, so it cannot silently drift.
    function _vectorCount() internal view returns (uint256) {
        return json.readUint("$.count");
    }

    function test_SolidityReproducesEveryTypeScriptVector() public view {
        uint256 count = _vectorCount();
        assertGe(count, 6, "fixture must cover the demo and boundary cases");

        for (uint256 i = 0; i < count; i++) {
            _assertVector(_readVector(i));
        }
    }

    function _readVector(uint256 index) internal view returns (Vector memory v) {
        string memory base = string.concat("$.vectors[", vm.toString(index), "]");
        v.name = json.readString(string.concat(base, ".name"));
        v.chainId = vm.parseUint(json.readString(string.concat(base, ".chainId")));
        v.agent = json.readAddress(string.concat(base, ".agent"));
        v.target = json.readAddress(string.concat(base, ".target"));
        v.receiver = json.readAddress(string.concat(base, ".receiver"));
        v.selector = bytes4(json.readBytes(string.concat(base, ".selector")));
        v.shares = vm.parseUint(json.readString(string.concat(base, ".shares")));
        v.deadline = uint64(vm.parseUint(json.readString(string.concat(base, ".deadline"))));
        v.nonce = uint64(vm.parseUint(json.readString(string.concat(base, ".nonce"))));
        v.paramsHash = json.readBytes32(string.concat(base, ".paramsHash"));
        v.intentId = json.readBytes32(string.concat(base, ".intentId"));
    }

    function _assertVector(Vector memory v) internal view {
        bytes32 paramsHash = IntentHashLib.hashParams(v.receiver, v.shares);
        assertEq(paramsHash, v.paramsHash, string.concat("paramsHash mismatch in vector ", v.name));

        bytes32 intentId = IntentHashLib.hashIntent(
            v.chainId, v.agent, v.target, v.selector, paramsHash, v.deadline, v.nonce
        );
        assertEq(intentId, v.intentId, string.concat("intentId mismatch in vector ", v.name));

        // The deployed registry's public helpers must agree with the library.
        assertEq(registry.hashParams(v.receiver, v.shares), paramsHash);
        assertEq(
            registry.hashIntent(
                v.chainId, v.agent, v.target, v.selector, paramsHash, v.deadline, v.nonce
            ),
            intentId
        );
    }

    function test_VectorsAreDistinct() public view {
        uint256 count = _vectorCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 idI =
                json.readBytes32(string.concat("$.vectors[", vm.toString(i), "].intentId"));
            for (uint256 j = i + 1; j < count; j++) {
                bytes32 idJ =
                    json.readBytes32(string.concat("$.vectors[", vm.toString(j), "].intentId"));
                assertTrue(idI != idJ, "two vectors collided onto the same intent id");
            }
        }
    }
}
