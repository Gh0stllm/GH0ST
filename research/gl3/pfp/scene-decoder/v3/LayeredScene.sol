// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Deterministic, native 64×64 image inference from the version-3 scene model.
/// @dev Seven immutable style shards hold quantized latents. A shared shard holds the
///      learned tile classification heads and RGBA palettes. The constructor checks
///      code hashes, sizes and the STOP prefix before binding the shard addresses.
contract LayeredScene {
    error InvalidDependency();
    error InvalidPrompt();

    event ImageGenerated(bytes32 indexed modelId, uint64 indexed prompt, uint64 indexed seed, bytes32 imageHash);

    uint256 private constant STYLE_BYTES = 69_632;
    uint256 private constant SHARED_BYTES = 12_576;
    uint256 private constant HEAD_BYTES = 4_608;
    uint256 private constant BACKGROUND_START = 36_864;
    uint256 private constant BACKGROUND_BYTES = 4_096;
    uint256 private constant SUBJECT_BYTES = 1_024;
    uint256 private constant ALTERNATE_START = 24_576;
    // Second-variant offsets by subject ID. 0xff marks an unavailable variant.
    bytes24 private constant ALTERNATES = hex"000102ffff03040506ff0708090affffffff0bffffffffff";

    address private immutable style0;
    address private immutable style1;
    address private immutable style2;
    address private immutable style3;
    address private immutable style4;
    address private immutable style5;
    address private immutable style6;
    address private immutable sharedShard;
    bytes32 public immutable modelId;

    constructor(address[8] memory shards, bytes32[8] memory expectedCodeHashes, bytes32 id) {
        for (uint256 i = 0; i < shards.length; ++i) {
            address shard = shards[i];
            uint256 payloadSize = i == 7 ? SHARED_BYTES : STYLE_BYTES;
            if (shard.code.length != payloadSize + 1 || shard.codehash != expectedCodeHashes[i]) {
                revert InvalidDependency();
            }
            bytes memory first = _copy(shard, 0, 1);
            if (first[0] != 0x00) revert InvalidDependency();
        }
        bytes memory magic = _copy(shards[7], 9_953, 8);
        if (bytes8(magic) != bytes8("GH0ST64B")) revert InvalidDependency();
        style0 = shards[0];
        style1 = shards[1];
        style2 = shards[2];
        style3 = shards[3];
        style4 = shards[4];
        style5 = shards[5];
        style6 = shards[6];
        sharedShard = shards[7];
        modelId = id;
    }

    /// @param prompt Eight high-to-low bytes: subjects A/B, tints A/B, relation, background, style, palette.
    /// @return packedPixels 4,096 row-major 5-bit palette indices, least significant bits first.
    /// @return paletteRGBA 32 RGBA colors, four bytes per color.
    function generate(uint64 prompt, uint64 seed)
        public view returns (bytes memory packedPixels, bytes memory paletteRGBA)
    {
        uint256 subjectA = uint8(prompt >> 56);
        uint256 subjectB = uint8(prompt >> 48);
        uint256 tintA = uint8(prompt >> 40);
        uint256 tintB = uint8(prompt >> 32);
        uint256 relation = uint8(prompt >> 24);
        uint256 background = uint8(prompt >> 16);
        uint256 style = uint8(prompt >> 8);
        uint256 palette = uint8(prompt);
        if (style >= 7 || palette >= 16 || relation >= 3 || background >= 8 || tintA >= 8 || tintB >= 8
            || subjectA == 0 || subjectA > 24 || subjectB > 24 || subjectA == subjectB
            || ((subjectB == 0) != (relation == 0))) {
            revert InvalidPrompt();
        }

        bytes32 variants = sha256(abi.encodePacked(prompt, seed));
        address styleShard = _style(style);
        bytes memory grid = new bytes(4_096);
        bytes memory backgroundHead = _copy(sharedShard, 1 + HEAD_BYTES, HEAD_BYTES);
        bytes memory backgroundTiles = _copy(
            styleShard, 1 + BACKGROUND_START + background * BACKGROUND_BYTES,
            BACKGROUND_BYTES
        );
        _draw(grid, backgroundTiles, backgroundHead, 16, 0, 0);

        bytes memory subjectHead = _copy(sharedShard, 1, HEAD_BYTES);
        uint256 originA = relation == 0 ? 16 * 64 + 16 : relation == 1 ? 16 * 64 : 16;
        _subject(grid, styleShard, subjectHead, subjectA, uint8(variants[1]) & 1, originA, 7);
        if (subjectB != 0) {
            uint256 originB = relation == 1 ? 16 * 64 + 32 : 32 * 64 + 16;
            _subject(grid, styleShard, subjectHead, subjectB, uint8(variants[2]) & 1, originB, 15);
        }
        packedPixels = _pack(grid);
        paletteRGBA = _palette(palette, tintA, tintB);
    }

    /// @notice Records the output commitment in a receipt and returns the full image.
    function generateAndRecord(uint64 prompt, uint64 seed)
        external returns (bytes memory packedPixels, bytes memory paletteRGBA)
    {
        (packedPixels, paletteRGBA) = generate(prompt, seed);
        emit ImageGenerated(modelId, prompt, seed, keccak256(abi.encodePacked(packedPixels, paletteRGBA)));
    }

    function _subject(
        bytes memory grid, address styleShard, bytes memory head, uint256 subject,
        uint256 variant, uint256 origin, uint256 firstColor
    ) private view {
        uint256 offset = (subject - 1) * SUBJECT_BYTES;
        uint256 alternate = uint8(ALTERNATES[subject - 1]);
        if (variant != 0 && alternate != 255) offset = ALTERNATE_START + alternate * SUBJECT_BYTES;
        _draw(grid, _copy(styleShard, 1 + offset, SUBJECT_BYTES), head, 8, origin, firstColor);
    }

    function _style(uint256 style) private view returns (address) {
        if (style == 0) return style0;
        if (style == 1) return style1;
        if (style == 2) return style2;
        if (style == 3) return style3;
        if (style == 4) return style4;
        if (style == 5) return style5;
        return style6;
    }

    function _copy(address shard, uint256 offset, uint256 size) private view returns (bytes memory result) {
        // Leave padding for the decoder's unaligned 32-byte loads.
        result = new bytes(size + 32);
        assembly ("memory-safe") {
            extcodecopy(shard, add(result, 32), offset, size)
            mstore(result, size)
        }
    }

    function _palette(uint256 palette, uint256 tintA, uint256 tintB) private view returns (bytes memory rgba) {
        address shard = sharedShard;
        rgba = new bytes(128);
        assembly ("memory-safe") {
            let data := add(rgba, 32)
            extcodecopy(shard, data, add(9217, shl(5, palette)), 32)
            extcodecopy(shard, add(data, 32), add(9729, mul(28, tintA)), 28)
            extcodecopy(shard, add(data, 64), add(9729, mul(28, tintB)), 28)
        }
    }

    function _draw(
        bytes memory grid, bytes memory tiles, bytes memory head, uint256 side,
        uint256 offset, uint256 firstColor
    ) private pure {
        assembly ("memory-safe") {
            function packedInput(p) -> v {
                // The first feature occupies the highest 16-bit lane. Weight
                // lanes run in the opposite order.
                v := shr(192, mload(p))
                v := and(or(v, shl(32, v)), 0x00000000ffffffff00000000ffffffff)
                v := and(or(v, shl(16, v)), 0x0000ffff0000ffff0000ffff0000ffff)
                v := and(or(v, shl(8, v)), 0x00ff00ff00ff00ff00ff00ff00ff00ff)
            }
            function score(row, inputA, inputB) -> value {
                let word := mload(row)
                let bias := signextend(3, shr(224, mload(add(row, 32))))
                // Each convolution coefficient is at most 8 × 255 × 31,
                // so extracting the center lane yields each half-dot exactly.
                let left := and(shr(112, mul(inputA, shr(128, word))), 65535)
                let right := and(shr(112, mul(inputB, and(word, 0xffffffffffffffffffffffffffffffff))), 65535)
                value := add(add(left, right), bias)
            }
            function choose(row, inputA, inputB) -> color {
                let best := score(row, inputA, inputB)
                for { let k := 1 } lt(k, 8) { k := add(k, 1) } {
                    let value := score(add(row, mul(k, 36)), inputA, inputB)
                    if sgt(value, best) {
                        best := value
                        color := k
                    }
                }
            }

            let canvas := add(add(grid, 32), offset)
            let feature := add(tiles, 32)
            let weights := add(head, 32)
            for { let tileY := 0 } lt(tileY, side) { tileY := add(tileY, 1) } {
                let canvasRow := add(canvas, shl(8, tileY))
                for { let tileX := 0 } lt(tileX, side) { tileX := add(tileX, 1) } {
                    let inputA := packedInput(feature)
                    let inputB := packedInput(add(feature, 8))
                    feature := add(feature, 16)
                    let row := weights
                    let point := add(canvasRow, shl(2, tileX))
                    for { let py := 0 } lt(py, 4) { py := add(py, 1) } {
                        let line := add(point, shl(6, py))
                        for { let px := 0 } lt(px, 4) { px := add(px, 1) } {
                            let color := choose(row, inputA, inputB)
                            if or(iszero(firstColor), color) {
                                mstore8(add(line, px), add(firstColor, color))
                            }
                            row := add(row, 288)
                        }
                    }
                }
            }
        }
    }

    function _pack(bytes memory grid) private pure returns (bytes memory packed) {
        packed = new bytes(2_560);
        assembly ("memory-safe") {
            let source := add(grid, 32)
            let target := add(packed, 32)
            for { let start := 0 } lt(start, 4096) { start := add(start, 8) } {
                let octet := mload(add(source, start))
                let word := 0
                for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                    word := or(word, shl(mul(i, 5), byte(i, octet)))
                }
                for { let j := 0 } lt(j, 5) { j := add(j, 1) } {
                    mstore8(add(target, j), shr(shl(3, j), word))
                }
                target := add(target, 5)
            }
        }
    }
}
