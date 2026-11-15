// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IChessToken {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Immutable, manually funded escrow for an ICP-attested chess challenge.
/// @dev TRUST BOUNDARY: this contract authenticates a pinned threshold-ECDSA address.
/// It does NOT execute chess, verify ICP code, or prove that Stockfish ran correctly.
/// The canister/controller/RH entry verifier and pinned engine configuration are trusted.
/// A production front end must bind token to canonical GH0ST on chain 4663. Mock token
/// constructor support exists for isolated tests; this source is not a deployment approval.
contract RHChessChallengeVault {
    uint256 public constant ENTRY_FEE = 25_000 * 1e18;
    uint256 public constant TOTAL_PRIZE = 100_000 * 1e18;
    uint64 public constant GAME_DURATION = 1 days;
    uint64 public constant RECONCILIATION_WINDOW = 7 days;
    uint256 private constant SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("GH0ST RH Chess Challenge");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "GameResult(bytes32 gameId,address player,bytes32 principalHash,uint256 nonce,bytes32 finalPositionHash,bytes32 transcriptHash,uint8 result,bytes32 engineConfigHash,uint64 completedAt,uint64 issuedAt,uint64 validUntil)"
    );
    address public constant CANONICAL_GH0ST = 0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559;
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;

    enum Result {
        None,
        HumanCheckmate,
        BotCheckmate,
        Draw,
        HumanResigned,
        PlayerTimeout,
        ServiceFault,
        EngineAbort,
        ReconciliationExpiredRefund
    }

    struct Game {
        address player;
        bytes32 principalHash;
        uint256 nonce;
        uint64 openedAt;
        uint64 gameDeadline;
        uint64 reconciliationDeadline;
        Result result;
    }

    struct GameResult {
        bytes32 gameId;
        address player;
        bytes32 principalHash;
        uint256 nonce;
        bytes32 finalPositionHash;
        bytes32 transcriptHash;
        uint8 result;
        bytes32 engineConfigHash;
        uint64 completedAt;
        uint64 issuedAt;
        uint64 validUntil;
    }

    IChessToken public immutable paymentToken;
    address public immutable owner;
    address public immutable attestor;
    bytes32 public immutable engineConfigHash;
    mapping(bytes32 => Game) public games;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    uint256 public totalReserved;
    uint256 public activeGames;
    bool public paused = true;
    bool private entered;

    event PoolFunded(address indexed funder, uint256 amount);
    event PoolWithdrawal(address indexed owner, uint256 amount);
    event EntriesPaused(bool paused);
    event EntryAccepted(bytes32 indexed gameId, address indexed player, bytes32 indexed principalHash,
        uint256 nonce, bytes32 engineConfigHash, uint64 openedAt,
        uint64 gameDeadline, uint64 reconciliationDeadline);
    event GameSettled(bytes32 indexed gameId, address indexed player, Result result,
        uint256 paid, bytes32 finalPositionHash, bytes32 transcriptHash, bytes32 receiptDigest);

    error InvalidConfiguration();
    error Unauthorized();
    error Reentrancy();
    error EntriesArePaused();
    error InvalidEntry();
    error NonceAlreadyUsed();
    error InsufficientFreePool();
    error Insolvent();
    error TransferFailed();
    error UnknownGame();
    error GameAlreadySettled();
    error InvalidReceipt();
    error InvalidSignature();
    error ReceiptExpired();
    error ReconciliationNotExpired();

    constructor(address token, address poolOwner, address pinnedAttestor, bytes32 configHash) {
        if (token.code.length == 0 || poolOwner == address(0) || poolOwner == address(this)
            || pinnedAttestor == address(0) || pinnedAttestor == address(this)
            || configHash == bytes32(0)) revert InvalidConfiguration();
        if (IChessToken(token).decimals() != 18) revert InvalidConfiguration();
        paymentToken = IChessToken(token);
        owner = poolOwner;
        attestor = pinnedAttestor;
        engineConfigHash = configHash;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Actual unreserved tokens, including voluntarily sent donations.
    /// @dev Zero means no spendable pool if an unsupported token becomes insolvent.
    function freePool() public view returns (uint256) {
        uint256 balance = paymentToken.balanceOf(address(this));
        return balance > totalReserved ? balance - totalReserved : 0;
    }

    function isSolvent() external view returns (bool) {
        return paymentToken.balanceOf(address(this)) >= totalReserved;
    }

    /// @notice Only this explicit caller-approved action pulls pool funds.
    function fundPool(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidEntry();
        _transferExact(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Pausing blocks new entries only. Existing games keep their fixed terms.
    function setPaused(bool value) external onlyOwner nonReentrant {
        paused = value;
        emit EntriesPaused(value);
    }

    /// @notice The immutable owner can withdraw only free pool tokens to itself.
    function withdrawPool(uint256 amount) external onlyOwner nonReentrant {
        _requireSolvent();
        if (amount == 0 || amount > freePool()) revert InsufficientFreePool();
        _transferExact(address(this), owner, amount);
        emit PoolWithdrawal(owner, amount);
    }

    function gameIdFor(address player, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), player, nonce));
    }

    /// @notice Reserves the entire 100k prize BEFORE charging exactly 25k from msg.sender.
    /// principalHash = SHA256(raw ICP Principal bytes); the canister must authenticate it.
    function enterGame(bytes32 principalHash, uint256 nonce) external nonReentrant returns (bytes32 gameId) {
        if (paused) revert EntriesArePaused();
        if (principalHash == bytes32(0) || msg.sender == address(this)) revert InvalidEntry();
        if (nonceUsed[msg.sender][nonce]) revert NonceAlreadyUsed();
        _requireSolvent();
        if (freePool() < TOTAL_PRIZE) revert InsufficientFreePool();
        gameId = gameIdFor(msg.sender, nonce);
        uint64 openedAt = uint64(block.timestamp);
        uint64 deadline = openedAt + GAME_DURATION;
        uint64 reconciliationDeadline = deadline + RECONCILIATION_WINDOW;
        nonceUsed[msg.sender][nonce] = true;
        games[gameId] = Game(msg.sender, principalHash, nonce, openedAt,
            deadline, reconciliationDeadline, Result.None);
        totalReserved += TOTAL_PRIZE;
        activeGames += 1;
        _transferExact(msg.sender, address(this), ENTRY_FEE);
        emit EntryAccepted(gameId, msg.sender, principalHash, nonce, engineConfigHash,
            openedAt, deadline, reconciliationDeadline);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function receiptDigest(GameResult calldata receipt) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(RESULT_TYPEHASH, receipt.gameId, receipt.player,
            receipt.principalHash, receipt.nonce, receipt.finalPositionHash, receipt.transcriptHash,
            receipt.result, receipt.engineConfigHash, receipt.completedAt, receipt.issuedAt, receipt.validUntil));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    /// @notice Any relayer may submit; payment always goes to the originally bound player.
    /// Codes 2-5 keep the entry fee; codes 6-7 refund it. Only code 1 pays 100k TOTAL.
    function settleGame(GameResult calldata receipt, bytes calldata signature) external nonReentrant {
        Game storage game = _activeGame(receipt.gameId);
        if (receipt.player != game.player || receipt.principalHash != game.principalHash
            || receipt.nonce != game.nonce || receipt.engineConfigHash != engineConfigHash
            || receipt.finalPositionHash == bytes32(0) || receipt.transcriptHash == bytes32(0)
            || receipt.result == 0 || receipt.result > uint8(Result.EngineAbort)
            || receipt.completedAt < game.openedAt || receipt.completedAt > game.gameDeadline
            || receipt.issuedAt < receipt.completedAt || receipt.issuedAt > block.timestamp
            || receipt.validUntil < receipt.issuedAt
            || receipt.validUntil > game.reconciliationDeadline) revert InvalidReceipt();
        if (block.timestamp > receipt.validUntil) revert ReceiptExpired();
        bytes32 digest = receiptDigest(receipt);
        _verify(digest, signature);
        Result result = Result(receipt.result);
        uint256 paid = result == Result.HumanCheckmate ? TOTAL_PRIZE
            : result == Result.ServiceFault || result == Result.EngineAbort ? ENTRY_FEE : 0;
        _resolve(receipt.gameId, game, result, paid, receipt.finalPositionHash, receipt.transcriptHash, digest);
    }

    /// @notice Attestation outage escape hatch after the full reconciliation window.
    /// Missing evidence is a service-fault refund, never an unsigned player forfeiture.
    function refundUnattested(bytes32 gameId) external nonReentrant {
        Game storage game = _activeGame(gameId);
        if (block.timestamp <= game.reconciliationDeadline) revert ReconciliationNotExpired();
        _resolve(gameId, game, Result.ReconciliationExpiredRefund, ENTRY_FEE,
            bytes32(0), bytes32(0), bytes32(0));
    }

    function _activeGame(bytes32 gameId) private view returns (Game storage game) {
        game = games[gameId];
        if (game.player == address(0)) revert UnknownGame();
        if (game.result != Result.None) revert GameAlreadySettled();
    }

    function _resolve(bytes32 gameId, Game storage game, Result result, uint256 paid,
        bytes32 finalHash, bytes32 transcriptHash, bytes32 digest) private
    {
        _requireSolvent();
        game.result = result;
        totalReserved -= TOTAL_PRIZE;
        activeGames -= 1;
        if (paid != 0) _transferExact(address(this), game.player, paid);
        emit GameSettled(gameId, game.player, result, paid, finalHash, transcriptHash, digest);
    }

    function _verify(bytes32 digest, bytes calldata signature) private view {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if ((v != 27 && v != 28) || uint256(s) == 0 || uint256(s) > SECP256K1_HALF_N)
            revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != attestor) revert InvalidSignature();
    }

    function _requireSolvent() private view {
        if (paymentToken.balanceOf(address(this)) < totalReserved) revert Insolvent();
    }

    /// @dev Project Forge/Synapse convention: exact sender and receiver deltas reject
    /// taxed, false-return and rebasing-during-transfer tokens; all state rolls back.
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
