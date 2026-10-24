// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId,PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface ICachedSentenceModel {
    function modelHash() external view returns(bytes32);
    function promptToken() external view returns(uint16);
    function generateCachedSentence(uint8,bytes32,uint8,uint16) external view returns(uint16[] memory,bool,bool,bytes32);
}

/// @notice Local-only cached-model adapter with exactly replayable caller-chosen sampling seeds.
/// @dev A view preview does not use an off-chain model. The swap recomputes the same immutable model.
/// Seed selection is public and manipulable; it is intended only for sentence variety.
contract CachedSampledSentenceHook {
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable poolManager;
    ICachedSentenceModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint16 public immutable promptToken;
    uint8 public immutable topK;
    uint16 public immutable temperatureMilli;
    uint64 public immutable inferenceGasLimit;
    uint8 public constant maximumNewTokens=5;
    struct Context {uint64 sequence;bool initialized;}
    mapping(bytes32=>Context)public contexts;
    error InvalidConfiguration();
    error UnauthorizedCallback();
    error InvalidSeedLength();
    error InsufficientGas();
    error InferenceFailed();
    error IncompleteSentence();
    event SentenceSpoken(bytes32 indexed poolId,uint64 indexed sequence,bytes32 indexed modelHash,
        bytes32 seed,uint16 promptToken,uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);
    constructor(IPoolManager manager_,ICachedSentenceModel model_,uint64 budget_,uint8 k_,uint16 temperature_){
        if(block.chainid!=31337||address(manager_).code.length==0||address(model_).code.length==0||budget_<100000||budget_>29250000
            ||k_==0||k_>64||temperature_<100||temperature_>2000)revert InvalidConfiguration();
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

contract CachedGenerationProbe {
    event Generated(bytes32 seed,uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash);
    function measure(ICachedSentenceModel model,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature)external{
        (uint16[] memory ids,bool eos,bool sentence,bytes32 hash)=model.generateCachedSentence(maxNew,seed,topK,temperature);
        emit Generated(seed,ids,eos,sentence,hash);
    }
}
