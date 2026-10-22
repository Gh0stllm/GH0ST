// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULIntelTypes as T} from "./S0ULIntelTypes.sol";

/// @notice Bounded observations read directly from explicitly registered same-chain contracts.
/// @dev Callers supply an ID, never a metric. Raw token units and reserve ratios
/// do not imply USD prices, trading volume, holder enumeration or a security audit.
contract S0ULObservations {
    uint256 public constant RING_SIZE = 16;
    uint256 public constant MAX_SUBJECTS = 256;
    uint256 public constant READ_GAS = 50_000;
    address public immutable owner;
    uint32 public immutable minSpacing;
    uint32 public immutable maxAge;
    uint256 public subjectCount;

    mapping(uint256 => T.Subject) private _subjects;
    mapping(uint256 => mapping(uint256 => T.Snapshot)) private _samples;
    bool private _entered;

    error NotOwner();
    error InvalidConfiguration();
    error InvalidSubject();
    error UnknownSubject();
    error InvalidLookback();
    error SampleUnavailable();
    error InsufficientGas();
    error Reentrant();

    event SubjectRegistered(uint256 indexed subjectId, uint8 kind, address indexed target,
        address account, bytes32 codeHash, address asset0, address asset1);
    event SubjectEnabled(uint256 indexed subjectId, bool enabled);
    event SnapshotStored(uint256 indexed subjectId, uint64 indexed sequence,
        bytes32 indexed snapshotHash, uint64 timestamp, uint64 blockNumber, uint128[4] values);
    event SnapshotRejected(uint256 indexed subjectId, uint8 status, uint64 currentSequence);

    modifier nonReentrant() {
        if (_entered) revert Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address owner_, uint32 minSpacing_, uint32 maxAge_) {
        if (owner_ == address(0) || minSpacing_ == 0 || minSpacing_ > 86400
            || maxAge_ < minSpacing_ || maxAge_ > 86400) revert InvalidConfiguration();
        owner = owner_;
        minSpacing = minSpacing_;
        maxAge = maxAge_;
    }

    /// @notice The registry owner explicitly selects a target and its expected runtime.
    /// Code identity pins the target's runtime, not any implementation hidden behind a proxy.
    function registerSubject(uint8 kind, address target, address account, bytes32 expectedCodeHash)
        external nonReentrant returns (uint256 id)
    {
        if (msg.sender != owner) revert NotOwner();
        if (kind < 1 || kind > 3 || target.code.length == 0 || expectedCodeHash == 0
            || target.codehash != expectedCodeHash || subjectCount >= MAX_SUBJECTS
            || (kind == 2 ? account == address(0) : account != address(0))) revert InvalidSubject();
        T.Subject memory s;
        s.kind = T.ReaderKind(kind);
        s.enabled = true;
        s.target = target;
        s.account = account;
        s.codeHash = expectedCodeHash;
        s.asset0 = target;
        if (kind == 3) {
            (T.ReadStatus metadataStatus, address asset0, address asset1) = _metadata(target);
            if (metadataStatus != T.ReadStatus.Ok) revert InvalidSubject();
            s.asset0 = asset0;
            s.asset1 = asset1;
        }
        (T.ReadStatus status,) = _read(s);
        if (status != T.ReadStatus.Ok) revert InvalidSubject();
        id = ++subjectCount;
        _subjects[id] = s;
        emit SubjectRegistered(id, kind, target, account, expectedCodeHash, s.asset0, s.asset1);
    }

    function setEnabled(uint256 id, bool enabled) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        T.Subject storage s = _known(id);
        s.enabled = enabled;
        emit SubjectEnabled(id, enabled);
    }

    /// @notice Anyone may fund a fresh sample; getter failure never inserts fabricated facts.
    function snapshot(uint256 id) external nonReentrant returns (uint8 status, uint64 sequence) {
        T.Subject storage s = _known(id);
        if (s.sequence != 0) {
            T.Snapshot storage previous = _samples[id][(uint256(s.sequence) - 1) % RING_SIZE];
            if (block.timestamp < uint256(previous.timestamp) + minSpacing) {
                emit SnapshotRejected(id, uint8(T.ReadStatus.TooSoon), s.sequence);
                return (uint8(T.ReadStatus.TooSoon), s.sequence);
            }
        }
        (T.ReadStatus readStatus, uint128[4] memory values) = _read(s);
        if (readStatus != T.ReadStatus.Ok) {
            s.lastStatus = readStatus;
            emit SnapshotRejected(id, uint8(readStatus), s.sequence);
            return (uint8(readStatus), s.sequence);
        }
        if (block.timestamp > type(uint64).max || block.number > type(uint64).max)
            revert InvalidConfiguration();
        sequence = s.sequence + 1;
        T.Snapshot memory sample = T.Snapshot(sequence, uint64(block.timestamp), uint64(block.number),
            block.number == 0 ? bytes32(0) : blockhash(block.number - 1), values);
        _samples[id][(uint256(sequence) - 1) % RING_SIZE] = sample;
        s.sequence = sequence;
        s.lastStatus = T.ReadStatus.Ok;
        bytes32 digest = _hash(id, s, sample);
        emit SnapshotStored(id, sequence, digest, sample.timestamp, sample.blockNumber, values);
        return (uint8(T.ReadStatus.Ok), sequence);
    }

    function subject(uint256 id) external view returns (T.Subject memory) { return _known(id); }
    function latest(uint256 id) external view returns (T.Snapshot memory) {
        T.Subject storage s = _known(id);
        return _sampleAt(id, s.sequence, s.sequence);
    }
    function sampleAt(uint256 id, uint64 sequence) external view returns (T.Snapshot memory) {
        return _sampleAt(id, sequence, _known(id).sequence);
    }
    function snapshotHash(uint256 id, uint64 sequence) external view returns (bytes32) {
        T.Subject storage s = _known(id);
        return _hash(id, s, _sampleAt(id, sequence, s.sequence));
    }

    /// @notice Features derive only from this contract's own retained snapshots.
    function features(uint256 id, uint8 lookback) external view returns (T.FeatureFrame memory f) {
        if (lookback == 0 || lookback >= RING_SIZE) revert InvalidLookback();
        T.Subject storage s = _known(id);
        f.subjectId = id;
        f.kind = s.kind;
        f.vector[6] = int32(uint32(uint8(s.kind)));
        if (s.sequence == 0) { f.status = T.ReadStatus.NoSamples; return f; }
        f.current = _sampleAt(id, s.sequence, s.sequence);
        f.currentHash = _hash(id, s, f.current);
        f.fresh = block.timestamp >= f.current.timestamp
            && block.timestamp - f.current.timestamp <= maxAge;
        bool codeOk = s.target.code.length != 0 && s.target.codehash == s.codeHash;
        bool readerOk = s.enabled && codeOk && s.lastStatus == T.ReadStatus.Ok;
        if (f.fresh) f.flags |= T.FLAG_FRESH;
        if (readerOk) f.flags |= T.FLAG_READER_OK;
        if (s.sequence > lookback) {
            f.previous = _sampleAt(id, s.sequence - lookback, s.sequence);
            f.previousHash = _hash(id, s, f.previous);
            f.hasHistory = true;
            f.flags |= T.FLAG_HISTORY;
            uint256 elapsed = uint256(f.current.timestamp) - f.previous.timestamp;
            f.elapsedSeconds = elapsed > type(uint32).max ? type(uint32).max : uint32(elapsed);
            f.vector[5] = elapsed > 86400 ? int32(86400) : int32(uint32(elapsed));
            uint256 fields = s.kind == T.ReaderKind.ERC20Supply ? 1
                : s.kind == T.ReaderKind.ERC20Balance ? 2 : 3;
            for (uint256 i; i < fields; ++i) {
                (int32 change, bool zero, bool clipped) = _change(f.current.values[i], f.previous.values[i]);
                f.vector[i] = change;
                if (zero) f.flags |= T.FLAG_ZERO_BASELINE;
                if (clipped) f.flags |= T.FLAG_CLIPPED;
            }
            if (s.kind == T.ReaderKind.UniswapV2) {
                // Products of uint112 reserves fit uint224; the 10000 multiplier
                // remains below uint256. This is a reserve ratio, not a USD price.
                uint256 newer = uint256(f.current.values[1]) * f.previous.values[0];
                uint256 older = uint256(f.previous.values[1]) * f.current.values[0];
                (int32 change, bool zero, bool clipped) = _change(newer, older);
                f.vector[3] = change;
                if (zero || f.current.values[0] == 0 || f.previous.values[0] == 0)
                    f.flags |= T.FLAG_ZERO_BASELINE;
                if (clipped) f.flags |= T.FLAG_CLIPPED;
            }
        }
        if (s.kind == T.ReaderKind.ERC20Balance) {
            if (f.current.values[1] == 0) f.flags |= T.FLAG_ZERO_BASELINE;
            else f.vector[4] = int32(uint32(uint256(f.current.values[0]) * 10000 / f.current.values[1]));
        }
        if (!s.enabled) f.status = T.ReadStatus.Disabled;
        else if (!codeOk) f.status = T.ReadStatus.CodeChanged;
        else if (s.lastStatus != T.ReadStatus.Ok) f.status = s.lastStatus;
        else if (!f.hasHistory) f.status = T.ReadStatus.NoHistory;
        else if (!f.fresh) f.status = T.ReadStatus.Stale;
        else f.status = T.ReadStatus.Ok;
        f.vector[7] = int32(uint32(f.flags));
    }

    function _read(T.Subject memory s) private view returns (T.ReadStatus status, uint128[4] memory values) {
        if (!s.enabled) return (T.ReadStatus.Disabled, values);
        if (s.target.code.length == 0 || s.target.codehash != s.codeHash)
            return (T.ReadStatus.CodeChanged, values);
        uint256 a;
        uint256 b;
        uint256 c;
        if (s.kind == T.ReaderKind.UniswapV2) {
            (T.ReadStatus metadataStatus, address asset0, address asset1) = _metadata(s.target);
            if (metadataStatus != T.ReadStatus.Ok) return (metadataStatus, values);
            if (asset0 != s.asset0 || asset1 != s.asset1) return (T.ReadStatus.MetadataChanged, values);
            (status, a, b, c) = _words(s.target, 0x0902f1ac, 0, false, 96);
            if (status != T.ReadStatus.Ok) return (status, values);
            if (a > type(uint112).max || b > type(uint112).max || c > type(uint32).max)
                return (T.ReadStatus.OutOfRange, values);
            values[0] = uint128(a); values[1] = uint128(b); values[3] = uint128(c);
            (status, a,,) = _words(s.target, 0x18160ddd, 0, false, 32);
            if (status != T.ReadStatus.Ok) return (status, values);
            if (a > type(uint128).max) return (T.ReadStatus.OutOfRange, values);
            values[2] = uint128(a);
        } else {
            (status, a,,) = _words(s.target, 0x18160ddd, 0, false, 32);
            if (status != T.ReadStatus.Ok) return (status, values);
            if (a > type(uint128).max) return (T.ReadStatus.OutOfRange, values);
            if (s.kind == T.ReaderKind.ERC20Supply) values[0] = uint128(a);
            else {
                values[1] = uint128(a);
                (status, b,,) = _words(s.target, 0x70a08231, uint256(uint160(s.account)), true, 32);
                if (status != T.ReadStatus.Ok) return (status, values);
                if (b > type(uint128).max) return (T.ReadStatus.OutOfRange, values);
                if (b > a) return (T.ReadStatus.Malformed, values);
                values[0] = uint128(b);
            }
        }
        return (T.ReadStatus.Ok, values);
    }

    function _metadata(address target) private view returns (T.ReadStatus status, address asset0, address asset1) {
        uint256 a;
        uint256 b;
        (status, a,,) = _words(target, 0x0dfe1681, 0, false, 32);
        if (status != T.ReadStatus.Ok) return (status, address(0), address(0));
        (status, b,,) = _words(target, 0xd21220a7, 0, false, 32);
        if (status != T.ReadStatus.Ok) return (status, address(0), address(0));
        if (a > type(uint160).max || b > type(uint160).max) return (T.ReadStatus.Malformed, address(0), address(0));
        asset0 = address(uint160(a)); asset1 = address(uint160(b));
        if (asset0 == address(0) || asset1 == address(0) || asset0 == asset1
            || asset0.code.length == 0 || asset1.code.length == 0)
            return (T.ReadStatus.Malformed, address(0), address(0));
        return (T.ReadStatus.Ok, asset0, asset1);
    }

    function _words(address target, uint32 selector, uint256 argument, bool withArgument, uint256 expectedSize)
        private view returns (T.ReadStatus status, uint256 a, uint256 b, uint256 c)
    {
        // Guarantee the fixed call budget under EIP-150. Underfunded callers
        // revert instead of persisting a fabricated getter-failure status.
        if (gasleft() < 80_000) revert InsufficientGas();
        bool ok;
        uint256 size;
        uint256 inputSize = withArgument ? 36 : 4;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, selector))
            mstore(add(ptr, 4), argument)
            ok := staticcall(50000, target, ptr, inputSize, ptr, 96)
            size := returndatasize()
            a := mload(ptr)
            b := mload(add(ptr, 32))
            c := mload(add(ptr, 64))
        }
        if (!ok) return (T.ReadStatus.CallFailed, 0, 0, 0);
        if (size != expectedSize) return (T.ReadStatus.Malformed, 0, 0, 0);
        return (T.ReadStatus.Ok, a, b, c);
    }

    function _change(uint256 current, uint256 previous) private pure returns (int32 result, bool zero, bool clipped) {
        if (previous == 0) return (current == 0 ? int32(0) : int32(10000), true, current != 0);
        bool increasing = current >= previous;
        uint256 difference = increasing ? current - previous : previous - current;
        uint256 bps = difference * 10000 / previous;
        clipped = bps > 10000;
        if (clipped) bps = 10000;
        result = increasing ? int32(uint32(bps)) : -int32(uint32(bps));
    }

    function _known(uint256 id) private view returns (T.Subject storage s) {
        s = _subjects[id];
        if (id == 0 || s.target == address(0)) revert UnknownSubject();
    }
    function _sampleAt(uint256 id, uint64 sequence, uint64 latestSequence) private view returns (T.Snapshot memory s) {
        if (sequence == 0 || sequence > latestSequence || uint256(latestSequence - sequence) >= RING_SIZE)
            revert SampleUnavailable();
        s = _samples[id][(uint256(sequence) - 1) % RING_SIZE];
        if (s.sequence != sequence) revert SampleUnavailable();
    }
    function _hash(uint256 id, T.Subject memory s, T.Snapshot memory sample) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, s.kind, s.target, s.account,
            s.codeHash, s.asset0, s.asset1, sample));
    }
}
