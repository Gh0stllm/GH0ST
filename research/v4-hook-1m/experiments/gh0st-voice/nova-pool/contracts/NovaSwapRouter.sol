// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface INovaERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
interface INovaRouterHook {
    function poolManager() external view returns(address);
    function nova() external view returns(address);
    function fee() external view returns(uint24);
    function tickSpacing() external view returns(int24);
    function poolId() external view returns(bytes32);
}

/// @notice Local candidate exact-input router for one immutable native-ETH/N0VA pool.
/// @dev No custody permissions, arbitrary call, owner, liquidity withdrawal or upgrades.
contract NovaSwapRouter is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    struct Action { address payer; bool buy; uint256 amount; uint256 minimum; uint160 limit; }
    IPoolManager public immutable manager;
    INovaERC20 public immutable nova;
    IHooks public immutable hook;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint256 private entered;
    error InvalidTrade();
    error DeadlineExpired();
    error ReentrantCall();
    error UnauthorizedCallback();
    error InsufficientInput();
    error SlippageExceeded();
    error PartialFill();
    event Traded(address indexed trader, bool buy, uint256 amountIn, uint256 amountOut);

    constructor(IPoolManager manager_, INovaERC20 nova_, IHooks hook_, uint24 fee_, int24 spacing_) {
        if (block.chainid != 31337 || address(manager_).code.length == 0 || address(nova_).code.length == 0
            || address(hook_).code.length == 0 || fee_ >= 1_000_000 || spacing_ <= 0) revert InvalidTrade();
        INovaRouterHook bound = INovaRouterHook(address(hook_));
        PoolKey memory key = PoolKey(Currency.wrap(address(0)),Currency.wrap(address(nova_)),fee_,spacing_,hook_);
        if (bound.poolManager() != address(manager_) || bound.nova() != address(nova_)
            || bound.fee() != fee_ || bound.tickSpacing() != spacing_
            || bound.poolId() != PoolId.unwrap(PoolIdLibrary.toId(key))) revert InvalidTrade();
        manager = manager_; nova = nova_; hook = hook_; fee = fee_; tickSpacing = spacing_;
    }
    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1; _; entered = 0;
    }
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(nova)), fee, tickSpacing, hook);
    }
    function buy(uint256 minimumNova, uint160 limit, uint256 deadline)
        external payable nonReentrant returns (uint256 received)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0 || msg.value > uint256(int256(type(int128).max)) || minimumNova == 0)
            revert InvalidTrade();
        received = abi.decode(manager.unlock(abi.encode(Action(msg.sender, true, msg.value, minimumNova, limit))), (uint256));
        emit Traded(msg.sender, true, msg.value, received);
    }
    function sell(uint256 amount, uint256 minimumEth, uint160 limit, uint256 deadline)
        external nonReentrant returns (uint256 received)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amount == 0 || amount > uint256(int256(type(int128).max)) || minimumEth == 0) revert InvalidTrade();
        if (nova.balanceOf(msg.sender) < amount || nova.allowance(msg.sender, address(this)) < amount)
            revert InsufficientInput();
        received = abi.decode(manager.unlock(abi.encode(Action(msg.sender, false, amount, minimumEth, limit))), (uint256));
        emit Traded(msg.sender, false, amount, received);
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || entered != 1) revert UnauthorizedCallback();
        Action memory a = abi.decode(data, (Action));
        BalanceDelta delta = manager.swap(poolKey(), SwapParams(a.buy, -int256(a.amount), a.limit), "");
        int128 input = a.buy ? delta.amount0() : delta.amount1();
        int128 output = a.buy ? delta.amount1() : delta.amount0();
        if (input >= 0 || output <= 0) revert InvalidTrade();
        if (uint256(-int256(input)) != a.amount) revert PartialFill();
        uint256 received = uint256(int256(output));
        if (received < a.minimum) revert SlippageExceeded();
        if (a.buy) {
            manager.sync(Currency.wrap(address(0)));
            if (manager.settle{value:a.amount}() != a.amount) revert InvalidTrade();
            manager.take(Currency.wrap(address(nova)), a.payer, received);
        } else {
            manager.sync(Currency.wrap(address(nova)));
            if (!nova.transferFrom(a.payer, address(manager), a.amount)) revert InvalidTrade();
            if (manager.settle() != a.amount) revert InvalidTrade();
            manager.take(Currency.wrap(address(0)), a.payer, received);
        }
        return abi.encode(received);
    }
}
