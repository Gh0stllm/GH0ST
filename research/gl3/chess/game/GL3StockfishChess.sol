// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HybridChessRules} from "../../../chess/contracts/HybridChessRules.sol";
import {StockfishMoveCodec} from "./StockfishMoveCodec.sol";

interface IGL3Stockfish {
    function gameCoordinator() external view returns (address);
    function engineStatus() external view returns (bytes32 moduleSha256, bytes32 seedRoot, bool seedAvailable);
    function newGame(bytes32 job) external returns (bytes32 root);
    function releaseGame(bytes32 job) external returns (bool released);
    function begin(bytes32 job, uint64 generation, string calldata history)
        external returns (uint32 step, bool pending, bytes32 root);
    function advance(bytes32 job, uint64 generation, uint32 expectedStep)
        external returns (uint32 step, bool pending, bytes32 root);
    function inspect(bytes32 job) external view returns (
        uint64 generation, uint32 step, bool pending, uint64 observedNodes,
        string memory move, uint64 actualNodes, uint32 depth, bytes32 root
    );
}

/// @notice One retained Stockfish game with native GH0ST escrow and on-chain adjudication.
/// @dev The fixed A14 protocol precompile owns engine execution and retained state.
contract GL3StockfishChess {
    using HybridChessRules for HybridChessRules.Position;

    uint256 public constant CHAIN_ID = 4_663_001;
    uint256 public constant ENTRY_FEE = 25_000 ether;
    uint256 public constant TOTAL_PRIZE = 1_000_000 ether;
    uint64 public constant HUMAN_TURN_SECONDS = 1 days;
    uint64 public constant BOT_TURN_SECONDS = 1 hours;
    uint64 public constant NODES_PER_MOVE = 24_000_000;
    uint32 public constant MAX_ENGINE_HISTORY_PLIES = 1_024;
    uint32 private constant ENGINE_TERMINAL_DEPTH = 245;
    bytes32 public constant INITIAL_TRANSCRIPT_HASH = keccak256("GH0ST_CHESS_INITIAL_V1");
    bytes32 public constant ENGINE_MODULE_SHA =
        0x1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc;
    IGL3Stockfish public constant ENGINE = IGL3Stockfish(address(0x0a14));

    enum Result {
        Active, HumanCheckmate, BotCheckmate, Draw, HumanResigned, PlayerTimeout,
        ServiceTimeoutRefund, EngineLimitRefund
    }

    enum Phase { Idle, Running, Ready }

    struct Game {
        address player;
        uint256 nonce;
        uint64 openedAt;
        uint64 turnDeadline;
        Result result;
        uint32 ply;
        bytes32 positionHash;
        bytes32 transcriptHash;
        uint256 board;
        uint8 castling;
        uint8 enPassant;
        uint16 halfmoveClock;
        bool blackToMove;
    }

    struct Search {
        Phase phase;
        // Keep the search's original generation through Ready. A14 increments
        // its generation when the search finishes, before we apply the move.
        uint64 generation;
        uint32 step;
        uint32 ply;
        bytes32 positionHash;
        bytes32 transcriptHash;
        bytes32 root;
    }

    struct EngineProgress {
        uint64 generation;
        uint32 step;
        bool pending;
        uint64 observedNodes;
        string move;
        uint64 actualNodes;
        uint32 depth;
        bytes32 root;
    }

    address public immutable owner;
    bytes32 public immutable expectedSeedRoot;
    bytes32 public activeGameId;
    bytes32 public pendingEngineRelease;
    uint256 public totalReserved;
    uint256 public totalClaimable;
    bool public paused = true;
    bool private entered;

    mapping(bytes32 => Game) private games;
    mapping(bytes32 => Search) private searches;
    mapping(bytes32 => uint16[]) private moveHistory;
    mapping(bytes32 => mapping(bytes32 => uint8)) public repetitions;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(address => uint256) public claimable;

    event EntriesPaused(bool paused);
    event PoolFunded(address indexed funder, uint256 amount);
    event PoolWithdrawal(address indexed recipient, uint256 amount);
    event GameEntered(bytes32 indexed gameId, address indexed player, uint256 nonce, bytes32 engineConfigHash, uint64 turnDeadline);
    event MovePlayed(bytes32 indexed gameId, uint32 indexed ply, uint16 encodedMove, bytes32 positionHash, bytes32 transcriptHash);
    event SearchAdvanced(bytes32 indexed gameId, uint32 indexed ply, uint64 generation, uint32 step, bool pending, bytes32 root);
    event GameSettled(bytes32 indexed gameId, address indexed player, uint8 result, uint256 credited, bytes32 finalPositionHash, bytes32 transcriptHash);
    event PayoutClaimed(address indexed player, address indexed recipient, uint256 amount);
    event EngineReleased(bytes32 indexed gameId);

    error InvalidConfiguration();
    error Unauthorized();
    error Reentrancy();
    error InvalidAmount();
    error InvalidRecipient();
    error TransferFailed();
    error Paused();
    error Occupied();
    error InvalidEntry();
    error InsufficientFreePool();
    error UnknownGame();
    error Finished();
    error WrongTurn();
    error DeadlinePassed();
    error DeadlinePending();
    error DrawUnavailable();
    error EngineNotReady();
    error StaleSearch();
    error InvalidEngineResult();

    constructor(address poolOwner, bytes32 pinnedSeedRoot) {
        if (block.chainid != CHAIN_ID || poolOwner == address(0) || poolOwner == address(this) || pinnedSeedRoot == 0) {
            revert InvalidConfiguration();
        }
        owner = poolOwner;
        expectedSeedRoot = pinnedSeedRoot;
    }

    modifier guard() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Verify the protocol feature, exact seed and narrow caller registration.
    function engineReady() public view returns (bool) {
        (bool ok, bytes memory response) = address(ENGINE).staticcall(abi.encodeCall(IGL3Stockfish.gameCoordinator, ()));
        if (!ok || response.length != 32 || abi.decode(response, (uint256)) != uint160(address(this))) return false;
        (ok, response) = address(ENGINE).staticcall(abi.encodeCall(IGL3Stockfish.engineStatus, ()));
        if (!ok || response.length != 96) return false;
        (bytes32 moduleSha256, bytes32 seedRoot, uint256 available) = abi.decode(response, (bytes32, bytes32, uint256));
        return available == 1 && moduleSha256 == ENGINE_MODULE_SHA && seedRoot == expectedSeedRoot;
    }

    function getGame(bytes32 id) external view returns (Game memory) { return games[id]; }
    function getSearch(bytes32 id) external view returns (Search memory) { return searches[id]; }
    function getMoves(bytes32 id) external view returns (uint16[] memory) { return moveHistory[id]; }

    function engineProgress(bytes32 id) external view returns (EngineProgress memory) {
        return _inspect(id);
    }

    function freePool() public view returns (uint256) {
        uint256 liabilities = totalReserved + totalClaimable;
        uint256 balance = address(this).balance;
        return balance > liabilities ? balance - liabilities : 0;
    }

    function isSolvent() external view returns (bool) {
        return address(this).balance >= totalReserved + totalClaimable;
    }

    function setPaused(bool value) external onlyOwner guard {
        if (!value) _requireEngine();
        paused = value;
        emit EntriesPaused(value);
    }

    function fundPool() external payable guard {
        if (msg.value == 0) revert InvalidAmount();
        emit PoolFunded(msg.sender, msg.value);
    }

    function withdrawPool(address payable recipient, uint256 amount) external onlyOwner guard {
        if (amount == 0 || amount > freePool()) revert InsufficientFreePool();
        _pay(recipient, amount);
        emit PoolWithdrawal(recipient, amount);
    }

    function gameIdFor(address player, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), player, nonce));
    }

    function enterGame(uint256 nonce) external payable guard returns (bytes32 id) {
        if (paused) revert Paused();
        if (activeGameId != 0 || pendingEngineRelease != 0) revert Occupied();
        if (msg.value != ENTRY_FEE || nonceUsed[msg.sender][nonce] || msg.sender == address(this)) revert InvalidEntry();
        // The incoming fee cannot fund the prize being reserved.
        if (address(this).balance - msg.value < totalClaimable + TOTAL_PRIZE) revert InsufficientFreePool();
        _requireEngine();

        id = gameIdFor(msg.sender, nonce);
        if (id == 0 || ENGINE.newGame(id) != expectedSeedRoot) revert InvalidEngineResult();
        EngineProgress memory initialEngine = _inspect(id);
        if (initialEngine.generation != 1 || initialEngine.step != 0 || initialEngine.pending
            || initialEngine.root != expectedSeedRoot) revert InvalidEngineResult();

        nonceUsed[msg.sender][nonce] = true;
        Game storage game = games[id];
        game.player = msg.sender;
        game.nonce = nonce;
        game.openedAt = uint64(block.timestamp);
        game.turnDeadline = game.openedAt + HUMAN_TURN_SECONDS;
        game.transcriptHash = INITIAL_TRANSCRIPT_HASH;
        HybridChessRules.Position memory initialPosition = HybridChessRules.initial();
        _store(game, initialPosition);
        repetitions[id][initialPosition.key()] = 1;
        searches[id].generation = initialEngine.generation;
        searches[id].root = initialEngine.root;
        activeGameId = id;
        totalReserved = TOTAL_PRIZE;
        emit GameEntered(id, msg.sender, nonce, ENGINE_MODULE_SHA, game.turnDeadline);
    }

    function playHumanMove(bytes32 id, uint16 move_, uint32 expectedPly) external guard {
        Game storage game = _active(id);
        if (msg.sender != game.player) revert Unauthorized();
        if (game.blackToMove) revert WrongTurn();
        if (game.ply != expectedPly) revert StaleSearch();
        _beforeDeadline(game);
        _play(id, game, move_);
    }

    /// @notice Start the exact search from the canonical adjudicated move history.
    function beginBotSearch(bytes32 id, uint32 expectedPly, bytes32 expectedPositionHash) external guard {
        Game storage game = _blackTurn(id);
        Search storage search = searches[id];
        if (search.phase != Phase.Idle || game.ply != expectedPly || game.positionHash != expectedPositionHash) {
            revert StaleSearch();
        }
        _requireEngine();
        _assertEngine(id, search, false, false);
        search.ply = game.ply;
        search.positionHash = game.positionHash;
        search.transcriptHash = game.transcriptHash;
        (uint32 step, bool pending, bytes32 root) = ENGINE.begin(id, search.generation, StockfishMoveCodec.history(moveHistory[id]));
        _recordStep(id, search, 1, step, pending, root);
    }

    /// @notice Any caller may pay for the next bounded consensus increment.
    function advanceBotSearch(bytes32 id, uint64 expectedGeneration, uint32 expectedStep) external guard {
        Game storage game = _blackTurn(id);
        Search storage search = searches[id];
        if (search.phase != Phase.Running || search.generation != expectedGeneration || search.step != expectedStep) {
            revert StaleSearch();
        }
        _requireBinding(game, search);
        _requireEngine();
        _assertEngine(id, search, true, false);
        (uint32 step, bool pending, bytes32 root) = ENGINE.advance(id, expectedGeneration, expectedStep);
        _recordStep(id, search, expectedStep + 1, step, pending, root);
    }

    /// @notice Apply only the complete engine outcome for the current exact search.
    function applyBotMove(bytes32 id, uint64 expectedGeneration, uint32 expectedStep, bytes32 expectedRoot) external guard {
        Game storage game = _blackTurn(id);
        Search storage search = searches[id];
        if (search.phase != Phase.Ready || search.generation != expectedGeneration
            || search.step != expectedStep || search.root != expectedRoot) revert StaleSearch();
        _requireBinding(game, search);
        _requireEngine();
        EngineProgress memory result = _assertEngine(id, search, false, true);
        _validateDecision(result);
        search.phase = Phase.Idle;
        search.generation = result.generation;
        _play(id, game, StockfishMoveCodec.decode(result.move));
    }

    function claimDraw(bytes32 id) external guard {
        Game storage game = _active(id);
        if (msg.sender != game.player) revert Unauthorized();
        if (game.blackToMove) revert WrongTurn();
        _beforeDeadline(game);
        if (game.halfmoveClock < 100 && repetitions[id][_position(game).key()] < 3) revert DrawUnavailable();
        _settle(id, game, Result.Draw, 0);
    }

    function resign(bytes32 id) external guard {
        Game storage game = _active(id);
        if (msg.sender != game.player) revert Unauthorized();
        _settle(id, game, Result.HumanResigned, 0);
    }

    function claimTimeout(bytes32 id) external guard {
        Game storage game = _active(id);
        if (block.timestamp <= game.turnDeadline) revert DeadlinePending();
        if (game.blackToMove) _settle(id, game, Result.ServiceTimeoutRefund, ENTRY_FEE);
        else _settle(id, game, Result.PlayerTimeout, 0);
    }

    /// @notice Release completed or aborted engine state independently of payout.
    function releaseEndedGame(bytes32 id) external guard {
        if (id == 0 || id != pendingEngineRelease) revert UnknownGame();
        _requireEngine();
        if (!ENGINE.releaseGame(id)) revert InvalidEngineResult();
        pendingEngineRelease = 0;
        emit EngineReleased(id);
    }

    function claimPayout(address payable recipient) external guard {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert InvalidAmount();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        _pay(recipient, amount);
        emit PayoutClaimed(msg.sender, recipient, amount);
    }

    function _inspect(bytes32 id) private view returns (EngineProgress memory result) {
        (result.generation, result.step, result.pending, result.observedNodes,
            result.move, result.actualNodes, result.depth, result.root) = ENGINE.inspect(id);
    }

    function _assertEngine(bytes32 id, Search storage search, bool pending, bool finished)
        private view returns (EngineProgress memory result)
    {
        result = _inspect(id);
        uint64 expectedGeneration = finished ? search.generation + 1 : search.generation;
        if (result.generation != expectedGeneration || result.step != search.step
            || result.pending != pending || result.root != search.root) revert StaleSearch();
    }

    function _recordStep(bytes32 id, Search storage search, uint32 expected, uint32 step, bool pending, bytes32 root) private {
        if (step != expected || root == 0) revert InvalidEngineResult();
        search.step = step;
        search.root = root;
        search.phase = pending ? Phase.Running : Phase.Ready;
        EngineProgress memory result = _assertEngine(id, search, pending, !pending);
        if (!pending) _validateDecision(result);
        emit SearchAdvanced(id, search.ply, search.generation, step, pending, root);
    }

    function _validateDecision(EngineProgress memory result) private pure {
        // Depth 245 is the exact engine's proven terminal search exception.
        if (result.depth == 0 || (result.actualNodes < NODES_PER_MOVE && result.depth != ENGINE_TERMINAL_DEPTH)) {
            revert InvalidEngineResult();
        }
    }

    function _requireBinding(Game storage game, Search storage search) private view {
        if (search.ply != game.ply || search.positionHash != game.positionHash
            || search.transcriptHash != game.transcriptHash) revert StaleSearch();
    }

    function _requireEngine() private view {
        if (!engineReady()) revert EngineNotReady();
    }

    function _active(bytes32 id) private view returns (Game storage game) {
        game = games[id];
        if (game.player == address(0)) revert UnknownGame();
        if (game.result != Result.Active || id != activeGameId) revert Finished();
    }

    function _blackTurn(bytes32 id) private view returns (Game storage game) {
        game = _active(id);
        if (!game.blackToMove) revert WrongTurn();
        _beforeDeadline(game);
    }

    function _beforeDeadline(Game storage game) private view {
        if (block.timestamp > game.turnDeadline) revert DeadlinePassed();
    }

    function _position(Game storage game) private view returns (HybridChessRules.Position memory) {
        return HybridChessRules.Position(game.board, game.castling, game.enPassant, game.halfmoveClock, game.blackToMove);
    }

    function _store(Game storage game, HybridChessRules.Position memory position) private {
        game.board = position.board;
        game.castling = position.castling;
        game.enPassant = position.enPassant;
        game.halfmoveClock = position.halfmoveClock;
        game.blackToMove = position.blackToMove;
        game.positionHash = keccak256(abi.encode(position.board, position.castling, position.enPassant, position.blackToMove));
    }

    function _play(bytes32 id, Game storage game, uint16 move_) private {
        HybridChessRules.Position memory position = _position(game).applyMove(move_);
        _store(game, position);
        game.ply++;
        moveHistory[id].push(move_);
        game.transcriptHash = keccak256(abi.encode(game.transcriptHash, move_));
        uint8 repeats = ++repetitions[id][position.key()];
        game.turnDeadline = uint64(block.timestamp) + (position.blackToMove ? BOT_TURN_SECONDS : HUMAN_TURN_SECONDS);
        emit MovePlayed(id, game.ply, move_, game.positionHash, game.transcriptHash);

        if (!position.hasLegalMove()) {
            if (position.inCheck(position.blackToMove)) {
                _settle(id, game, position.blackToMove ? Result.HumanCheckmate : Result.BotCheckmate,
                    position.blackToMove ? TOTAL_PRIZE : 0);
            } else {
                _settle(id, game, Result.Draw, 0);
            }
        } else if (position.insufficient() || repeats >= 5 || position.halfmoveClock >= 150
            || (position.blackToMove && (repeats >= 3 || position.halfmoveClock >= 100))) {
            _settle(id, game, Result.Draw, 0);
        } else if (position.blackToMove && game.ply > MAX_ENGINE_HISTORY_PLIES) {
            _settle(id, game, Result.EngineLimitRefund, ENTRY_FEE);
        }
    }

    function _settle(bytes32 id, Game storage game, Result result, uint256 amount) private {
        game.result = result;
        totalReserved = 0;
        activeGameId = 0;
        pendingEngineRelease = id;
        if (amount != 0) {
            claimable[game.player] += amount;
            totalClaimable += amount;
        }
        if (result == Result.HumanCheckmate && !paused) {
            paused = true;
            emit EntriesPaused(true);
        }
        emit GameSettled(id, game.player, uint8(result), amount, game.positionHash, game.transcriptHash);
    }

    function _pay(address payable recipient, uint256 amount) private {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
