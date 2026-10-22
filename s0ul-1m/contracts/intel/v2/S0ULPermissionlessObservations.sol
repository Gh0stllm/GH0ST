// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULIntelTypes as T} from "../S0ULIntelTypes.sol";

/// @notice Permissionless same-chain inspection and bounded, code-pinned observation history.
/// @dev Getter compatibility is not token authenticity or a security audit. A proxy's
/// runtime hash does not pin its implementation. No names, symbols or caller metrics are trusted.
contract S0ULPermissionlessObservations {
    uint256 public constant RING_SIZE = 16;
    uint256 public constant MAX_WATCHES = 64;
    uint256 public constant READ_GAS = 50_000;
    // Retained only for clients reading the V1 observations interface. There is no owner role.
    address public constant owner = address(0);
    uint32 public immutable minSpacing;
    uint32 public immutable maxAge;
    uint256 public subjectCount;

    // Compatible-kind bits: 1=supply getter, 2=account balance getters, 4=V2-style pool getters.
    // Probe statuses: 0=Ok, 1=NoCode, 2=CallFailed, 3=Malformed, 4=OutOfRange, 5=NotRequested.
    struct Inspection {
        address target;
        address account;
        uint256 nativeBalance;
        uint256 codeSize;
        bytes32 codeHash;
        uint64 observedAt;
        uint64 evmBlockNumber;
        uint8 compatibleKinds;
        uint8 preferredKind;
        uint8 supplyStatus;
        uint8 balanceStatus;
        uint8 poolStatus;
        address asset0;
        address asset1;
        uint128[4] supplyValues;
        uint128[4] balanceValues;
        uint128[4] poolValues;
    }

    mapping(uint256 => T.Subject) private _subjects;
    mapping(uint256 => mapping(uint256 => T.Snapshot)) private _samples;
    mapping(bytes32 => uint256) public keyToSubject;
    mapping(address => uint256[]) private _watchlists;
    mapping(address => mapping(uint256 => uint256)) private _watchIndex;
    bool private _entered;

    error InvalidConfiguration();
    error InvalidSubject();
    error UnknownSubject();
    error InvalidLookback();
    error SampleUnavailable();
    error WatchLimit();
    error NotWatching();
    error InsufficientGas();
    error Reentrant();

    event SubjectRegistered(uint256 indexed subjectId, uint8 kind, address indexed target,
        address account, bytes32 codeHash, address asset0, address asset1);
    event WatchAdded(address indexed watcher, uint256 indexed subjectId, bytes32 indexed key);
    event WatchRemoved(address indexed watcher, uint256 indexed subjectId);
    event SnapshotStored(uint256 indexed subjectId, uint64 indexed sequence,
        bytes32 indexed snapshotHash, uint64 timestamp, uint64 blockNumber, uint128[4] values);
    event SnapshotRejected(uint256 indexed subjectId, uint8 status, uint64 currentSequence);

    modifier nonReentrant() {
        if (_entered) revert Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(uint32 minSpacing_, uint32 maxAge_) {
        if (minSpacing_ == 0 || minSpacing_ > 86400 || maxAge_ < minSpacing_
            || maxAge_ > 86400) revert InvalidConfiguration();
        minSpacing = minSpacing_;
        maxAge = maxAge_;
    }

    /// @notice Read current facts without registering, storing history, or trusting supplied metrics.
    /// A zero account omits the balance probe. Pool getters take detection priority over LP ERC20 getters.
    function inspect(address target, address account) public view returns (Inspection memory f) {
        if (block.timestamp > type(uint64).max || block.number > type(uint64).max)
            revert InvalidConfiguration();
        f.target = target;
        f.account = account;
        f.nativeBalance = target.balance;
        f.codeSize = target.code.length;
        f.codeHash = target.codehash;
        f.observedAt = uint64(block.timestamp);
        // Nitro's Solidity block.number is an ancestor-chain estimate, not the RPC L2 block number.
        f.evmBlockNumber = uint64(block.number);
        if (f.codeSize == 0) {
            f.supplyStatus = 1; f.balanceStatus = 1; f.poolStatus = 1;
            return f;
        }
        T.Subject memory s;
        s.enabled = true;
        s.target = target;
        s.codeHash = f.codeHash;
        T.ReadStatus status;
        s.kind = T.ReaderKind.ERC20Supply;
        (status, f.supplyValues) = _read(s);
        f.supplyStatus = _probeStatus(status);
        if (status == T.ReadStatus.Ok) f.compatibleKinds |= 1;
        else delete f.supplyValues;
        if (account != address(0)) {
            s.kind = T.ReaderKind.ERC20Balance;
            s.account = account;
            (status, f.balanceValues) = _read(s);
            f.balanceStatus = _probeStatus(status);
            if (status == T.ReadStatus.Ok) f.compatibleKinds |= 2;
            else delete f.balanceValues;
        } else f.balanceStatus = 5;
        (status, f.asset0, f.asset1) = _metadata(target);
        if (status == T.ReadStatus.Ok) {
            s.kind = T.ReaderKind.UniswapV2;
            s.account = address(0);
            s.asset0 = f.asset0;
            s.asset1 = f.asset1;
            (status, f.poolValues) = _read(s);
        }
        f.poolStatus = _probeStatus(status);
        if (status == T.ReadStatus.Ok) f.compatibleKinds |= 4;
        else delete f.poolValues;
        f.preferredKind = (f.compatibleKinds & 4) != 0 ? 3
            : (f.compatibleKinds & 2) != 0 ? 2 : (f.compatibleKinds & 1) != 0 ? 1 : 0;
    }

    /// @notice Fixed factual commentary assembled entirely from this call's on-chain observations.
    function inspectText(address target, address account) external view returns (string memory) {
        Inspection memory f = inspect(target, account);
        string memory text = string.concat("S0UL address inspection. Target ", _hex(uint160(target), 20),
            ". Native balance ", _uint(f.nativeBalance), " wei. Runtime bytes ", _uint(f.codeSize), ". ");
        if (f.codeSize == 0) return string.concat(text,
            "No runtime bytecode is present; this does not establish account type. No token or pool compatibility is asserted.");
        text = string.concat(text, "Runtime code hash ", _hex(uint256(f.codeHash), 32),
            ". Supply reader: ", _probeName(f.supplyStatus), ". Account balance reader: ",
            _probeName(f.balanceStatus), ". V2-style pool reader: ", _probeName(f.poolStatus), ". ");
        if ((f.compatibleKinds & 4) != 0) text = string.concat(text, "Pool reserves ",
            _uint(f.poolValues[0]), " and ", _uint(f.poolValues[1]), "; LP supply ",
            _uint(f.poolValues[2]), " raw integer units. ");
        else if ((f.compatibleKinds & 1) != 0) text = string.concat(text,
            "Supply getter returned ", _uint(f.supplyValues[0]), " raw integer units. ");
        if ((f.compatibleKinds & 2) != 0) text = string.concat(text, "Account ",
            _hex(uint160(account), 20), " balance getter returned ", _uint(f.balanceValues[0]),
            " raw integer units. ");
        return string.concat(text, "Compatible getters may be implemented or spoofed by arbitrary contracts. ",
            "This is not a security audit, asset authenticity check, price, volume or forecast.");
    }

    function subjectKey(uint8 kind, address target, address account, bytes32 codeHash)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(kind, target, account, codeHash));
    }

    /// @notice Join a shared code-pinned history. A new subject also captures its validated baseline.
    /// Existing subjects are never resampled by joining, so one watcher cannot reset another's history.
    function watch(uint8 kind, address target, address account, bytes32 expectedCodeHash)
        external nonReentrant returns (uint256 id)
    {
        if (kind < 1 || kind > 3 || target.code.length == 0 || expectedCodeHash == 0
            || target.codehash != expectedCodeHash
            || (kind == 2 ? account == address(0) : account != address(0))) revert InvalidSubject();
        bytes32 key = subjectKey(kind, target, account, expectedCodeHash);
        id = keyToSubject[key];
        if (id != 0) {
            // Joining never records a sample, but still revalidates the current getters
            // and originally pinned pool metadata, including behind unchanged proxy bytecode.
            (T.ReadStatus joinStatus,) = _read(_subjects[id]);
            if (joinStatus != T.ReadStatus.Ok) revert InvalidSubject();
            if (_watchIndex[msg.sender][id] != 0) return id;
        }
        if (_watchlists[msg.sender].length >= MAX_WATCHES) revert WatchLimit();
        if (id == 0) {
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
            (T.ReadStatus status, uint128[4] memory values) = _read(s);
            if (status != T.ReadStatus.Ok) revert InvalidSubject();
            id = ++subjectCount;
            keyToSubject[key] = id;
            _subjects[id] = s;
            emit SubjectRegistered(id, kind, target, account, expectedCodeHash, s.asset0, s.asset1);
            _storeSnapshot(id, _subjects[id], values);
        }
        _watchlists[msg.sender].push(id);
        _watchIndex[msg.sender][id] = _watchlists[msg.sender].length;
        emit WatchAdded(msg.sender, id, key);
    }

    function watchlist(address watcher) external view returns (uint256[] memory) {
        return _watchlists[watcher];
    }
    function watchCount(address watcher) external view returns (uint256) {
        return _watchlists[watcher].length;
    }
    function isWatching(address watcher, uint256 id) external view returns (bool) {
        return _watchIndex[watcher][id] != 0;
    }
    function unwatch(uint256 id) external nonReentrant {
        uint256 position = _watchIndex[msg.sender][id];
        if (position == 0) revert NotWatching();
        uint256[] storage list = _watchlists[msg.sender];
        uint256 last = list[list.length - 1];
        list[position - 1] = last;
        _watchIndex[msg.sender][last] = position;
        list.pop();
        delete _watchIndex[msg.sender][id];
        emit WatchRemoved(msg.sender, id);
    }

    /// @notice Anyone may fund a sample. A failed reader never inserts fabricated history.
    function snapshot(uint256 id) external nonReentrant returns (uint8 status, uint64 sequence) {
        T.Subject storage s = _known(id);
        T.Snapshot storage previous = _samples[id][(uint256(s.sequence) - 1) % RING_SIZE];
        if (block.timestamp < uint256(previous.timestamp) + minSpacing) {
            emit SnapshotRejected(id, uint8(T.ReadStatus.TooSoon), s.sequence);
            return (uint8(T.ReadStatus.TooSoon), s.sequence);
        }
        (T.ReadStatus readStatus, uint128[4] memory values) = _read(s);
        if (readStatus != T.ReadStatus.Ok) {
            s.lastStatus = readStatus;
            emit SnapshotRejected(id, uint8(readStatus), s.sequence);
            return (uint8(readStatus), s.sequence);
        }
        sequence = _storeSnapshot(id, s, values);
        return (uint8(T.ReadStatus.Ok), sequence);
    }

    function _storeSnapshot(uint256 id, T.Subject storage s, uint128[4] memory values)
        private returns (uint64 sequence)
    {
        if (block.timestamp > type(uint64).max || block.number > type(uint64).max)
            revert InvalidConfiguration();
        sequence = s.sequence + 1;
        // On Nitro these fields retain EVM counter/BLOCKHASH semantics; neither is an RPC L2 parent hash.
        T.Snapshot memory sample = T.Snapshot(sequence, uint64(block.timestamp), uint64(block.number),
            block.number == 0 ? bytes32(0) : blockhash(block.number - 1), values);
        _samples[id][(uint256(sequence) - 1) % RING_SIZE] = sample;
        s.sequence = sequence;
        s.lastStatus = T.ReadStatus.Ok;
        emit SnapshotStored(id, sequence, _hash(id, s, sample), sample.timestamp, sample.blockNumber, values);
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

    function _probeStatus(T.ReadStatus status) private pure returns (uint8) {
        if (status == T.ReadStatus.Ok) return 0;
        if (status == T.ReadStatus.CodeChanged) return 1;
        if (status == T.ReadStatus.CallFailed) return 2;
        if (status == T.ReadStatus.OutOfRange) return 4;
        return 3;
    }
    function _probeName(uint8 status) private pure returns (string memory) {
        return status == 0 ? "compatible" : status == 1 ? "no runtime code"
            : status == 2 ? "getter call failed" : status == 3 ? "unrecognized or malformed getters"
            : status == 4 ? "outside supported numeric range" : "not requested";
    }
    function _uint(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 n = value;
        uint256 length;
        while (n != 0) { ++length; n /= 10; }
        bytes memory out = new bytes(length);
        while (value != 0) { out[--length] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(out);
    }
    function _hex(uint256 value, uint256 length) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(2 + length * 2);
        out[0] = "0"; out[1] = "x";
        for (uint256 i = out.length; i > 2;) { out[--i] = alphabet[value & 15]; value >>= 4; }
        return string(out);
    }
}
