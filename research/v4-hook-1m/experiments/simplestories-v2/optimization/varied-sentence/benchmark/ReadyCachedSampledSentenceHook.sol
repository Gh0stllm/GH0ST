// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId,PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IReadyCachedSentenceModel {
    function modelHash() external view returns(bytes32);
    function PARAMETERS() external view returns(uint256);
    function VOCABULARY() external view returns(uint256);
    function HIDDEN() external view returns(uint256);
    function LAYERS() external view returns(uint256);
    function MAX_CACHED_NEW_TOKENS() external view returns(uint8);
    function promptCache() external view returns(address);
    function promptCacheHash() external view returns(bytes32);
    function rootCandidates(uint8) external view returns(uint16[] memory);
    function branchCache(uint16) external view returns(address);
    function branchCacheHash(uint16) external view returns(bytes32);
    function promptToken() external view returns(uint16);
    function generateCachedSentence(uint8,bytes32,uint8,uint16) external view returns(uint16[] memory,bool,bool,bytes32);
}

/// @notice Local-only cached-model adapter with exactly replayable caller-chosen sampling seeds.
/// @dev A view preview does not use an off-chain model. The swap recomputes the same immutable model.
/// Seed selection is public and manipulable; it is intended only for sentence variety.
contract ReadyCachedSampledSentenceHook {
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable poolManager;
    IReadyCachedSentenceModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    bytes32 public immutable cacheReadinessHash;
    uint16 public immutable promptToken;
    uint8 public immutable topK;
    uint16 public immutable temperatureMilli;
    uint64 public immutable inferenceGasLimit;
    uint8 public constant maximumNewTokens=5;
    struct Context {uint64 sequence;bool initialized;}
    mapping(bytes32=>Context)public contexts;
    error InvalidConfiguration();
    error CacheNotReady(uint16 token);
    error UnauthorizedCallback();
    error InvalidSeedLength();
    error InsufficientGas();
    error InferenceFailed();
    error IncompleteSentence();
    event SentenceSpoken(bytes32 indexed poolId,uint64 indexed sequence,bytes32 indexed modelHash,
        bytes32 seed,uint16 promptToken,uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);
    constructor(IPoolManager manager_,IReadyCachedSentenceModel model_,uint64 budget_,uint8 k_,uint16 temperature_){
        if(block.chainid!=31337||address(manager_).code.length==0||address(model_).code.length==0||budget_<100000||budget_>29250000
            ||k_==0||k_>64||temperature_<100||temperature_>2000)revert InvalidConfiguration();
        if(model_.PARAMETERS()!=1235968||model_.VOCABULARY()!=4019||model_.HIDDEN()!=128||model_.LAYERS()!=4||model_.MAX_CACHED_NEW_TOKENS()!=5)revert InvalidConfiguration();
        address root=model_.promptCache();
        if(root.code.length!=18125||root.codehash!=model_.promptCacheHash())revert CacheNotReady(type(uint16).max);
        uint16[] memory candidates=model_.rootCandidates(64);
        if(candidates.length!=64)revert InvalidConfiguration();
        uint256[16] memory seen;
        bytes32 ready=keccak256(abi.encode(root,root.codehash));
        for(uint256 i;i<64;++i){
            uint16 token=candidates[i];if(token==0||token>=4019)revert InvalidConfiguration();
            uint256 bucket=uint256(token)>>8;uint256 bit=uint256(1)<<(uint256(token)&255);
            if((seen[bucket]&bit)!=0)revert InvalidConfiguration();seen[bucket]|=bit;
            if(token==1||token==2||token==15||token==30)continue;
            address cache=model_.branchCache(token);bytes32 hash=model_.branchCacheHash(token);
            if(cache.code.length!=20173||cache.codehash!=hash)revert CacheNotReady(token);
            ready=keccak256(abi.encode(ready,token,cache,hash));
        }
        cacheReadinessHash=ready;
        poolManager=manager_;model=model_;modelHash=model_.modelHash();modelCodeHash=address(model_).codehash;
        promptToken=model_.promptToken();if(promptToken>=4019)revert InvalidConfiguration();
        topK=k_;temperatureMilli=temperature_;inferenceGasLimit=budget_;
        Hooks.validateHookPermissions(IHooks(address(this)),getHookPermissions());
    }
    function getHookPermissions()public pure returns(Hooks.Permissions memory p){p.afterInitialize=true;p.afterSwap=true;}
    function _valid(uint16[] memory ids,bool eos,bool sentence)private pure returns(bool){
        uint256 n=ids.length;if(n<2||n>maximumNewTokens)return false;bool content;
        for(uint256 i;i<n;++i){uint16 t=ids[i];if(t>=4019)return false;bool end=t==1||t==2||t==15||t==30;
            if(end&&i+1<n)return false;if(!end&&t!=0)content=true;}
        uint16 last=ids[n-1];return content&&(eos||sentence)&&eos==(last==1)&&sentence==(last==2||last==15||last==30);
    }
    function preview(bytes32 seed)external view returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bool complete){
        if(address(model).codehash!=modelCodeHash)revert InferenceFailed();
        (tokens,endedEos,endedSentence,lastLogitHash)=model.generateCachedSentence{gas:inferenceGasLimit}(maximumNewTokens,seed,topK,temperatureMilli);
        complete=_valid(tokens,endedEos,endedSentence);
    }
    function _authorize(PoolKey calldata key)private view returns(bytes32){
        if(msg.sender!=address(poolManager)||address(key.hooks)!=address(this))revert UnauthorizedCallback();return PoolId.unwrap(key.toId());
    }
    function afterInitialize(address,PoolKey calldata key,uint160,int24)external returns(bytes4){
        bytes32 id=_authorize(key);if(contexts[id].initialized)revert UnauthorizedCallback();contexts[id].initialized=true;return IHooks.afterInitialize.selector;
    }
    function afterSwap(address,PoolKey calldata key,SwapParams calldata,BalanceDelta,bytes calldata data)external returns(bytes4,int128){
        bytes32 id=_authorize(key);if(!contexts[id].initialized)revert UnauthorizedCallback();if(data.length!=32)revert InvalidSeedLength();
        bytes32 seed=abi.decode(data,(bytes32));if(address(model).codehash!=modelCodeHash)revert InferenceFailed();
        uint256 budget=inferenceGasLimit;uint256 reserve=(budget+62)/63;if(reserve<250000)reserve=250000;
        if(gasleft()<budget+reserve+15000)revert InsufficientGas();
        try model.generateCachedSentence{gas:budget}(maximumNewTokens,seed,topK,temperatureMilli)
            returns(uint16[] memory ids,bool eos,bool sentence,bytes32 hash){
            if(!_valid(ids,eos,sentence))revert IncompleteSentence();
            uint64 sequence=contexts[id].sequence+1;contexts[id].sequence=sequence;
            emit SentenceSpoken(id,sequence,modelHash,seed,promptToken,ids,eos,sentence,hash);
        }catch{revert InferenceFailed();}
        return(IHooks.afterSwap.selector,0);
    }
}

contract ReadyCachedGenerationProbe {
    event Generated(bytes32 seed,uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);
    function measure(IReadyCachedSentenceModel model,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature)external{
        (uint16[] memory ids,bool eos,bool sentence,bytes32 hash)=model.generateCachedSentence(maxNew,seed,topK,temperature);
        emit Generated(seed,ids,eos,sentence,hash);
    }
}
