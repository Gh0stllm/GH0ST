// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../vendor/MoveVerification.sol";

/// @notice Local comparison harness for native move-validation/state-write costs.
/// No bot search, token handling, escrow, production admission or full FIDE claim.
contract RuleCostGame {
    MoveVerification public immutable verifier;
    uint256 public board = 0xcbaedabc99999999000000000000000000000000000000001111111143265234;
    uint32 public playerState = 0x000704ff;
    uint32 public opponentState = 0x383f3cff;
    uint32 public plies;
    uint8 public outcome;
    bool public blackToMove;

    event MoveApplied(uint16 encodedMove, uint32 ply, uint8 outcome, uint256 board);

    constructor(address rules) {
        require(rules.code.length != 0, "rules missing");
        verifier = MoveVerification(rules);
    }

    function play(uint16 encodedMove) external {
        require(outcome == 0, "terminal game");
        // Prevent the upstream verifier's special resign/draw encodings from being
        // interpreted as legal board moves in this cost-only comparison.
        require(encodedMove < 4096, "board moves only");
        uint16[] memory moves = new uint16[](1);
        moves[0] = encodedMove;
        (uint8 result, uint256 nextBoard, uint32 nextPlayer, uint32 nextOpponent) =
            verifier.checkGame(board, playerState, opponentState, blackToMove, moves);
        board = nextBoard;
        playerState = nextPlayer;
        opponentState = nextOpponent;
        blackToMove = !blackToMove;
        outcome = result;
        plies += 1;
        emit MoveApplied(encodedMove, plies, result, nextBoard);
    }
}
