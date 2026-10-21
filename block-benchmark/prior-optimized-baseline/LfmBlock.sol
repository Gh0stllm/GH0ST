// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Research implementation of LFM2.5-230M layer zero at one sequence position.
/// @dev Fixed-point approximation, not a complete LLM. One serial job per instance.
///      Immutable code shards are bound at construction. Only the owner may provide
///      a new block input; anyone may advance deterministic steps. No asset handling.
contract LfmBlock {
    error InvalidInput();
    error WrongStage();
    error Unauthorized();
    error Overflow();
    address public immutable owner;
    bytes32 public immutable weightsHash;
    address[355] public shards;
    uint256[2368] private words;
    uint256 public stage;
    uint256 public cursor;
    uint256 public tokens;
    event Progress(uint256 stage, uint256 cursor, bytes32 digest);

    constructor(address[] memory data) {
        if (data.length != 355) revert InvalidInput();
        owner = msg.sender;
        bytes32[] memory hashes = new bytes32[](355);
        for (uint256 i; i < 355; ++i) {
            uint256 expected = i < 288 ? 16513 : i < 352 ? 20545 : i == 352 ? 8193 : i == 353 ? 12289 : 8197;
            if (data[i].code.length != expected) revert InvalidInput();
            shards[i] = data[i];
            hashes[i] = data[i].codehash;
        }
        weightsHash = keccak256(abi.encode(hashes));
    }

    function begin(bytes calldata input) external {
        if (msg.sender != owner) revert Unauthorized();
        if (stage != 0 && stage != 11) revert WrongStage();
        if (input.length != 4096) revert InvalidInput();
        _write(0, input);
        stage = 1;
        cursor = 0;
        ++tokens;
    }

    function step() external returns (bytes32 digest) {
        uint256 s = stage;
        uint256 row = cursor;
        bytes memory out;
        if (s == 1) {
            out = _norm(_read(0, 1024), 0);
            _write(128, out);
            stage = 2;
        } else if (s == 2 || s == 4 || s == 6 || s == 7 || s == 9) {
            uint256 cols = s == 9 ? 2560 : 1024;
            uint256 count = s == 9 ? 16 : 32;
            uint256 first = s == 2 ? 0 : s == 4 ? 96 : s == 6 ? 128 : s == 7 ? 208 : 288;
            uint256 src = s == 2 ? 128 : s == 4 ? 640 : s == 9 ? 1664 : 896;
            uint256 dst = s == 2 ? 256 : s == 4 ? 768 : s == 6 ? 1024 : s == 7 ? 1344 : 1984;
            uint256 total = s == 2 ? 3072 : s == 6 || s == 7 ? 2560 : 1024;
            out = _project(_read(src, cols), _code(first + row / count), count, cols);
            _write(dst + row / 8, out);
            cursor += count;
            if (cursor == total) { cursor = 0; stage = s + 1; }
        } else if (s == 3) {
            out = _convolution(row);
            cursor += 128;
            if (cursor == 1024) { cursor = 0; stage = 4; }
        } else if (s == 5) {
            bytes memory residual = _add(_read(0, 1024), _read(768, 1024));
            _write(768, residual);
            bytes memory normalized = _norm(residual, 1024);
            _write(896, normalized);
            out = abi.encodePacked(residual, normalized);
            stage = 6;
        } else if (s == 8) {
            bytes memory a = _read(1024 + row / 8, 128);
            bytes memory b = _read(1344 + row / 8, 128);
            bytes memory lut = _code(354);
            out = new bytes(512);
            for (uint256 i; i < 128; ++i) {
                _put(out, i, _silu(_get(a, i), lut) * _get(b, i) / 65536);
            }
            _write(1664 + row / 8, out);
            cursor += 128;
            if (cursor == 2560) { cursor = 0; stage = 9; }
        } else if (s == 10) {
            out = _add(_read(768, 1024), _read(1984, 1024));
            _write(1984, out);
            stage = 11;
        } else revert WrongStage();
        digest = keccak256(out);
        emit Progress(s, row, digest);
    }

    /// @notice Read persisted checkpoints; id 0..11 follows the documented vector map.
    function vector(uint256 id) external view returns (bytes memory) {
        uint256[12] memory starts = [uint256(0),128,256,640,768,896,1024,1344,1664,1984,2112,2240];
        if (id >= 12) revert InvalidInput();
        return _read(starts[id], id == 2 ? 3072 : id >= 6 && id <= 8 ? 2560 : 1024);
    }

    function siluProbe(int256 x) external view returns (int256) {
        if (x < type(int32).min || x > type(int32).max) revert Overflow();
        return _silu(x, _code(354));
    }

    /// @notice Pure differential-testing surface; never changes inference state.
    function projectProbe(bytes memory x, bytes memory w, uint256 rows, uint256 cols)
        external pure returns (bytes memory)
    {
        if (rows == 0 || rows > 32 || cols == 0 || cols > 2560 || cols % 4 != 0
            || x.length != cols * 4 || w.length != rows * (cols / 2 + 4)) revert InvalidInput();
        return _project(x, w, rows, cols);
    }

    function _convolution(uint256 row) private returns (bytes memory) {
        bytes memory b = _read(256 + row / 8, 128);
        bytes memory c = _read(384 + row / 8, 128);
        bytes memory x = _read(512 + row / 8, 128);
        bytes memory old = _read(2112 + row / 8, 128);
        bytes memory prev = _read(2240 + row / 8, 128);
        bytes memory coeff = _code(353);
        bytes memory bx = new bytes(512);
        bytes memory out = new bytes(512);
        for (uint256 i; i < 128; ++i) {
            int256 v = _get(b, i) * _get(x, i) / 65536;
            _put(bx, i, v);
            uint256 k = 3 * (row + i);
            int256 cv = (_get(old, i) * _get(coeff, k) + _get(prev, i) * _get(coeff, k+1)
                         + v * _get(coeff, k+2)) / 16777216;
            _put(out, i, _get(c, i) * cv / 65536);
        }
        _write(640 + row / 8, out);
        _write(2112 + row / 8, prev);
        _write(2240 + row / 8, bx);
        return abi.encodePacked(out, prev, bx);
    }

    function _norm(bytes memory x, uint256 offset) private view returns (bytes memory out) {
        uint256 sum;
        for (uint256 i; i < 1024; ++i) { int256 v = _get(x, i); sum += uint256(v * v); }
        int256 root = int256(integerSqrt(sum / 1024 + 42950));
        bytes memory gamma = _code(352);
        out = new bytes(4096);
        for (uint256 i; i < 1024; ++i) _put(out, i, _get(x, i) * _get(gamma, offset+i) / root);
    }

    function integerSqrt(uint256 x) public pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = x / 2 + x % 2;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }

    function _silu(int256 x, bytes memory lut) private pure returns (int256) {
        if (x <= -1048576) return 0;
        if (x >= 1048576) return x;
        uint256 shifted = uint256(x + 1048576);
        uint256 index = shifted / 1024;
        int256 a = _get(lut, index);
        int256 sig = a + (_get(lut, index+1) - a) * int256(shifted % 1024) / 1024;
        return x * sig / 1073741824;
    }

    function _project(bytes memory x, bytes memory weights, uint256 rows, uint256 cols)
        internal pure virtual returns (bytes memory out)
    {
        out = new bytes(rows * 4);
        for (uint256 row; row < rows; ++row) {
            int256 sum;
            uint256 stride = cols / 2 + 4;
            int256 scale;
            assembly ("memory-safe") {
                scale := signextend(3,shr(224,mload(add(add(weights,32),mul(row,stride)))))
            }
            if (scale <= 0) revert InvalidInput();
            assembly ("memory-safe") {
                let xp := add(x, 32)
                let wp := add(add(weights, 36), mul(row, stride))
                for { let col := 0 } lt(col, cols) { col := add(col, 1) } {
                    let packed := byte(0, mload(add(wp, shr(1, col))))
                    let nibble := and(shr(mul(and(col, 1), 4), packed), 15)
                    let w := sub(xor(nibble, 8), 8)
                    let a := signextend(3, shr(224, mload(add(xp, mul(col, 4)))))
                    sum := add(sum, mul(w, a))
                }
            }
            _put(out, row, sum * scale / 16777216);
        }
    }

    function _add(bytes memory a, bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(4096);
        for (uint256 i; i < 1024; ++i) _put(out, i, _get(a,i) + _get(b,i));
    }

    function _code(uint256 index) private view returns (bytes memory data) {
        address target = shards[index];
        uint256 size = target.code.length - 1;
        data = new bytes(size);
        assembly ("memory-safe") { extcodecopy(target, add(data,32), 1, size) }
    }

    function _get(bytes memory data, uint256 i) internal pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(3, shr(224, mload(add(add(data,32),mul(i,4))))) }
    }

    function _put(bytes memory data, uint256 i, int256 value) internal pure {
        if (value < type(int32).min || value > type(int32).max) revert Overflow();
        assembly ("memory-safe") {
            let p := add(add(data,32),mul(shr(3,i),32))
            let shift := sub(224,mul(and(i,7),32))
            mstore(p,or(and(mload(p),not(shl(shift,0xffffffff))),shl(shift,and(value,0xffffffff))))
        }
    }

    function _read(uint256 start, uint256 count) private view returns (bytes memory data) {
        data = new bytes(count * 4);
        assembly ("memory-safe") {
            let p := add(data,32)
            let slot := add(words.slot,start)
            for { let i := 0 } lt(i,div(count,8)) { i := add(i,1) } {
                mstore(add(p,mul(i,32)),sload(add(slot,i)))
            }
        }
    }

    function _write(uint256 start, bytes memory data) private {
        assembly ("memory-safe") {
            let p := add(data,32)
            let slot := add(words.slot,start)
            for { let i := 0 } lt(i,div(mload(data),32)) { i := add(i,1) } {
                sstore(add(slot,i),mload(add(p,mul(i,32))))
            }
        }
    }
}
