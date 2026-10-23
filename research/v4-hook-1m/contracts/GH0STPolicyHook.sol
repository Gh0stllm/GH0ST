// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IFinalizedPolicySource} from "./IFinalizedPolicySource.sol";

/// @title GH0STPolicyHook — bounded consumer research, not a deployed ML engine
/// @notice Consumes a cached policy for one dynamic-fee v4 pool. Invalid, expired,
///         unavailable, or overly stale policy data falls back to a fixed LP fee.
/// @dev No inference runs here. `finalized == 1` is an assertion of the pinned
///      source, not a proof checked by this contract. No production inference
///      source is included. The full inputHash is recorded but its correspondence
///      to actual model features must be authenticated by that future source.
contract GH0STPolicyHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant SNAPSHOT_CAPACITY = 64;
    uint256 public constant POLICY_SOURCE_GAS = 60_000;
    uint256 private constant POLICY_ABI_BYTES = 320;

    enum Reason {
        Accepted,
        SourceUnavailable,
        NotFinalized,
        WrongPool,
        WrongModel,
        InvalidMetadata,
        NonceRollback,
        SnapshotMissing,
        SnapshotMismatch,
        SameBlockSnapshot,
        NotYetValid,
        Expired,
        WindowTooLong,
        TickDrift,
        FeeOutOfRange,
        SnapshotRollback,
        NonceReuseMismatch
    }

    struct Config {
        IPoolManager manager;
        IFinalizedPolicySource source;
        Currency currency0;
        Currency currency1;
        int24 tickSpacing;
        bytes32 modelHash;
        uint24 minimumFee;
        uint24 maximumFee;
        uint24 fallbackFee;
        uint24 maximumTickDrift;
        uint64 maximumPolicyAgeSeconds;
    }

    struct Snapshot {
        uint64 id;
        uint64 blockNumber;
        uint64 timestamp;
        int24 tick;
        bytes32 stateHash;
    }

    error InvalidConfiguration();
    error OnlyPoolManager();
    error WrongPoolKey();

    IPoolManager public immutable poolManager;
    IFinalizedPolicySource public immutable policySource;
    bytes32 public immutable modelHash;
    bytes32 public immutable poolId;
    uint24 public immutable minimumFee;
    uint24 public immutable maximumFee;
    uint24 public immutable fallbackFee;
    uint24 public immutable maximumTickDrift;
    uint64 public immutable maximumPolicyAgeSeconds;

    mapping(uint256 => Snapshot) private _snapshots;
    uint64 public latestSnapshotId;
    uint64 public latestSnapshotBlock;
    uint64 public lastAcceptedNonce;
    uint64 public lastAcceptedSnapshotId;
    bytes32 public lastAcceptedPolicyHash;

    event SnapshotRecorded(uint64 indexed id, uint64 indexed blockNumber, bytes32 stateHash, int24 tick);
    event PolicyApplied(bytes32 indexed poolId, uint64 indexed nonce, uint64 snapshotId, uint24 lpFee);
    event BaselineApplied(bytes32 indexed poolId, Reason reason, uint24 lpFee);

    constructor(Config memory config) {
        if (
            address(config.manager).code.length == 0 || address(config.source).code.length == 0
                || config.currency0 >= config.currency1 || config.tickSpacing <= 0
                || config.tickSpacing > 32767 || config.modelHash == bytes32(0)
                || config.minimumFee > config.fallbackFee || config.fallbackFee > config.maximumFee
                // Exact-output swaps cannot support a 100% LP fee.
                || config.maximumFee >= LPFeeLibrary.MAX_LP_FEE
                || config.maximumTickDrift == 0 || config.maximumTickDrift > 887272
                || config.maximumPolicyAgeSeconds == 0
        ) revert InvalidConfiguration();

        poolManager = config.manager;
        policySource = config.source;
        modelHash = config.modelHash;
        minimumFee = config.minimumFee;
        maximumFee = config.maximumFee;
        fallbackFee = config.fallbackFee;
        maximumTickDrift = config.maximumTickDrift;
        maximumPolicyAgeSeconds = config.maximumPolicyAgeSeconds;
        PoolKey memory key = PoolKey({
            currency0: config.currency0,
            currency1: config.currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: config.tickSpacing,
            hooks: IHooks(address(this))
        });
        poolId = PoolId.unwrap(key.toId());
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        onlyPoolManager
        returns (bytes4)
    {
        _checkPool(key);
        _recordSnapshot(tick);
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        (bool readable, IFinalizedPolicySource.Policy memory policy) = _readPolicy();
        Reason reason = readable ? _validate(policy) : Reason.SourceUnavailable;
        uint24 fee = fallbackFee;
        if (reason == Reason.Accepted) {
            uint64 nonce = uint64(policy.nonce);
            uint64 snapshotId = uint64(policy.snapshotId);
            fee = uint24(policy.lpFee);
            if (nonce > lastAcceptedNonce) {
                lastAcceptedNonce = nonce;
                lastAcceptedPolicyHash = keccak256(abi.encode(policy));
            }
            if (snapshotId > lastAcceptedSnapshotId) lastAcceptedSnapshotId = snapshotId;
            emit PolicyApplied(poolId, nonce, snapshotId, fee);
        } else {
            emit BaselineApplied(poolId, reason, fee);
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        _checkPool(key);
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        _recordSnapshot(tick);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @notice Onchain state marker, not proof of the complete time-series model input.
    /// @dev A ring entry survives up to 64 sampled blocks. Sampling is at most once
    ///      per block; this is not a manipulation-resistant market oracle.
    function snapshot(uint64 id) external view returns (Snapshot memory) {
        return _snapshots[id % SNAPSHOT_CAPACITY];
    }

    function quotePolicy() public view returns (uint24 fee, Reason reason, uint64 nonce, uint64 snapshotId) {
        (bool readable, IFinalizedPolicySource.Policy memory policy) = _readPolicy();
        if (!readable) return (fallbackFee, Reason.SourceUnavailable, 0, 0);
        reason = _validate(policy);
        if (reason != Reason.Accepted) return (fallbackFee, reason, 0, 0);
        return (uint24(policy.lpFee), Reason.Accepted, uint64(policy.nonce), uint64(policy.snapshotId));
    }

    function _validate(IFinalizedPolicySource.Policy memory policy) private view returns (Reason) {
        if (policy.finalized != 1) return Reason.NotFinalized;
        if (policy.poolId != poolId) return Reason.WrongPool;
        if (policy.modelHash != modelHash) return Reason.WrongModel;
        if (
            policy.inputHash == bytes32(0) || policy.nonce == 0 || policy.nonce > type(uint64).max
                || policy.snapshotId == 0 || policy.snapshotId > type(uint64).max
                || policy.notBefore > type(uint64).max || policy.expiresAt > type(uint64).max
                || policy.expiresAt <= policy.notBefore
        ) return Reason.InvalidMetadata;
        if (policy.nonce < lastAcceptedNonce) return Reason.NonceRollback;
        if (policy.nonce == lastAcceptedNonce && keccak256(abi.encode(policy)) != lastAcceptedPolicyHash) {
            return Reason.NonceReuseMismatch;
        }
        if (policy.snapshotId < lastAcceptedSnapshotId) return Reason.SnapshotRollback;
        Snapshot memory observation = _snapshots[policy.snapshotId % SNAPSHOT_CAPACITY];
        if (observation.id != policy.snapshotId) return Reason.SnapshotMissing;
        if (observation.stateHash != policy.snapshotHash) return Reason.SnapshotMismatch;
        if (observation.blockNumber >= block.number) return Reason.SameBlockSnapshot;
        if (policy.notBefore > block.timestamp) return Reason.NotYetValid;
        if (policy.expiresAt <= block.timestamp) return Reason.Expired;
        if (
            policy.notBefore < observation.timestamp || policy.expiresAt < observation.timestamp
                || policy.expiresAt - observation.timestamp > maximumPolicyAgeSeconds
        ) return Reason.WindowTooLong;
        (, int24 currentTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        int256 drift = int256(currentTick) - int256(observation.tick);
        if (drift < 0) drift = -drift;
        if (uint256(drift) > maximumTickDrift) return Reason.TickDrift;
        if (policy.lpFee < minimumFee || policy.lpFee > maximumFee) return Reason.FeeOutOfRange;
        return Reason.Accepted;
    }

    function _readPolicy() private view returns (bool readable, IFinalizedPolicySource.Policy memory policy) {
        bytes memory request = abi.encodeCall(IFinalizedPolicySource.latestPolicy, (poolId));
        bytes memory response = new bytes(POLICY_ABI_BYTES);
        address source = address(policySource);
        uint256 responseSize;
        // A failed, malformed, or gas-exhausting source cannot consume unlimited
        // caller gas or force allocation of an attacker-chosen return-data buffer.
        assembly ("memory-safe") {
            readable := staticcall(POLICY_SOURCE_GAS, source, add(request, 32), mload(request), add(response, 32), POLICY_ABI_BYTES)
            responseSize := returndatasize()
        }
        if (!readable || responseSize != POLICY_ABI_BYTES) return (false, policy);
        policy = abi.decode(response, (IFinalizedPolicySource.Policy));
    }

    function _recordSnapshot(int24 tick) private {
        if (latestSnapshotId != 0 && block.number == latestSnapshotBlock) return;
        uint64 id = latestSnapshotId + 1;
        uint64 blockNumber = uint64(block.number);
        uint64 timestamp = uint64(block.timestamp);
        bytes32 stateHash = keccak256(abi.encode(block.chainid, address(this), poolId, modelHash, id, blockNumber, timestamp, tick));
        _snapshots[id % SNAPSHOT_CAPACITY] = Snapshot(id, blockNumber, timestamp, tick, stateHash);
        latestSnapshotId = id;
        latestSnapshotBlock = blockNumber;
        emit SnapshotRecorded(id, blockNumber, stateHash, tick);
    }

    function _checkPool(PoolKey calldata key) private view {
        if (PoolId.unwrap(key.toId()) != poolId) revert WrongPoolKey();
    }
}
