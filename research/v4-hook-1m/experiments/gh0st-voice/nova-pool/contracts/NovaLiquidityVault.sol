// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {NovaToken} from "./NovaToken.sol";

interface INovaBoundHook {
    function poolManager() external view returns (IPoolManager);
    function nova() external view returns (address);
    function initializer() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function initialSqrtPriceX96() external view returns (uint160);
    function poolId() external view returns (bytes32);
}

/// @notice Owns one permanent v4 liquidity position. Principal, fees, and dust cannot be withdrawn.
/// @dev No owner, management keys, position transfers, generic calls, token approvals, or removal path.
///      This contract intentionally has no rescue function. Assets sent here remain locked forever.
///      Constructor parameters are deployment-time settings; they cannot subsequently be changed.
contract NovaLiquidityVault is IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    error InvalidConfiguration();
    error IncorrectFunding();
    error AlreadyLaunched();
    error UnauthorizedCallback();
    error UnexpectedLiquidityDelta();
    error IncompleteSettlement();

    uint256 public constant GENESIS_NATIVE = 1 ether;
    uint256 public constant GENESIS_TOKENS = 1_000_000 ether;
    // Tick rounding can leave small unused balances. At least 99.9% of both budgets must enter LP.
    uint256 public constant MAX_NATIVE_DUST = GENESIS_NATIVE / 1_000;
    uint256 public constant MAX_TOKEN_DUST = GENESIS_TOKENS / 1_000;
    bytes32 public constant POSITION_SALT = bytes32(0);

    IPoolManager public immutable manager;
    NovaToken public immutable token;
    IHooks public immutable hook;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    uint160 public immutable initialSqrtPriceX96;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint128 public immutable genesisLiquidity;
    uint256 public immutable nativeRequired;
    uint256 public immutable tokenRequired;

    bool public launched;
    bool private _unlockExpected;

    event GenesisPermanentlyLocked(
        PoolId indexed poolId,
        address indexed token,
        uint128 liquidity,
        uint256 nativeDeposited,
        uint256 tokensDeposited,
        uint256 nativeDustLocked,
        uint256 tokenDustLocked
    );

    constructor(
        IPoolManager manager_,
        address hook_,
        uint24 fee_,
        int24 tickSpacing_,
        uint160 initialSqrtPriceX96_,
        int24 tickLower_,
        int24 tickUpper_,
        uint128 genesisLiquidity_
    ) {
        if (
            address(manager_).code.length == 0 || hook_ == address(0) || fee_ >= 1_000_000
                || tickSpacing_ <= 0 || tickSpacing_ > type(int16).max || tickLower_ >= tickUpper_
                || tickLower_ < TickMath.MIN_TICK || tickUpper_ > TickMath.MAX_TICK
                || tickLower_ % tickSpacing_ != 0 || tickUpper_ % tickSpacing_ != 0 || genesisLiquidity_ == 0
        ) revert InvalidConfiguration();

        uint160 lower = TickMath.getSqrtPriceAtTick(tickLower_);
        uint160 upper = TickMath.getSqrtPriceAtTick(tickUpper_);
        if (initialSqrtPriceX96_ <= lower || initialSqrtPriceX96_ >= upper) revert InvalidConfiguration();

        uint256 nativeAmount = SqrtPriceMath.getAmount0Delta(initialSqrtPriceX96_, upper, genesisLiquidity_, true);
        uint256 tokenAmount = SqrtPriceMath.getAmount1Delta(lower, initialSqrtPriceX96_, genesisLiquidity_, true);
        if (
            nativeAmount > GENESIS_NATIVE || tokenAmount > GENESIS_TOKENS
                || GENESIS_NATIVE - nativeAmount > MAX_NATIVE_DUST
                || GENESIS_TOKENS - tokenAmount > MAX_TOKEN_DUST
        ) revert InvalidConfiguration();

        manager = manager_;
        hook = IHooks(hook_);
        fee = fee_;
        tickSpacing = tickSpacing_;
        initialSqrtPriceX96 = initialSqrtPriceX96_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        genesisLiquidity = genesisLiquidity_;
        nativeRequired = nativeAmount;
        tokenRequired = tokenAmount;
        // First CREATE by this vault: the token address is deterministically predictable before launch.
        token = new NovaToken(address(this));
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), fee, tickSpacing, hook);
    }

    function poolId() external view returns (PoolId) {
        return poolKey().toId();
    }

    function positionLiquidity() external view returns (uint128 liquidity) {
        (liquidity,,) = StateLibrary.getPositionInfo(
            manager, poolKey().toId(), address(this), tickLower, tickUpper, POSITION_SALT
        );
    }

    /// @notice Anyone may pay the fixed 1 ETH to launch the immutable configuration once.
    /// @dev The payer receives no LP token, withdrawal entitlement, control, or refund.
    ///      Only the predetermined position is funded; any rounding remainder stays permanently locked.
    function fundAndInitialize() external payable {
        if (launched) revert AlreadyLaunched();
        if (msg.value != GENESIS_NATIVE) revert IncorrectFunding();
        if (token.balanceOf(address(this)) != GENESIS_TOKENS) revert IncorrectFunding();
        _checkHookBindings();
        launched = true;
        manager.initialize(poolKey(), initialSqrtPriceX96);
        _unlockExpected = true;
        manager.unlock("");
        if (_unlockExpected) revert IncompleteSettlement();
        emit GenesisPermanentlyLocked(
            poolKey().toId(), address(token), genesisLiquidity, nativeRequired, tokenRequired,
            address(this).balance, token.balanceOf(address(this))
        );
    }

    function _checkHookBindings() private view {
        // The vault creates N0VA first; the predetermined CREATE2 hook is deployed second.
        // No funds can launch before that hook exists and reports the exact immutable bindings.
        if (address(hook).code.length == 0) revert InvalidConfiguration();
        INovaBoundHook bound = INovaBoundHook(address(hook));
        if (
            address(bound.poolManager()) != address(manager) || bound.nova() != address(token)
                || bound.initializer() != address(this) || bound.fee() != fee || bound.tickSpacing() != tickSpacing
                || bound.initialSqrtPriceX96() != initialSqrtPriceX96 || bound.poolId() != PoolId.unwrap(poolKey().toId())
        ) revert InvalidConfiguration();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || !_unlockExpected || data.length != 0) revert UnauthorizedCallback();
        // Consume callback authorization before any external interaction; repeated/reentrant callbacks fail.
        _unlockExpected = false;
        (BalanceDelta delta, BalanceDelta accruedFees) = manager.modifyLiquidity(
            poolKey(),
            ModifyLiquidityParams(tickLower, tickUpper, int256(uint256(genesisLiquidity)), POSITION_SALT),
            ""
        );
        if (
            delta.amount0() != -int128(uint128(nativeRequired))
                || delta.amount1() != -int128(uint128(tokenRequired)) || BalanceDelta.unwrap(accruedFees) != 0
        ) revert UnexpectedLiquidityDelta();

        manager.sync(Currency.wrap(address(0)));
        if (manager.settle{value: nativeRequired}() != nativeRequired) revert IncompleteSettlement();
        manager.sync(Currency.wrap(address(token)));
        if (!token.transfer(address(manager), tokenRequired)) revert IncompleteSettlement();
        if (manager.settle() != tokenRequired) revert IncompleteSettlement();
        return "";
    }
}
