// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface INovaModel {
    function VOCABULARY() external view returns (uint16);
    function modelHash() external view returns (bytes32);
    function word(uint16 token) external view returns (bytes32 value, uint8 length);
    function stepSampled(uint16 previous, uint8 previousPunct, int16[768] memory state,
        int32[6] memory features, bytes32 seed, uint256 wordIndex, uint16 temperatureQ10)
        external view returns (uint16 token, uint8 punct, int16[768] memory next,
            int256[197] memory scores, string memory text, bool terminal);
}

/// @notice Local candidate: immutable N0VA/ETH pool, one to three neural words per successful swap, continuing canonical state.
/// @dev Deliberately fail-closed: inference failure also reverts a sell. No admin or bypass exists.
///      The 32M target is a whole-transaction test condition, not a guarantee for arbitrary routers.
contract NovaPoolHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct Config {
        address nova;
        address initializer;
        uint24 fee;
        int24 tickSpacing;
        uint160 initialSqrtPriceX96;
        uint32 inferenceGasLimit;
        bytes32 expectedModelHash;
        bytes32 expectedModelCodeHash;
        bytes32 sampleSeed;
        uint16 temperatureQ10;
    }
    struct Context {
        int24 lastTick;
        uint16 lastMove;
        uint16 ewmaMove;
        uint64 lastTimestamp;
        uint64 sequence;
        uint16 previousToken;
        uint8 previousPunct;
        bool initialized;
        bytes32 stateHash;
    }
    struct Generation {
        uint16 token;
        uint8 punct;
        int16[768] hidden;
        int256[197] scores;
        string text;
        bool terminal;
    }

    IPoolManager public immutable poolManager;
    INovaModel public immutable model;
    address public immutable nova;
    address public immutable initializer;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint160 public immutable initialSqrtPriceX96;
    bytes32 public immutable poolId;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    bytes32 public immutable sampleSeed;
    uint16 public immutable temperatureQ10;
    uint32 public immutable inferenceGasLimit;

    uint256 public constant MAX_INFERENCE_GAS = 26_000_000;
    uint256 public constant CALLBACK_GAS_RESERVE = 2_000_000;
    uint256 public constant MAX_RETURN_BYTES = 31_104;
    uint256 public constant DECODER_GAS_LIMIT = 1_500_000;
    uint256 public constant WORD_LOOKUP_GAS_LIMIT = 150_000;
    uint16 public constant BOS_TOKEN = 8192;
    // Exported heads contain int16 weights and biases, so their Q10 sums fit int32.
    int256 public constant MIN_SCORE = type(int32).min;
    int256 public constant MAX_SCORE = type(int32).max;

    mapping(bytes32 => Context) public contexts;
    mapping(bytes32 => bytes32[37]) private _hidden;
    mapping(bytes32 => uint64) public sentenceCount;
    uint256 public constant MAX_WORDS_PER_SWAP = 3;

    error InvalidConfiguration();
    error UnauthorizedCallback();
    error WrongPool();
    error InvalidInitialization();
    error WordRequired(uint8 reason);
    // WordRequired reasons: 1 gas reserve; 2 model identity; 3 call/return length;
    // 4 invalid model output; 5 sequence exhausted; 6 empty fragment. No failure changes neural state.
    event WordSpoken(bytes32 indexed poolId, uint64 indexed sequence, bytes32 indexed modelHash,
        uint16 token, uint8 punct, string text, bool terminal, uint256 sampleIndex,
        int32[6] features, int256[197] branchScores, bytes32 previousStateHash, bytes32 stateHash);

    event TextAdvanced(bytes32 indexed poolId, uint64 indexed firstWord, uint64 indexed lastWord, string text, bool terminal, bytes32 previousStateHash, bytes32 stateHash);

    constructor(IPoolManager manager_, INovaModel model_, Config memory config) {
        if (block.chainid != 31337 || address(manager_).code.length == 0
            || address(model_).code.length == 0 || config.nova.code.length == 0
            || config.initializer == address(0) || config.fee >= 1_000_000
            || config.tickSpacing <= 0 || config.tickSpacing > 32767
            || config.initialSqrtPriceX96 < TickMath.MIN_SQRT_PRICE
            || config.initialSqrtPriceX96 >= TickMath.MAX_SQRT_PRICE
            || config.inferenceGasLimit < 100_000 || config.inferenceGasLimit > MAX_INFERENCE_GAS
            || config.temperatureQ10 < 64 || config.temperatureQ10 > 4096
            || config.expectedModelHash == bytes32(0) || config.expectedModelCodeHash == bytes32(0)
            || model_.VOCABULARY() != BOS_TOKEN || model_.modelHash() != config.expectedModelHash
            || address(model_).codehash != config.expectedModelCodeHash) revert InvalidConfiguration();
        poolManager = manager_;
        model = model_;
        nova = config.nova;
        initializer = config.initializer;
        fee = config.fee;
        tickSpacing = config.tickSpacing;
        initialSqrtPriceX96 = config.initialSqrtPriceX96;
        modelHash = config.expectedModelHash;
        modelCodeHash = config.expectedModelCodeHash;
        sampleSeed = config.sampleSeed;
        temperatureQ10 = config.temperatureQ10;
        inferenceGasLimit = config.inferenceGasLimit;
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(config.nova),
            config.fee, config.tickSpacing, IHooks(address(this)));
        poolId = PoolId.unwrap(key.toId());
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.afterInitialize = true;
        permissions.afterSwap = true;
    }

    function _authorize(PoolKey calldata key) private view returns (bytes32 id) {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();
        id = PoolId.unwrap(key.toId());
        if (id != poolId) revert WrongPool();
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external view returns (bytes4)
    {
        bytes32 id = _authorize(key);
        if (sender != initializer || sqrtPriceX96 != initialSqrtPriceX96 || contexts[id].initialized)
            revert InvalidInitialization();
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external returns (bytes4)
    {
        bytes32 id = _authorize(key);
        if (sender != initializer || sqrtPriceX96 != initialSqrtPriceX96 || contexts[id].initialized
            || tick != TickMath.getTickAtSqrtPrice(sqrtPriceX96)) revert InvalidInitialization();
        contexts[id] = Context(tick, 0, 0, uint64(block.timestamp), 0, BOS_TOKEN, 0, true, bytes32(0));
        return IHooks.afterInitialize.selector;
    }

    function hiddenState(bytes32 id) public view returns (int16[768] memory state) {
        // Each saved value has passed the unchanged neural range decoder [-1024,1024].
        // Fixed-size allocated output; partial final word writes exactly its remaining cells.
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for { let slot := 0 } lt(slot, 36) { slot := add(slot, 1) } {
                let packed := sload(add(base, slot))
                let output := add(state, mul(672, slot))
                mstore(add(output, 0), sar(244, shl(244, shr(0, packed))))
                mstore(add(output, 32), sar(244, shl(244, shr(12, packed))))
                mstore(add(output, 64), sar(244, shl(244, shr(24, packed))))
                mstore(add(output, 96), sar(244, shl(244, shr(36, packed))))
                mstore(add(output, 128), sar(244, shl(244, shr(48, packed))))
                mstore(add(output, 160), sar(244, shl(244, shr(60, packed))))
                mstore(add(output, 192), sar(244, shl(244, shr(72, packed))))
                mstore(add(output, 224), sar(244, shl(244, shr(84, packed))))
                mstore(add(output, 256), sar(244, shl(244, shr(96, packed))))
                mstore(add(output, 288), sar(244, shl(244, shr(108, packed))))
                mstore(add(output, 320), sar(244, shl(244, shr(120, packed))))
                mstore(add(output, 352), sar(244, shl(244, shr(132, packed))))
                mstore(add(output, 384), sar(244, shl(244, shr(144, packed))))
                mstore(add(output, 416), sar(244, shl(244, shr(156, packed))))
                mstore(add(output, 448), sar(244, shl(244, shr(168, packed))))
                mstore(add(output, 480), sar(244, shl(244, shr(180, packed))))
                mstore(add(output, 512), sar(244, shl(244, shr(192, packed))))
                mstore(add(output, 544), sar(244, shl(244, shr(204, packed))))
                mstore(add(output, 576), sar(244, shl(244, shr(216, packed))))
                mstore(add(output, 608), sar(244, shl(244, shr(228, packed))))
                mstore(add(output, 640), sar(244, shl(244, shr(240, packed))))
            }
            let packed := sload(add(base, 36))
            let output := add(state, 24192)
                mstore(add(output, 0), sar(244, shl(244, shr(0, packed))))
                mstore(add(output, 32), sar(244, shl(244, shr(12, packed))))
                mstore(add(output, 64), sar(244, shl(244, shr(24, packed))))
                mstore(add(output, 96), sar(244, shl(244, shr(36, packed))))
                mstore(add(output, 128), sar(244, shl(244, shr(48, packed))))
                mstore(add(output, 160), sar(244, shl(244, shr(60, packed))))
                mstore(add(output, 192), sar(244, shl(244, shr(72, packed))))
                mstore(add(output, 224), sar(244, shl(244, shr(84, packed))))
                mstore(add(output, 256), sar(244, shl(244, shr(96, packed))))
                mstore(add(output, 288), sar(244, shl(244, shr(108, packed))))
                mstore(add(output, 320), sar(244, shl(244, shr(120, packed))))
                mstore(add(output, 352), sar(244, shl(244, shr(132, packed))))
        }
    }

    function _saveState(bytes32 id, int16[768] memory state) private {
        // Called only after decodeStep validates all 768 cells. Exact two's-complement 12-bit storage.
        // Scratch is 0..63; free-memory pointer and zero slot remain intact.
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for { let slot := 0 } lt(slot, 36) { slot := add(slot, 1) } {
                let packed := 0
                let input := add(state, mul(672, slot))
                packed := or(packed, shl(0, and(mload(add(input, 0)), 4095)))
                packed := or(packed, shl(12, and(mload(add(input, 32)), 4095)))
                packed := or(packed, shl(24, and(mload(add(input, 64)), 4095)))
                packed := or(packed, shl(36, and(mload(add(input, 96)), 4095)))
                packed := or(packed, shl(48, and(mload(add(input, 128)), 4095)))
                packed := or(packed, shl(60, and(mload(add(input, 160)), 4095)))
                packed := or(packed, shl(72, and(mload(add(input, 192)), 4095)))
                packed := or(packed, shl(84, and(mload(add(input, 224)), 4095)))
                packed := or(packed, shl(96, and(mload(add(input, 256)), 4095)))
                packed := or(packed, shl(108, and(mload(add(input, 288)), 4095)))
                packed := or(packed, shl(120, and(mload(add(input, 320)), 4095)))
                packed := or(packed, shl(132, and(mload(add(input, 352)), 4095)))
                packed := or(packed, shl(144, and(mload(add(input, 384)), 4095)))
                packed := or(packed, shl(156, and(mload(add(input, 416)), 4095)))
                packed := or(packed, shl(168, and(mload(add(input, 448)), 4095)))
                packed := or(packed, shl(180, and(mload(add(input, 480)), 4095)))
                packed := or(packed, shl(192, and(mload(add(input, 512)), 4095)))
                packed := or(packed, shl(204, and(mload(add(input, 544)), 4095)))
                packed := or(packed, shl(216, and(mload(add(input, 576)), 4095)))
                packed := or(packed, shl(228, and(mload(add(input, 608)), 4095)))
                packed := or(packed, shl(240, and(mload(add(input, 640)), 4095)))
                sstore(add(base, slot), packed)
            }
            let packed := 0
            let input := add(state, 24192)
                packed := or(packed, shl(0, and(mload(add(input, 0)), 4095)))
                packed := or(packed, shl(12, and(mload(add(input, 32)), 4095)))
                packed := or(packed, shl(24, and(mload(add(input, 64)), 4095)))
                packed := or(packed, shl(36, and(mload(add(input, 96)), 4095)))
                packed := or(packed, shl(48, and(mload(add(input, 128)), 4095)))
                packed := or(packed, shl(60, and(mload(add(input, 160)), 4095)))
                packed := or(packed, shl(72, and(mload(add(input, 192)), 4095)))
                packed := or(packed, shl(84, and(mload(add(input, 224)), 4095)))
                packed := or(packed, shl(96, and(mload(add(input, 256)), 4095)))
                packed := or(packed, shl(108, and(mload(add(input, 288)), 4095)))
                packed := or(packed, shl(120, and(mload(add(input, 320)), 4095)))
                packed := or(packed, shl(132, and(mload(add(input, 352)), 4095)))
            sstore(add(base, 36), packed)
        }
    }

    function _checkWord(Generation memory output) private view {
        bytes memory input = abi.encodeCall(INovaModel.word, (output.token));
        bytes memory result = new bytes(64);
        address target = address(model);
        bool ok;
        uint256 size;
        uint256 lookupBudget = WORD_LOOKUP_GAS_LIMIT;
        assembly ("memory-safe") {
            ok := staticcall(lookupBudget, target, add(input, 32), mload(input), add(result, 32), 64)
            size := returndatasize()
        }
        if (!ok || size != 64) revert InvalidConfiguration();
        (bytes32 value, uint8 length) = abi.decode(result, (bytes32, uint8));
        bytes memory text = bytes(output.text);
        if (length == 0 || length > 32 || text.length != uint256(length) + (output.punct == 0 ? 0 : 1))
            revert InvalidConfiguration();
        for (uint256 i; i < length; ++i) {
            uint8 character = uint8(value[i]);
            if (text[i] != value[i] || !((character >= 97 && character <= 122) || (character == 39 && i > 0)))
                revert InvalidConfiguration();
        }
        if (output.punct != 0) {
            bytes1 suffix = output.punct == 1 ? bytes1(",") : output.punct == 2 ? bytes1(".")
                : output.punct == 3 ? bytes1("!") : bytes1("?");
            if (text[length] != suffix) revert InvalidConfiguration();
        }
    }

    /// @dev Separate bounded self-call catches invalid ABI, invalid numeric values and vocabulary mismatch.
    function decodeStep(bytes calldata encoded) external view returns (Generation memory output) {
        if (msg.sender != address(this)) revert UnauthorizedCallback();
        (output.token, output.punct, output.hidden, output.scores, output.text, output.terminal) =
            abi.decode(encoded, (uint16, uint8, int16[768], int256[197], string, bool));
        if (output.token >= BOS_TOKEN || bytes(output.text).length == 0 || bytes(output.text).length > 33
            || output.punct > 4 || output.terminal != (output.punct >= 2)) revert InvalidConfiguration();
        for (uint256 i; i < 768; ++i)
            if (output.hidden[i] < -1024 || output.hidden[i] > 1024) revert InvalidConfiguration();
        for (uint256 i; i < 197; ++i)
            if (output.scores[i] < MIN_SCORE || output.scores[i] > MAX_SCORE) revert InvalidConfiguration();
        // Re-encoding also rejects overlapping/aliased dynamic offsets, trailing bytes and noncanonical padding.
        if (keccak256(encoded) != keccak256(abi.encode(output.token, output.punct, output.hidden,
            output.scores, output.text, output.terminal))) revert InvalidConfiguration();
        _checkWord(output);
    }

    /// @dev Both buffers are allocated once by afterSwap. The decoder validates the
    /// canonical raw model return before any typed pointer is borrowed from it.
    function _inferBuffered(Context memory c, int16[768] memory state,
        bytes memory input, bytes memory decoderInput, Generation memory output) private view
    {
        if (address(model).codehash != modelCodeHash) revert WordRequired(2);
        address target = address(model);
        uint256 budget = inferenceGasLimit;
        uint256 token = c.previousToken;
        uint256 punct = c.previousPunct;
        uint256 sequence = c.sequence;
        uint256 modelSize;
        bool ok;
        assembly ("memory-safe") {
            let callData := add(input, 32)
            mstore(add(callData, 4), token)
            mstore(add(callData, 36), punct)
            mcopy(add(callData, 68), state, 24576)
            mstore(add(callData, 24868), sequence)
            // decodeStep(bytes): selector + offset + length precede raw model ABI.
            ok := staticcall(budget, target, callData, 24932, add(decoderInput, 100), 31104)
            modelSize := returndatasize()
        }
        if (!ok || modelSize < 31_072 || modelSize > MAX_RETURN_BYTES) revert WordRequired(3);
        uint256 decoderBudget = DECODER_GAS_LIMIT;
        assembly ("memory-safe") {
            mstore(add(decoderInput, 68), modelSize)
            // The original self-call still executes every validation. Its large
            // return value is discarded; the validated input is already in memory.
            ok := staticcall(decoderBudget, address(), add(decoderInput, 32), add(68, modelSize), 0, 0)
        }
        if (!ok) revert WordRequired(4);
        assembly ("memory-safe") {
            let raw := add(decoderInput, 100)
            mstore(output, mload(raw))
            mstore(add(output, 32), mload(add(raw, 32)))
            mstore(add(output, 64), add(raw, 64))
            mstore(add(output, 96), add(raw, 24640))
            mstore(add(output, 128), add(raw, 31008))
            mstore(add(output, 160), mload(add(raw, 30976)))
        }
    }

    /// @dev Same abi.encode(modelHash,id,sequence,token,punct,state) bytes as before.
    function _nextStateHash(bytes memory buffer, bytes32 id, uint64 sequence,
        uint16 token, uint8 punct, int16[768] memory state) private view returns (bytes32 hash)
    {
        bytes32 identity = modelHash;
        assembly ("memory-safe") {
            let data := add(buffer, 32)
            mstore(data, identity)
            mstore(add(data, 32), id)
            mstore(add(data, 64), sequence)
            mstore(add(data, 96), token)
            mstore(add(data, 128), punct)
            mcopy(add(data, 160), state, 24576)
            hash := keccak256(data, 24736)
        }
    }

    /// @dev Emits the exact standard WordSpoken ABI with a reusable bounded buffer.
    function _emitBufferedWord(bytes memory buffer, bytes32 id, Context memory c,
        Generation memory generated, uint256 sampleIndex, int32[6] memory features,
        bytes32 previousHash) private
    {
        bytes32 signature = keccak256("WordSpoken(bytes32,uint64,bytes32,uint16,uint8,string,bool,uint256,int32[6],int256[197],bytes32,bytes32)");
        bytes32 identity = modelHash;
        uint256 sequence = c.sequence;
        bytes32 stateHash = c.stateHash;
        assembly ("memory-safe") {
            let data := add(buffer, 32)
            mstore(data, mload(generated))
            mstore(add(data, 32), mload(add(generated, 32)))
            mstore(add(data, 64), 6720)
            mstore(add(data, 96), mload(add(generated, 160)))
            mstore(add(data, 128), sampleIndex)
            mcopy(add(data, 160), features, 192)
            mcopy(add(data, 352), mload(add(generated, 96)), 6304)
            mstore(add(data, 6656), previousHash)
            mstore(add(data, 6688), stateHash)
            let text := mload(add(generated, 128))
            let size := mload(text)
            let padded := and(add(size, 31), not(31))
            mstore(add(data, 6720), size)
            // decodeStep's canonical encoding check proved these padding bytes zero.
            mcopy(add(data, 6752), add(text, 32), padded)
            log4(data, add(6752, padded), signature, id, sequence, identity)
        }
    }

    /// @dev Ignores arbitrary hookData. Callers cannot select, spoof or race the canonical neural state.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        external returns (bytes4, int128)
    {
        bytes32 id = _authorize(key);
        Context memory c = contexts[id];
        if (!c.initialized) revert InvalidInitialization();
        if (c.sequence == type(uint64).max) revert WordRequired(5);
        uint256 required = uint256(inferenceGasLimit) + uint256(inferenceGasLimit) / 63 + CALLBACK_GAS_RESERVE;
        if (gasleft() < required) revert WordRequired(1);
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
        int16[768] memory state = hiddenState(id);
        uint64 firstWord = c.sequence + 1;
        bytes32 fragmentPreviousHash = c.stateHash;
        // At most three validated words, 33 bytes each, with two spaces.
        bytes memory fragmentBuffer = new bytes(101);
        bytes memory modelInput = new bytes(24932);
        bytes memory decoderInput = new bytes(31172);
        bytes memory stateHashBuffer = new bytes(24736);
        bytes memory eventBuffer = new bytes(6816);
        Generation memory generated;
        uint256 modelSelector = uint32(INovaModel.stepSampled.selector);
        uint256 decoderSelector = uint32(this.decodeStep.selector);
        bytes32 samplingSeed = sampleSeed;
        uint256 temperature = temperatureQ10;
        assembly ("memory-safe") {
            generated := mload(0x40)
            mstore(0x40, add(generated, 192))
            let input := add(modelInput, 32)
            mstore(input, shl(224, modelSelector))
            mcopy(add(input, 24644), features, 192)
            mstore(add(input, 24836), samplingSeed)
            mstore(add(input, 24900), temperature)
            mstore(add(decoderInput, 32), shl(224, decoderSelector))
            mstore(add(decoderInput, 36), 32)
        }
        uint256 fragmentLength;
        bool complete;
        for (uint256 wordIndex; wordIndex < MAX_WORDS_PER_SWAP; ++wordIndex) {
            if (c.sequence == type(uint64).max) revert WordRequired(5);
            // Stop before attempting a new inference if its full allowance and
            // the unchanged save/settlement reserve no longer fit. An attempted
            // inference failure still reverts every word and the entire trade.
            if (gasleft() < required) {
                if (wordIndex == 0) revert WordRequired(1);
                break;
            }
            _inferBuffered(c, state, modelInput, decoderInput, generated);
            bytes32 previousHash = c.stateHash;
            uint256 sampleIndex = c.sequence;
            ++c.sequence;
            c.previousToken = generated.token;
            c.previousPunct = generated.punct;
            state = generated.hidden;
            c.stateHash = _nextStateHash(stateHashBuffer, id, c.sequence, generated.token, generated.punct, state);
            bytes memory wordText = bytes(generated.text);
            uint256 needed = fragmentLength + wordText.length + (wordIndex == 0 ? 0 : 1);
            if (needed > 101) revert WordRequired(4);
            assembly ("memory-safe") {
                let dest := add(add(fragmentBuffer, 32), fragmentLength)
                if wordIndex { mstore8(dest, 32) dest := add(dest, 1) }
                mcopy(dest, add(wordText, 32), mload(wordText))
            }
            fragmentLength = needed;
            // Commit the sequence and its state hash for every neural word.
            // The fragment event explicitly states whether the sentence ended.
            if (generated.terminal) { complete = true; break; }
        }
        if (fragmentLength == 0) revert WordRequired(6);
        c.lastTick = tick;
        c.lastTimestamp = uint64(block.timestamp);
        c.ewmaMove = uint16((uint256(c.ewmaMove) * 7 + move) / 8);
        c.lastMove = uint16(move);
        _saveState(id, state);
        contexts[id] = c;
        if (complete) {
            if (sentenceCount[id] == type(uint64).max) revert WordRequired(5);
            ++sentenceCount[id];
        }
        assembly ("memory-safe") { mstore(fragmentBuffer, fragmentLength) }
        emit TextAdvanced(id, firstWord, c.sequence, string(fragmentBuffer), complete, fragmentPreviousHash, c.stateHash);
        return (IHooks.afterSwap.selector, 0);
    }
}
