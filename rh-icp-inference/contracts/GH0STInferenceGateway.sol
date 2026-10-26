// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Async ICP inference inbox. A signature authenticates the configured
/// canister key, not a zero-knowledge proof of correct model execution.
/// Responses are data only; this contract never calls model-selected targets.
contract GH0STInferenceGateway {
    enum Status { Unknown, Pending, Fulfilled, Cancelled }
    struct Request {
        address requester;
        uint32 maxTokens;
        uint64 deadline;
        Status status;
        bytes32 promptHash;
        bytes32 answerHash;
    }
    struct Result {
        bytes32 requestId;
        bytes32 promptHash;
        bytes32 modelId;
        bytes32 artifactHash;
        bytes32 answerHash;
        uint64 inputTokens;
        uint64 outputTokens;
        uint128 modelCycles;
    }

    bytes32 public constant RESULT_TYPEHASH = keccak256("InferenceResult(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    address public immutable owner;
    address public immutable icpSigner;
    bytes32 public immutable modelId;
    bytes32 public immutable artifactHash;
    uint256 public nonce;
    bool public paused;
    mapping(address => bool) public authorizedRequester;
    mapping(bytes32 => Request) public requests;

    event InferenceRequested(bytes32 indexed requestId, address indexed requester, bytes32 indexed modelId, bytes32 promptHash, uint32 maxTokens, uint64 deadline, string prompt);
    event InferenceFulfilled(bytes32 indexed requestId, bytes32 indexed answerHash, string answer, uint64 inputTokens, uint64 outputTokens, uint128 modelCycles);
    event InferenceCancelled(bytes32 indexed requestId);
    event RequesterAuthorization(address indexed requester, bool authorized);
    event Paused(bool paused);

    error Unauthorized();
    error InvalidRequest();
    error InvalidResult();
    error InvalidSignature();

    constructor(address owner_, address icpSigner_, bytes32 modelId_, bytes32 artifactHash_) {
        if (owner_ == address(0) || icpSigner_ == address(0) || modelId_ == bytes32(0) || artifactHash_ == bytes32(0)) revert InvalidRequest();
        owner = owner_; icpSigner = icpSigner_; modelId = modelId_; artifactHash = artifactHash_;
        authorizedRequester[owner_] = true;
    }

    function setRequester(address requester, bool authorized) external {
        if (msg.sender != owner) revert Unauthorized();
        authorizedRequester[requester] = authorized;
        emit RequesterAuthorization(requester, authorized);
    }

    function setPaused(bool value) external {
        if (msg.sender != owner) revert Unauthorized();
        paused = value;
        emit Paused(value);
    }

    function requestInference(string calldata prompt, uint32 maxTokens, uint64 deadline) external returns (bytes32 requestId) {
        if (!authorizedRequester[msg.sender]) revert Unauthorized();
        if (paused || bytes(prompt).length == 0 || bytes(prompt).length > 4096 || maxTokens == 0 || maxTokens > 128 || deadline <= block.timestamp || deadline > block.timestamp + 1 days) revert InvalidRequest();
        bytes32 promptHash = keccak256(bytes(prompt));
        requestId = keccak256(abi.encode(block.chainid, address(this), msg.sender, ++nonce, promptHash));
        requests[requestId] = Request(msg.sender, maxTokens, deadline, Status.Pending, promptHash, bytes32(0));
        emit InferenceRequested(requestId, msg.sender, modelId, promptHash, maxTokens, deadline, prompt);
    }

    function cancel(bytes32 requestId) external {
        Request storage r = requests[requestId];
        if (r.status != Status.Pending) revert InvalidRequest();
        if (msg.sender != r.requester && msg.sender != owner && block.timestamp <= r.deadline) revert Unauthorized();
        r.status = Status.Cancelled;
        emit InferenceCancelled(requestId);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("GH0ST ICP Inference"), keccak256("1"), block.chainid, address(this)));
    }

    function resultDigest(Result calldata result) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(RESULT_TYPEHASH, result));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    /// @notice Anyone may transport the signed result. No privileged relayer key.
    function fulfillInference(Result calldata result, string calldata answer, bytes calldata signature) external {
        Request storage r = requests[result.requestId];
        if (r.status != Status.Pending || block.timestamp > r.deadline || result.modelId != modelId || result.artifactHash != artifactHash || result.promptHash != r.promptHash || bytes(answer).length == 0 || bytes(answer).length > 8192 || result.answerHash != keccak256(bytes(answer)) || result.outputTokens == 0 || result.outputTokens > r.maxTokens) revert InvalidResult();
        if (signature.length != 65) revert InvalidSignature();
        bytes32 s; bytes32 rr; uint8 v;
        assembly { rr := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28) || ecrecover(resultDigest(result), v, rr, s) != icpSigner) revert InvalidSignature();
        r.status = Status.Fulfilled;
        r.answerHash = result.answerHash;
        emit InferenceFulfilled(result.requestId, result.answerHash, answer, result.inputTokens, result.outputTokens, result.modelCycles);
    }
}
