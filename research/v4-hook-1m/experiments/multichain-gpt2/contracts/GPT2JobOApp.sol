// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {IGPT2Shard} from "./interfaces/IGPT2Shard.sol";

/// @notice One authenticated inference job: request on RH, all model math on a compute chain,
/// then one result message back. No token-by-token interchain round trips.
/// @dev Single-use session. Token IDs use four-byte big-endian wire encoding. Tokenization
/// stays local; embedding, all blocks, KV state and the complete vocabulary head stay on-chain.
contract GPT2JobOApp is OApp, Ownable2Step, ReentrancyGuard {
    using OptionsBuilder for bytes;

    bytes32 public constant MODEL_ID = 0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107;
    uint8 public constant VERSION = 2;
    uint8 public constant REQUEST = 1;
    uint8 public constant RESULT = 2;
    uint32 public constant CONTEXT = 1024;
    uint32 public constant VOCAB = 50257;
    uint128 public constant RECEIVE_GAS = 500000;

    struct Packet {
        uint8 version;
        uint8 kind;
        bytes32 routeId;
        bytes32 modelId;
        bytes32 sessionId;
        bytes32 jobId;
        bytes32 promptHash;
        uint32 maxNewTokens;
        bytes32 trace;
        bytes tokens;
    }

    bool public immutable isHome;
    uint32 public immutable homeEid;
    uint32 public immutable computeEid;
    address public immutable requester;
    bytes32 public immutable routeId;
    bytes32 public immutable sessionId;
    uint64 public immutable deadline;
    IGPT2Shard public engine;
    bool public routeSealed;
    bool public requested;
    bool public awaitingActivation;
    bool public running;
    bool public completed;
    bool public resultDispatched;
    bool public resultFinalized;
    bytes32 public jobId;
    bytes32 public promptHash;
    bytes32 public trace;
    bytes32 public outputHash;
    uint32 public promptLength;
    uint32 public maxNewTokens;
    uint32 public processedPositions;
    uint32 public resultCount;
    bytes private _prompt;
    uint32[] private _generated;
    mapping(bytes32 => bool) public acceptedGuid;

    error InvalidConfiguration();
    error InvalidState();
    error InvalidPacket();
    error InvalidTokens();
    error Unauthorized();
    error SessionExpired();
    event JobRequested(bytes32 indexed jobId, bytes32 promptHash, uint32 promptLength, uint32 maxNewTokens);
    event JobReceived(bytes32 indexed guid, bytes32 indexed jobId, bytes packet);
    event JobStarted(bytes32 indexed jobId);
    event PositionConsumed(uint32 indexed position, uint32 inputToken, uint32 outputToken, bool generated, bytes32 trace);
    event JobCompleted(bytes32 indexed jobId, uint32 outputCount, bytes32 trace);
    event ResultDispatched(bytes32 indexed guid, bytes32 indexed jobId, bytes packet);
    event ResultFinalized(bytes32 indexed jobId, bytes32 outputHash, uint32 outputCount, bytes32 trace, bytes tokens);

    constructor(address endpoint_, address admin_, address requester_, bool home_, uint32 homeEid_,
        uint32 computeEid_, bytes32 routeId_, bytes32 sessionId_, uint64 deadline_)
        OApp(endpoint_, admin_) Ownable(admin_)
    {
        if (endpoint_.code.length == 0 || requester_ == address(0) || homeEid_ == 0 || computeEid_ == 0
            || homeEid_ == computeEid_ || routeId_ == bytes32(0) || sessionId_ == bytes32(0)
            || deadline_ <= block.timestamp || endpoint.eid() != (home_ ? homeEid_ : computeEid_)) {
            revert InvalidConfiguration();
        }
        isHome = home_;
        requester = requester_;
        homeEid = homeEid_;
        computeEid = computeEid_;
        routeId = routeId_;
        sessionId = sessionId_;
        deadline = deadline_;
    }

    modifier live() { if (block.timestamp > deadline) revert SessionExpired(); _; }
    modifier sealedRoute() { if (!routeSealed) revert InvalidState(); _; }
    function remoteEid() public view returns (uint32) { return isHome ? computeEid : homeEid; }

    function setPeer(uint32 eid_, bytes32 peer_) public override onlyOwner live {
        if (routeSealed || eid_ != remoteEid() || peer_ == bytes32(0) || uint256(peer_) >> 160 != 0) {
            revert InvalidConfiguration();
        }
        _setPeer(eid_, peer_);
    }

    function bindEngine(address candidate) external onlyOwner live {
        if (isHome || routeSealed || address(engine) != address(0) || candidate.code.length == 0) {
            revert InvalidConfiguration();
        }
        IGPT2Shard shard = IGPT2Shard(candidate);
        if (shard.controller() != address(this) || shard.modelId() != MODEL_ID || shard.firstLayer() != 0
            || shard.endLayer() != 12 || !shard.doesEmbedding() || !shard.doesOutput()
            || shard.phase() != 0 || shard.position() != 0) revert InvalidConfiguration();
        engine = shard;
    }

    function sealRoute() external onlyOwner live {
        if (routeSealed || peers[remoteEid()] == bytes32(0) || (!isHome && address(engine) == address(0))) {
            revert InvalidState();
        }
        routeSealed = true;
    }

    function fixedOptions() public pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(RECEIVE_GAS, 0);
    }

    function _countAndValidate(bytes memory tokens) private pure returns (uint32 count) {
        if (tokens.length == 0 || tokens.length > uint256(CONTEXT) * 4 || tokens.length % 4 != 0) revert InvalidTokens();
        count = uint32(tokens.length / 4);
        for (uint256 i; i < count; ++i) {
            uint32 token;
            assembly ("memory-safe") { token := shr(224, mload(add(add(tokens, 32), mul(i, 4)))) }
            if (token >= VOCAB) revert InvalidTokens();
        }
    }

    function _requestPacket(bytes memory tokens, uint32 newTokens) private view returns (Packet memory packetData) {
        if (!isHome || requested) revert InvalidState();
        uint32 count = _countAndValidate(tokens);
        // N prompt positions produce the first output; each further output needs one position.
        if (newTokens == 0 || uint256(count) + newTokens - 1 > CONTEXT) revert InvalidTokens();
        bytes32 hash = keccak256(tokens);
        bytes32 id = keccak256(abi.encode(routeId, MODEL_ID, sessionId, hash, newTokens));
        packetData = Packet(VERSION, REQUEST, routeId, MODEL_ID, sessionId, id, hash, newTokens,
            keccak256(abi.encode("GH0ST_JOB_V2", id)), tokens);
    }

    function quoteRequest(bytes calldata tokens, uint32 newTokens) external view sealedRoute live returns (MessagingFee memory) {
        return _quote(remoteEid(), abi.encode(_requestPacket(tokens, newTokens)), fixedOptions(), false);
    }

    function requestJob(bytes calldata tokens, uint32 newTokens) external payable sealedRoute live nonReentrant
        returns (MessagingReceipt memory receipt)
    {
        if (msg.sender != requester) revert Unauthorized();
        Packet memory packetData = _requestPacket(tokens, newTokens);
        requested = true;
        jobId = packetData.jobId;
        promptHash = packetData.promptHash;
        promptLength = uint32(tokens.length / 4);
        maxNewTokens = newTokens;
        trace = packetData.trace;
        receipt = _lzSend(remoteEid(), abi.encode(packetData), fixedOptions(), MessagingFee(msg.value, 0), payable(msg.sender));
        emit JobRequested(jobId, promptHash, promptLength, newTokens);
    }

    /// @notice A separate paid transaction imports the authenticated prompt and starts embedding.
    function activateJob(bytes calldata tokens) external sealedRoute live nonReentrant {
        if (isHome || !awaitingActivation || running || completed || keccak256(tokens) != promptHash) revert InvalidState();
        if (_countAndValidate(tokens) != promptLength) revert InvalidTokens();
        awaitingActivation = false;
        running = true;
        _prompt = tokens;
        engine.begin(0, _promptToken(0), trace, "");
        emit JobStarted(jobId);
    }

    function _promptToken(uint32 index) private view returns (uint32) {
        uint256 at = uint256(index) * 4;
        if (index >= promptLength) revert InvalidState();
        return (uint32(uint8(_prompt[at])) << 24) | (uint32(uint8(_prompt[at + 1])) << 16)
            | (uint32(uint8(_prompt[at + 2])) << 8) | uint32(uint8(_prompt[at + 3]));
    }

    /// @notice Consume a COMPLETE engine position and start the next one locally, without a bridge hop.
    function continueJob() external sealedRoute live nonReentrant {
        if (isHome || !running || completed || engine.phase() != 12 || engine.position() != processedPositions) {
            revert InvalidState();
        }
        uint32 token = engine.bestToken();
        if (token >= VOCAB) revert InvalidTokens();
        uint32 input = engine.pendingToken();
        trace = keccak256(abi.encode(trace, processedPositions, input, token, engine.stateCommitment()));
        bool visible = processedPositions + 1 >= promptLength;
        emit PositionConsumed(processedPositions, input, token, visible, trace);
        ++processedPositions;
        if (visible) _generated.push(token);
        if (_generated.length == maxNewTokens) {
            completed = true;
            running = false;
            resultCount = maxNewTokens;
            emit JobCompleted(jobId, resultCount, trace);
        } else {
            uint32 nextInput = processedPositions < promptLength ? _promptToken(processedPositions) : token;
            engine.begin(processedPositions, nextInput, trace, "");
        }
    }

    function generatedTokens() external view returns (uint32[] memory) { return _generated; }

    function resultPacket() public view sealedRoute live returns (bytes memory) {
        if (isHome || !completed || resultDispatched || _generated.length != maxNewTokens) revert InvalidState();
        bytes memory tokens = new bytes(_generated.length * 4);
        for (uint256 i; i < _generated.length; ++i) {
            uint32 token = _generated[i];
            assembly ("memory-safe") {
                let at := add(add(tokens, 32), mul(i, 4))
                mstore8(at, shr(24, token))
                mstore8(add(at, 1), shr(16, token))
                mstore8(add(at, 2), shr(8, token))
                mstore8(add(at, 3), token)
            }
        }
        return abi.encode(Packet(VERSION, RESULT, routeId, MODEL_ID, sessionId, jobId, promptHash, maxNewTokens, trace, tokens));
    }

    function quoteResult() external view returns (MessagingFee memory) {
        return _quote(remoteEid(), resultPacket(), fixedOptions(), false);
    }

    function dispatchResult() external payable sealedRoute live nonReentrant returns (MessagingReceipt memory receipt) {
        bytes memory packet = resultPacket();
        resultDispatched = true;
        receipt = _lzSend(remoteEid(), packet, fixedOptions(), MessagingFee(msg.value, 0), payable(msg.sender));
        emit ResultDispatched(receipt.guid, jobId, packet);
    }

    function verifyResult(bytes calldata tokens) external view returns (bool) {
        return isHome && resultFinalized && keccak256(tokens) == outputHash;
    }

    function _lzReceive(Origin calldata origin, bytes32 guid, bytes calldata message, address, bytes calldata)
        internal override sealedRoute live nonReentrant
    {
        if (origin.srcEid != remoteEid() || acceptedGuid[guid] || message.length < 384 || message.length > 448 + 4 * uint256(CONTEXT)) {
            revert InvalidPacket();
        }
        Packet memory packet = abi.decode(message, (Packet));
        if (keccak256(message) != keccak256(abi.encode(packet)) || packet.version != VERSION
            || packet.routeId != routeId || packet.modelId != MODEL_ID || packet.sessionId != sessionId
            || packet.trace == bytes32(0)) revert InvalidPacket();
        uint32 count = _countAndValidate(packet.tokens);
        if (isHome) {
            if (!requested || resultFinalized || packet.kind != RESULT || packet.jobId != jobId
                || packet.promptHash != promptHash || packet.maxNewTokens != maxNewTokens || count != maxNewTokens) {
                revert InvalidPacket();
            }
            resultFinalized = true;
            outputHash = keccak256(packet.tokens);
            resultCount = count;
            trace = packet.trace;
            emit ResultFinalized(jobId, outputHash, count, trace, packet.tokens);
        } else {
            bytes32 expectedId = keccak256(abi.encode(routeId, MODEL_ID, sessionId, packet.promptHash, packet.maxNewTokens));
            if (requested || running || completed || awaitingActivation || packet.kind != REQUEST
                || packet.promptHash != keccak256(packet.tokens) || packet.jobId != expectedId
                || packet.trace != keccak256(abi.encode("GH0ST_JOB_V2", expectedId))
                || packet.maxNewTokens == 0 || uint256(count) + packet.maxNewTokens - 1 > CONTEXT) revert InvalidPacket();
            requested = true;
            awaitingActivation = true;
            jobId = packet.jobId;
            promptHash = packet.promptHash;
            promptLength = count;
            maxNewTokens = packet.maxNewTokens;
            trace = packet.trace;
            emit JobReceived(guid, jobId, message);
        }
        acceptedGuid[guid] = true;
    }

    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) { Ownable2Step.transferOwnership(newOwner); }
    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) { Ownable2Step._transferOwnership(newOwner); }
    function acceptOwnership() public override { super.acceptOwnership(); endpoint.setDelegate(msg.sender); }
    function renounceOwnership() public override onlyOwner { revert Unauthorized(); }
}
