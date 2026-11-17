// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./GL3ZkTypes.sol";
import "./GL3DataRegistry.sol";

interface IGL3SP1Verifier {
    function verifyProof(bytes32 programVKey, bytes calldata publicValues, bytes calldata proof) external view;
}

interface IGL3FreshGraphFactory {
    function createdGraphHash(address coordinator) external view returns (bytes32);
}

interface IGL3BridgeGraph is IGL3AccumulatorBridge {
    function rollup() external view returns (address);
    function nativeToken() external view returns (address);
    function sequencerInbox() external view returns (address);
    function allowedDelayedInboxList(uint256 index) external view returns (address);
    function allowedOutboxList(uint256 index) external view returns (address);
    function allowedDelayedInboxes(address inbox) external view returns (bool);
    function allowedOutboxes(address outbox) external view returns (bool);
}

interface IGL3InboxGraph {
    function bridge() external view returns (address);
    function sequencerInbox() external view returns (address);
}

interface IGL3SequencerGraph {
    function bridge() external view returns (address);
    function rollup() external view returns (address);
    function batchPosterManager() external view returns (address);
}

interface IGL3OutboxGraph {
    function bridge() external view returns (address);
    function rollup() external view returns (address);
    function updateSendRoot(bytes32 sendRoot, bytes32 l2BlockHash) external;
}

