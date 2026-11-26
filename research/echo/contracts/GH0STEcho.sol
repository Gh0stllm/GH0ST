// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Archive a solo route, then replay it alongside a second player's moves.
contract GH0STEcho {
    uint8 public constant MAX_TICKS = 32;
    uint8 private constant SPAWN = 28;
    uint8 private constant PLATE = 12;
    uint8 private constant EXIT = 34;
    bytes private constant ROOM =
        "#########"
        "#..P.#..#"
        "#.##.#..#"
        "#S...G.E#"
        "#.##.#..#"
        "#....#..#"
        "#########";

    struct Run {
        address player;
        bytes moves;
    }

    uint256 public runCount;
    mapping(uint256 => Run) private runs;
    mapping(address => mapping(uint256 => bool)) public clearedWith;

    event RunRecorded(uint256 indexed runId, address indexed player, bytes moves);
    event RoomCleared(uint256 indexed runId, address indexed player, address indexed ghostPlayer, bytes moves);

    error InvalidLength();
    error InvalidMove();
    error MissedPlate();
    error UnknownRun();
    error OwnGhost();
    error MissedExit();
    error AlreadyCleared();

    function room() external pure returns (bytes memory) {
        return ROOM;
    }

    function recordRun(bytes calldata moves) external returns (uint256 runId) {
        _checkLength(moves.length);
        uint8 ghost = SPAWN;
        bool touched;
        for (uint256 i; i < moves.length; ++i) {
            ghost = _step(ghost, moves[i], false);
            if (ghost == PLATE) touched = true;
        }
        if (!touched) revert MissedPlate();
        runId = ++runCount;
        runs[runId] = Run(msg.sender, moves);
        emit RunRecorded(runId, msg.sender, moves);
    }

    function getRun(uint256 runId) external view returns (address player, bytes memory moves) {
        Run storage run = _get(runId);
        return (run.player, run.moves);
    }

    /// @notice Preview positions without requiring a connected wallet. Tile = y * 9 + x.
    function preview(uint256 runId, bytes calldata moves)
        external view returns (bool won, uint8 runnerTile, uint8 ghostTile)
    {
        return _replay(_get(runId).moves, moves);
    }

    function clearRoom(uint256 runId, bytes calldata moves) external returns (bool) {
        Run storage run = _get(runId);
        if (run.player == msg.sender) revert OwnGhost();
        if (clearedWith[msg.sender][runId]) revert AlreadyCleared();
        (bool won,,) = _replay(run.moves, moves);
        if (!won) revert MissedExit();
        clearedWith[msg.sender][runId] = true;
        emit RoomCleared(runId, msg.sender, run.player, moves);
        return true;
    }

    function _get(uint256 runId) private view returns (Run storage) {
        if (runId == 0 || runId > runCount) revert UnknownRun();
        return runs[runId];
    }

    function _replay(bytes memory archive, bytes calldata moves)
        private pure returns (bool won, uint8 runnerTile, uint8 ghostTile)
    {
        _checkLength(moves.length);
        ghostTile = SPAWN;
        runnerTile = SPAWN;
        for (uint256 i; i < moves.length; ++i) {
            // A finished ghost holds its last tile. Archive movement always follows solo rules.
            if (i < archive.length) ghostTile = _step(ghostTile, archive[i], false);
            runnerTile = _step(runnerTile, moves[i], ghostTile == PLATE);
        }
        won = runnerTile == EXIT;
    }

    function _checkLength(uint256 length) private pure {
        if (length == 0 || length > MAX_TICKS) revert InvalidLength();
    }

    function _step(uint8 tile, bytes1 move, bool gateOpen) private pure returns (uint8) {
        if (move == ".") return tile;
        uint8 next;
        if (move == "U") next = tile - 9;
        else if (move == "D") next = tile + 9;
        else if (move == "L") next = tile - 1;
        else if (move == "R") next = tile + 1;
        else revert InvalidMove();
        // The outer border is solid, so a reachable position has four in-bounds neighbors.
        bytes1 terrain = ROOM[next];
        if (terrain == "#" || (terrain == "G" && !gateOpen)) return tile;
        return next;
    }
}
