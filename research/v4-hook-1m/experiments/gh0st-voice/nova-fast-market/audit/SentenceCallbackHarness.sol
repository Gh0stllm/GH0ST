// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {NovaPoolHook} from "experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol";
contract SentenceDummyToken { function marker() external pure returns (uint256) { return 1; } }
/// @dev Callback-only test driver. This does not claim PoolManager or token settlement integration.
contract SentenceCallbackHarness {
    uint256 public successfulCallbacks;
    function extsload(bytes32) external pure returns (bytes32) { return bytes32(uint256(1) << 96); }
    function initialize(NovaPoolHook hook, PoolKey calldata key) external {
        hook.beforeInitialize(msg.sender, key, uint160(1 << 96));
        hook.afterInitialize(msg.sender, key, uint160(1 << 96), 0);
    }
    function run(NovaPoolHook hook, PoolKey calldata key) external {
        ++successfulCallbacks;
        hook.afterSwap(msg.sender, key, SwapParams(true, -1, uint160(1 << 95)), BalanceDelta.wrap(0), "");
    }
}
contract SentenceHookFactory {
    function deploy(bytes32 salt, bytes memory init) external returns (address result) {
        assembly ("memory-safe") { result := create2(0, add(init, 32), mload(init), salt) }
        require(result != address(0));
    }
}
