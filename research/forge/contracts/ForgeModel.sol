// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev STOP-prefixed immutable bytecode storage, following SynapseData.
contract ForgeData {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

interface IForgeToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Creator-owned, immutable Q8 numeric classifier with optional exact ERC20 payment.
/// @dev The mainnet UI binds token to GH0ST on chain 4663; the constructor permits mock tokens
/// for isolated EVM verification. There is no factory, protocol fee, owner, or configuration setter.
contract ForgeModel {
    struct Trace {
        int256[] hidden;
        int256[] logits;
        uint16 classId;
    }

    bytes32 public constant FORMAT_ID = keccak256("GH0ST_FORGE_NUMERIC_MLP_Q8_V1");
    int256 public constant SCALE = 256;
    int256 public constant FEATURE_MIN = -256;
    int256 public constant FEATURE_MAX = 256;
    int256 public constant ACTIVATION_MAX = 32767;

    IForgeToken public immutable paymentToken;
    address public immutable beneficiary;
    uint96 public immutable fee;
    uint8 public immutable inputCount;
    uint8 public immutable hiddenWidth;
    uint8 public immutable classCount;
    bytes32 public immutable featureSchemaHash;
    bytes32 public immutable labelsHash;
    bytes32 public immutable datasetHash;
    bytes32 public immutable weightsHash;
    bytes32 public immutable modelHash;
    bytes32 public immutable modelId;
    address public immutable data;
    bytes32 public immutable dataCodeHash;
    mapping(address => uint256) public credits;
    uint256 public totalCredits;
    bool private entered;

    event Inference(address indexed payer, bytes32 indexed modelId, uint16 classId,
        bytes32 inputHash, bytes32 traceHash, uint256 fee);
    event Withdrawal(address indexed beneficiary, uint256 amount);

    error InvalidModel();
    error InvalidFeatures();
    error InvalidQuote();
    error Expired();
    error TransferFailed();
    error Reentrancy();

    /// @param packedWeights Signed int16 big-endian: hiddenWeights[H][F], hiddenBias[H],
    /// headWeights[C][H], headBias[C]. Matrices are output-major; all parameters use Q8.
    constructor(address token, address recipient, uint96 price,
        uint8 features, uint8 width, uint8 classes,
        bytes32 schemaHash, bytes32 classLabelsHash, bytes32 trainingDatasetHash,
        bytes memory packedWeights)
    {
        if (token.code.length == 0 || recipient == address(0) || recipient == address(this)
            || features == 0 || features > 8 || width == 0 || width > 16
            || classes < 2 || classes > 4 || schemaHash == bytes32(0)
            || classLabelsHash == bytes32(0) || trainingDatasetHash == bytes32(0)
            || packedWeights.length != 2 * (uint256(width) * features + width
                + uint256(classes) * width + classes)) revert InvalidModel();
        paymentToken = IForgeToken(token);
        beneficiary = recipient;
        fee = price;
        inputCount = features;
        hiddenWidth = width;
        classCount = classes;
        featureSchemaHash = schemaHash;
        labelsHash = classLabelsHash;
        datasetHash = trainingDatasetHash;
        weightsHash = keccak256(packedWeights);
        modelHash = keccak256(abi.encode(FORMAT_ID, features, width, classes,
            schemaHash, classLabelsHash, trainingDatasetHash, keccak256(packedWeights)));
        modelId = keccak256(abi.encode(block.chainid, address(this), token, recipient, price, modelHash));
        address source = address(new ForgeData(packedWeights));
        data = source;
        dataCodeHash = source.codehash;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    function quote() external view returns (bytes32 quotedModelId, uint256 quotedFee) {
        return (modelId, fee);
    }

    /// @notice Deterministic read-only prediction. Features must already be normalized to Q8
    /// in [-256, 256]. Each affine sum divides by 256 with signed truncation toward zero.
    /// Hidden activations use ReLU clipped at 32767; logits are linear; ties choose lowest ID.
    function predict(int256[] calldata features) public view returns (Trace memory trace) {
        if (features.length != inputCount) revert InvalidFeatures();
        for (uint256 i; i < features.length; ++i) {
            if (features[i] < FEATURE_MIN || features[i] > FEATURE_MAX) revert InvalidFeatures();
        }
        uint256 width = hiddenWidth;
        uint256 classes = classCount;
        uint256 hiddenBias = width * inputCount;
        uint256 head = hiddenBias + width;
        uint256 headBias = head + classes * width;
        bytes memory packed = _load(2 * (headBias + classes));
        trace.hidden = new int256[](width);
        trace.logits = new int256[](classes);
        for (uint256 row; row < width; ++row) {
            int256 sum;
            for (uint256 column; column < inputCount; ++column) {
                sum += _weight(packed, row * inputCount + column) * features[column];
            }
            int256 activation = sum / SCALE + _weight(packed, hiddenBias + row);
            trace.hidden[row] = activation < 0 ? int256(0)
                : activation > ACTIVATION_MAX ? ACTIVATION_MAX : activation;
        }
        for (uint16 row; row < classes; ++row) {
            int256 sum;
            for (uint256 column; column < width; ++column) {
                sum += _weight(packed, head + uint256(row) * width + column) * trace.hidden[column];
            }
            trace.logits[row] = sum / SCALE + _weight(packed, headBias + row);
            if (trace.logits[row] > trace.logits[trace.classId]) trace.classId = row;
        }
    }

    function inferPaid(int256[] calldata features, bytes32 expectedModelId, uint256 maxFee, uint256 deadline)
        external nonReentrant returns (uint16 classId)
    {
        if (block.timestamp > deadline) revert Expired();
        if (expectedModelId != modelId || fee > maxFee) revert InvalidQuote();
        Trace memory trace = predict(features);
        if (fee != 0) {
            _transferExact(msg.sender, address(this), fee);
            credits[beneficiary] += fee;
            totalCredits += fee;
        }
        emit Inference(msg.sender, modelId, trace.classId, keccak256(abi.encode(features)),
            keccak256(abi.encode(trace)), fee);
        return trace.classId;
    }

    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = credits[msg.sender];
        if (amount == 0) return 0;
        credits[msg.sender] = 0;
        totalCredits -= amount;
        _transferExact(address(this), msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
    }

    function _load(uint256 length) private view returns (bytes memory packed) {
        address source = data;
        if (source.codehash != dataCodeHash || source.code.length != length + 1) revert InvalidModel();
        packed = new bytes(length);
        assembly ("memory-safe") { extcodecopy(source, add(packed, 32), 1, length) }
    }

    function _weight(bytes memory packed, uint256 index) private pure returns (int256 value) {
        assembly ("memory-safe") {
            value := signextend(1, shr(240, mload(add(add(packed, 32), mul(index, 2)))))
        }
    }

    /// @dev Exact sender and recipient balance deltas reject taxed, false-return, and
    /// rebasing-during-transfer tokens. Reverts roll back token effects and credits together.
    function _transferExact(address from, address to, uint256 amount) private {
        uint256 senderBefore = paymentToken.balanceOf(from);
        uint256 recipientBefore = paymentToken.balanceOf(to);
        if (senderBefore < amount) revert TransferFailed();
        bool sent = from == address(this)
            ? paymentToken.transfer(to, amount)
            : paymentToken.transferFrom(from, to, amount);
        if (!sent || paymentToken.balanceOf(from) != senderBefore - amount
            || paymentToken.balanceOf(to) != recipientBefore + amount) revert TransferFailed();
    }
}
