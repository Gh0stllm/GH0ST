// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IGL3AccumulatorBridge {
    function sequencerMessageCount() external view returns (uint256);
    function delayedMessageCount() external view returns (uint256);
    function sequencerInboxAccs(uint256 index) external view returns (bytes32);
    function delayedInboxAccs(uint256 index) external view returns (bytes32);
}

abstract contract GL3DataRegistry {
    bytes32 public constant SEQUENCER_RANGE_DOMAIN = keccak256("GH0ST_GL3_SEQ_RANGE_V1");
    bytes32 public constant DELAYED_RANGE_DOMAIN = keccak256("GH0ST_GL3_DELAY_RANGE_V1");
    uint256 public constant MAX_WIRE_BYTES = 131072;

    struct SequencerRecord {
        bytes32 wireHash;
        bytes32 beforeAccumulator;
        bytes32 afterAccumulator;
        bytes32 delayedAccumulator;
        uint64 afterDelayedCount;
        bool registered;
    }

    struct DelayedRecord {
        bytes32 wireHash;
        bytes32 messageHash;
        bytes32 beforeAccumulator;
        bytes32 afterAccumulator;
        bool registered;
    }

    mapping(uint64 => SequencerRecord) public sequencerRecords;
    mapping(uint64 => DelayedRecord) public delayedRecords;
    mapping(uint64 => bytes32) public sequencerPrefixAfter;
    mapping(uint64 => bytes32) public delayedPrefixAfter;
    uint64 public registeredSequencerCount;
    uint64 public registeredDelayedCount;

    error Unsealed();
    error InvalidWire();
    error UnsupportedDataAvailability();
    error UnknownInboxIndex();
    error AccumulatorMismatch();
    error ConflictingRegistration();
    error MissingData(uint64 index);
    error InvalidRange();
    error NoncontiguousRegistration();

    // Raw bytes are published in transaction calldata; only commitments are stored.
    event SequencerDataRegistered(uint64 indexed index, bytes32 indexed wireHash);
    event DelayedDataRegistered(uint64 indexed index, bytes32 indexed wireHash);

    function _registryBridge() internal view virtual returns (IGL3AccumulatorBridge);
    function _registryDomain() internal view virtual returns (bytes32);
    function _registrySealed() internal view virtual returns (bool);

    function registerSequencerData(uint64 index, bytes calldata wire) external {
        if (!_registrySealed()) revert Unsealed();
        if (wire.length < 40 || wire.length > MAX_WIRE_BYTES) revert InvalidWire();
        // Header-only force inclusion and ordinary calldata/Brotli are supported.
        if (wire.length != 40 && uint8(wire[40]) != 0) revert UnsupportedDataAvailability();
        IGL3AccumulatorBridge bridge = _registryBridge();
        if (uint256(index) >= bridge.sequencerMessageCount()) revert UnknownInboxIndex();
        uint64 delayedCount = uint64(bytes8(wire[32:40]));
        if (uint256(delayedCount) > bridge.delayedMessageCount()) revert UnknownInboxIndex();
        bytes32 delayedAcc = delayedCount == 0 ? bytes32(0) : bridge.delayedInboxAccs(delayedCount - 1);
        bytes32 beforeAcc = index == 0 ? bytes32(0) : bridge.sequencerInboxAccs(index - 1);
        bytes32 wireHash = keccak256(wire);
        bytes32 afterAcc = keccak256(abi.encodePacked(beforeAcc, wireHash, delayedAcc));
        if (afterAcc != bridge.sequencerInboxAccs(index)) revert AccumulatorMismatch();
        SequencerRecord storage record = sequencerRecords[index];
        if (record.registered) {
            if (record.wireHash != wireHash) revert ConflictingRegistration();
            return;
        }
        if (index != registeredSequencerCount || index == type(uint64).max)
            revert NoncontiguousRegistration();
        record.wireHash = wireHash;
        record.beforeAccumulator = beforeAcc;
        record.afterAccumulator = afterAcc;
        record.delayedAccumulator = delayedAcc;
        record.afterDelayedCount = delayedCount;
        record.registered = true;
        bytes32 prefixBefore = index == 0 ?
            keccak256(abi.encode(SEQUENCER_RANGE_DOMAIN, _registryDomain())) : sequencerPrefixAfter[index - 1];
        sequencerPrefixAfter[index] = keccak256(abi.encode(prefixBefore, index, wireHash,
            beforeAcc, afterAcc, delayedCount, delayedAcc));
        registeredSequencerCount = index + 1;
        emit SequencerDataRegistered(index, wireHash);
    }

    function registerDelayedData(uint64 index, bytes calldata wire) external {
        if (!_registrySealed()) revert Unsealed();
        if (wire.length < 113 || wire.length > MAX_WIRE_BYTES) revert InvalidWire();
        IGL3AccumulatorBridge bridge = _registryBridge();
        if (uint256(index) >= bridge.delayedMessageCount()) revert UnknownInboxIndex();
        uint256 senderWord = uint256(bytes32(wire[1:33]));
        if (senderWord >> 160 != 0) revert InvalidWire();
        uint256 encodedIndex = uint256(bytes32(wire[49:81]));
        if (encodedIndex != uint256(index)) revert InvalidWire();
        bytes32 messageHash = keccak256(abi.encodePacked(
            uint8(wire[0]), address(uint160(senderWord)),
            uint64(bytes8(wire[33:41])), uint64(bytes8(wire[41:49])),
            encodedIndex, uint256(bytes32(wire[81:113])), keccak256(wire[113:])
        ));
        bytes32 beforeAcc = index == 0 ? bytes32(0) : bridge.delayedInboxAccs(index - 1);
        bytes32 afterAcc = keccak256(abi.encodePacked(beforeAcc, messageHash));
        if (afterAcc != bridge.delayedInboxAccs(index)) revert AccumulatorMismatch();
        bytes32 wireHash = keccak256(wire);
        DelayedRecord storage record = delayedRecords[index];
        if (record.registered) {
            if (record.wireHash != wireHash) revert ConflictingRegistration();
            return;
        }
        if (index != registeredDelayedCount || index == type(uint64).max)
            revert NoncontiguousRegistration();
        record.wireHash = wireHash;
        record.messageHash = messageHash;
        record.beforeAccumulator = beforeAcc;
        record.afterAccumulator = afterAcc;
        record.registered = true;
        bytes32 prefixBefore = index == 0 ?
            keccak256(abi.encode(DELAYED_RANGE_DOMAIN, _registryDomain())) : delayedPrefixAfter[index - 1];
        delayedPrefixAfter[index] = keccak256(abi.encode(prefixBefore, index, wireHash,
            messageHash, beforeAcc, afterAcc));
        registeredDelayedCount = index + 1;
        emit DelayedDataRegistered(index, wireHash);
    }

    function sequencerRangeCommitment(uint64 start, uint64 end) public view returns (bytes32 value) {
        if (!_registrySealed()) revert Unsealed();
        if (end < start) revert InvalidRange();
        if (end > registeredSequencerCount) revert MissingData(registeredSequencerCount);
        bytes32 seed = keccak256(abi.encode(SEQUENCER_RANGE_DOMAIN, _registryDomain()));
        bytes32 beforePrefix = start == 0 ? seed : sequencerPrefixAfter[start - 1];
        bytes32 afterPrefix = end == 0 ? seed : sequencerPrefixAfter[end - 1];
        value = keccak256(abi.encode(SEQUENCER_RANGE_DOMAIN, _registryDomain(), start, end,
            beforePrefix, afterPrefix));
    }

    function delayedRangeCommitment(uint64 start, uint64 end) public view returns (bytes32 value) {
        if (!_registrySealed()) revert Unsealed();
        if (end < start) revert InvalidRange();
        if (end > registeredDelayedCount) revert MissingData(registeredDelayedCount);
        bytes32 seed = keccak256(abi.encode(DELAYED_RANGE_DOMAIN, _registryDomain()));
        bytes32 beforePrefix = start == 0 ? seed : delayedPrefixAfter[start - 1];
        bytes32 afterPrefix = end == 0 ? seed : delayedPrefixAfter[end - 1];
        value = keccak256(abi.encode(DELAYED_RANGE_DOMAIN, _registryDomain(), start, end,
            beforePrefix, afterPrefix));
    }
}
