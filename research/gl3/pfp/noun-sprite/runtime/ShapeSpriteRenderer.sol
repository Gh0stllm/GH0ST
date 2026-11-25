// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IShapeLinear {
    function dotTile(bytes calldata input, address weights, uint256 width, uint256 outputs)
        external view returns (bytes memory);
}

/// @dev Shared byte-exact neural mask compositor extracted from ComposableSprite.
abstract contract ShapeSpriteRenderer {
    uint256 private constant PARAM_BYTES = (32 + 256) * 6;

    struct Part {
        uint8 shape;
        uint8 x;
        uint8 y;
        uint8 width;
        uint8 height;
        uint24 rgb;
        int16 profile;
    }

    IShapeLinear public immutable kernel;
    address public immutable firstWeights;
    address public immutable maskWeights;
    address public immutable parameters;

    error InvalidKernel();
    error InvalidShard(uint256 index);

    constructor(
        address[3] memory shards,
        bytes32[3] memory codeHashes,
        address kernelAddress,
        bytes32 kernelCodeHash
    ) {
        if (kernelAddress.code.length == 0 || kernelAddress.codehash != kernelCodeHash) revert InvalidKernel();
        _checkShard(shards[0], codeHashes[0], 32 * 32, 0);
        _checkShard(shards[1], codeHashes[1], 32 * 256, 1);
        _checkShard(shards[2], codeHashes[2], PARAM_BYTES, 2);
        kernel = IShapeLinear(kernelAddress);
        firstWeights = shards[0];
        maskWeights = shards[1];
        parameters = shards[2];
    }

    function _checkShard(address shard, bytes32 hash, uint256 dataLength, uint256 index) internal view {
        if (shard.code.length != dataLength + 1 || shard.codehash != hash) revert InvalidShard(index);
        uint256 leadingByte;
        assembly ("memory-safe") {
            extcodecopy(shard, 0, 0, 1)
            leadingByte := byte(0, mload(0))
        }
        if (leadingByte != 0) revert InvalidShard(index);
    }

    function _renderParts(Part[] memory layers, uint64 seed) internal view returns (bytes memory rgba) {
        rgba = new bytes(48 * 48 * 4);
        if (layers.length == 0) return rgba;
        bytes memory input = new bytes(layers.length * 64);
        for (uint256 i; i < layers.length; ++i) {
            uint256 feature = layers[i].shape;
            uint256 profile = uint16(layers[i].profile);
            assembly ("memory-safe") {
                let token := add(add(input, 32), shl(6, i))
                mstore8(add(token, shl(1, feature)), 4)
                mstore8(add(token, 32), shr(8, profile))
                mstore8(add(token, 33), profile)
            }
        }
        bytes memory logits = _maskLogits(input, layers.length);
        // Work from the visible top down so later opaque parts need no overdraw.
        for (uint256 i = layers.length; i != 0;) {
            unchecked { --i; }
            _paint(rgba, logits, layers[i], i, seed);
        }
    }

    function _maskLogits(bytes memory input, uint256 count) private view returns (bytes memory logits) {
        bytes memory params = new bytes(PARAM_BYTES);
        address paramAddress = parameters;
        assembly ("memory-safe") {
            extcodecopy(paramAddress, add(params, 32), 1, PARAM_BYTES)
        }

        bytes memory dots = kernel.dotTile(input, firstWeights, 32, 32);
        bytes memory hidden = new bytes(count * 64);
        _affine(dots, params, count, 32, 0, hidden, true);
        dots = kernel.dotTile(hidden, maskWeights, 32, 256);
        logits = new bytes(count * 256 * 2);
        _affine(dots, params, count, 256, 32, logits, false);
    }

    function _affine(
        bytes memory dots,
        bytes memory params,
        uint256 count,
        uint256 rows,
        uint256 firstRow,
        bytes memory output,
        bool relu
    ) private pure {
        assembly ("memory-safe") {
            let dot := add(dots, 8)
            let p := add(add(params, 6), mul(firstRow, 6))
            let out := add(output, 32)
            let stride := shl(1, rows)
            for { let row := 0 } lt(row, rows) { row := add(row, 1) } {
                let pair := mload(p)
                let scale := and(shr(32, pair), 65535)
                let bias := signextend(3, pair)
                for { let token := 0 } lt(token, count) { token := add(token, 1) } {
                    let value := add(sar(16, mul(signextend(7, mload(dot)), scale)), bias)
                    let upper := 1024
                    if relu { upper := 8192 }
                    if slt(value, 0) { value := 0 }
                    if sgt(value, upper) { value := upper }
                    let pos := add(out, add(shl(1, row), mul(token, stride)))
                    mstore8(pos, shr(8, value))
                    mstore8(add(pos, 1), value)
                    dot := add(dot, 8)
                }
                p := add(p, 6)
            }
        }
    }

    function _paint(bytes memory canvas, bytes memory logits, Part memory layer, uint256 index, uint64 seed)
        private pure
    {
        assembly ("memory-safe") {
            function covered(mask, x, y) -> yes {
                let offset := add(shl(5, y), shl(1, x))
                yes := gt(and(shr(8, mload(add(mask, offset))), 255), 1)
            }
            function edge(mask, x, y) -> yes {
                if or(or(iszero(x), eq(x, 15)), or(iszero(y), eq(y, 15))) {
                    yes := 1
                    leave
                }
                yes := iszero(and(and(covered(mask, sub(x, 1), y), covered(mask, add(x, 1), y)),
                    and(covered(mask, x, sub(y, 1)), covered(mask, x, add(y, 1)))))
            }
            function channel(value, light) -> result {
                result := shr(8, add(mul(and(value, 255), light), 128))
                if gt(result, 255) { result := 255 }
            }

            let mask := add(add(logits, 2), shl(9, index))
            let out := add(canvas, 32)
            let width := mload(add(layer, 96))
            let height := mload(add(layer, 128))
            let left := sub(mload(add(layer, 32)), shr(1, width))
            let top := sub(mload(add(layer, 64)), shr(1, height))
            let right := add(left, width)
            let bottom := add(top, height)
            let rgb := mload(add(layer, 160))
            let phase := add(mod(seed, 7), mul(11, index))

            let xStart := left
            if slt(xStart, 0) { xStart := 0 }
            if sgt(right, 48) { right := 48 }
            let yStart := top
            if slt(yStart, 0) { yStart := 0 }
            if sgt(bottom, 48) { bottom := 48 }

            for { let y := yStart } lt(y, bottom) { y := add(y, 1) } {
                let my := div(shl(4, sub(y, top)), height)
                let row := add(out, shl(2, add(mul(48, y), xStart)))
                for { let x := xStart let pos := row } lt(x, right) { x := add(x, 1) pos := add(pos, 4) } {
                    if and(mload(sub(pos, 28)), 255) { continue }
                    let mx := div(shl(4, sub(x, left)), width)
                    if covered(mask, mx, my) {
                        let grain := mod(add(phase, add(mul(13, x), mul(17, y))), 7)
                        let light := sub(add(281, grain), div(add(mul(52, my), mul(14, mx)), 15))
                        if edge(mask, mx, my) { light := shr(8, add(mul(202, light), 128)) }
                        mstore8(pos, channel(shr(16, rgb), light))
                        mstore8(add(pos, 1), channel(shr(8, rgb), light))
                        mstore8(add(pos, 2), channel(rgb, light))
                        mstore8(add(pos, 3), 255)
                    }
                }
            }
        }
    }
}
