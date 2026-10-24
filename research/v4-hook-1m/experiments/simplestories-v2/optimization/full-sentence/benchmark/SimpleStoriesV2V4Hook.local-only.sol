// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface ISimpleStoriesV2Model {
    function PARAMETERS() external view returns (uint256);
    function VOCABULARY() external view returns (uint256);
    function HIDDEN() external view returns (uint256);
    function LAYERS() external view returns (uint256);
    function modelHash() external view returns (bytes32);
    function generate(uint16[] calldata prompt, uint8 maximumNewTokens)
        external view returns (uint16[] memory tokens, bool ended, bytes32 lastLogitHash);
}

/// @notice GAS BENCHMARK ONLY: gas-budget type widened to uint64 and ceiling to 14B.
///         Inference mathematics are unchanged. Do not use this override for a live deployment.
/// @notice LOCAL RESEARCH: a full pretrained transformer on a fixed configured prompt.
/// @dev No stateful chat, token templates, or off-chain inference. The fixed prompt
///      makes repeated greedy outputs expected. Token IDs are decoded externally.
contract SimpleStoriesV2V4Hook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;
    uint256 public constant CALLBACK_GAS_RESERVE = 250_000;
    uint256 public constant DECODER_GAS_LIMIT = 100_000;
    uint256 public constant MAX_MODEL_RETURN_BYTES = 1024;
    bytes4 public constant REQUIRE_SPEECH = 0x53504b31;
    uint8 public constant SKIP_LOW_GAS = 1;
    uint8 public constant SKIP_MODEL_FAILURE = 2;

    struct Context { uint64 sequence; bool initialized; }
    struct Generation { uint16[] tokens; bool ended; bytes32 logitHash; }
    IPoolManager public immutable poolManager;
    ISimpleStoriesV2Model public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint8 public immutable maximumNewTokens;
    uint64 public immutable inferenceGasLimit;
    uint16[] private _prompt;
    mapping(bytes32 => Context) public contexts;
    error InvalidConfiguration();
    error UnauthorizedCallback();
    error SpeechRequired(uint8 reason);
    event TokensSpoken(bytes32 indexed poolId, uint64 indexed sequence, bytes32 indexed modelHash,
        uint16[] tokens, bool ended, bytes32 logitHash);
    event TokensSkipped(bytes32 indexed poolId, uint64 indexed sequence, uint8 reason);

    constructor(IPoolManager manager_, ISimpleStoriesV2Model model_, uint16[] memory prompt_, uint8 maximumNewTokens_, uint64 inferenceGasLimit_) {
        if (address(manager_).code.length == 0 || address(model_).code.length == 0 || prompt_.length == 0
            || maximumNewTokens_ == 0 || maximumNewTokens_ > 4 || prompt_.length + maximumNewTokens_ - 1 > 16
            || inferenceGasLimit_ < 100_000 || inferenceGasLimit_ > 14_000_000_000) revert InvalidConfiguration();
        if (model_.PARAMETERS() != 1235968 || model_.VOCABULARY() != 4019 || model_.HIDDEN() != 128 || model_.LAYERS() != 4)
            revert InvalidConfiguration();
        for (uint256 i; i < prompt_.length; ++i) {
            if (prompt_[i] >= 4019) revert InvalidConfiguration();
            _prompt.push(prompt_[i]);
        }
        poolManager = manager_; model = model_; modelHash = model_.modelHash(); modelCodeHash = address(model_).codehash;
        maximumNewTokens = maximumNewTokens_; inferenceGasLimit = inferenceGasLimit_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function prompt() external view returns (uint16[] memory) { return _prompt; }
    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true; permissions.afterSwap = true;
    }
    function _authorize(PoolKey calldata key) private view returns (bytes32 id) {
        if (msg.sender != address(poolManager) || address(key.hooks) != address(this)) revert UnauthorizedCallback();
        return PoolId.unwrap(PoolIdLibrary.toId(key));
    }
    function afterInitialize(address, PoolKey calldata key, uint160, int24) external returns (bytes4) {
        bytes32 id = _authorize(key);
        if (contexts[id].initialized) revert UnauthorizedCallback();
        contexts[id] = Context(0, true);
        if (key.fee.isDynamicFee()) poolManager.updateDynamicLPFee(key, 3000);
        return IHooks.afterInitialize.selector;
    }
    function decodeGeneration(bytes calldata raw) external view returns (Generation memory generation) {
        if (msg.sender != address(this)) revert UnauthorizedCallback();
        (generation.tokens, generation.ended, generation.logitHash) = abi.decode(raw, (uint16[], bool, bytes32));
        uint256 length = generation.tokens.length;
        if (length == 0 || length > maximumNewTokens) revert InvalidConfiguration();
        for (uint256 i; i < length; ++i) if (generation.tokens[i] >= 4019 || (generation.tokens[i] == 1 && i + 1 != length)) revert InvalidConfiguration();
        if (generation.ended != (generation.tokens[length - 1] == 1) || (!generation.ended && length != maximumNewTokens))
            revert InvalidConfiguration();
    }
    function _infer() private view returns (bool ok, Generation memory generation) {
        if (address(model).codehash != modelCodeHash) return (false, generation);
        bytes memory input = abi.encodeCall(ISimpleStoriesV2Model.generate, (_prompt, maximumNewTokens));
        address target = address(model); uint256 budget = inferenceGasLimit; uint256 size;
        assembly ("memory-safe") { ok := staticcall(budget, target, add(input, 32), mload(input), 0, 0) size := returndatasize() }
        if (!ok || size > MAX_MODEL_RETURN_BYTES) return (false, generation);
        bytes memory raw = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(raw, 32), 0, size) }
        try this.decodeGeneration{gas: DECODER_GAS_LIMIT}(raw) returns (Generation memory result) { return (true, result); }
        catch { return (false, generation); }
    }
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata hookData)
        external returns (bytes4, int128)
    {
        bytes32 id = _authorize(key);
        Context memory context = contexts[id];
        if (!context.initialized) revert UnauthorizedCallback();
        bool requiredSpeech = hookData.length == 4 && bytes4(hookData) == REQUIRE_SPEECH;
        context.sequence += 1;
        uint256 required = uint256(inferenceGasLimit) + uint256(inferenceGasLimit) / 63 + CALLBACK_GAS_RESERVE;
        if (gasleft() < required) {
            if (requiredSpeech) revert SpeechRequired(SKIP_LOW_GAS);
            emit TokensSkipped(id, context.sequence, SKIP_LOW_GAS);
        } else {
            (bool ok, Generation memory generation) = _infer();
            if (!ok) {
                if (requiredSpeech) revert SpeechRequired(SKIP_MODEL_FAILURE);
                emit TokensSkipped(id, context.sequence, SKIP_MODEL_FAILURE);
            } else emit TokensSpoken(id, context.sequence, modelHash, generation.tokens, generation.ended, generation.logitHash);
        }
        contexts[id] = context;
        return (IHooks.afterSwap.selector, 0);
    }
}
