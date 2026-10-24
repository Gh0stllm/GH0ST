// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IStreamingSimpleStoriesModel {
    function PARAMETERS() external view returns(uint256);
    function HIDDEN() external view returns(uint256);
    function LAYERS() external view returns(uint256);
    function VOCABULARY() external view returns(uint256);
    function modelHash() external view returns(bytes32);
    function step(bytes32 sessionId,uint16 token,bool reset) external returns(uint16,int32[128] memory,bytes32);
    function prefill(bytes32 sessionId,uint16 token,bool reset) external returns(uint16,int32[128] memory,bytes32);
    function sessionState(address owner,bytes32 sessionId) external view returns(uint8,bool,uint64,bytes32);
}

/// @notice Local-only research: one exact new input token and full-vocabulary prediction per swap.
/// @dev Each pool owns a shared stream in this hook's model namespace. Fixed prompts are prefetched
/// one token per swap; a prompt of N tokens requires N swaps before the first completion token.
/// Every successful swap must execute inference. Complete/closed streams restart automatically.
contract SimpleStoriesV2StreamingHook {
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable poolManager;
    IStreamingSimpleStoriesModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint8 public immutable maximumNewTokens;
    uint64 public immutable inferenceGasLimit;
    uint256 public constant CALLBACK_GAS_RESERVE=250000;
    uint16[] private _prompt;
    struct Context {uint64 sequence;uint8 promptIndex;uint8 generated;uint16 nextToken;bool ended;bool initialized;}
    mapping(bytes32=>Context) public contexts;
    error InvalidConfiguration();
    error UnauthorizedCallback();
    error InsufficientGas();
    error InvalidModelResult();
    event StreamToken(bytes32 indexed poolId,uint64 indexed sequence,uint64 epoch,
        uint16 inputToken,uint16 nextToken,bool completion,bool reset,bool ended,
        int32[128] lastHidden,bytes32 logitHash,bytes32 prefixHash);

    constructor(IPoolManager manager_,IStreamingSimpleStoriesModel model_,uint16[] memory prompt_,
        uint8 maximumNewTokens_,uint64 inferenceGasLimit_) {
        if(address(manager_).code.length==0||address(model_).code.length==0||prompt_.length==0||
            maximumNewTokens_==0||prompt_.length+maximumNewTokens_-1>16||
            inferenceGasLimit_<100000||inferenceGasLimit_>29500000)revert InvalidConfiguration();
        if(model_.PARAMETERS()!=1235968||model_.HIDDEN()!=128||model_.LAYERS()!=4||model_.VOCABULARY()!=4019)
            revert InvalidConfiguration();
        for(uint256 i;i<prompt_.length;++i){if(prompt_[i]>=4019)revert InvalidConfiguration();_prompt.push(prompt_[i]);}
        poolManager=manager_;model=model_;modelHash=model_.modelHash();modelCodeHash=address(model_).codehash;
        maximumNewTokens=maximumNewTokens_;inferenceGasLimit=inferenceGasLimit_;
        Hooks.validateHookPermissions(IHooks(address(this)),getHookPermissions());
    }
    function prompt() external view returns(uint16[] memory){return _prompt;}
    function getHookPermissions() public pure returns(Hooks.Permissions memory permissions){
        permissions.afterInitialize=true;permissions.afterSwap=true;
    }
    function _authorize(PoolKey calldata key) private view returns(bytes32 id){
        if(msg.sender!=address(poolManager)||address(key.hooks)!=address(this))revert UnauthorizedCallback();
        return PoolId.unwrap(key.toId());
    }
    function afterInitialize(address,PoolKey calldata key,uint160,int24) external returns(bytes4){
        bytes32 id=_authorize(key);if(contexts[id].initialized)revert UnauthorizedCallback();
        contexts[id].initialized=true;return IHooks.afterInitialize.selector;
    }
    function afterSwap(address,PoolKey calldata key,SwapParams calldata,BalanceDelta,bytes calldata)
        external returns(bytes4,int128){
        bytes32 id=_authorize(key);Context memory state=contexts[id];if(!state.initialized)revert UnauthorizedCallback();
        if(address(model).codehash!=modelCodeHash)revert InvalidModelResult();
        (uint8 length,bool closed,uint64 epoch,)=model.sessionState(address(this),id);
        bool reset=state.sequence==0||state.ended||closed||length>=16||state.generated>=maximumNewTokens;
        if(reset){state.promptIndex=0;state.generated=0;state.ended=false;}
        bool inPrompt=state.promptIndex<_prompt.length;
        uint16 current=inPrompt?_prompt[state.promptIndex]:state.nextToken;
        bool completion=!inPrompt||uint256(state.promptIndex)+1==_prompt.length;
        uint256 required=uint256(inferenceGasLimit)+uint256(inferenceGasLimit)/63+CALLBACK_GAS_RESERVE;
        if(gasleft()<required)revert InsufficientGas();
        uint16 next;int32[128] memory hidden;bytes32 hash;
        if(completion)(next,hidden,hash)=model.step{gas:inferenceGasLimit}(id,current,reset);
        else(next,hidden,hash)=model.prefill{gas:inferenceGasLimit}(id,current,reset);
        if(next>=4019)revert InvalidModelResult();
        (uint8 newLength,bool ended,uint64 newEpoch,bytes32 prefixHash)=model.sessionState(address(this),id);
        if(newLength!=(reset?1:uint256(length)+1)||newEpoch!=(reset?epoch+1:epoch))revert InvalidModelResult();
        state.sequence+=1;if(inPrompt)state.promptIndex+=1;if(completion)state.generated+=1;
        state.nextToken=next;state.ended=ended;contexts[id]=state;
        emit StreamToken(id,state.sequence,newEpoch,current,next,completion,reset,ended,hidden,hash,prefixHash);
        return(IHooks.afterSwap.selector,0);
    }
}

