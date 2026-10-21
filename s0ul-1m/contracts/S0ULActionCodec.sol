// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact parser for the frozen S0UL action-output grammar.
/// @dev Parsing establishes syntax only. It grants no authorization or execution rights.
library S0ULActionCodec {
    struct Action {
        uint8 kind;
        bytes32 key;
        bytes value;
        uint256 taskId;
    }

    /// @return valid False for any noncanonical or unsupported action.
    /// @return a Kinds: WAIT=0, BALANCE_ETH=1, BALANCE_GH0ST=2, MEM_SET=3,
    /// MEM_GET=4, TASK_ADD=5, TASK_LIST=6, TASK_DONE=7, CLARIFY=8, REFUSE=9.
    function parse(bytes memory text) internal pure returns (bool valid, Action memory a) {
        a.value = new bytes(0);
        uint256 length = text.length;
        if (length == 0 || length > 100) return (false, a);

        uint256 first = length;
        uint256 second = length;
        uint256 fields = 1;
        for (uint256 i; i < length; ++i) {
            uint8 c = uint8(text[i]);
            if (c == 0x7c) {
                if (fields == 1) first = i;
                else if (fields == 2) second = i;
                else return (false, a);
                ++fields;
            } else if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
                || (c >= 0x30 && c <= 0x39) || c == 0x5f)) {
                // The canonical grammar contains no whitespace, controls, UTF-8
                // bytes, punctuation or normalization alternatives.
                return (false, a);
            }
        }

        if (fields == 1) return (_eq(text, 0, first, "WAIT"), a);

        uint256 argument = first + 1;
        uint256 argumentLength = fields == 2 ? length - argument : second - argument;
        if (_eq(text, 0, first, "BALANCE")) {
            if (fields != 3 || !_eq(text, argument, argumentLength, "SELF")) return (false, a);
            uint256 asset = second + 1;
            if (_eq(text, asset, length - asset, "ETH")) a.kind = 1;
            else if (_eq(text, asset, length - asset, "GH0ST")) a.kind = 2;
            else return (false, a);
            return (true, a);
        }
        if (_eq(text, 0, first, "MEM_SET")) {
            if (fields != 3) return (false, a);
            a.key = _memoryKey(text, argument, argumentLength);
            uint256 value = second + 1;
            if (a.key == bytes32(0) || !_slug(text, value, length - value)) return (false, a);
            a.kind = 3;
            a.value = _copy(text, value, length - value);
            return (true, a);
        }
        if (fields != 2) return (false, a);
        if (_eq(text, 0, first, "MEM_GET")) {
            a.key = _memoryKey(text, argument, argumentLength);
            if (a.key == bytes32(0)) return (false, a);
            a.kind = 4;
        } else if (_eq(text, 0, first, "TASK_ADD")) {
            if (!_slug(text, argument, argumentLength)) return (false, a);
            a.kind = 5;
            a.value = _copy(text, argument, argumentLength);
        } else if (_eq(text, 0, first, "TASK_LIST")) {
            if (!_eq(text, argument, argumentLength, "SELF")) return (false, a);
            a.kind = 6;
        } else if (_eq(text, 0, first, "TASK_DONE")) {
            (bool numberValid, uint256 taskId) = _taskId(text, argument, argumentLength);
            if (!numberValid) return (false, a);
            a.kind = 7;
            a.taskId = taskId;
        } else if (_eq(text, 0, first, "CLARIFY")) {
            a.key = _clarification(text, argument, argumentLength);
            if (a.key == bytes32(0)) return (false, a);
            a.kind = 8;
        } else if (_eq(text, 0, first, "REFUSE")) {
            a.key = _refusal(text, argument, argumentLength);
            if (a.key == bytes32(0)) return (false, a);
            a.kind = 9;
        } else return (false, a);
        return (true, a);
    }

    function _eq(bytes memory text, uint256 start, uint256 length, string memory literal)
        private pure returns (bool)
    {
        bytes memory expected = bytes(literal);
        if (length != expected.length || start > text.length || length > text.length - start) return false;
        for (uint256 i; i < length; ++i) if (text[start + i] != expected[i]) return false;
        return true;
    }

    function _memoryKey(bytes memory text, uint256 start, uint256 length) private pure returns (bytes32) {
        if (_eq(text, start, length, "theme")) return bytes32("theme");
        if (_eq(text, start, length, "language")) return bytes32("language");
        if (_eq(text, start, length, "mode")) return bytes32("mode");
        return bytes32(0);
    }

    function _clarification(bytes memory text, uint256 start, uint256 length) private pure returns (bytes32) {
        if (_eq(text, start, length, "asset")) return bytes32("asset");
        if (_eq(text, start, length, "key")) return bytes32("key");
        if (_eq(text, start, length, "value")) return bytes32("value");
        if (_eq(text, start, length, "title")) return bytes32("title");
        if (_eq(text, start, length, "task_id")) return bytes32("task_id");
        if (_eq(text, start, length, "request")) return bytes32("request");
        return bytes32(0);
    }

    function _refusal(bytes memory text, uint256 start, uint256 length) private pure returns (bytes32) {
        if (_eq(text, start, length, "unsupported")) return bytes32("unsupported");
        if (_eq(text, start, length, "unauthorized")) return bytes32("unauthorized");
        if (_eq(text, start, length, "unsafe")) return bytes32("unsafe");
        return bytes32(0);
    }

    function _slug(bytes memory text, uint256 start, uint256 length) private pure returns (bool) {
        if (length == 0 || length > 24) return false;
        uint8 first = uint8(text[start]);
        if (first < 0x61 || first > 0x7a) return false;
        for (uint256 i = 1; i < length; ++i) {
            uint8 c = uint8(text[start + i]);
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        return true;
    }

    function _taskId(bytes memory text, uint256 start, uint256 length) private pure returns (bool, uint256 value) {
        if (length == 0 || length > 4) return (false, 0);
        uint8 first = uint8(text[start]);
        if (first < 0x31 || first > 0x39) return (false, 0);
        for (uint256 i; i < length; ++i) {
            uint8 c = uint8(text[start + i]);
            if (c < 0x30 || c > 0x39) return (false, 0);
            value = value * 10 + c - 0x30;
        }
        return (true, value);
    }

    function _copy(bytes memory text, uint256 start, uint256 length) private pure returns (bytes memory value) {
        value = new bytes(length);
        for (uint256 i; i < length; ++i) value[i] = text[start + i];
    }
}
