// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
interface ISimpleStoriesSentenceModel {
    function PARAMETERS() external view returns(uint256);
    function VOCABULARY() external view returns(uint256);
    function HIDDEN() external view returns(uint256);
    function LAYERS() external view returns(uint256);
    function modelHash() external view returns(bytes32);
    function generateSentence(uint16[] calldata prompt,uint8 maximumNewTokens)
        external view returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);
}

/// @notice Local research: every successful swap must generate a naturally terminated sentence.
/// @dev No saved inference state or outputs from earlier swaps are used. Native model tokens
/// 1(EOS),2(!),15(.),30(?) terminate generation; no punctuation is appended by this hook.
/// Elevated budgets exist only for isolated diagnostic measurements, never 32M pass claims.
contract SimpleStoriesV2SentenceHook {
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable poolManager;
    ISimpleStoriesSentenceModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint8 public immutable maximumNewTokens;
    uint64 public immutable inferenceGasLimit;
    uint256 public constant CALLBACK_GAS_RESERVE=250000;
    uint16[] private _prompt;
    struct Context{uint64 sequence;bool initialized;}
    mapping(bytes32=>Context) public contexts;
    error InvalidConfiguration();
    error UnauthorizedCallback();
    error InsufficientGas();
    error InferenceFailed();
    error InvalidModelResult();
    error IncompleteSentence();
    event SentenceSpoken(bytes32 indexed poolId,uint64 indexed sequence,bytes32 indexed modelHash,
        uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);

    constructor(IPoolManager manager_,ISimpleStoriesSentenceModel model_,uint16[] memory prompt_,
        uint8 maximumNewTokens_,uint64 inferenceGasLimit_) {
        if(address(manager_).code.length==0||address(model_).code.length==0||prompt_.length==0||
            maximumNewTokens_==0||maximumNewTokens_>16||prompt_.length+maximumNewTokens_-1>16||
            inferenceGasLimit_<100000||inferenceGasLimit_>14000000000)revert InvalidConfiguration();
        if(model_.PARAMETERS()!=1235968||model_.VOCABULARY()!=4019||model_.HIDDEN()!=128||model_.LAYERS()!=4)revert InvalidConfiguration();
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
        bytes32 id=_authorize(key);Context memory context=contexts[id];if(!context.initialized)revert UnauthorizedCallback();
        if(address(model).codehash!=modelCodeHash)revert InvalidModelResult();
        uint256 budget=inferenceGasLimit;
        uint256 reserved=(budget+62)/63;
        if(reserved<CALLBACK_GAS_RESERVE)reserved=CALLBACK_GAS_RESERVE;
        if(gasleft()<budget+reserved+10000)revert InsufficientGas();
        try model.generateSentence{gas:budget}(_prompt,maximumNewTokens)
            returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash){
            uint256 n=tokens.length;if(n<2||n>maximumNewTokens)revert InvalidModelResult();
            bool content;
            for(uint256 i;i<n;++i){
                uint16 t=tokens[i];if(t>=4019)revert InvalidModelResult();
                bool terminator=t==1||t==2||t==15||t==30;
                if(terminator&&i+1<n)revert InvalidModelResult();
                if(!terminator&&t!=0)content=true;
            }
            uint16 last=tokens[n-1];
            if(endedEos!=(last==1)||endedSentence!=(last==2||last==15||last==30))revert InvalidModelResult();
            if((!endedSentence&&!endedEos)||!content)revert IncompleteSentence();
            context.sequence+=1;contexts[id]=context;
            emit SentenceSpoken(id,context.sequence,modelHash,tokens,endedEos,endedSentence,lastLogitHash);
        }catch{revert InferenceFailed();}
        return(IHooks.afterSwap.selector,0);
    }
}

