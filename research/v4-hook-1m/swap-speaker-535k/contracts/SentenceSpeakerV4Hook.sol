// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface ISentenceSpeakerV4Model {
    function VOCABULARY() external view returns (uint16);
    function modelHash() external view returns (bytes32);
    function generate(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords)
        external view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens,
            string memory text, bool endedNaturally);
    function generateSampled(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords, bytes32 seed)
        external view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens,
            string memory text, bool endedNaturally);
}

/// @notice Optional multi-pool adapter for the sentence model. Inference failures skip speech, never change swap deltas.
/// @dev Research code. The gas reserve protects the callback's own bookkeeping, not an arbitrarily gas-starved swap.
contract SentenceSpeakerV4Hook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using LPFeeLibrary for uint24;

    uint256 public constant CALLBACK_GAS_RESERVE = 180_000;
    uint256 public constant MAX_MODEL_RETURN_BYTES = 4096;
    uint256 public constant DECODER_GAS_LIMIT = 80_000;
    uint8 public constant SKIP_LOW_GAS = 1;
    uint8 public constant SKIP_MODEL_FAILURE = 2;
    bytes4 public constant REQUIRE_SPEECH = 0x53504b31; // "SPK1", exact four-byte opt-in only

    struct Context {
        int24 lastTick;
        uint16 lastMove;
        uint16 ewmaMove;
        uint64 lastTimestamp;
        uint64 sequence;
        uint16 previousToken;
        bool initialized;
    }

    struct Generation {
        uint16 previous;
        int16[32] state;
        uint16[] tokens;
        string text;
        bool ended;
    }

    IPoolManager public immutable poolManager;
    ISentenceSpeakerV4Model public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint8 public immutable maximumWords;
    uint32 public immutable inferenceGasLimit;
    uint16 public immutable startToken;
    uint24 public immutable initialDynamicLPFee;
    mapping(bytes32 => Context) public contexts;
    mapping(bytes32 => bytes32[2]) private _hidden;

    error InvalidConfiguration();
    error UnauthorizedCallback();
    error SpeechRequired(uint8 reason);

    event SentenceSpoken(bytes32 indexed poolId, uint64 indexed sequence, bytes32 indexed modelHash,
        string text, uint8 words, bool endedNaturally, bytes32 inputHash, bytes32 stateHash);
    event SentenceSkipped(bytes32 indexed poolId, uint64 indexed sequence, uint8 reason, bytes32 inputHash);

    constructor(IPoolManager manager_, ISentenceSpeakerV4Model model_, uint8 maximumWords_, uint32 inferenceGasLimit_,
        uint24 initialDynamicLPFee_) {
        if (address(manager_).code.length == 0 || address(model_).code.length == 0
            || maximumWords_ == 0 || maximumWords_ > 16 || inferenceGasLimit_ < 100_000
            || inferenceGasLimit_ > 15_000_000 || initialDynamicLPFee_ >= 1_000_000) revert InvalidConfiguration();
        poolManager = manager_;
        model = model_;
        modelHash = model_.modelHash();
        modelCodeHash = address(model_).codehash;
        startToken = model_.VOCABULARY();
        if (startToken != 8192) revert InvalidConfiguration();
        maximumWords = maximumWords_;
        inferenceGasLimit = inferenceGasLimit_;
        initialDynamicLPFee = initialDynamicLPFee_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true;
        permissions.afterSwap = true;
    }

    function _authorize(PoolKey calldata key) private view returns (bytes32 id) {
        if (msg.sender != address(poolManager) || address(key.hooks) != address(this)) revert UnauthorizedCallback();
        return PoolId.unwrap(key.toId());
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external returns (bytes4) {
        bytes32 id = _authorize(key);
        if (contexts[id].initialized) revert UnauthorizedCallback();
        contexts[id] = Context(tick, 0, 0, uint64(block.timestamp), 0, startToken, true);
        // A configured fixed initial fee avoids silently initializing a dynamic pool at zero fee.
        // This research adapter does not infer or update a learned fee policy.
        if (key.fee.isDynamicFee()) poolManager.updateDynamicLPFee(key, initialDynamicLPFee);
        return IHooks.afterInitialize.selector;
    }

    function hiddenState(bytes32 id) public view returns (int16[32] memory state) {
        uint256 a = uint256(_hidden[id][0]);
        uint256 b = uint256(_hidden[id][1]);
        for (uint256 i; i < 16; ++i) state[i] = int16(uint16(a >> (i * 16)));
        for (uint256 i; i < 16; ++i) state[i + 16] = int16(uint16(b >> (i * 16)));
    }

    function _saveState(bytes32 id, int16[32] memory state) private {
        uint256 a;
        uint256 b;
        for (uint256 i; i < 16; ++i) a |= uint256(uint16(state[i])) << (i * 16);
        for (uint256 i; i < 16; ++i) b |= uint256(uint16(state[i + 16])) << (i * 16);
        _hidden[id][0] = bytes32(a);
        _hidden[id][1] = bytes32(b);
    }

    function _reset(bytes32 id, Context memory c) private {
        c.previousToken = startToken;
        delete _hidden[id];
    }

    /// @dev Decode in a separate call so malformed ABI is caught without reverting the swap.
    function decodeGeneration(bytes calldata encoded) external view returns (Generation memory output) {
        if (msg.sender != address(this)) revert UnauthorizedCallback();
        (output.previous, output.state, output.tokens, output.text, output.ended) =
            abi.decode(encoded, (uint16, int16[32], uint16[], string, bool));
        if (output.previous >= startToken || output.tokens.length == 0 || output.tokens.length > maximumWords
            || bytes(output.text).length == 0 || bytes(output.text).length > uint256(maximumWords) * 33 + 1)
            revert InvalidConfiguration();
        for (uint256 i; i < 32; ++i) if (output.state[i] < 0 || output.state[i] > 8192) revert InvalidConfiguration();
        for (uint256 i; i < output.tokens.length; ++i) if (output.tokens[i] >= startToken) revert InvalidConfiguration();
        if (output.tokens[output.tokens.length - 1] != output.previous) revert InvalidConfiguration();
    }

    function _infer(uint16 previous, int16[32] memory state, int32[6] memory features, bytes32 seed)
        private view returns (bool ok, Generation memory output)
    {
        if (address(model).codehash != modelCodeHash) return (false, output);
        bytes memory input = abi.encodeCall(ISentenceSpeakerV4Model.generateSampled, (previous, state, features, maximumWords, seed));
        address target = address(model);
        uint256 budget = inferenceGasLimit;
        uint256 size;
        // Zero-sized output prevents automatic copying of arbitrarily large returndata.
        assembly ("memory-safe") {
            ok := staticcall(budget, target, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        if (!ok || size > MAX_MODEL_RETURN_BYTES) return (false, output);
        bytes memory encoded = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(encoded, 32), 0, size) }
        try this.decodeGeneration{gas: DECODER_GAS_LIMIT}(encoded) returns (Generation memory result) { return (true, result); }
        catch { return (false, output); }
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata hookData)
        external returns (bytes4, int128)
    {
        bytes32 id = _authorize(key);
        Context memory c = contexts[id];
        if (!c.initialized) revert UnauthorizedCallback();
        bool requireSpeech = hookData.length == 4 && bytes4(hookData) == REQUIRE_SPEECH;
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(id));
        int256 difference = int256(tick) - int256(c.lastTick);
        uint256 move = uint256(difference < 0 ? -difference : difference);
        if (move > 1024) move = 1024;
        uint256 acceleration = move > c.lastMove ? move - c.lastMove : c.lastMove - move;
        uint256 elapsed = block.timestamp > c.lastTimestamp ? block.timestamp - c.lastTimestamp : 0;
        if (elapsed > 300) elapsed = 300;
        int32[6] memory features = [int32(int256(move * 4)), int32(uint32(c.ewmaMove) * 4),
            int32(int256(acceleration * 4)), int32(int256(elapsed * 1024 / 300)),
            params.zeroForOne ? int32(1024) : int32(-1024),
            params.amountSpecified < 0 ? int32(1024) : int32(-1024)];
        int16[32] memory previousState = hiddenState(id);
        c.sequence += 1;
        bytes32 inputHash = keccak256(abi.encode(id, modelHash, c.sequence, c.previousToken, previousState, features));
        c.lastTick = tick;
        c.lastTimestamp = uint64(block.timestamp);
        c.ewmaMove = uint16((uint256(c.ewmaMove) * 7 + move) / 8);
        c.lastMove = uint16(move);

        // EIP-150 may retain 1/64 of a subcall's gas. Require full model budget plus a separate bookkeeping reserve.
        uint256 required = uint256(inferenceGasLimit) + uint256(inferenceGasLimit) / 63 + CALLBACK_GAS_RESERVE;
        if (gasleft() < required) {
            if (requireSpeech) revert SpeechRequired(SKIP_LOW_GAS);
            _reset(id, c);
            emit SentenceSkipped(id, c.sequence, SKIP_LOW_GAS, inputHash);
        } else {
            (bool ok, Generation memory generated) = _infer(c.previousToken, previousState, features, inputHash);
            if (ok) {
                if (generated.ended) {
                    c.previousToken = generated.previous;
                    _saveState(id, generated.state);
                } else {
                    _reset(id, c);
                }
                emit SentenceSpoken(id, c.sequence, modelHash, generated.text, uint8(generated.tokens.length), generated.ended, inputHash,
                    keccak256(abi.encode(c.previousToken, hiddenState(id))));
            } else {
                if (requireSpeech) revert SpeechRequired(SKIP_MODEL_FAILURE);
                _reset(id, c);
                emit SentenceSkipped(id, c.sequence, SKIP_MODEL_FAILURE, inputHash);
            }
        }
        contexts[id] = c;
        return (IHooks.afterSwap.selector, 0);
    }
}
