// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId,PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IRelativeContinuityModel {
    function modelHash()external view returns(bytes32);
    function PARAMETERS()external view returns(uint256);
    function VOCABULARY()external view returns(uint256);
    function HIDDEN()external view returns(uint256);
    function LAYERS()external view returns(uint256);
    function POSITION_INDEPENDENT()external view returns(bool);
    function ATTENTION_WINDOW()external view returns(uint256);
    function MAX_NEW_TOKENS()external view returns(uint256);
    function storyState(address,bytes32)external view returns(bytes32,uint64,uint16,uint64,uint64,uint64,uint256,uint48,uint8);
    function preview(bytes32,uint8,bytes32,uint8,uint16)external view returns(uint16[] memory,bool,bool,bytes32,bytes32,bool);
    function advanceStory(bytes32,bytes32,uint8,bytes32,uint8,uint16)external returns(uint16[] memory,bool,bool,bytes32,bytes32,bool);
}

/// @notice Local research: each successful swap continues its pool's model context by one or two tokens.
/// @dev The model attends to its last 64 real KV positions using relative RoPE distances, without prompt resets.
/// Tokens may be a sentence fragment. After position 26 this adapter requests one token for bounded gas.
contract RelativeContinuityHook {
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable poolManager;
    IRelativeContinuityModel public immutable model;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelCodeHash;
    uint64 public immutable inferenceGasLimit;
    uint8 public immutable topK;
    uint16 public immutable temperatureMilli;
    uint16 public immutable attentionWindow;
    struct Context {uint64 revision;bool initialized;bytes32 contextHash;}
    mapping(bytes32=>Context)public contexts;
    error InvalidConfiguration();
    error UnauthorizedCallback();
    error InvalidHookData();
    error StaleQuote(uint64 revision,bytes32 contextHash);
    error InvalidContext();
    error InsufficientGas();
    error InferenceFailed();
    error InvalidModelResult();
    event StoryContinued(bytes32 indexed poolId,uint64 indexed revision,bytes32 indexed modelHash,
        bytes32 previousContextHash,bytes32 contextHash,bytes32 seed,uint8 requestedTokens,uint16[] tokens,
        bool endedEos,bool endedSentence,bytes32 lastLogitHash,bool refreshed);

    constructor(IPoolManager manager_,IRelativeContinuityModel model_,uint64 budget_,uint8 topK_,uint16 temperature_){
        if(block.chainid!=31337||address(manager_).code.length==0||address(model_).code.length==0||budget_<100000||budget_>29250000
            ||topK_==0||topK_>64||temperature_<100||temperature_>2000)revert InvalidConfiguration();
        if(model_.PARAMETERS()!=1235968||model_.VOCABULARY()!=4019||model_.HIDDEN()!=128||model_.LAYERS()!=4
            ||!model_.POSITION_INDEPENDENT()||model_.ATTENTION_WINDOW()!=64||model_.MAX_NEW_TOKENS()!=2)revert InvalidConfiguration();
        poolManager=manager_;model=model_;modelHash=model_.modelHash();modelCodeHash=address(model_).codehash;
        inferenceGasLimit=budget_;topK=topK_;temperatureMilli=temperature_;attentionWindow=64;
        Hooks.validateHookPermissions(IHooks(address(this)),getHookPermissions());
    }
    function getHookPermissions()public pure returns(Hooks.Permissions memory p){p.afterInitialize=true;p.afterSwap=true;}
    function _authorize(PoolKey calldata key)private view returns(bytes32){
        if(msg.sender!=address(poolManager)||address(key.hooks)!=address(this))revert UnauthorizedCallback();return PoolId.unwrap(key.toId());
    }
    function _checked(bytes32 id,uint64 expectedRevision,bytes32 expectedContextHash)private view returns(Context memory c,uint8 requested){
        c=contexts[id];if(!c.initialized)revert InvalidContext();
        if(c.revision!=expectedRevision||c.contextHash!=expectedContextHash)revert StaleQuote(c.revision,c.contextHash);
        if(address(model).codehash!=modelCodeHash)revert InferenceFailed();
        (bytes32 actual,uint64 processed,,,,,,,)=model.storyState(address(this),id);
        if(actual!=c.contextHash)revert InvalidContext();
        requested=processed<=26?2:1;
    }
    function preview(bytes32 poolId,uint64 expectedRevision,bytes32 expectedContextHash,bytes32 seed)external view
        returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bytes32 nextContextHash,bool refreshed,uint8 requested){
        (,requested)=_checked(poolId,expectedRevision,expectedContextHash);
        (tokens,endedEos,endedSentence,lastLogitHash,nextContextHash,refreshed)=model.preview{gas:inferenceGasLimit}(poolId,requested,seed,topK,temperatureMilli);
    }
    function afterInitialize(address,PoolKey calldata key,uint160,int24)external returns(bytes4){
        bytes32 id=_authorize(key);if(contexts[id].initialized)revert InvalidContext();
        (bytes32 head,,,,,,,,)=model.storyState(address(this),id);if(head!=bytes32(0))revert InvalidContext();
        contexts[id].initialized=true;return IHooks.afterInitialize.selector;
    }
    function afterSwap(address,PoolKey calldata key,SwapParams calldata,BalanceDelta,bytes calldata data)external returns(bytes4,int128){
        bytes32 id=_authorize(key);if(data.length!=96)revert InvalidHookData();
        (uint64 revision,bytes32 expected,bytes32 seed)=abi.decode(data,(uint64,bytes32,bytes32));
        (Context memory c,uint8 requested)=_checked(id,revision,expected);
        uint256 budget=inferenceGasLimit;uint256 reserve=(budget+62)/63;if(reserve<250000)reserve=250000;
        if(gasleft()<budget+reserve+20000)revert InsufficientGas();
        try model.advanceStory{gas:budget}(id,c.contextHash,requested,seed,topK,temperatureMilli)
            returns(uint16[] memory ids,bool eos,bool sentence,bytes32 logits,bytes32 next,bool refreshed){
            uint256 n=ids.length;if(n==0||n>requested||next==bytes32(0)||next==c.contextHash)revert InvalidModelResult();
            for(uint256 i;i<n;++i){uint16 token=ids[i];if(token==0||token>=4019)revert InvalidModelResult();
                bool terminal=token==1||token==2||token==15||token==30;if(terminal&&i+1<n)revert InvalidModelResult();}
            uint16 last=ids[n-1];if(eos!=(last==1)||sentence!=(last==2||last==15||last==30))revert InvalidModelResult();
            (bytes32 actual,,,,,,,,)=model.storyState(address(this),id);if(actual!=next)revert InvalidModelResult();
            contexts[id]=Context(c.revision+1,true,next);
            emit StoryContinued(id,c.revision+1,modelHash,c.contextHash,next,seed,requested,ids,eos,sentence,logits,refreshed);
        }catch{revert InferenceFailed();}
        return(IHooks.afterSwap.selector,0);
    }
}
