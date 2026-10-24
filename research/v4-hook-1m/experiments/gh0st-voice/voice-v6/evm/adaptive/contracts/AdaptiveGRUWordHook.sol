// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IAdaptiveGRUWordModel {
    function VOCABULARY() external view returns (uint16);
    function modelHash() external view returns (bytes32);
    function stepSampled(uint16 previous, int16[224] memory state, int32[6] memory features,
        bytes32 seed, uint256 wordIndex, uint16 temperatureQ10)
        external view returns (uint16 token, int16[224] memory next, int256[192] memory scores,
            string memory text, bool terminal);
}

/// @notice Local-only one-word-per-swap recurrent research adapter.
/// Every successful swap must produce a new word. Inference failure reverts the swap.
contract AdaptiveGRUWordHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct Context {
        int24 lastTick;
        uint16 lastMove;
        uint16 ewmaMove;
        uint64 lastTimestamp;
        uint64 sequence;
        uint16 previousToken;
        bool initialized;
        bytes32 stateHash;
    }
    struct Generation {
        uint16 token;
        int16[224] hidden;
        int256[192] scores;
        string text;
        bool terminal;
    }
    IPoolManager public immutable poolManager;
    IAdaptiveGRUWordModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    bytes32 public immutable sampleSeed;
    uint16 public immutable temperatureQ10;
    uint32 public immutable inferenceGasLimit;
    uint256 public constant CALLBACK_GAS_RESERVE = 750_000;
    uint256 public constant MAX_RETURN_BYTES = 16_384;
    uint256 public constant DECODER_GAS_LIMIT = 600_000;
    mapping(bytes32 => Context) public contexts;
    mapping(bytes32 => bytes32[14]) private _hidden;

    error InvalidConfiguration();
    error UnauthorizedCallback();
    error StaleContext();
    error WordRequired(uint8 reason);
    event WordSpoken(bytes32 indexed poolId, uint64 indexed sequence, bytes32 indexed modelHash,
        uint16 token, string text, bool terminal, uint256 sampleIndex, int32[6] features,
        int256[192] branchScores, bytes32 previousStateHash, bytes32 stateHash);

    constructor(IPoolManager manager_, IAdaptiveGRUWordModel model_, uint32 budget_, bytes32 seed_, uint16 temperature_) {
        if (block.chainid != 31337 || address(manager_).code.length == 0 || address(model_).code.length == 0
            || budget_ < 100_000 || budget_ > 29_000_000 || temperature_ < 64 || temperature_ > 4096
            || model_.VOCABULARY() != 8192) revert InvalidConfiguration();
        poolManager = manager_; model = model_; inferenceGasLimit = budget_;
        sampleSeed = seed_; temperatureQ10 = temperature_;
        modelHash = model_.modelHash(); modelCodeHash = address(model_).codehash;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }
    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true; permissions.afterSwap = true;
    }
    function _authorize(PoolKey calldata key) private view returns (bytes32 id) {
        if (msg.sender != address(poolManager) || address(key.hooks) != address(this)) revert UnauthorizedCallback();
        return PoolId.unwrap(key.toId());
    }
    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external returns (bytes4) {
        bytes32 id = _authorize(key);
        if (contexts[id].initialized) revert InvalidConfiguration();
        contexts[id] = Context(tick, 0, 0, uint64(block.timestamp), 0, 8192, true, bytes32(0));
        return IHooks.afterInitialize.selector;
    }
    function hiddenState(bytes32 id) public view returns (int16[224] memory state) {
        for (uint256 slot; slot < 14; ++slot) {
            uint256 packed = uint256(_hidden[id][slot]);
            for (uint256 j; j < 16 && slot * 16 + j < 224; ++j)
                state[slot * 16 + j] = int16(uint16(packed >> (j * 16)));
        }
    }
    function _saveState(bytes32 id, int16[224] memory state) private {
        for (uint256 slot; slot < 14; ++slot) {
            uint256 packed;
            for (uint256 j; j < 16 && slot * 16 + j < 224; ++j)
                packed |= uint256(uint16(state[slot * 16 + j])) << (j * 16);
            _hidden[id][slot] = bytes32(packed);
        }
    }
    function decodeStep(bytes calldata encoded) external view returns (Generation memory output) {
        if (msg.sender != address(this)) revert UnauthorizedCallback();
        (output.token, output.hidden, output.scores, output.text, output.terminal) =
            abi.decode(encoded, (uint16, int16[224], int256[192], string, bool));
        if (output.token >= 8192 || bytes(output.text).length == 0 || bytes(output.text).length > 32) revert InvalidConfiguration();
        for (uint256 i; i < 224; ++i) if (output.hidden[i] < -1024 || output.hidden[i] > 1024) revert InvalidConfiguration();
    }
    function _infer(uint16 previous, int16[224] memory state, int32[6] memory features, uint256 sampleIndex)
        private view returns (Generation memory output)
    {
        if (address(model).codehash != modelCodeHash) revert WordRequired(2);
        bytes memory input = abi.encodeCall(IAdaptiveGRUWordModel.stepSampled,
            (previous, state, features, sampleSeed, sampleIndex, temperatureQ10));
        address target = address(model); uint256 budget = inferenceGasLimit; bool ok; uint256 size;
        assembly ("memory-safe") {
            ok := staticcall(budget, target, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        if (!ok || size > MAX_RETURN_BYTES) revert WordRequired(2);
        bytes memory encoded = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(encoded, 32), 0, size) }
        try this.decodeStep{gas: DECODER_GAS_LIMIT}(encoded) returns (Generation memory result) { return result; }
        catch { revert WordRequired(2); }
    }
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata hookData)
        external returns (bytes4, int128)
    {
        bytes32 id = _authorize(key); Context memory c = contexts[id];
        if (!c.initialized) revert UnauthorizedCallback();
        if (hookData.length != 64) revert StaleContext();
        (uint64 expectedSequence, bytes32 expectedHash) = abi.decode(hookData, (uint64, bytes32));
        if (expectedSequence != c.sequence || expectedHash != c.stateHash) revert StaleContext();
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
        Generation memory generated = _infer(c.previousToken, hiddenState(id), features, c.sequence);
        bytes32 previousHash = c.stateHash; uint256 sampleIndex = c.sequence;
        c.sequence += 1; c.previousToken = generated.token;
        c.stateHash = keccak256(abi.encode(modelHash, id, c.sequence, generated.token, generated.hidden));
        c.lastTick = tick; c.lastTimestamp = uint64(block.timestamp);
        c.ewmaMove = uint16((uint256(c.ewmaMove) * 7 + move) / 8); c.lastMove = uint16(move);
        _saveState(id, generated.hidden); contexts[id] = c;
        emit WordSpoken(id, c.sequence, modelHash, generated.token, generated.text, generated.terminal,
            sampleIndex, features, generated.scores, previousHash, c.stateHash);
        return (IHooks.afterSwap.selector, 0);
    }
}
