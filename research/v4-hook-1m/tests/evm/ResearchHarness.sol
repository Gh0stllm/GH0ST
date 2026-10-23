// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IFinalizedPolicySource} from "../../contracts/IFinalizedPolicySource.sol";

/// @dev TEST ONLY: an authorized publisher assertion, with no neural-network
///      execution, output verification, ZK proof, or inference transcript check.
contract MockAttestedPolicySource is IFinalizedPolicySource {
    error OnlyPublisher();
    address public immutable publisher;
    Policy private _policy;
    uint256 public mode;

    constructor(address publisher_) { publisher = publisher_; }

    function publish(Policy calldata policy) external {
        if (msg.sender != publisher) revert OnlyPublisher();
        // Deliberately permits malformed policies to exercise consumer bounds.
        _policy = policy;
    }

    function setMode(uint256 mode_) external {
        if (msg.sender != publisher) revert OnlyPublisher();
        mode = mode_;
    }

    function latestPolicy(bytes32) external view returns (Policy memory) {
        if (mode == 1) revert("test source unavailable");
        if (mode == 2) { assembly { mstore(0, 1) return(0, 32) } }
        if (mode == 3) { assembly { for { } 1 { } { pop(keccak256(0, 32)) } } }
        if (mode == 4) { assembly { return(0, 65536) } }
        return _policy;
    }
}

contract ResearchCreate2Factory {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        assembly { deployed := create2(0, add(creationCode, 32), mload(creationCode), salt) }
        require(deployed != address(0), "test deployment failed");
    }
}

/// @dev TEST ONLY: mimics the state-read ABI and callback ordering. Uses upstream
///      Hooks.sol to validate callback selectors and fee handling. It implements
///      NO AMM math, token settlement, unlock flow, liquidity, or real swap.
contract V4CallbackHarness {
    using Hooks for IHooks;
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    mapping(bytes32 => bytes32) private _words;
    mapping(bytes32 => bool) public initialized;
    uint24 public lastAppliedFee;
    event HarnessCallbackCycle(bytes32 indexed poolId, uint24 fee);

    function extsload(bytes32 slot) external view returns (bytes32) { return _words[slot]; }

    function initialize(PoolKey memory key, int24 tick) external {
        bytes32 id = PoolId.unwrap(key.toId());
        require(!initialized[id], "already initialized");
        require(key.hooks.isValidHookAddress(key.fee), "invalid hook flags");
        initialized[id] = true;
        _setTick(key, tick);
        key.hooks.afterInitialize(key, uint160(1 << 96), tick);
    }

    function setTick(PoolKey memory key, int24 tick) external { _setTick(key, tick); }

    function driveBeforeSwap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) public returns (uint24 fee) {
        (, BeforeSwapDelta delta, uint24 overrideFee) = key.hooks.beforeSwap(key, params, hookData);
        require(BeforeSwapDelta.unwrap(delta) == 0, "unexpected accounting delta");
        fee = key.fee.isDynamicFee() && overrideFee.isOverride()
            ? overrideFee.removeOverrideFlagAndValidate()
            : key.fee.getInitialLPFee();
        lastAppliedFee = fee;
    }

    function driveAfterSwap(PoolKey memory key, SwapParams memory params, int24 tick, bytes calldata hookData) public {
        _setTick(key, tick);
        (BalanceDelta callerDelta, BalanceDelta hookDelta) = key.hooks.afterSwap(
            key, params, BalanceDeltaLibrary.ZERO_DELTA, hookData, BeforeSwapDelta.wrap(0)
        );
        require(BalanceDelta.unwrap(callerDelta) == 0 && BalanceDelta.unwrap(hookDelta) == 0, "unexpected delta");
    }

    function driveCallbackCycle(PoolKey memory key, SwapParams memory params, int24 tick, bytes calldata hookData) external returns (uint24 fee) {
        fee = driveBeforeSwap(key, params, hookData);
        driveAfterSwap(key, params, tick, hookData);
        emit HarnessCallbackCycle(PoolId.unwrap(key.toId()), fee);
    }

    function driveTwoAfterCallbacks(PoolKey memory key, SwapParams memory params, int24 firstTick, int24 lastTick, bytes calldata hookData) external {
        driveAfterSwap(key, params, firstTick, hookData);
        driveAfterSwap(key, params, lastTick, hookData);
    }

    function _setTick(PoolKey memory key, int24 tick) private {
        bytes32 slot = keccak256(abi.encode(PoolId.unwrap(key.toId()), uint256(6)));
        _words[slot] = bytes32(uint256(1 << 96) | (uint256(uint24(tick)) << 160));
    }
}
