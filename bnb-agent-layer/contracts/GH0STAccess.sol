// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GH0STPassport} from "./GH0STPassport.sol";

/// @notice BNB access to existing RH -> ICP -> RH inference. No model or GH0ST token migration.
/// @dev An ICP attestation authenticates a result; it is not a ZK execution proof.
contract GH0STAccess is EIP712, ReentrancyGuard {
    using Strings for uint256;
    using SafeERC20 for IERC20;
    enum Status { Unknown, Pending, Fulfilled, Refunded }
    struct Settings {
        address passport; address icpSigner; address rhGateway;
        bytes32 modelId; bytes32 artifactHash; address quoteSigner; address treasury;
        uint256 rewardPerRequest; uint256 maxRewardsPerPassport; uint256 maxRewardBudget;
    }
    struct Quote {
        address requester; uint256 passportId; bytes32 promptHash; uint32 maxTokens;
        uint256 fee; uint64 validUntil; uint64 deadline; bytes32 nonce;
    }
    struct TokenQuote { Quote request; address paymentToken; }
    struct Request {
        address requester; uint256 passportId; uint256 fee; uint32 maxTokens; uint64 deadline;
        Status status; bytes32 promptHash; bytes32 transportPromptHash;
        bytes32 originRequestId; bytes32 answerHash;
    }
    struct Result {
        bytes32 requestId; bytes32 promptHash; bytes32 modelId; bytes32 artifactHash;
        bytes32 answerHash; uint64 inputTokens; uint64 outputTokens; uint128 modelCycles;
    }
    GH0STPassport public immutable passport;
    address public immutable owner;
    address public immutable icpSigner;
    address public immutable rhGateway;
    bytes32 public immutable modelId;
    bytes32 public immutable artifactHash;
    address public immutable quoteSigner;
    address public immutable treasury;
    uint256 public immutable rewardPerRequest;
    uint256 public immutable maxRewardsPerPassport;
    uint256 public immutable maxRewardBudget;
    bytes32 public immutable originDomain;
    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(address requester,uint256 passportId,bytes32 promptHash,uint32 maxTokens,uint256 fee,uint64 validUntil,uint64 deadline,bytes32 nonce)");
    bytes32 public constant RESULT_TYPEHASH = keccak256("InferenceResult(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)");
    bytes32 public constant TOKEN_QUOTE_TYPEHASH = keccak256("TokenQuote(Quote request,address paymentToken)Quote(address requester,uint256 passportId,bytes32 promptHash,uint32 maxTokens,uint256 fee,uint64 validUntil,uint64 deadline,bytes32 nonce)");
    address public paymentToken;
    mapping(bytes32 => address) public requestPaymentToken;
    mapping(address => uint256) public tokenCredits;
    uint256 public tokenEscrowed;
    uint256 public totalTokenCredits;
    mapping(bytes32 => Request) public requests;
    mapping(address => mapping(bytes32 => bool)) public usedQuoteNonce;
    mapping(bytes32 => bool) public usedOriginResult;
    mapping(uint256 => bytes32[]) private history;
    mapping(uint256 => uint256) public completed;
    mapping(uint256 => uint256) public rewarded;
    mapping(address => uint256) public credits;
    uint256 public escrowed;
    uint256 public totalCredits;
    uint256 public rewardPool;
    uint256 public totalRewardFunding;
    bool public paused;
    event ThoughtRequested(bytes32 indexed requestId, uint256 indexed passportId, address indexed requester, bytes32 transportPromptHash, uint32 maxTokens, uint64 deadline, uint256 fee, string prompt, string transportPrompt);
    event ThoughtFulfilled(bytes32 indexed requestId, bytes32 indexed originRequestId, uint256 indexed passportId, bytes32 answerHash, string answer, uint64 inputTokens, uint64 outputTokens, uint128 modelCycles);
    event ThoughtRefunded(bytes32 indexed requestId, address indexed requester, uint256 fee);
    event RewardFunded(address indexed funder, uint256 amount);
    event RewardEarned(uint256 indexed passportId, address indexed holder, uint256 amount);
    event Withdrawn(address indexed holder, uint256 amount);
    event Paused(bool value);
    event PaymentTokenBound(address indexed token);
    event PaymentEscrowed(bytes32 indexed requestId, address indexed token, uint256 amount);
    event TokenWithdrawn(address indexed holder, address indexed token, uint256 amount);
    error InvalidRequest(); error InvalidResult(); error Unauthorized(); error PaymentFailed();

    constructor(Settings memory s) EIP712("GH0ST BNB Access", "1") {
        if (block.chainid != 56 || s.passport.code.length == 0 || s.icpSigner == address(0) || s.rhGateway == address(0) || s.quoteSigner == address(0) || s.treasury == address(0) || s.modelId == 0 || s.artifactHash == 0) revert InvalidRequest();
        passport = GH0STPassport(s.passport); owner = msg.sender; icpSigner = s.icpSigner;
        rhGateway = s.rhGateway; modelId = s.modelId; artifactHash = s.artifactHash;
        quoteSigner = s.quoteSigner; treasury = s.treasury;
        rewardPerRequest = s.rewardPerRequest; maxRewardsPerPassport = s.maxRewardsPerPassport; maxRewardBudget = s.maxRewardBudget;
        originDomain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("GH0ST ICP Inference"), keccak256("1"), uint256(4663), s.rhGateway));
    }
    function setPaused(bool value) external { if (msg.sender != owner) revert Unauthorized(); paused = value; emit Paused(value); }
    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }
    function transportPrompt(bytes32 requestId, string calldata prompt) public view returns (string memory) {
        return string.concat("GH0ST_ACCESS_V1|56|", Strings.toHexString(address(this)), "|", uint256(requestId).toHexString(32), "\n", prompt);
    }
    /// @notice One-time binding to the verified BNB bridge token; cannot later be replaced.
    function bindPaymentToken(address token) external {
        if (msg.sender != owner) revert Unauthorized();
        if (paymentToken != address(0) || token.code.length == 0) revert InvalidRequest();
        paymentToken = token; emit PaymentTokenBound(token);
    }
    function tokenQuoteDigest(TokenQuote calldata tq) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TOKEN_QUOTE_TYPEHASH, keccak256(abi.encode(QUOTE_TYPEHASH, tq.request)), tq.paymentToken)));
    }
    function _checkRequest(string calldata prompt, Quote calldata q) private view {
        if (paused || q.requester != msg.sender || q.passportId == 0 || passport.passportOf(msg.sender) != q.passportId || !passport.isActive(msg.sender)
            || bytes(prompt).length == 0 || bytes(prompt).length > 3400 || q.promptHash != keccak256(bytes(prompt)) || q.maxTokens == 0 || q.maxTokens > 128
            || q.validUntil < block.timestamp || q.validUntil > q.deadline || q.deadline < block.timestamp + 300 || q.deadline > block.timestamp + 1 days
            || q.fee == 0 || usedQuoteNonce[msg.sender][q.nonce]) revert InvalidRequest();
    }
    function _recordRequest(string calldata prompt, Quote calldata q, bytes32 requestId, address asset) private {
        usedQuoteNonce[msg.sender][q.nonce] = true;
        string memory transport = transportPrompt(requestId, prompt);
        bytes32 transportHash = keccak256(bytes(transport));
        requests[requestId] = Request(msg.sender, q.passportId, q.fee, q.maxTokens, q.deadline, Status.Pending, q.promptHash, transportHash, 0, 0);
        requestPaymentToken[requestId] = asset;
        history[q.passportId].push(requestId);
        emit PaymentEscrowed(requestId, asset, q.fee);
        emit ThoughtRequested(requestId, q.passportId, msg.sender, transportHash, q.maxTokens, q.deadline, q.fee, prompt, transport);
    }
    function requestThought(string calldata prompt, Quote calldata q, bytes calldata signature) external payable nonReentrant returns (bytes32 requestId) {
        _checkRequest(prompt, q);
        if (msg.value != q.fee) revert InvalidRequest();
        requestId = quoteDigest(q);
        if (ECDSA.recover(requestId, signature) != quoteSigner) revert Unauthorized();
        escrowed += q.fee;
        _recordRequest(prompt, q, requestId, address(0));
    }
    function requestThoughtWithToken(string calldata prompt, TokenQuote calldata tq, bytes calldata signature) external nonReentrant returns (bytes32 requestId) {
        Quote calldata q = tq.request;
        _checkRequest(prompt, q);
        if (paymentToken == address(0) || tq.paymentToken != paymentToken) revert InvalidRequest();
        requestId = tokenQuoteDigest(tq);
        if (ECDSA.recover(requestId, signature) != quoteSigner) revert Unauthorized();
        IERC20 token = IERC20(paymentToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        _recordRequest(prompt, q, requestId, paymentToken);
        token.safeTransferFrom(msg.sender, address(this), q.fee);
        if (token.balanceOf(address(this)) - beforeBalance != q.fee) revert InvalidRequest();
        tokenEscrowed += q.fee;
    }
    function _creditPayment(bytes32 requestId, Request storage r, address recipient) private {
        if (requestPaymentToken[requestId] == address(0)) {
            escrowed -= r.fee; credits[recipient] += r.fee; totalCredits += r.fee;
        } else {
            tokenEscrowed -= r.fee; tokenCredits[recipient] += r.fee; totalTokenCredits += r.fee;
        }
    }
    function originDigest(Result calldata r) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(originDomain, keccak256(abi.encode(RESULT_TYPEHASH, r)));
    }
    /// @notice Anyone can deliver the original ICP signature. No relayer can replace the answer.
    function fulfill(bytes32 requestId, Result calldata result, string calldata answer, bytes calldata signature) external nonReentrant {
        Request storage r = requests[requestId];
        if (r.status != Status.Pending || block.timestamp > r.deadline || result.requestId == 0 || usedOriginResult[result.requestId]
            || result.promptHash != r.transportPromptHash || result.modelId != modelId || result.artifactHash != artifactHash
            || bytes(answer).length == 0 || bytes(answer).length > 8192 || result.answerHash != keccak256(bytes(answer))
            || result.outputTokens == 0 || result.outputTokens > r.maxTokens) revert InvalidResult();
        if (ECDSA.recover(originDigest(result), signature) != icpSigner) revert Unauthorized();
        r.status = Status.Fulfilled; r.originRequestId = result.requestId; r.answerHash = result.answerHash;
        usedOriginResult[result.requestId] = true; _creditPayment(requestId, r, treasury); completed[r.passportId]++;
        if (rewardPerRequest > 0 && rewardPool >= rewardPerRequest && rewarded[r.passportId] < maxRewardsPerPassport) {
            rewardPool -= rewardPerRequest; rewarded[r.passportId]++;
            credits[r.requester] += rewardPerRequest; totalCredits += rewardPerRequest;
            emit RewardEarned(r.passportId, r.requester, rewardPerRequest);
        }
        emit ThoughtFulfilled(requestId, result.requestId, r.passportId, result.answerHash, answer, result.inputTokens, result.outputTokens, result.modelCycles);
    }
    function refund(bytes32 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        if (r.status != Status.Pending || block.timestamp <= r.deadline) revert InvalidRequest();
        r.status = Status.Refunded; _creditPayment(requestId, r, r.requester);
        emit ThoughtRefunded(requestId, r.requester, r.fee);
    }
    function fundRewards() external payable {
        if (msg.value == 0 || totalRewardFunding + msg.value > maxRewardBudget) revert InvalidRequest();
        totalRewardFunding += msg.value; rewardPool += msg.value; emit RewardFunded(msg.sender, msg.value);
    }
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender]; if (amount == 0) revert InvalidRequest();
        credits[msg.sender] = 0; totalCredits -= amount;
        (bool ok,) = msg.sender.call{value: amount}(""); if (!ok) revert PaymentFailed();
        emit Withdrawn(msg.sender, amount);
    }
    function withdrawToken() external nonReentrant {
        uint256 amount = tokenCredits[msg.sender]; if (amount == 0 || paymentToken == address(0)) revert InvalidRequest();
        tokenCredits[msg.sender] = 0; totalTokenCredits -= amount;
        IERC20 token = IERC20(paymentToken); uint256 beforeBalance = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        if (token.balanceOf(msg.sender) - beforeBalance != amount) revert InvalidRequest();
        emit TokenWithdrawn(msg.sender, paymentToken, amount);
    }
    function requestCount(uint256 passportId) external view returns (uint256) { return history[passportId].length; }
    function requestPage(uint256 passportId, uint256 offset, uint256 limit) external view returns (bytes32[] memory ids) {
        if (limit == 0 || limit > 50) revert InvalidRequest();
        uint256 length = history[passportId].length; if (offset >= length) return new bytes32[](0);
        uint256 count = length - offset; if (count > limit) count = limit;
        ids = new bytes32[](count); for (uint256 i; i < count; i++) ids[i] = history[passportId][offset + i];
    }
}
