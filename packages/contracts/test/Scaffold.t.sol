// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Scaffold } from "../src/Scaffold.sol";

/// @notice Self-contained sanity test. Deliberately avoids forge-std so a clean
///         clone builds and tests without vendoring dependencies; Phase 2 tests
///         will pull in forge-std. A Foundry test passes if it does not revert.
contract ScaffoldTest {
    Scaffold internal scaffold;

    function setUp() public {
        scaffold = new Scaffold();
    }

    function test_Version() public view {
        require(scaffold.version() == 1, "unexpected version");
    }

    function test_SchemaId() public view {
        require(
            keccak256(bytes(scaffold.INTENT_SCHEMA_ID())) == keccak256(bytes("chainsre/mint-v1")),
            "schema id drift"
        );
    }
}
