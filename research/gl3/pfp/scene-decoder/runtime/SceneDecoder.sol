// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ISceneLinear {
    function linearRaw(
        bytes calldata inputs, address shard, uint32 offset, uint16 stride, uint16 width, uint16 outputs
    ) external view returns (bytes memory);
}

/// @notice Deterministic integer inference for the seven-style GH0ST Scene Decoder package.
/// @dev Model and kernels are bound to verified bytecode hashes in the constructor.
contract SceneDecoder {
    error InvalidDependency();
    error InvalidPrompt();

    event ImageGenerated(bytes32 indexed modelId, uint64 indexed prompt, uint64 indexed seed, bytes32 imageHash);

    address private immutable expert0;
    address private immutable expert1;
    address private immutable expert2;
    address private immutable expert3;
    address private immutable expert4;
    address private immutable expert5;
    address private immutable expert6;
    address private immutable sharedShard;
    ISceneLinear private immutable linear96;
    ISceneLinear private immutable linear32;
    bytes32 public immutable modelId;

    constructor(
        address[8] memory shards,
        bytes32[8] memory expectedCodeHashes,
        address kernel96,
        address kernel32,
        bytes32[2] memory expectedKernelHashes,
        bytes32 id
    ) {
        for (uint256 i = 0; i < shards.length; ++i) {
            address shard = shards[i];
            uint256 expectedLength = i == 7 ? 26_913 : 67_585;
            if (shard.code.length != expectedLength || shard.codehash != expectedCodeHashes[i]) {
                revert InvalidDependency();
            }
            bytes memory first = _read(shard, 0, 1);
            if (first[0] != 0x00) revert InvalidDependency();
        }
        if (kernel96.code.length == 0 || kernel96.codehash != expectedKernelHashes[0]
            || kernel32.code.length == 0 || kernel32.codehash != expectedKernelHashes[1]) {
            revert InvalidDependency();
        }
        expert0 = shards[0];
        expert1 = shards[1];
        expert2 = shards[2];
        expert3 = shards[3];
        expert4 = shards[4];
        expert5 = shards[5];
        expert6 = shards[6];
        sharedShard = shards[7];
        linear96 = ISceneLinear(kernel96);
        linear32 = ISceneLinear(kernel32);
        modelId = id;
    }

    /// @param prompt Eight high-to-low bytes: subjects A/B, tints A/B, relation, background, style, palette.
    /// @return packedPixels 1,024 row-major 5-bit palette indices, least significant bits first.
    /// @return paletteRGBA 32 RGBA colors, four bytes per color.
    function generate(uint64 prompt, uint64 seed)
        public view returns (bytes memory packedPixels, bytes memory paletteRGBA)
    {
        uint256 style = uint8(prompt >> 8);
        uint256 palette = uint8(prompt);
        uint256 subjectA = uint8(prompt >> 56);
        uint256 subjectB = uint8(prompt >> 48);
        uint256 relation = uint8(prompt >> 24);
        if (style >= 7 || palette >= 16 || relation >= 3 || uint8(prompt >> 16) >= 8
            || uint8(prompt >> 40) >= 8 || uint8(prompt >> 32) >= 8 || subjectA == 0 || subjectA > 24
            || subjectB > 24 || subjectA == subjectB || ((subjectB == 0) != (relation == 0))) {
            revert InvalidPrompt();
        }

        bytes memory shared = _read(sharedShard, 1, 26_272);
        bytes memory input = _condition(shared, prompt, seed);
        address expert = _expert(style);
        bytes memory first = linear96.linearRaw(input, expert, 1, 60, 96, 512);
        bytes memory second = linear96.linearRaw(input, expert, 30_721, 60, 96, 512);
        bytes memory params = _read(expert, 61_441, 6_144);
        bytes memory grid = _upsample(first, second, params);
        for (uint256 blockIndex = 0; blockIndex < 2; ++blockIndex) {
            uint256 base = blockIndex * 1_204;
            bytes memory depth = _depthwise(grid, shared, base);
            bytes memory mixed = linear32.linearRaw(depth, sharedShard, uint32(373 + base), 20, 32, 32);
            grid = _pointwise(mixed, shared, base, 24_480 + 256 * style + 128 * blockIndex);
        }
        bytes memory scores = linear32.linearRaw(grid, sharedShard, 2_409, 20, 32, 128);
        packedPixels = _paint(scores, shared, style, prompt);
        paletteRGBA = _read(sharedShard, 14_697 + palette * 128, 128);
    }

    /// @notice Commits the image result to a transaction receipt while returning the same pixels.
    function generateAndRecord(uint64 prompt, uint64 seed)
        external returns (bytes memory packedPixels, bytes memory paletteRGBA)
    {
        (packedPixels, paletteRGBA) = generate(prompt, seed);
        emit ImageGenerated(modelId, prompt, seed, keccak256(abi.encodePacked(packedPixels, paletteRGBA)));
    }

    function _expert(uint256 style) private view returns (address) {
        if (style == 0) return expert0;
        if (style == 1) return expert1;
        if (style == 2) return expert2;
        if (style == 3) return expert3;
        if (style == 4) return expert4;
        if (style == 5) return expert5;
        return expert6;
    }

    function _read(address shard, uint256 offset, uint256 size) private view returns (bytes memory result) {
        result = new bytes(size);
        assembly ("memory-safe") { extcodecopy(shard, add(result, 32), offset, size) }
    }

    function _condition(bytes memory shared, uint64 prompt, uint64 seed)
        private pure returns (bytes memory input)
    {
        bytes32 noise = sha256(abi.encodePacked(prompt, seed));
        // Pad every activation buffer for word writes, then restore its ABI length.
        input = new bytes(96 * 4 + 28);
        assembly ("memory-safe") {
            function byteAt(p, offset) -> v { v := byte(0, mload(add(p, offset))) }
            function put(p, index, v) {
                v := and(v, 0xffffffff)
                v := or(and(shl(8, v), 0xff00ff00), and(shr(8, v), 0x00ff00ff))
                v := or(shl(16, and(v, 0xffff)), shr(16, v))
                mstore(add(p, shl(2, index)), shl(224, v))
            }

            let base := add(shared, 32)
            let target := add(input, 32)
            let subjectA := and(shr(56, prompt), 255)
            let subjectB := and(shr(48, prompt), 255)
            let tintA := add(22888, mul(and(shr(40, prompt), 255), 24))
            let tintB := add(22888, mul(and(shr(32, prompt), 255), 24))
            for { let which := 0 } lt(which, 2) { which := add(which, 1) } {
                let subject := subjectA
                let tint := tintA
                if which { subject := subjectB tint := tintB }
                let start := add(16744, mul(subject, 24))
                let end := mul(which, 24)
                for { let i := 0 } lt(i, 24) { i := add(i, 1) } {
                    let value := signextend(0, byteAt(base, add(start, i)))
                    if subject { value := add(value, signextend(0, byteAt(base, add(tint, i)))) }
                    put(target, add(end, i), shl(3, value))
                }
            }

            let relation := add(23656, mul(and(shr(24, prompt), 255), 8))
            let background := add(23784, mul(and(shr(16, prompt), 255), 8))
            let style := add(24296, mul(and(shr(8, prompt), 255), 8))
            let palette := add(24352, mul(and(prompt, 255), 8))
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                put(target, add(48, i), shl(3, signextend(0, byteAt(base, add(relation, i)))))
            }
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                put(target, add(56, i), shl(3, signextend(0, byteAt(base, add(background, i)))))
            }
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                put(target, add(64, i), shl(3, signextend(0, byteAt(base, add(style, i)))))
            }
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                put(target, add(72, i), shl(3, signextend(0, byteAt(base, add(palette, i)))))
            }
            for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                put(target, add(80, i), shl(3, sub(byte(i, noise), 128)))
            }
            mstore(input, 384)
        }
    }

    function _upsample(bytes memory first, bytes memory second, bytes memory params)
        private pure returns (bytes memory grid)
    {
        grid = new bytes(8_192 + 28);
        assembly ("memory-safe") {
            function le16(word) -> value {
                value := or(byte(0, word), shl(8, byte(1, word)))
            }
            function le32(word) -> value {
                value := signextend(3, or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), shl(24, byte(3, word)))))
            }
            function le64(word) -> value {
                let v := shr(192, word)
                v := or(and(shl(8, v), 0xff00ff00ff00ff00), and(shr(8, v), 0x00ff00ff00ff00ff))
                v := or(and(shl(16, v), 0xffff0000ffff0000), and(shr(16, v), 0x0000ffff0000ffff))
                value := signextend(7, or(shl(32, and(v, 0xffffffff)), shr(32, v)))
            }
            function activate(sum, row, scales, biases) -> value {
                let scale := le16(mload(add(scales, shl(1, row))))
                let bias := le32(mload(add(biases, shl(2, row))))
                value := add(sar(16, mul(sum, scale)), bias)
            }
            function save(p, v) {
                v := or(and(shl(8, v), 0xff00ff00), and(shr(8, v), 0x00ff00ff))
                v := or(shl(16, and(v, 0xffff)), shr(16, v))
                mstore(p, or(shl(224, v), and(mload(p), sub(shl(224, 1), 1))))
            }

            let scales := add(params, 32)
            let biases := add(scales, 2048)
            let dest := add(grid, 32)
            for { let tile := 0 } lt(tile, 16) { tile := add(tile, 1) } {
                let source := first
                if gt(tile, 7) { source := second }
                source := add(add(source, 32), shl(9, and(tile, 7)))
                let target := add(dest, add(shl(11, shr(2, tile)), shl(8, and(tile, 3))))
                let rowBase := shl(6, tile)
                for { let lane := 0 } lt(lane, 32) { lane := add(lane, 1) } {
                    let row := add(rowBase, shl(1, lane))
                    let pointer := add(source, shl(4, lane))
                    let a := activate(le64(mload(pointer)), row, scales, biases)
                    let b := activate(le64(mload(add(pointer, 8))), add(row, 1), scales, biases)
                    let value := a
                    if sgt(b, a) { value := b }
                    if slt(value, 0) { value := 0 }
                    if sgt(value, 8192) { value := 8192 }
                    let p := add(target, shl(2, lane))
                    save(p, value)
                    save(add(p, 128), value)
                    save(add(p, 1024), value)
                    save(add(p, 1152), value)
                }
            }
            mstore(grid, 8192)
        }
    }

    function _depthwise(bytes memory grid, bytes memory shared, uint256 layer)
        private pure returns (bytes memory output)
    {
        output = new bytes(8_192 + 28);
        assembly ("memory-safe") {
            function le16(word) -> value {
                value := or(byte(0, word), shl(8, byte(1, word)))
            }
            function le32(word) -> value {
                value := signextend(3, or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), shl(24, byte(3, word)))))
            }
            function save(p, v) {
                v := or(and(shl(8, v), 0xff00ff00), and(shr(8, v), 0x00ff00ff))
                v := or(shl(16, and(v, 0xffff)), shr(16, v))
                mstore(p, or(shl(224, v), and(mload(p), sub(shl(224, 1), 1))))
            }
            function channelWeight(source, index) -> w {
                let bit := mul(index, 5)
                let word := mload(add(source, shr(3, bit)))
                w := sub(and(shr(and(bit, 7), le16(word)), 31), 16)
            }
            function dot3(p, a, b, c) -> sum {
                sum := add(add(mul(le32(mload(p)), a), mul(le32(mload(add(p, 128))), b)),
                    mul(le32(mload(add(p, 256))), c))
            }

            // The extra one-cell border makes every 3×3 stencil branch free.
            let padded := mload(0x40)
            mstore(0x40, add(padded, 12832))
            calldatacopy(padded, calldatasize(), 12800)
            let cursor := add(grid, 32)
            for { let y := 0 } lt(y, 8) { y := add(y, 1) } {
                let row := add(padded, add(1408, mul(y, 1280)))
                for { let x := 0 } lt(x, 1024) { x := add(x, 32) } {
                    mstore(add(row, x), mload(cursor))
                    cursor := add(cursor, 32)
                }
            }
            let weights := add(add(shared, 32), layer)
            let dest := add(output, 32)
            for { let channel := 0 } lt(channel, 32) { channel := add(channel, 1) } {
                let k := mul(channel, 9)
                let w0 := channelWeight(weights, k)
                let w1 := channelWeight(weights, add(k, 1))
                let w2 := channelWeight(weights, add(k, 2))
                let w3 := channelWeight(weights, add(k, 3))
                let w4 := channelWeight(weights, add(k, 4))
                let w5 := channelWeight(weights, add(k, 5))
                let w6 := channelWeight(weights, add(k, 6))
                let w7 := channelWeight(weights, add(k, 7))
                let w8 := channelWeight(weights, add(k, 8))
                let scale := le16(mload(add(weights, add(180, shl(1, channel)))))
                let bias := le32(mload(add(weights, add(244, shl(2, channel)))))
                let offset := shl(2, channel)
                for { let y := 0 } lt(y, 8) { y := add(y, 1) } {
                    let row := add(padded, add(mul(y, 1280), offset))
                    let target := add(dest, add(shl(10, y), offset))
                    for { let x := 0 } lt(x, 1024) { x := add(x, 128) } {
                        let p := add(row, x)
                        let sum := add(add(dot3(p, w0, w1, w2), dot3(add(p, 1280), w3, w4, w5)),
                            dot3(add(p, 2560), w6, w7, w8))
                        let value := add(sar(16, mul(sum, scale)), bias)
                        if slt(value, 0) { value := 0 }
                        if sgt(value, 8192) { value := 8192 }
                        save(add(target, x), value)
                    }
                }
            }
            mstore(output, 8192)
        }
    }

    function _pointwise(bytes memory mixed, bytes memory shared, uint256 layer, uint256 styleOffset)
        private pure returns (bytes memory output)
    {
        output = new bytes(8_192 + 28);
        assembly ("memory-safe") {
            function le16(word) -> value {
                value := or(byte(0, word), shl(8, byte(1, word)))
            }
            function le32(word) -> value {
                value := signextend(3, or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), shl(24, byte(3, word)))))
            }
            function le64(word) -> value {
                let v := shr(192, word)
                v := or(and(shl(8, v), 0xff00ff00ff00ff00), and(shr(8, v), 0x00ff00ff00ff00ff))
                v := or(and(shl(16, v), 0xffff0000ffff0000), and(shr(16, v), 0x0000ffff0000ffff))
                value := signextend(7, or(shl(32, and(v, 0xffffffff)), shr(32, v)))
            }
            function save(p, v) {
                v := or(and(shl(8, v), 0xff00ff00), and(shr(8, v), 0x00ff00ff))
                v := or(shl(16, and(v, 0xffff)), shr(16, v))
                mstore(p, or(shl(224, v), and(mload(p), sub(shl(224, 1), 1))))
            }

            let base := add(shared, 32)
            let styles := add(base, styleOffset)
            let weights := add(base, layer)
            let dest := add(output, 32)
            let source := add(mixed, 32)
            for { let lane := 0 } lt(lane, 32) { lane := add(lane, 1) } {
                let double := shl(1, lane)
                let quad := shl(2, lane)
                let scale := le16(mload(add(weights, add(1012, double))))
                let bias := le32(mload(add(weights, add(1076, quad))))
                let gain := le16(mload(add(styles, double)))
                let offset := signextend(1, le16(mload(add(styles, add(64, double)))))
                for { let token := 0 } lt(token, 64) { token := add(token, 1) } {
                    let sum := le64(mload(source))
                    source := add(source, 8)
                    let value := add(sar(16, mul(sum, scale)), bias)
                    value := add(sar(8, mul(value, gain)), offset)
                    if slt(value, 0) { value := 0 }
                    if sgt(value, 8192) { value := 8192 }
                    save(add(dest, add(shl(7, token), quad)), value)
                }
            }
            mstore(output, 8192)
        }
    }

    function _paint(bytes memory scores, bytes memory shared, uint256 style, uint64 prompt)
        private pure returns (bytes memory output)
    {
        output = new bytes(640);
        assembly ("memory-safe") {
            function le16(word) -> value {
                value := or(byte(0, word), shl(8, byte(1, word)))
            }
            function le32(word) -> value {
                value := signextend(3, or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), shl(24, byte(3, word)))))
            }
            function le64(word) -> value {
                let v := shr(192, word)
                v := or(and(shl(8, v), 0xff00ff00ff00ff00), and(shr(8, v), 0x00ff00ff00ff00ff))
                v := or(and(shl(16, v), 0xffff0000ffff0000), and(shr(16, v), 0x0000ffff0000ffff))
                value := signextend(7, or(shl(32, and(v, 0xffffffff)), shr(32, v)))
            }
            function orByte(p, b) {
                mstore8(p, or(byte(0, mload(p)), b))
            }
            function applyTints(row, tintA, tintB) -> colored {
                // Dictionary entries 8–10 and 11–13 name three shade roles for
                // subjects A and B. The selected palette has eight tint ramps.
                for { let shift := 0 } lt(shift, 20) { shift := add(shift, 5) } {
                    let color := and(shr(shift, row), 31)
                    let role := sub(color, 8)
                    if lt(role, 6) {
                        let tint := tintA
                        if gt(role, 2) {
                            tint := tintB
                            role := sub(role, 3)
                        }
                        color := add(add(8, tint), role)
                    }
                    colored := or(colored, shl(shift, color))
                }
            }

            let base := add(shared, 32)
            let scales := add(base, 4968)
            let biases := add(base, 5224)
            let patches := add(base, add(5736, mul(style, 1280)))
            let choice := mload(0x40)
            let best := add(choice, 2048)
            mstore(0x40, add(best, 2048))
            let raw := add(scores, 32)
            for { let code := 0 } lt(code, 128) { code := add(code, 1) } {
                let scale := le16(mload(add(scales, shl(1, code))))
                let bias := le32(mload(add(biases, shl(2, code))))
                for { let pos := 0 } lt(pos, 2048) { pos := add(pos, 32) } {
                    let value := add(sar(16, mul(le64(mload(raw)), scale)), bias)
                    raw := add(raw, 8)
                    let slot := add(best, pos)
                    if or(iszero(code), sgt(value, mload(slot))) {
                        mstore(slot, value)
                        mstore(add(choice, pos), code)
                    }
                }
            }
            let dest := add(output, 32)
            let tintA := mul(and(shr(40, prompt), 255), 3)
            let tintB := mul(and(shr(32, prompt), 255), 3)
            for { let tile := 0 } lt(tile, 64) { tile := add(tile, 1) } {
                let code := mload(add(choice, shl(5, tile)))
                let patch := mload(add(patches, mul(code, 10)))
                let col := and(tile, 7)
                let left := mul(col, 20)
                let target := add(dest, add(mul(shr(3, tile), 80), shr(3, left)))
                for { let row := 0 } lt(row, 4) { row := add(row, 1) } {
                    let bit := mul(row, 20)
                    let at := shr(3, bit)
                    let triple := or(or(byte(at, patch), shl(8, byte(add(at, 1), patch))),
                        shl(16, byte(add(at, 2), patch)))
                    let colors := applyTints(shr(and(bit, 7), triple), tintA, tintB)
                    let bins := shl(and(left, 7), colors)
                    let ptr := add(target, mul(row, 20))
                    orByte(ptr, bins)
                    orByte(add(ptr, 1), shr(8, bins))
                    orByte(add(ptr, 2), shr(16, bins))
                }
            }
        }
    }
}
