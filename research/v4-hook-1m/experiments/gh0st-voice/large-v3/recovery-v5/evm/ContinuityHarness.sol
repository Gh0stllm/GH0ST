// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SentenceV4SettlementRouter} from "tests/evm/SentenceV4IntegrationHarness.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
contract ContinuityTestRouter is SentenceV4SettlementRouter {
    constructor(IPoolManager manager_)SentenceV4SettlementRouter(manager_){}
    function swapAndRevert(PoolKey calldata key,SwapParams calldata params,bytes calldata hookData)external returns(BalanceDelta){
        Action memory action;action.key=key;action.swap=params;action.payer=msg.sender;
        action.hookData=hookData;action.revertAfterSettlement=true;
        return abi.decode(manager.unlock(abi.encode(action)),(BalanceDelta));
    }
}
