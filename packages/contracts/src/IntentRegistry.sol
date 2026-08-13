// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IntentHashLib } from "./IntentHashLib.sol";

/// @title IntentRegistry
/// @notice On-chain commitment registry for ChainSRE's `MintIntentV1` typed intents.
///
/// @dev An agent commits the hash of what it *declares* it will do **before** it acts.
///      ChainSRE's off-chain watcher later compares the confirmed action against this
///      commitment and trips the guardian when they diverge.
///
///      Scope is deliberately narrow (see `02-Hackathon-PRD.md` §6): this is a typed
///      commitment anchor for one action shape, **not** a generic policy engine for
///      arbitrary contracts and calldata. It does not authorize, gate, or execute
///      anything — enforcement lives off-chain in ChainSRE and on-chain in the vault's
///      guardian pause.
contract IntentRegistry {
    /// @notice A stored intent commitment.
    /// @dev `committedAt != 0` is the existence flag; a commitment is never deleted.
    struct Commitment {
        address agent;
        address target;
        bytes4 selector;
        bytes32 paramsHash;
        uint64 deadline;
        uint64 nonce;
        uint64 committedAt;
        uint64 committedAtBlock;
    }

    /// @notice Human-readable schema discriminant, mirrored by the shared Zod schema.
    string public constant INTENT_SCHEMA_ID = IntentHashLib.SCHEMA_ID;

    /// @notice `keccak256(bytes(INTENT_SCHEMA_ID))` — the hash domain separator.
    bytes32 public constant INTENT_SCHEMA_HASH = IntentHashLib.SCHEMA_HASH;

    /// @dev intentId => commitment.
    mapping(bytes32 => Commitment) private _commitments;

    /// @dev agent => nonce => used. One nonce per agent, ever.
    mapping(address => mapping(uint64 => bool)) private _usedNonces;

    /// @notice Emitted once per accepted commitment.
    /// @dev Carries everything the watcher needs to correlate a later on-chain action
    ///      with this declaration: the id, who declared it, what it targets, which
    ///      function, the parameter hash, and the validity window.
    event IntentCommitted(
        bytes32 indexed intentId,
        address indexed agent,
        address indexed target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    );

    /// @notice The supplied `intentId` is not the canonical hash of the supplied fields.
    error IntentIdMismatch(bytes32 provided, bytes32 expected);
    /// @notice The intent's deadline has already passed.
    error IntentExpired(uint64 deadline, uint64 blockTimestamp);
    /// @notice This exact intent has already been committed.
    error IntentAlreadyCommitted(bytes32 intentId);
    /// @notice This agent has already used this nonce.
    error NonceAlreadyUsed(address agent, uint64 nonce);
    /// @notice The target contract address is the zero address.
    error InvalidTarget();
    /// @notice The declared function selector is empty.
    error InvalidSelector();
    /// @notice No commitment exists for the requested id.
    error UnknownIntent(bytes32 intentId);

    /// @notice Commit a typed mint intent before executing it.
    /// @dev The caller is the agent; the chain is `block.chainid`. Both are folded into
    ///      the canonical hash rather than accepted as arguments, so a commitment can
    ///      never claim a different agent or chain than the one that produced it.
    /// @param intentId   Canonical intent hash, recomputed and checked here.
    /// @param target     Contract the action targets (the vault).
    /// @param selector   4-byte selector the agent intends to call.
    /// @param paramsHash `keccak256(abi.encode(receiver, shares))`.
    /// @param deadline   Unix seconds after which the intent is no longer valid.
    /// @param nonce      Per-agent replay-protection nonce.
    function commitIntent(
        bytes32 intentId,
        address target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    ) external {
        if (target == address(0)) revert InvalidTarget();
        if (selector == bytes4(0)) revert InvalidSelector();
        // A deadline is a wall-clock window by definition, so `block.timestamp` is the
        // correct oracle here. Second-level proposer drift is irrelevant: intent windows
        // are minutes wide and the watcher, not this check, is what enforces semantics.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline <= block.timestamp) {
            revert IntentExpired(deadline, uint64(block.timestamp));
        }

        bytes32 expected = IntentHashLib.hashIntent(
            block.chainid, msg.sender, target, selector, paramsHash, deadline, nonce
        );
        if (intentId != expected) revert IntentIdMismatch(intentId, expected);

        // Checked before the nonce so that re-submitting an identical intent reports the
        // more specific duplicate-commitment error.
        if (_commitments[intentId].committedAt != 0) revert IntentAlreadyCommitted(intentId);
        if (_usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed(msg.sender, nonce);

        _usedNonces[msg.sender][nonce] = true;
        _commitments[intentId] = Commitment({
            agent: msg.sender,
            target: target,
            selector: selector,
            paramsHash: paramsHash,
            deadline: deadline,
            nonce: nonce,
            // uint64 holds both values for ~584 billion years / blocks; neither cast
            // can truncate on any reachable chain state.
            committedAt: uint64(block.timestamp),
            committedAtBlock: uint64(block.number)
        });

        emit IntentCommitted(intentId, msg.sender, target, selector, paramsHash, deadline, nonce);
    }

    /// @notice Read a stored commitment, reverting if it does not exist.
    function getCommitment(bytes32 intentId) external view returns (Commitment memory) {
        Commitment memory commitment = _commitments[intentId];
        if (commitment.committedAt == 0) revert UnknownIntent(intentId);
        return commitment;
    }

    /// @notice Whether an intent has been committed.
    function isCommitted(bytes32 intentId) external view returns (bool) {
        return _commitments[intentId].committedAt != 0;
    }

    /// @notice Whether an agent has already spent a nonce.
    function isNonceUsed(address agent, uint64 nonce) external view returns (bool) {
        return _usedNonces[agent][nonce];
    }

    /// @notice Canonical params hash for a mint intent.
    function hashParams(address receiver, uint256 shares) external pure returns (bytes32) {
        return IntentHashLib.hashParams(receiver, shares);
    }

    /// @notice Canonical intent hash for an explicit chain id.
    /// @dev Pure so off-chain tooling and golden vectors can reproduce any chain's hash.
    function hashIntent(
        uint256 chainId,
        address agent,
        address target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    ) external pure returns (bytes32) {
        return IntentHashLib.hashIntent(
            chainId, agent, target, selector, paramsHash, deadline, nonce
        );
    }

    /// @notice Canonical intent hash for *this* chain, as {commitIntent} would compute it.
    function hashIntentForCaller(
        address target,
        bytes4 selector,
        bytes32 paramsHash,
        uint64 deadline,
        uint64 nonce
    ) external view returns (bytes32) {
        return IntentHashLib.hashIntent(
            block.chainid, msg.sender, target, selector, paramsHash, deadline, nonce
        );
    }
}
