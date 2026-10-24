// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @dev Testing tools only. These are not proposed public protocol contracts.
contract NovaPoolReader {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    function state(IPoolManager manager, PoolKey memory key)
        external view returns (uint160 sqrtPrice, int24 tick, uint24 protocolFee, uint24 lpFee, uint128 liquidity)
    {
        (sqrtPrice, tick, protocolFee, lpFee) = manager.getSlot0(key.toId());
        liquidity = manager.getLiquidity(key.toId());
    }
    function position(IPoolManager manager, PoolKey memory key, address owner, int24 lower, int24 upper)
        external view returns (uint128 liquidity, uint256 feeGrowth0, uint256 feeGrowth1)
    {
        return manager.getPositionInfo(key.toId(), owner, lower, upper, bytes32(0));
    }
}
interface INovaTestRouter {
    function buy(uint256 minimum, uint160 limit, uint256 deadline) external payable returns(uint256);
    function sell(uint256 amount, uint256 minimum, uint160 limit, uint256 deadline) external returns(uint256);
}
interface INovaTestToken { function approve(address,uint256) external returns(bool); }
contract NovaReentryTrader {
    INovaTestRouter public immutable router;
    bool public attempted;
    bool public blocked;
    constructor(INovaTestRouter router_) { router = router_; }
    function buy(uint160 limit) external payable { router.buy{value:msg.value}(1,limit,block.timestamp); }
    function approve(INovaTestToken token,uint256 amount) external { token.approve(address(router),amount); }
    function sell(uint256 amount,uint160 limit) external { router.sell(amount,1,limit,block.timestamp); }
    receive() external payable {
        attempted = true;
        (bool ok,) = address(router).call(abi.encodeCall(INovaTestRouter.sell,(1,1,type(uint160).max-1,block.timestamp)));
        blocked = !ok;
    }
}
contract NovaCreate2Factory {
    function deploy(bytes32 salt,bytes memory code) external returns(address deployed) {
        assembly("memory-safe") { deployed := create2(0,add(code,32),mload(code),salt) }
        require(deployed != address(0),"CREATE2 failed");
    }
}
contract NovaLPAttack is IUnlockCallback {
    IPoolManager public immutable manager;
    constructor(IPoolManager manager_) { manager = manager_; }
    function remove(PoolKey calldata key, int24 lower, int24 upper, uint128 liquidity) external {
        manager.unlock(abi.encode(key, lower, upper, liquidity));
    }
    function unlockCallback(bytes calldata data) external returns(bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key,int24 lower,int24 upper,uint128 liquidity)=abi.decode(data,(PoolKey,int24,int24,uint128));
        manager.modifyLiquidity(key,ModifyLiquidityParams(lower,upper,-int256(uint256(liquidity)),bytes32(0)),"");
        return "";
    }
}
contract NovaPreSyncBuyer {
    function buy(IPoolManager manager, address token, INovaTestRouter router, uint160 limit) external payable {
        manager.sync(Currency.wrap(token));
        router.buy{value:msg.value}(1,limit,block.timestamp);
    }
}
