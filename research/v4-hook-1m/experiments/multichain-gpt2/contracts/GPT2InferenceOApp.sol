// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {IGPT2Shard} from "./interfaces/IGPT2Shard.sol";

/// @notice A single-session, fixed-route GPT-2 pipeline using LayerZero V2.
/// @dev Receipt authenticates and commits activations; a separate transaction starts computation.
/// No token is created, bridged or minted. A new route/session requires fresh contracts.
contract GPT2InferenceOApp is OApp, Ownable2Step, ReentrancyGuard {
    using OptionsBuilder for bytes;

    uint8 public constant VERSION = 1;
    uint8 public constant ACTIVATION = 1;
    uint8 public constant RESULT = 2;
    uint8 public constant COMPLETE = 12;
    uint8 public constant BOUNDARY = 13;
    uint32 public constant VOCAB = 50257;
    uint32 public constant CONTEXT = 1024;
    uint256 public constant HIDDEN_BYTES = 3072;
    uint128 public constant RECEIVE_GAS = 500000;

    struct Packet {
        uint8 version;
        bytes32 routeId;
        bytes32 modelId;
        bytes32 sessionId;
        uint32 position;
        uint32 inputToken;
        uint8 destinationStage;
        uint8 kind;
        uint32 outputToken;
        bytes32 trace;
        bytes hidden;
    }

    address public immutable requester;
    bytes32 public immutable modelId;
    bytes32 public immutable routeId;
    bytes32 public immutable sessionId;
    uint8 public immutable stage;
    uint8 public immutable routeLength;
    uint64 public immutable deadline;
    uint32[] public eids;
    IGPT2Shard public engine;
    bool public routeSealed;
    bool public active;
    bool public awaitingActivation;
    bool public dispatched;
    uint32 public nextPosition;
    uint32 public pendingInputToken;
    bytes32 public inboundHiddenHash;
    bytes32 public inboundTrace;
    uint32 public latestResult;
    uint32 public latestResultPosition;
    uint32 public finalizedCount;
    bytes32 public latestResultTrace;
    mapping(bytes32 guid => bool accepted) public acceptedGuid;

    error InvalidConfiguration();
    error RouteIsSealed();
    error RouteNotSealed();
    error SessionExpired();
    error InvalidEngine();
    error WrongStage();
    error InvalidState();
    error InvalidPacket();
    error InvalidHidden();
    error InvalidToken();
    error OnlyRequester();
    error Replay();
    error RenounceOwnershipDisabled();

    event EngineBound(address indexed engine);
    event RouteSealed(bytes32 indexed routeId, bytes32 indexed sessionId);
    event TokenBegun(uint32 indexed position, uint32 inputToken, bytes32 trace);
    event PacketReceived(bytes32 indexed guid, uint32 indexed position, uint8 kind, bytes packet);
    event ActivationStarted(uint32 indexed position, bytes32 hiddenHash, bytes32 trace);
    event PacketDispatched(bytes32 indexed guid, uint32 indexed position, uint32 indexed destinationEid, bytes packet);
    event ResultFinalized(uint32 indexed position, uint32 inputToken, uint32 outputToken, bytes32 trace);

    constructor(
        address endpoint_, address admin_, address requester_, bytes32 modelId_,
        bytes32 routeId_, bytes32 sessionId_, uint8 stage_, uint32[] memory eids_, uint64 deadline_
    ) OApp(endpoint_, admin_) Ownable(admin_) {
        if (endpoint_.code.length == 0 || requester_ == address(0) || modelId_ == bytes32(0)
            || routeId_ == bytes32(0) || sessionId_ == bytes32(0) || eids_.length < 2 || eids_.length > 8
            || stage_ >= eids_.length || deadline_ <= block.timestamp) {
            revert InvalidConfiguration();
        }
        for (uint256 i; i < eids_.length; ++i) {
            if (eids_[i] == 0) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (eids_[i] == eids_[j]) revert InvalidConfiguration();
            }
        }
        requester = requester_;
        modelId = modelId_;
        routeId = routeId_;
        sessionId = sessionId_;
        stage = stage_;
        routeLength = uint8(eids_.length);
        eids = eids_;
        deadline = deadline_;
        if (endpoint.eid() != eids_[stage_]) revert InvalidConfiguration();
    }

    modifier live() {
        if (block.timestamp > deadline) revert SessionExpired();
        _;
    }

    modifier sealedRoute() {
        if (!routeSealed) revert RouteNotSealed();
        _;
    }

    function previousEid() public view returns (uint32) { return eids[(uint256(stage) + routeLength - 1) % routeLength]; }
    function nextEid() public view returns (uint32) { return eids[(uint256(stage) + 1) % routeLength]; }

    /// @dev Peers must be canonical EVM addresses of the two adjacent stage routers.
    function setPeer(uint32 eid_, bytes32 peer_) public override onlyOwner live {
        if (routeSealed) revert RouteIsSealed();
        if ((eid_ != previousEid() && eid_ != nextEid()) || peer_ == bytes32(0)
            || uint256(peer_) >> 160 != 0) revert InvalidConfiguration();
        _setPeer(eid_, peer_);
    }

    function bindEngine(address candidate) external onlyOwner live {
        if (routeSealed || address(engine) != address(0) || candidate.code.length == 0) revert InvalidEngine();
        IGPT2Shard shard = IGPT2Shard(candidate);
        if (shard.controller() != address(this) || shard.modelId() != modelId || shard.phase() != 0
            || shard.position() != 0) revert InvalidEngine();
        if (stage == 0) {
            if (shard.firstLayer() != 0 || shard.endLayer() != 0 || !shard.doesEmbedding() || shard.doesOutput()) revert InvalidEngine();
        } else {
            bool finalStage = stage == routeLength - 1;
            if (shard.firstLayer() >= shard.endLayer() || shard.endLayer() > 12 || shard.doesEmbedding()
                || shard.doesOutput() != finalStage || (stage == 1 && shard.firstLayer() != 0)
                || (finalStage && shard.endLayer() != 12)) revert InvalidEngine();
        }
        engine = shard;
        emit EngineBound(candidate);
    }

    function sealRoute() external onlyOwner live {
        if (routeSealed) revert RouteIsSealed();
        if (address(engine) == address(0) || peers[previousEid()] == bytes32(0)
            || peers[nextEid()] == bytes32(0)) revert InvalidConfiguration();
        routeSealed = true;
        emit RouteSealed(routeId, sessionId);
    }

    function beginToken(uint32 inputToken) external sealedRoute live nonReentrant {
        if (stage != 0) revert WrongStage();
        if (msg.sender != requester) revert OnlyRequester();
        if (active || awaitingActivation || nextPosition >= CONTEXT) revert InvalidState();
        if (inputToken >= VOCAB) revert InvalidToken();
        active = true;
        dispatched = false;
        pendingInputToken = inputToken;
        inboundTrace = keccak256(abi.encode("GH0ST_GPT2_START_V1", routeId, modelId, sessionId, nextPosition, inputToken));
        engine.begin(nextPosition, inputToken, inboundTrace, "");
        emit TokenBegun(nextPosition, inputToken, inboundTrace);
    }

    /// @notice Begin the already-authenticated activation using its public event payload.
    function activate(bytes calldata hidden) external sealedRoute live nonReentrant {
        if (stage == 0) revert WrongStage();
        if (!awaitingActivation || active) revert InvalidState();
        if (hidden.length != HIDDEN_BYTES || keccak256(hidden) != inboundHiddenHash) revert InvalidHidden();
        awaitingActivation = false;
        active = true;
        dispatched = false;
        engine.begin(nextPosition, pendingInputToken, inboundTrace, hidden);
        emit ActivationStarted(nextPosition, inboundHiddenHash, inboundTrace);
    }

    function fixedOptions() public pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(RECEIVE_GAS, 0);
    }

    function outboundPacket() public view sealedRoute live returns (bytes memory) {
        if (!active || dispatched || engine.position() != nextPosition || engine.pendingToken() != pendingInputToken)
            revert InvalidState();
        bool finalStage = stage == routeLength - 1;
        uint8 requiredPhase = finalStage ? COMPLETE : BOUNDARY;
        if (engine.phase() != requiredPhase) revert InvalidState();
        bytes memory hidden;
        uint32 outputToken;
        if (finalStage) {
            outputToken = engine.bestToken();
            if (outputToken >= VOCAB) revert InvalidToken();
        } else {
            hidden = engine.exportHidden();
            if (hidden.length != HIDDEN_BYTES) revert InvalidHidden();
        }
        bytes32 trace = keccak256(abi.encode(
            inboundTrace, routeId, modelId, sessionId, stage, nextPosition, pendingInputToken, engine.stateCommitment()
        ));
        return abi.encode(Packet({
            version: VERSION, routeId: routeId, modelId: modelId, sessionId: sessionId,
            position: nextPosition, inputToken: pendingInputToken,
            destinationStage: uint8((uint256(stage) + 1) % routeLength), kind: finalStage ? RESULT : ACTIVATION,
            outputToken: outputToken, trace: trace, hidden: hidden
        }));
    }

    function quoteDispatch() external view returns (MessagingFee memory) {
        return _quote(nextEid(), outboundPacket(), fixedOptions(), false);
    }

    function dispatch() external payable sealedRoute live nonReentrant returns (MessagingReceipt memory receipt) {
        bytes memory packetBytes = outboundPacket();
        uint32 sentPosition = nextPosition;
        dispatched = true;
        if (stage != 0) {
            active = false;
            ++nextPosition;
        }
        receipt = _lzSend(nextEid(), packetBytes, fixedOptions(), MessagingFee(msg.value, 0), payable(msg.sender));
        emit PacketDispatched(receipt.guid, sentPosition, nextEid(), packetBytes);
    }

    function _lzReceive(Origin calldata origin, bytes32 guid, bytes calldata message, address, bytes calldata)
        internal override sealedRoute live nonReentrant
    {
        if (origin.srcEid != previousEid()) revert WrongStage();
        if (acceptedGuid[guid]) revert Replay();
        // Bound decoder input before copying or decoding attacker-controlled dynamic data.
        if (message.length > HIDDEN_BYTES + 512 || message.length < 384) revert InvalidPacket();
        Packet memory packetData = abi.decode(message, (Packet));
        if (packetData.version != VERSION || packetData.routeId != routeId || packetData.modelId != modelId
            || packetData.sessionId != sessionId || packetData.destinationStage != stage
            || packetData.position != nextPosition || packetData.position >= CONTEXT
            || packetData.inputToken >= VOCAB || packetData.trace == bytes32(0)) revert InvalidPacket();
        // Reject alternate encodings: each accepted message has one canonical byte representation.
        if (keccak256(message) != keccak256(abi.encode(packetData))) revert InvalidPacket();
        if (stage == 0) {
            if (packetData.kind != RESULT || packetData.hidden.length != 0 || packetData.outputToken >= VOCAB
                || !active || !dispatched || packetData.inputToken != pendingInputToken) revert InvalidPacket();
            acceptedGuid[guid] = true;
            active = false;
            dispatched = false;
            latestResult = packetData.outputToken;
            latestResultPosition = packetData.position;
            latestResultTrace = packetData.trace;
            ++finalizedCount;
            ++nextPosition;
            emit ResultFinalized(packetData.position, packetData.inputToken, packetData.outputToken, packetData.trace);
        } else {
            if (packetData.kind != ACTIVATION || packetData.hidden.length != HIDDEN_BYTES || packetData.outputToken != 0
                || active || awaitingActivation) revert InvalidPacket();
            acceptedGuid[guid] = true;
            awaitingActivation = true;
            dispatched = false;
            pendingInputToken = packetData.inputToken;
            inboundHiddenHash = keccak256(packetData.hidden);
            inboundTrace = packetData.trace;
        }
        emit PacketReceived(guid, packetData.position, packetData.kind, message);
    }

    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) {
        Ownable2Step.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(newOwner);
    }

    function acceptOwnership() public override {
        super.acceptOwnership();
        endpoint.setDelegate(msg.sender);
    }

    function renounceOwnership() public override onlyOwner { revert RenounceOwnershipDisabled(); }
}
