// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SentenceSpeakerModel} from "./SentenceSpeakerModel.sol";

/// @notice One bounded sentence generation per afterSwap callback.
/// @dev Research hook. No fee changes or custom token-accounting permissions.
contract SentenceSpeakerHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct Context {
        int24 lastTick;
        uint16 lastMove;
        uint16 ewmaMove;
        uint64 lastTimestamp;
        uint64 sequence;
        uint16 previousToken;
    }
    IPoolManager public immutable poolManager;
    SentenceSpeakerModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable poolId;
    Context public context;
    bytes32 private _hidden0;
    bytes32 private _hidden1;
    uint8 public immutable maximumWords;
    bool public initialized;

    error InvalidConfiguration();
    error UnauthorizedCallback();

    event SentenceSpoken(bytes32 indexed poolId, uint64 indexed sequence, bytes32 indexed modelHash,
        string text, uint8 words, bool endedNaturally, bytes32 inputHash, bytes32 stateHash);

    constructor(IPoolManager manager_, SentenceSpeakerModel model_, Currency currency0, Currency currency1,
        int24 tickSpacing, uint24 fee, uint8 maximumWords_)
    {
        if (address(manager_).code.length == 0 || address(model_).code.length == 0 || currency0 >= currency1
            || tickSpacing <= 0 || tickSpacing > 32767 || fee >= 1_000_000 || maximumWords_ == 0 || maximumWords_ > 12) revert InvalidConfiguration();
        poolManager = manager_;
        model = model_;
        maximumWords = maximumWords_;
        modelHash = model_.modelHash();
        PoolKey memory key = PoolKey(currency0, currency1, fee, tickSpacing, IHooks(address(this)));
        poolId = PoolId.unwrap(key.toId());
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true;
        permissions.afterSwap = true;
    }

    function _authorize(PoolKey calldata key) private view {
        if (msg.sender != address(poolManager) || PoolId.unwrap(key.toId()) != poolId) revert UnauthorizedCallback();
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external returns (bytes4) {
        _authorize(key);
        if (initialized) revert UnauthorizedCallback();
        initialized = true;
        context = Context(tick, 0, 0, uint64(block.timestamp), 0, model.VOCABULARY());
        return IHooks.afterInitialize.selector;
    }

    function hiddenState() public view returns (int16[32] memory state) {
        uint256 a = uint256(_hidden0);
        uint256 b = uint256(_hidden1);
        for (uint256 i; i < 16; ++i) state[i] = int16(uint16(a >> (i * 16)));
        for (uint256 i; i < 16; ++i) state[i + 16] = int16(uint16(b >> (i * 16)));
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        external returns (bytes4, int128)
    {
        _authorize(key);
        if (!initialized) revert UnauthorizedCallback();
        Context memory c = context;
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
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
        int16[32] memory previousState = hiddenState();
        bytes32 inputHash = keccak256(abi.encode(poolId, modelHash, c.sequence + 1, c.previousToken, previousState, features));
        (uint16 previous, int16[32] memory nextState, uint16[] memory tokens, string memory text, bool ended) =
            model.generate(c.previousToken, previousState, features, maximumWords);
        c.sequence += 1;
        c.lastTick = tick;
        c.lastTimestamp = uint64(block.timestamp);
        c.ewmaMove = uint16((uint256(c.ewmaMove) * 7 + move) / 8);
        c.lastMove = uint16(move);
        if (!ended) {
            c.previousToken = model.VOCABULARY();
            _hidden0 = 0;
            _hidden1 = 0;
        } else {
            c.previousToken = previous;
            uint256 a;
            uint256 b;
            for (uint256 i; i < 16; ++i) a |= uint256(uint16(nextState[i])) << (i * 16);
            for (uint256 i; i < 16; ++i) b |= uint256(uint16(nextState[i + 16])) << (i * 16);
            _hidden0 = bytes32(a);
            _hidden1 = bytes32(b);
        }
        emit SentenceSpoken(poolId, c.sequence, modelHash, text, uint8(tokens.length), ended, inputHash,
            keccak256(abi.encode(c.previousToken, hiddenState())));
        context = c;
        return (IHooks.afterSwap.selector, 0);
    }

}
