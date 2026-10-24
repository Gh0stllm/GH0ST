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

interface INovaBatchModel {
    function stepBatchPacked(uint16 previous, uint8 previousPunct, int16[768] memory state, int32[6] memory features, bytes32 seed, uint256 wordIndex, uint16 temperature, uint8 maxWords) external view returns(bytes memory);
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
    uint256 public constant DECODER_GAS_LIMIT = 800_000;
    uint256 public constant WORD_LOOKUP_GAS_LIMIT = 150_000;
    uint16 public constant BOS_TOKEN = 8192;
    // Exported heads contain int16 weights and biases, so their Q10 sums fit int32.
    int256 public constant MIN_SCORE = type(int32).min;
    int256 public constant MAX_SCORE = type(int32).max;

    mapping(bytes32 => Context) public contexts;
    mapping(bytes32 => bytes32[37]) private _hidden;
    mapping(bytes32 => uint64) public sentenceCount;
    uint256 public constant MAX_WORDS_PER_SWAP = 3;

    struct BatchGeneration {
        uint16[3] tokens;
        uint8[3] puncts;
        int16[768][3] states;
        string[3] texts;
        uint8 count;
        bool terminal;
    }
    uint256 public constant MAX_BATCH_RETURN_BYTES = 7_168;
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


    /// @dev Both buffers are allocated once by afterSwap. The decoder validates the
    /// canonical raw model return before any typed pointer is borrowed from it.


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
    /// @dev Validates every intermediate state, score and word before anything commits.
    /// @dev Lossless packed return: canonical outer ABI bytes, NV01 header,
    /// count/terminal, and three fixed 2361-byte slots. Signed int16 states and
    /// int32 scores preserve the previous ABI values exactly. Every unused byte
    /// and every text-padding byte must be zero before typed memory is formed.
    function decodeBatch(bytes calldata encoded) external view {
        if (msg.sender != address(this)) revert UnauthorizedCallback();
        if (encoded.length != MAX_BATCH_RETURN_BYTES) revert InvalidConfiguration();
        bool valid = true;
        assembly ("memory-safe") {
            let data := encoded.offset
            // Single bytes result: 32-byte offset + 32-byte length + 7089 bytes,
            // with exactly 15 zero bytes of trailing ABI padding.
            if iszero(eq(calldataload(data), 32)) { valid := 0 }
            if iszero(eq(calldataload(add(data, 32)), 7089)) { valid := 0 }
            let payload := add(data, 64)
            if iszero(eq(shr(224, calldataload(payload)), 0x4e563031)) { valid := 0 }
            let count := byte(0, calldataload(add(payload, 4)))
            let terminal := byte(0, calldataload(add(payload, 5)))
            if or(or(iszero(count), gt(count, 3)), gt(terminal, 1)) { valid := 0 }
            // Last payload word has 17 data bytes and 15 canonical zero bytes.
            if and(calldataload(add(data, 7136)), 0xffffffffffffffffffffffffffffff) { valid := 0 }
            for { let i := 0 } lt(i, 3) { i := add(i, 1) } {
                let slot := add(add(payload, 6), mul(i, 2361))
                let used := lt(i, count)
                if used {
                    let token := shr(240, calldataload(slot))
                    let punct := byte(0, calldataload(add(slot, 2)))
                    let length := byte(0, calldataload(add(slot, 3)))
                    if or(or(gt(token, 8191), gt(punct, 4)), or(iszero(length), gt(length, 33))) { valid := 0 }
                    if and(lt(add(i, 1), count), gt(punct, 1)) { valid := 0 }
                    if eq(add(i, 1), count) { if iszero(eq(terminal, gt(punct, 1))) { valid := 0 } }
                    // All 33 fixed text bytes are canonical. Bytes after length
                    // must be zero, independently of how the vocabulary is read.
                    for { let j := length } lt(j, 33) { j := add(j, 1) } {
                        if byte(0, calldataload(add(add(slot, 4), j))) { valid := 0 }
                    }
                    for { let j := 0 } lt(j, 1536) { j := add(j, 2) } {
                        let v := signextend(1, shr(240, calldataload(add(add(slot, 37), j))))
                        if gt(add(v, 1024), 2048) { valid := 0 }
                    }
                    // Every 4-byte score represents exactly one canonical int32,
                    // so no further score-range test is needed for used slots.
                }
                if iszero(used) {
                    // Read only this slot: the final 25-byte tail is masked so
                    // bytes from a later slot cannot affect zero validation.
                    for { let j := 0 } lt(j, 2336) { j := add(j, 32) } {
                        if calldataload(add(slot, j)) { valid := 0 }
                    }
                    if shr(56, calldataload(add(slot, 2336))) { valid := 0 }
                }
            }
        }
        if (!valid) revert InvalidConfiguration();
        uint256 count;
        assembly ("memory-safe") { count := byte(0, calldataload(add(encoded.offset, 68))) }
        for (uint256 i; i < count; ++i) {
            uint256 token;
            uint256 punct;
            uint256 length;
            uint256 offset = 70 + i * 2361;
            assembly ("memory-safe") {
                token := shr(240, calldataload(add(encoded.offset, offset)))
                punct := byte(0, calldataload(add(add(encoded.offset, offset), 2)))
                length := byte(0, calldataload(add(add(encoded.offset, offset), 3)))
            }
            _checkBatchWord(token, punct, encoded[offset + 4:offset + 4 + length]);
        }
    }

