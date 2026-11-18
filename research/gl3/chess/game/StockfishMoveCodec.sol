// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Canonical UCI and GH0ST board move conversion for the A14 engine.
/// @dev Legality remains the responsibility of HybridChessRules.
library StockfishMoveCodec {
    uint256 internal constant MAX_HISTORY_PLIES = 1024;

    error InvalidMoveEncoding();
    error HistoryTooLong();

    function history(uint16[] storage moves) internal view returns (string memory) {
        uint256 count = moves.length;
        if (count > MAX_HISTORY_PLIES) revert HistoryTooLong();
        if (count == 0) return "";

        // Count exactly so canonical history has no padding or trailing separator.
        uint256 length = count * 5 - 1;
        for (uint256 i; i < count; ++i) {
            if (moves[i] >> 12 != 0) ++length;
        }
        bytes memory output = new bytes(length);
        uint256 cursor;
        for (uint256 i; i < count; ++i) {
            if (i != 0) output[cursor++] = 0x20;
            uint16 move_ = moves[i];
            uint8 from = uint8((move_ >> 6) & 63);
            uint8 to = uint8(move_ & 63);
            if (from == to) revert InvalidMoveEncoding();
            output[cursor++] = bytes1(uint8(97 + from % 8));
            output[cursor++] = bytes1(uint8(49 + from / 8));
            output[cursor++] = bytes1(uint8(97 + to % 8));
            output[cursor++] = bytes1(uint8(49 + to / 8));
            uint16 promotion = move_ >> 12;
            if (promotion != 0) output[cursor++] = promotionLetter(promotion);
        }
        return string(output);
    }

    function decode(string memory uci) internal pure returns (uint16) {
        bytes memory text = bytes(uci);
        if (text.length != 4 && text.length != 5) revert InvalidMoveEncoding();
        uint16 from = square(text[0], text[1]);
        uint16 to = square(text[2], text[3]);
        if (from == to) revert InvalidMoveEncoding();

        uint16 promotion;
        if (text.length == 5) {
            bytes1 letter = text[4];
            if (letter == 0x6e) promotion = 2; // n
            else if (letter == 0x62) promotion = 3; // b
            else if (letter == 0x72) promotion = 4; // r
            else if (letter == 0x71) promotion = 5; // q
            else revert InvalidMoveEncoding();
        }
        return (promotion << 12) | (from << 6) | to;
    }

    function square(bytes1 file, bytes1 rank) private pure returns (uint16) {
        uint16 f = uint8(file);
        uint16 r = uint8(rank);
        if (f < 97 || f > 104 || r < 49 || r > 56) revert InvalidMoveEncoding();
        return (r - 49) * 8 + (f - 97);
    }

    function promotionLetter(uint16 piece) private pure returns (bytes1) {
        if (piece == 2) return 0x6e;
        if (piece == 3) return 0x62;
        if (piece == 4) return 0x72;
        if (piece == 5) return 0x71;
        revert InvalidMoveEncoding();
    }
}
