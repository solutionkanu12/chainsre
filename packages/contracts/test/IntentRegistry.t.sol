// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Fixture } from "./Fixture.sol";
import { IntentHashLib } from "../src/IntentHashLib.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";

/// @notice Security boundaries of the intent commitment registry.
contract IntentRegistryTest is Fixture {
    event IntentCommitted(
        bytes32 indexed intentId,
        address indexed agent,
        address indexed target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    );

    // --------------------------------------------------------------------- //
    // Canonical hashing                                                     //
    // --------------------------------------------------------------------- //

    function test_SchemaConstantsMatchSharedSchema() public view {
        assertEq(registry.INTENT_SCHEMA_ID(), "chainsre/mint-v1", "schema id drift");
        assertEq(
            registry.INTENT_SCHEMA_HASH(), keccak256(bytes("chainsre/mint-v1")), "schema hash drift"
        );
    }

    function test_HashIsDeterministic() public view {
        uint64 deadline = _futureDeadline();
        bytes32 a = _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);
        bytes32 b = _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);
        assertEq(a, b, "same inputs must hash identically");
    }

    function test_HashChangesWithEveryField() public view {
        uint64 deadline = _futureDeadline();
        bytes32 base =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        assertTrue(
            base
                != _intentId(
                    stranger, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1
                ),
            "agent must be in the domain"
        );
        assertTrue(
            base != _intentId(agent, address(controlVault), attacker, NORMAL_SHARES, deadline, 1),
            "target must be in the domain"
        );
        assertTrue(
            base != _intentId(agent, address(protectedVault), stranger, NORMAL_SHARES, deadline, 1),
            "receiver must be in the domain"
        );
        assertTrue(
            base
                != _intentId(
                    agent, address(protectedVault), attacker, OVERMINT_SHARES, deadline, 1
                ),
            "shares must be in the domain"
        );
        assertTrue(
            base
                != _intentId(
                    agent, address(protectedVault), attacker, NORMAL_SHARES, deadline + 1, 1
                ),
            "deadline must be in the domain"
        );
        assertTrue(
            base != _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 2),
            "nonce must be in the domain"
        );
    }

    function test_HashIncludesChainId() public view {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 onBase = registry.hashIntent(
            84_532, agent, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
        bytes32 onMainnet = registry.hashIntent(
            1, agent, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
        assertTrue(onBase != onMainnet, "chain id must be in the hash domain");
    }

    function test_HashIntentForCallerMatchesCommitPath() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);

        vm.prank(agent);
        bytes32 fromView = registry.hashIntentForCaller(
            address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );

        assertEq(
            fromView,
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1),
            "view helper must match the committed hash"
        );
    }

    function testFuzz_ParamsHashIsInjective(
        address receiverA,
        uint256 sharesA,
        address receiverB,
        uint256 sharesB
    ) public view {
        vm.assume(receiverA != receiverB || sharesA != sharesB);
        assertTrue(
            registry.hashParams(receiverA, sharesA) != registry.hashParams(receiverB, sharesB),
            "distinct params must not collide"
        );
    }

    // --------------------------------------------------------------------- //
    // Commitment                                                            //
    // --------------------------------------------------------------------- //

    function test_CommitStoresAndEmits() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IntentCommitted(
            intentId, agent, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );

        vm.prank(agent);
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );

        assertTrue(registry.isCommitted(intentId), "commitment must exist");
        assertTrue(registry.isNonceUsed(agent, 1), "nonce must be spent");

        IntentRegistry.Commitment memory c = registry.getCommitment(intentId);
        assertEq(c.agent, agent);
        assertEq(c.target, address(protectedVault));
        assertEq(c.selector, _mintSelector());
        assertEq(c.paramsHash, paramsHash);
        assertEq(c.deadline, deadline);
        assertEq(c.nonce, 1);
        assertEq(c.committedAt, uint64(block.timestamp));
        assertEq(c.committedAtBlock, uint64(block.number));
    }

    function test_CommitmentEventCorrelatesActionParameters() public {
        // The watcher recomputes the paramsHash from the decoded SharesMinted event and
        // compares it with the commitment. Matching values must reproduce the hash.
        uint64 deadline = _futureDeadline();
        bytes32 intentId =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        IntentRegistry.Commitment memory c = registry.getCommitment(intentId);
        assertEq(
            c.paramsHash,
            registry.hashParams(attacker, NORMAL_SHARES),
            "declared params must reproduce the committed hash"
        );
        assertTrue(
            c.paramsHash != registry.hashParams(attacker, OVERMINT_SHARES),
            "an over-mint must not reproduce the committed hash"
        );
    }

    function test_RevertWhen_IntentIdDoesNotMatchFields() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 wrongId = keccak256("not the canonical hash");
        bytes32 expected =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IntentRegistry.IntentIdMismatch.selector, wrongId, expected)
        );
        registry.commitIntent(
            wrongId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_RevertWhen_AgentImpersonated() public {
        // An id computed for `agent` cannot be committed by anyone else: the registry
        // always rebuilds the hash from msg.sender.
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(attacker);
        vm.expectRevert();
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_RevertWhen_DeadlineExpired() public {
        uint64 deadline = uint64(block.timestamp - 1);
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IntentRegistry.IntentExpired.selector, deadline, uint64(block.timestamp)
            )
        );
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_RevertWhen_DeadlineIsExactlyNow() public {
        uint64 deadline = uint64(block.timestamp);
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId =
            _intentId(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IntentRegistry.IntentExpired.selector, deadline, uint64(block.timestamp)
            )
        );
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_RevertWhen_CommitmentDuplicated() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IntentRegistry.IntentAlreadyCommitted.selector, intentId)
        );
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_RevertWhen_NonceReused() public {
        uint64 deadline = _futureDeadline();
        _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        // Different parameters, same agent and nonce: a distinct intent id, still replay.
        bytes32 paramsHash = registry.hashParams(attacker, OVERMINT_SHARES);
        bytes32 intentId =
            _intentId(agent, address(protectedVault), attacker, OVERMINT_SHARES, deadline, 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IntentRegistry.NonceAlreadyUsed.selector, agent, uint64(1))
        );
        registry.commitIntent(
            intentId, address(protectedVault), _mintSelector(), paramsHash, deadline, 1
        );
    }

    function test_NoncesAreScopedPerAgent() public {
        uint64 deadline = _futureDeadline();
        _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);
        // A different agent may use nonce 1 too.
        _commit(stranger, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);

        assertTrue(registry.isNonceUsed(agent, 1));
        assertTrue(registry.isNonceUsed(stranger, 1));
        assertFalse(registry.isNonceUsed(agent, 2));
    }

    function test_RevertWhen_TargetIsZero() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId = registry.hashIntent(
            block.chainid, agent, address(0), _mintSelector(), paramsHash, deadline, 1
        );

        vm.prank(agent);
        vm.expectRevert(IntentRegistry.InvalidTarget.selector);
        registry.commitIntent(intentId, address(0), _mintSelector(), paramsHash, deadline, 1);
    }

    function test_RevertWhen_SelectorIsEmpty() public {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = registry.hashParams(attacker, NORMAL_SHARES);
        bytes32 intentId = registry.hashIntent(
            block.chainid, agent, address(protectedVault), bytes4(0), paramsHash, deadline, 1
        );

        vm.prank(agent);
        vm.expectRevert(IntentRegistry.InvalidSelector.selector);
        registry.commitIntent(intentId, address(protectedVault), bytes4(0), paramsHash, deadline, 1);
    }

    function test_RevertWhen_ReadingUnknownCommitment() public {
        bytes32 unknown = keccak256("never committed");
        vm.expectRevert(abi.encodeWithSelector(IntentRegistry.UnknownIntent.selector, unknown));
        registry.getCommitment(unknown);
        assertFalse(registry.isCommitted(unknown));
    }

    function test_CommitmentsAreImmutable() public {
        uint64 deadline = _futureDeadline();
        bytes32 intentId =
            _commit(agent, address(protectedVault), attacker, NORMAL_SHARES, deadline, 1);
        IntentRegistry.Commitment memory before = registry.getCommitment(intentId);

        // Time passes and the intent expires; the stored record must not change.
        vm.warp(uint256(deadline) + 1 days);
        IntentRegistry.Commitment memory later = registry.getCommitment(intentId);

        assertEq(keccak256(abi.encode(before)), keccak256(abi.encode(later)), "record mutated");
        assertTrue(registry.isCommitted(intentId), "commitment must survive expiry");
    }

    function test_LibraryAndContractHashesAgree() public view {
        uint64 deadline = _futureDeadline();
        bytes32 paramsHash = IntentHashLib.hashParams(attacker, NORMAL_SHARES);
        assertEq(paramsHash, registry.hashParams(attacker, NORMAL_SHARES));
        assertEq(
            IntentHashLib.hashIntent(
                block.chainid,
                agent,
                address(protectedVault),
                _mintSelector(),
                paramsHash,
                deadline,
                1
            ),
            registry.hashIntent(
                block.chainid,
                agent,
                address(protectedVault),
                _mintSelector(),
                paramsHash,
                deadline,
                1
            )
        );
    }
}