    function _checkBatchWord(uint256 token, uint256 punct, bytes calldata text) private view {
        bytes memory input = abi.encodeCall(INovaModel.word, (uint16(token)));
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
        if (length == 0 || length > 32 || text.length != uint256(length) + (punct == 0 ? 0 : 1))
            revert InvalidConfiguration();
        for (uint256 i; i < length; ++i) {
            uint8 character = uint8(value[i]);
            if (text[i] != value[i] || !((character >= 97 && character <= 122) || (character == 39 && i > 0)))
                revert InvalidConfiguration();
        }
        if (punct != 0) {
            bytes1 suffix = punct == 1 ? bytes1(",") : punct == 2 ? bytes1(".")
                : punct == 3 ? bytes1("!") : bytes1("?");
            if (text[length] != suffix) revert InvalidConfiguration();
        }
    }

    function _inferBatch(Context memory c, int16[768] memory state, int32[6] memory features)
        private view returns (BatchGeneration memory generated)
    {
        if (address(model).codehash != modelCodeHash) revert WordRequired(2);
        uint256 remaining = uint256(type(uint64).max) - c.sequence;
        uint8 maximum = remaining < 3 ? uint8(remaining) : 3;
        uint256 budget;
        // Choose once before inference. Never retry, truncate or accept a failed batch.
        while (true) {
            budget = maximum == 3 ? uint256(inferenceGasLimit)
                : maximum == 2 ? 18_500_000 : 10_000_000;
            if (budget > inferenceGasLimit) budget = inferenceGasLimit;
            uint256 required = budget + budget / 63 + CALLBACK_GAS_RESERVE;
            if (gasleft() >= required) break;
            if (maximum == 1) revert WordRequired(1);
            --maximum;
        }
        bytes memory input = abi.encodeWithSelector(INovaBatchModel.stepBatchPacked.selector,
            c.previousToken,c.previousPunct,state,features,sampleSeed,c.sequence,temperatureQ10,maximum);
        bytes memory raw = new bytes(MAX_BATCH_RETURN_BYTES);
        uint256 size;
        bool ok;
        address target = address(model);
        assembly ("memory-safe") {
            ok := staticcall(budget,target,add(input,32),mload(input),add(raw,32),7168)
            size := returndatasize()
        }
        if (!ok || size != MAX_BATCH_RETURN_BYTES) revert WordRequired(3);
        assembly ("memory-safe") { mstore(raw,size) }
        try this.decodeBatch{gas: DECODER_GAS_LIMIT}(raw) {} catch { revert WordRequired(4); }
        // Validation is complete before packed input is expanded. Only used
        // states/texts are allocated, with zero-initialized unused pointer slots.
        assembly ("memory-safe") {
            let payload := add(raw, 96)
            generated := mload(0x40)
            let tokens := add(generated, 192)
            let puncts := add(tokens, 96)
            let states := add(puncts, 96)
            let texts := add(states, 96)
            let free := add(texts, 96)
            let count := byte(0, mload(add(payload, 4)))
            mstore(generated, tokens)
            mstore(add(generated, 32), puncts)
            mstore(add(generated, 64), states)
            mstore(add(generated, 96), texts)
            mstore(add(generated, 128), count)
            mstore(add(generated, 160), byte(0, mload(add(payload, 5))))
            for { let i := 0 } lt(i, 3) { i := add(i, 1) } {
                mstore(add(tokens, mul(i, 32)), 0)
                mstore(add(puncts, mul(i, 32)), 0)
                mstore(add(states, mul(i, 32)), 0)
                mstore(add(texts, mul(i, 32)), 0)
            }
            for { let i := 0 } lt(i, count) { i := add(i, 1) } {
                let slot := add(add(payload, 6), mul(i, 2361))
                mstore(add(tokens, mul(i, 32)), shr(240, mload(slot)))
                mstore(add(puncts, mul(i, 32)), byte(0, mload(add(slot, 2))))
                mstore(add(states, mul(i, 32)), free)
                for { let j := 0 } lt(j, 768) { j := add(j, 1) } {
                    mstore(add(free, mul(j, 32)), signextend(1, shr(240, mload(add(add(slot, 37), mul(j, 2))))))
                }
                free := add(free, 24576)
                let length := byte(0, mload(add(slot, 3)))
                mstore(add(texts, mul(i, 32)), free)
                mstore(free, length)
                // Copy the bounded text; explicitly zero ABI padding.
                mstore(add(free, 32), mload(add(slot, 4)))
                if gt(length, 32) { mstore(add(free, 64), mload(add(slot, 36))) }
                let remainder := and(length, 31)
                if remainder {
                    let last := add(add(free, 32), sub(length, remainder))
                    mstore(last, and(mload(last), not(sub(shl(mul(sub(32, remainder), 8), 1), 1))))
                }
                free := add(free, add(32, and(add(length, 31), not(31))))
            }
            mstore(0x40, free)
        }
        if (generated.count > maximum) revert WordRequired(5);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        external returns (bytes4,int128)
    {
        bytes32 id = _authorize(key);
        Context memory c = contexts[id];
        if (!c.initialized) revert InvalidInitialization();
        if (c.sequence == type(uint64).max) revert WordRequired(5);
        uint256 minimumBudget = inferenceGasLimit < 10_000_000 ? inferenceGasLimit : 10_000_000;
        uint256 required = minimumBudget + minimumBudget / 63 + CALLBACK_GAS_RESERVE;
        if (gasleft() < required) revert WordRequired(1);
        (,int24 tick,,) = poolManager.getSlot0(PoolId.wrap(id));
        int256 difference = int256(tick)-int256(c.lastTick);
        uint256 move = uint256(difference<0 ? -difference : difference);
        if (move>1024) move=1024;
        uint256 acceleration = move>c.lastMove ? move-c.lastMove : c.lastMove-move;
        uint256 elapsed = block.timestamp>c.lastTimestamp ? block.timestamp-c.lastTimestamp : 0;
        if (elapsed>300) elapsed=300;
        int32[6] memory features = [int32(int256(move*4)),int32(uint32(c.ewmaMove)*4),
            int32(int256(acceleration*4)),int32(int256(elapsed*1024/300)),
            params.zeroForOne?int32(1024):int32(-1024),params.amountSpecified<0?int32(1024):int32(-1024)];
        BatchGeneration memory g = _inferBatch(c,hiddenState(id),features);
        uint64 first = c.sequence+1;
        bytes32 previousHash = c.stateHash;
        bytes memory text = new bytes(101);
        bytes memory hashBuffer = new bytes(24736);
        uint256 length;
        for (uint256 i; i<g.count; ++i) {
            ++c.sequence;
            c.previousToken=g.tokens[i];c.previousPunct=g.puncts[i];
            c.stateHash=_nextStateHash(hashBuffer,id,c.sequence,g.tokens[i],g.puncts[i],g.states[i]);
            bytes memory word=bytes(g.texts[i]);
            if(length+word.length+(i==0?0:1)>101) revert WordRequired(4);
            assembly ("memory-safe") {
                let dest:=add(add(text,32),length)
                if i {mstore8(dest,32) dest:=add(dest,1)}
                mcopy(dest,add(word,32),mload(word))
            }
            length+=word.length+(i==0?0:1);
        }
        c.lastTick=tick;c.lastTimestamp=uint64(block.timestamp);
        c.ewmaMove=uint16((uint256(c.ewmaMove)*7+move)/8);c.lastMove=uint16(move);
        _saveState(id,g.states[g.count-1]);contexts[id]=c;
        if(g.terminal){if(sentenceCount[id]==type(uint64).max)revert WordRequired(5);++sentenceCount[id];}
        assembly ("memory-safe") {mstore(text,length)}
        emit TextAdvanced(id,first,c.sequence,string(text),g.terminal,previousHash,c.stateHash);
        return (IHooks.afterSwap.selector,0);
    }
}
