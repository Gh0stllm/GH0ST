// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ISentenceSpeakerV4Model} from "../../swap-speaker-535k/contracts/SentenceSpeakerV4Hook.sol";

/// @dev Test token only; anyone may mint.
contract SentenceV4TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SentenceV4Create2Factory {
    function deploy(bytes32 salt, bytes memory code) external returns (address deployed) {
        assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
        require(deployed != address(0), "CREATE2 failed");
    }
}

/// @dev Exercises real unlock -> modifyLiquidity/swap -> sync/settle/take accounting.
contract SentenceV4SettlementRouter is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct Action {
        PoolKey key;
        bool addLiquidity;
        ModifyLiquidityParams liquidity;
        SwapParams swap;
        address payer;
        bool skipSettlement;
        bool revertAfterSettlement;
        bytes hookData;
    }

    IPoolManager public immutable manager;
    error UnauthorizedCallback();
    error ForcedRollback();

    constructor(IPoolManager manager_) { manager = manager_; }
    receive() external payable {}

    function poolState(PoolKey calldata key) external view returns (uint160, int24, uint24, uint24) {
        return manager.getSlot0(key.toId());
    }

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params) external payable returns (BalanceDelta) {
        Action memory action;
        action.key = key;
        action.addLiquidity = true;
        action.liquidity = params;
        action.payer = msg.sender;
        return abi.decode(manager.unlock(abi.encode(action)), (BalanceDelta));
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bool skipSettlement, bool revertAfterSettlement)
        external payable returns (BalanceDelta)
    {
        Action memory action;
        action.key = key;
        action.swap = params;
        action.payer = msg.sender;
        action.skipSettlement = skipSettlement;
        action.revertAfterSettlement = revertAfterSettlement;
        return abi.decode(manager.unlock(abi.encode(action)), (BalanceDelta));
    }

    function swapWithHookData(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external payable returns (BalanceDelta)
    {
        Action memory action;
        action.key = key;
        action.swap = params;
        action.payer = msg.sender;
        action.hookData = hookData;
        return abi.decode(manager.unlock(abi.encode(action)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert UnauthorizedCallback();
        Action memory action = abi.decode(data, (Action));
        BalanceDelta delta;
        if (action.addLiquidity) (delta,) = manager.modifyLiquidity(action.key, action.liquidity, "");
        else delta = manager.swap(action.key, action.swap, action.hookData);
        if (!action.skipSettlement) {
            _settle(action.key.currency0, delta.amount0(), action.payer);
            _settle(action.key.currency1, delta.amount1(), action.payer);
        }
        if (action.revertAfterSettlement) revert ForcedRollback();
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 delta, address payer) private {
        if (delta < 0) {
            uint256 debt = uint256(-int256(delta));
            if (Currency.unwrap(currency) == address(0)) manager.settle{value: debt}();
            else {
                manager.sync(currency);
                require(SentenceV4TestToken(Currency.unwrap(currency)).transferFrom(payer, address(manager), debt));
                manager.settle();
            }
        } else if (delta > 0) {
            manager.take(currency, payer, uint256(int256(delta)));
        }
    }
}

/// @dev Failure injection verifies that optional inference cannot veto a valid swap.
contract SentenceV4FailingModel is ISentenceSpeakerV4Model {
    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("failure-injection-model");
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    { revert("model unavailable"); }
}
