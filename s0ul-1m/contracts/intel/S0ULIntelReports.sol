// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULIntelTypes as T} from "./S0ULIntelTypes.sol";

interface IS0ULObservations {
    function snapshot(uint256 id) external returns (T.ReadStatus status, uint64 sequence);
    function features(uint256 id, uint8 lookback) external view returns (T.FeatureFrame memory);
}

interface IS0ULIntelClassifier {
    function modelId() external view returns (bytes32);
    function trainingManifestHash() external view returns (bytes32);
    function classify(int32[8] calldata vector) external view returns (uint8 label, int256[6] memory scores);
}

/// @notice Public, factual intelligence records derived entirely from pinned on-chain readers.
/// @dev Callers provide identifiers only. This extension is separate from the S0UL-1M language model.
contract S0ULIntelReports {
    error InvalidConfiguration();
    error DependencyChanged();
    error InvalidObservation(uint8 status);
    error InvalidClassification();
    error DuplicateReport();
    error UnknownReport();

    struct Report {
        uint256 subjectId;
        uint64 currentSequence;
        uint64 previousSequence;
        uint64 observedBlock;
        uint64 createdBlock;
        uint64 createdAt;
        bytes32 currentHash;
        bytes32 previousHash;
        bytes32 featureHash;
        bytes32 modelId;
        uint8 label;
        int32[8] features;
        int256[6] scores;
        uint128[4] currentValues;
        uint128[4] previousValues;
        uint8 flags;
        uint64 observedAt;
        uint64 previousObservedAt;
        uint32 elapsedSeconds;
    }

    IS0ULObservations public immutable observations;
    IS0ULIntelClassifier public immutable classifier;
    bytes32 public immutable observationsCodeHash;
    bytes32 public immutable classifierCodeHash;
    bytes32 public immutable modelId;
    bytes32 public immutable trainingManifestHash;
    uint256 public immutable chainId;
    uint256 public reportCount;
    mapping(uint256 => uint256) public latestReport;
    mapping(bytes32 => bool) public reported;
    mapping(uint256 => Report) private _reports;

    event ReportPublished(uint256 indexed reportId, uint256 indexed subjectId, uint64 indexed sequence,
        uint8 label, bytes32 featureHash, bytes32 modelId);

    constructor(address observations_, address classifier_) {
        if (observations_.code.length == 0 || classifier_.code.length == 0) revert InvalidConfiguration();
        observations = IS0ULObservations(observations_);
        classifier = IS0ULIntelClassifier(classifier_);
        observationsCodeHash = observations_.codehash;
        classifierCodeHash = classifier_.codehash;
        modelId = IS0ULIntelClassifier(classifier_).modelId();
        trainingManifestHash = IS0ULIntelClassifier(classifier_).trainingManifestHash();
        if (modelId == bytes32(0) || trainingManifestHash == bytes32(0)) revert InvalidConfiguration();
        chainId = block.chainid;
    }

    /// @notice Read an existing fresh snapshot, derive features and run the pinned classifier.
    function analyze(uint256 subjectId, uint8 lookback) external returns (uint256) {
        return _analyze(subjectId, lookback);
    }

    /// @notice Capture facts and publish their analysis atomically; the caller supplies no measurements.
    function captureAndAnalyze(uint256 subjectId, uint8 lookback) external returns (uint256) {
        _checkDependencies();
        (T.ReadStatus status,) = observations.snapshot(subjectId);
        if (status != T.ReadStatus.Ok) revert InvalidObservation(uint8(status));
        return _analyze(subjectId, lookback);
    }

    function _checkDependencies() private view {
        if (address(observations).codehash != observationsCodeHash
            || address(classifier).codehash != classifierCodeHash
            || classifier.modelId() != modelId || classifier.trainingManifestHash() != trainingManifestHash
            || block.chainid != chainId) revert DependencyChanged();
    }

    function _analyze(uint256 subjectId, uint8 lookback) private returns (uint256 id) {
        _checkDependencies();
        T.FeatureFrame memory f = observations.features(subjectId, lookback);
        if ((f.status != T.ReadStatus.Ok && f.status != T.ReadStatus.NoHistory)
            || !f.fresh || f.subjectId != subjectId || f.current.sequence == 0
            || f.current.blockNumber > block.number || f.current.timestamp > block.timestamp
            || (f.flags & T.FLAG_READER_OK) == 0) revert InvalidObservation(uint8(f.status));
        bytes32 featureHash = keccak256(abi.encode(chainId, address(observations), f));
        bytes32 key = keccak256(abi.encode(subjectId, f.currentHash, f.previousHash, modelId));
        if (reported[key]) revert DuplicateReport();
        (uint8 label, int256[6] memory scores) = classifier.classify(f.vector);
        if (label > 5 || (!f.hasHistory && label != 5)) revert InvalidClassification();
        // A neural routing label never grants permission to manufacture an observation.
        if ((label == 1 && f.kind != T.ReaderKind.ERC20Supply)
            || (label == 2 && f.kind != T.ReaderKind.ERC20Balance)
            || ((label == 3 || label == 4) && f.kind != T.ReaderKind.UniswapV2))
            revert InvalidClassification();
        reported[key] = true;
        id = ++reportCount;
        Report storage r = _reports[id];
        r.subjectId = subjectId;
        r.currentSequence = f.current.sequence;
        r.previousSequence = f.previous.sequence;
        r.observedBlock = f.current.blockNumber;
        r.createdBlock = uint64(block.number);
        r.createdAt = uint64(block.timestamp);
        r.currentHash = f.currentHash;
        r.previousHash = f.previousHash;
        r.featureHash = featureHash;
        r.modelId = modelId;
        r.label = label;
        r.features = f.vector;
        r.scores = scores;
        r.currentValues = f.current.values;
        r.previousValues = f.previous.values;
        r.flags = f.flags;
        r.observedAt = f.current.timestamp;
        r.previousObservedAt = f.previous.timestamp;
        r.elapsedSeconds = f.elapsedSeconds;
        latestReport[subjectId] = id;
        emit ReportPublished(id, subjectId, r.currentSequence, label, featureHash, modelId);
    }

    function report(uint256 id) external view returns (Report memory) {
        if (id == 0 || id > reportCount) revert UnknownReport();
        return _reports[id];
    }

    /// @notice Commentary is assembled on-chain from recorded facts, never from a server or caller text.
    function render(uint256 id) external view returns (string memory) {
        if (id == 0 || id > reportCount) revert UnknownReport();
        Report storage r = _reports[id];
        string memory headline = r.label == 0 ? "Routine observation"
            : r.label == 1 ? "Token supply observation"
            : r.label == 2 ? "Watched account balance observation"
            : r.label == 3 ? "Pool LP-token supply observation"
            : r.label == 4 ? "Pool reserve-ratio observation" : "Insufficient comparable history";
        string memory result = string.concat("S0UL Intel: ", headline, ". Subject ", _uint(r.subjectId),
            ", sample ", _uint(r.currentSequence), ", observed block ", _uint(r.observedBlock), ". ");
        if (r.features[6] == int32(uint32(uint8(T.ReaderKind.ERC20Supply)))) {
            result = string.concat(result, "Total supply ", _uint(r.currentValues[0]), " raw token units. ");
        } else if (r.features[6] == int32(uint32(uint8(T.ReaderKind.ERC20Balance)))) {
            result = string.concat(result, "Watched account balance ", _uint(r.currentValues[0]),
                "; token supply ", _uint(r.currentValues[1]), " raw token units. ");
        } else {
            result = string.concat(result, "Pool reserves token0 ", _uint(r.currentValues[0]),
                ", token1 ", _uint(r.currentValues[1]), "; LP-token supply ", _uint(r.currentValues[2]),
                " raw token units. ");
        }
        if ((r.flags & T.FLAG_HISTORY) == 0) {
            return string.concat(result, "Baseline snapshot recorded; no prior-sample trend is asserted.");
        }
        if ((r.flags & T.FLAG_ZERO_BASELINE) != 0) {
            return string.concat(result,
                "At least one baseline was zero; an ordinary percentage comparison is undefined. Inspect raw recorded values.");
        }
        result = string.concat(result, "Comparison window ", _uint(r.elapsedSeconds), " seconds. ");
        if (r.features[6] == int32(uint32(uint8(T.ReaderKind.ERC20Supply)))) {
            result = string.concat(result, "Supply change between stored samples ", _signed(r.features[0]), " bps. ");
        } else if (r.features[6] == int32(uint32(uint8(T.ReaderKind.ERC20Balance)))) {
            result = string.concat(result, "Balance change between stored samples ", _signed(r.features[0]),
                " bps; supply change ", _signed(r.features[1]), " bps. Balance changes do not identify transfers. ");
        } else {
            result = string.concat(result, "Changes between stored samples: reserve0 ", _signed(r.features[0]),
                " bps, reserve1 ", _signed(r.features[1]), " bps, LP-token supply ", _signed(r.features[2]), " bps. ");
        }
        if (r.features[6] == int32(uint32(uint8(T.ReaderKind.UniswapV2)))) {
            result = string.concat(result, "Raw reserve1/reserve0 ratio change ", _signed(r.features[3]),
                " bps. This ratio is not a USD price; reserve changes are not trading volume. ");
        }
        if ((r.flags & T.FLAG_CLIPPED) != 0)
            result = string.concat(result, "One or more relative changes were clipped to +/-10000 bps. ");
        return string.concat(result, "Classification is observational routing, not a forecast or a safety verdict.");
    }

    function _signed(int256 value) private pure returns (string memory) {
        return value < 0 ? string.concat("-", _uint(uint256(-value))) : _uint(uint256(value));
    }
    function _uint(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 n = value; uint256 length;
        while (n != 0) { ++length; n /= 10; }
        bytes memory digits = new bytes(length);
        while (value != 0) { digits[--length] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(digits);
    }
}