/// @notice Research candidate. No accepted canonical STF guest key exists yet.
/// @dev Deploy only through a reviewed immutable factory that creates and
/// initializes fresh clones in the same transaction and then calls seal().
contract GL3ZkCoordinator is GL3DataRegistry {
    uint256 public constant STATEMENT_BYTES = 736;
    bytes32 public constant CHAIN_DOMAIN = keccak256("GH0ST_GL3_ZK_CHAIN_V1");

    struct Implementations {
        address bridge;
        address inbox;
        address sequencerInbox;
        address outbox;
    }

    struct Graph {
        address bridge;
        address inbox;
        address sequencerInbox;
        address outbox;
    }

    struct ProofConfig {
        address verifier;
        bytes32 verifierCodeHash;
        bytes32 programVKey;
        bytes32 machineRoot;
        bytes32 executionProfileHash;
        uint256 childChainId;
        address nativeToken;
    }

    address public immutable bootstrapFactory;
    bytes32 public immutable bootstrapFactoryCodeHash;
    address public immutable verifier;
    bytes32 public immutable verifierCodeHash;
    bytes32 public immutable programVKey;
    bytes32 public immutable machineRoot;
    bytes32 public immutable executionProfileHash;
    uint256 public immutable childChainId;
    address public immutable nativeToken;
    bytes32 public immutable genesisStateHash;
    bytes32 public immutable implementationsHash;
    bytes32 public immutable implementationCodeHashes;

    bool public bootstrapSealed;
    bytes32 public domain;
    uint64 public finalizedTransition;
    GL3ZkTypes.GlobalState private state;
    Graph public graph;
    bool private finalizing;

    error InvalidConfiguration();
    error UnauthorizedBootstrap();
    error InvalidGraph();
    error InvalidStatement();
    error StaleState();
    error DataCommitmentMismatch();
    error RecursiveFinalization();

    event BootstrapSealed(bytes32 indexed domain, bytes32 indexed graphHash);
    event TransitionFinalized(uint64 indexed index, bytes32 indexed blockHash, bytes32 indexed sendRoot);

    constructor(ProofConfig memory config, Implementations memory implementations,
                GL3ZkTypes.GlobalState memory genesis) {
        if (msg.sender.code.length == 0 || config.verifier.code.length == 0 ||
            config.verifier.codehash != config.verifierCodeHash ||
            config.programVKey == bytes32(0) || config.machineRoot == bytes32(0) ||
            config.executionProfileHash == bytes32(0) || config.childChainId == 0 ||
            config.childChainId == block.chainid || config.nativeToken.code.length == 0 ||
            genesis.blockHash == bytes32(0) || genesis.sendRoot != bytes32(0) ||
            genesis.melStateHash != bytes32(0) || genesis.melMessageHash != bytes32(0) ||
            genesis.inboxPosition != 0 || genesis.positionInMessage != 0 ||
            implementations.bridge.code.length == 0 || implementations.inbox.code.length == 0 ||
            implementations.sequencerInbox.code.length == 0 || implementations.outbox.code.length == 0)
            revert InvalidConfiguration();
        bootstrapFactory = msg.sender;
        bootstrapFactoryCodeHash = msg.sender.codehash;
        verifier = config.verifier;
        verifierCodeHash = config.verifierCodeHash;
        programVKey = config.programVKey;
        machineRoot = config.machineRoot;
        executionProfileHash = config.executionProfileHash;
        childChainId = config.childChainId;
        nativeToken = config.nativeToken;
        state = genesis;
        genesisStateHash = GL3ZkTypes.hashState(genesis);
        implementationsHash = keccak256(abi.encode(implementations));
        implementationCodeHashes = _implementationHashes(implementations);
    }

    // Canonical Bridge owner access exists only inside atomic bootstrap.
    function owner() external view returns (address) {
        return bootstrapSealed ? address(0) : bootstrapFactory;
    }

    function finalizedState() external view returns (GL3ZkTypes.GlobalState memory) { return state; }

    function seal(Graph calldata candidate, Implementations calldata implementations) external {
        if (msg.sender != bootstrapFactory || msg.sender.codehash != bootstrapFactoryCodeHash ||
            bootstrapSealed) revert UnauthorizedBootstrap();
        bytes32 graphHash = keccak256(abi.encode(candidate));
        if (IGL3FreshGraphFactory(bootstrapFactory).createdGraphHash(address(this)) != graphHash ||
            keccak256(abi.encode(implementations)) != implementationsHash ||
            _implementationHashes(implementations) != implementationCodeHashes)
            revert InvalidGraph();
        _checkClone(candidate.bridge, implementations.bridge);
        _checkClone(candidate.inbox, implementations.inbox);
        _checkClone(candidate.sequencerInbox, implementations.sequencerInbox);
        _checkClone(candidate.outbox, implementations.outbox);
        IGL3BridgeGraph bridge = IGL3BridgeGraph(candidate.bridge);
        if (bridge.rollup() != address(this) || bridge.nativeToken() != nativeToken ||
            bridge.sequencerInbox() != candidate.sequencerInbox ||
            bridge.allowedDelayedInboxList(0) != candidate.inbox ||
            bridge.allowedOutboxList(0) != candidate.outbox ||
            !bridge.allowedDelayedInboxes(candidate.inbox) || !bridge.allowedOutboxes(candidate.outbox))
            revert InvalidGraph();
        // Upstream exposes array indexing but no length getters. A second item
        // must revert out of bounds, and nonempty return data is not ignored.
        _checkNoSecondEntry(candidate.bridge, IGL3BridgeGraph.allowedDelayedInboxList.selector);
        _checkNoSecondEntry(candidate.bridge, IGL3BridgeGraph.allowedOutboxList.selector);
        IGL3SequencerGraph sequencer = IGL3SequencerGraph(candidate.sequencerInbox);
        if (sequencer.bridge() != candidate.bridge || sequencer.rollup() != address(this) ||
            sequencer.batchPosterManager() != address(0) ||
            IGL3InboxGraph(candidate.inbox).bridge() != candidate.bridge ||
            IGL3InboxGraph(candidate.inbox).sequencerInbox() != candidate.sequencerInbox ||
            IGL3OutboxGraph(candidate.outbox).bridge() != candidate.bridge ||
            IGL3OutboxGraph(candidate.outbox).rollup() != address(this)) revert InvalidGraph();
        graph = candidate;
        domain = keccak256(abi.encode(CHAIN_DOMAIN, block.chainid, childChainId,
            address(this), graphHash, nativeToken, verifier, verifierCodeHash, programVKey,
            machineRoot, executionProfileHash, genesisStateHash, implementationCodeHashes));
        bootstrapSealed = true;
        emit BootstrapSealed(domain, graphHash);
    }

    function finalize(bytes calldata publicValues, bytes calldata proof) external {
        if (!bootstrapSealed) revert Unsealed();
        if (finalizing) revert RecursiveFinalization();
        if (publicValues.length != STATEMENT_BYTES) revert InvalidStatement();
        GL3ZkTypes.Statement memory statement = abi.decode(publicValues, (GL3ZkTypes.Statement));
        if (statement.version != 1 || statement.domain != domain ||
            statement.transitionIndex != finalizedTransition + 1 || statement.machineRoot != machineRoot ||
            statement.executionProfileHash != executionProfileHash ||
            statement.beforeState.melStateHash != bytes32(0) || statement.beforeState.melMessageHash != bytes32(0) ||
            statement.afterState.melStateHash != bytes32(0) || statement.afterState.melMessageHash != bytes32(0) ||
            statement.afterState.blockHash == bytes32(0) ||
            !GL3ZkTypes.progresses(statement.beforeState, statement.afterState)) revert InvalidStatement();
        if (GL3ZkTypes.hashState(statement.beforeState) != GL3ZkTypes.hashState(state)) revert StaleState();
        if (statement.sequencerReadStart != statement.beforeState.inboxPosition ||
            statement.sequencerReadEnd <= statement.sequencerReadStart ||
            statement.afterState.inboxPosition > statement.sequencerReadEnd ||
            (statement.delayedReadStart == statement.delayedReadEnd && statement.delayedReadStart != 0))
            revert InvalidStatement();
        if (statement.sequencerDataCommitment != sequencerRangeCommitment(statement.sequencerReadStart, statement.sequencerReadEnd) ||
            statement.delayedDataCommitment != delayedRangeCommitment(statement.delayedReadStart, statement.delayedReadEnd))
            revert DataCommitmentMismatch();
        if (verifier.codehash != verifierCodeHash) revert InvalidConfiguration();
        finalizing = true;
        IGL3SP1Verifier(verifier).verifyProof(programVKey, publicValues, proof);
        state = statement.afterState;
        finalizedTransition = statement.transitionIndex;
        IGL3OutboxGraph(graph.outbox).updateSendRoot(statement.afterState.sendRoot, statement.afterState.blockHash);
        finalizing = false;
        emit TransitionFinalized(statement.transitionIndex, statement.afterState.blockHash, statement.afterState.sendRoot);
    }

    function _checkClone(address instance, address implementation) private view {
        bytes32 expected = keccak256(abi.encodePacked(hex"363d3d373d3d3d363d73", implementation,
            hex"5af43d82803e903d91602b57fd5bf3"));
        if (instance.code.length != 45 || instance.codehash != expected) revert InvalidGraph();
    }

    function _checkNoSecondEntry(address bridge, bytes4 selector) private view {
        (bool ok, bytes memory result) = bridge.staticcall(abi.encodeWithSelector(selector, uint256(1)));
        // Require Solidity's exact Panic(0x32) for an out-of-bounds array read.
        if (ok || keccak256(result) != keccak256(abi.encodeWithSignature("Panic(uint256)", uint256(0x32))))
            revert InvalidGraph();
    }

    function _implementationHashes(Implementations memory implementations) private view returns (bytes32) {
        return keccak256(abi.encode(implementations.bridge.codehash, implementations.inbox.codehash,
            implementations.sequencerInbox.codehash, implementations.outbox.codehash));
    }

    function _registryBridge() internal view override returns (IGL3AccumulatorBridge) {
        return IGL3AccumulatorBridge(graph.bridge);
    }
    function _registryDomain() internal view override returns (bytes32) { return domain; }
    function _registrySealed() internal view override returns (bool) { return bootstrapSealed; }
}
