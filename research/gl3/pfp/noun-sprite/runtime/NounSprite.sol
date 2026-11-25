// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ShapeSpriteRenderer } from "./ShapeSpriteRenderer.sol";

/// @notice Interpret a noun's visual traits, infer a sprite plan and paint 48 × 48 RGBA pixels in the EVM.
contract NounSprite is ShapeSpriteRenderer {
    uint256 private constant FNV64_BASIS = 14695981039346656037;
    uint256 private constant FNV64_PRIME = 1099511628211;
    uint256 private constant TRAIT_BYTES = 25;
    uint256 private constant PLANNER_WIDTH = 64;
    uint256 private constant SLOTS = 12;
    uint256 private constant FEATURES_PER_SLOT = 25;
    uint256 private constant PLANNER_OUTPUTS = SLOTS * FEATURES_PER_SLOT;
    uint256 private constant PLANNER_PARAM_BYTES = (PLANNER_WIDTH + PLANNER_OUTPUTS) * 6;

    address public immutable plannerFirstWeights;
    address public immutable plannerOutputWeights;
    address public immutable plannerParameters;
    address public immutable lexicon;
    bytes32 public immutable modelId;
    bytes32 public immutable codeCommitment;

    error InvalidPromptLength();
    error NoKnownNoun();
    error InvalidTraits();
    error InvalidDotCount();

    event SpriteGenerated(address indexed caller, bytes32 indexed promptHash, uint64 seed, bytes32 pixelsHash);

    constructor(
        address[7] memory shards,
        bytes32[7] memory codeHashes,
        address kernelAddress,
        bytes32 kernelCodeHash,
        bytes32 id
    ) ShapeSpriteRenderer(
        [shards[0], shards[1], shards[2]],
        [codeHashes[0], codeHashes[1], codeHashes[2]],
        kernelAddress,
        kernelCodeHash
    ) {
        _checkShard(shards[3], codeHashes[3], 32 * PLANNER_WIDTH, 3);
        _checkShard(shards[4], codeHashes[4], PLANNER_WIDTH * PLANNER_OUTPUTS, 4);
        _checkShard(shards[5], codeHashes[5], PLANNER_PARAM_BYTES, 5);
        uint256 lexiconSize = shards[6].code.length;
        if (lexiconSize <= 1 || lexiconSize > 24_576 || (lexiconSize - 1) % TRAIT_BYTES != 0) revert InvalidShard(6);
        _checkShard(shards[6], codeHashes[6], lexiconSize - 1, 6);

        plannerFirstWeights = shards[3];
        plannerOutputWeights = shards[4];
        plannerParameters = shards[5];
        lexicon = shards[6];
        modelId = id;
        codeCommitment = keccak256(abi.encode(codeHashes, kernelCodeHash));
    }

    function plan(string calldata prompt) external view returns (Part[] memory layers) {
        return _plan(bytes(prompt));
    }

    function generate(string calldata prompt, uint64 seed) external view returns (bytes memory rgba) {
        return _renderParts(_plan(bytes(prompt)), seed);
    }

    function generateAndRecord(string calldata prompt, uint64 seed) external returns (bytes memory rgba) {
        rgba = _renderParts(_plan(bytes(prompt)), seed);
        emit SpriteGenerated(msg.sender, keccak256(bytes(prompt)), seed, keccak256(rgba));
    }

    function measure(string calldata prompt, uint64 seed) external view returns (bytes memory rgba, uint256 gasUsed) {
        uint256 before = gasleft();
        rgba = _renderParts(_plan(bytes(prompt)), seed);
        gasUsed = before - gasleft();
    }

    function _plan(bytes calldata text) private view returns (Part[] memory layers) {
        (bytes memory input, uint72 palette) = _plannerInput(text);
        bytes memory params = new bytes(PLANNER_PARAM_BYTES);
        address paramAddress = plannerParameters;
        assembly ("memory-safe") {
            extcodecopy(paramAddress, add(params, 32), 1, mload(params))
        }
        bytes memory hiddenDots = kernel.dotTile(input, plannerFirstWeights, 32, PLANNER_WIDTH);
        if (hiddenDots.length != PLANNER_WIDTH * 8) revert InvalidDotCount();
        bytes memory hidden = new bytes(PLANNER_WIDTH * 2);
        for (uint256 i; i < PLANNER_WIDTH; ++i) {
            int256 value = _affineValue(hiddenDots, params, i, i);
            if (value < 0) value = 0;
            if (value > 8192) value = 8192;
            assembly ("memory-safe") {
                let pos := add(add(hidden, 32), shl(1, i))
                mstore8(pos, shr(8, value))
                mstore8(add(pos, 1), value)
            }
        }

        bytes memory dots = kernel.dotTile(hidden, plannerOutputWeights, PLANNER_WIDTH, PLANNER_OUTPUTS);
        if (dots.length != PLANNER_OUTPUTS * 8) revert InvalidDotCount();
        layers = new Part[](SLOTS);
        uint256 count;
        for (uint256 slot; slot < SLOTS; ++slot) {
            uint256 first = slot * FEATURES_PER_SLOT;
            if (_score(dots, params, first + 24) >= 512) {
                layers[count++] = _decodePart(dots, params, first, palette);
            }
        }
        assembly ("memory-safe") {
            mstore(layers, count)
        }
    }

    function _decodePart(bytes memory dots, bytes memory params, uint256 first, uint72 palette)
        private pure returns (Part memory part)
    {
        int256 best = _score(dots, params, first);
        for (uint8 i = 1; i < 16; ++i) {
            int256 score = _score(dots, params, first + i);
            if (score > best) {
                best = score;
                part.shape = i;
            }
        }
        part.x = _scaled(_score(dots, params, first + 16), 47);
        part.y = _scaled(_score(dots, params, first + 17), 47);
        part.width = _scaled(_score(dots, params, first + 18), 48);
        part.height = _scaled(_score(dots, params, first + 19), 48);
        if (part.width == 0) part.width = 1;
        if (part.height == 0) part.height = 1;

        part.rgb = _blendPalette(
            palette,
            _clampQ10(_score(dots, params, first + 20)),
            _clampQ10(_score(dots, params, first + 21)),
            _clampQ10(_score(dots, params, first + 22))
        );
        int256 profile = _score(dots, params, first + 23);
        if (profile < -768) profile = -768;
        if (profile > 768) profile = 768;
        part.profile = int16(profile);
    }

    function _affineValue(bytes memory dots, bytes memory params, uint256 dotRow, uint256 parameterRow)
        private pure returns (int256 value)
    {
        assembly ("memory-safe") {
            let dot := signextend(7, mload(add(add(dots, 8), shl(3, dotRow))))
            let pair := mload(add(add(params, 6), mul(parameterRow, 6)))
            let scale := and(shr(32, pair), 65535)
            value := add(sar(16, mul(dot, scale)), signextend(3, pair))
        }
    }

    function _score(bytes memory dots, bytes memory params, uint256 row) private pure returns (int256) {
        return _affineValue(dots, params, row, PLANNER_WIDTH + row);
    }

    function _scaled(int256 value, uint256 max) private pure returns (uint8) {
        return uint8((_clampQ10(value) * max + 512) >> 10);
    }

    function _clampQ10(int256 value) private pure returns (uint256) {
        if (value <= 0) return 0;
        if (value >= 1024) return 1024;
        return uint256(value);
    }

    function _blendPalette(uint72 palette, uint256 main, uint256 light, uint256 accent)
        private pure returns (uint24 rgb)
    {
        assembly ("memory-safe") {
            let denom := add(add(main, light), accent)
            let night := 0
            if lt(denom, 1024) {
                night := sub(1024, denom)
                denom := 1024
            }
            for { let c := 0 } lt(c, 3) { c := add(c, 1) } {
                let sum := add(mul(main, byte(add(23, c), palette)), mul(light, byte(add(26, c), palette)))
                sum := add(sum, mul(accent, byte(add(29, c), palette)))
                sum := add(sum, mul(night, byte(add(29, c), 0x1b1d2a)))
                rgb := or(shl(8, rgb), div(add(sum, shr(1, denom)), denom))
            }
        }
    }

    function _plannerInput(bytes calldata text) private view returns (bytes memory input, uint72 palette) {
        if (text.length == 0 || text.length > 160) revert InvalidPromptLength();
        address traitShard = lexicon;
        uint256 rows = (traitShard.code.length - 1) / TRAIT_BYTES;
        bytes32 traits;
        uint256 chosenLength;
        uint256 chosenStart;
        uint256 tokens;
        uint256[3] memory hashes;
        // The winning noun spans at most three words. Keep the first four
        // color positions so the earliest color outside it remains available.
        uint256[4] memory colorCandidates;
        uint256 colors;
        uint256 i;
        while (i < text.length) {
            uint8 c = _wordByte(uint8(text[i]));
            if (c == 0) {
                ++i;
                continue;
            }
            hashes[2] = _hashByte(hashes[1], 32);
            hashes[1] = _hashByte(hashes[0], 32);
            hashes[0] = FNV64_BASIS;
            while (c != 0) {
                hashes[0] = _hashByte(hashes[0], c);
                hashes[1] = _hashByte(hashes[1], c);
                hashes[2] = _hashByte(hashes[2], c);
                ++i;
                if (i == text.length) break;
                c = _wordByte(uint8(text[i]));
            }
            if (colors < 4) {
                uint24 color = _colorWord(hashes[0]);
                if (color != 0) colorCandidates[colors++] = (tokens << 24) | color;
            }
            ++tokens;

            uint256 maxLength = tokens < 3 ? tokens : 3;
            for (uint256 length = maxLength; length > chosenLength; --length) {
                (bytes32 candidate, bool found) = _findTraits(traitShard, rows, hashes[length - 1]);
                if (found) {
                    traits = candidate;
                    chosenLength = length;
                    chosenStart = tokens - length;
                    break;
                }
            }
            // At this point i is the following delimiter or the end of text.
            ++i;
        }
        if (chosenLength == 0) revert NoKnownNoun();

        uint24 overrideColor;
        for (uint256 j; j < colors; ++j) {
            uint256 at = colorCandidates[j] >> 24;
            if (at < chosenStart || at >= chosenStart + chosenLength) {
                overrideColor = uint24(colorCandidates[j]);
                break;
            }
        }
        input = _encodeTraits(traits, overrideColor);
        palette = uint72(uint256(traits) >> 80);
        if (overrideColor != 0) palette = (uint72(overrideColor) << 48) | uint48(palette);
    }

    function _wordByte(uint8 c) private pure returns (uint8) {
        if (c >= 65 && c <= 90) return c + 32;
        if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) return c;
        return 0;
    }

    function _hashByte(uint256 state, uint8 c) private pure returns (uint64 digest) {
        assembly ("memory-safe") {
            digest := and(mul(xor(state, c), FNV64_PRIME), 0xffffffffffffffff)
        }
    }

    function _findTraits(address shard, uint256 rows, uint256 word) private view returns (bytes32 traits, bool known) {
        uint256 low;
        uint256 high = rows;
        while (low < high) {
            uint256 mid = (low + high) >> 1;
            uint256 offset = 1 + mid * TRAIT_BYTES;
            uint256 candidate;
            assembly ("memory-safe") {
                extcodecopy(shard, 0, offset, TRAIT_BYTES)
                traits := mload(0)
                candidate := shr(192, traits)
            }
            if (candidate == word) return (traits, true);
            if (candidate < word) low = mid + 1;
            else high = mid;
        }
        return (0, false);
    }

    function _encodeTraits(bytes32 row, uint24 color) private pure returns (bytes memory input) {
        if (uint8(row[8]) > 3 || uint8(row[9]) > 2 || uint8(row[10]) > 2 || uint8(row[11]) > 2) revert InvalidTraits();
        input = new bytes(64);
        assembly ("memory-safe") {
            let out := add(input, 32)
            mstore8(add(out, shl(1, byte(8, row))), 4)
            mstore8(add(out, shl(1, add(4, byte(9, row)))), 4)
            mstore8(add(out, shl(1, add(7, byte(10, row)))), 4)
            mstore8(add(out, shl(1, add(10, byte(11, row)))), 4)

            let flags := byte(12, row)
            for { let i := 0 } lt(i, 3) { i := add(i, 1) } {
                mstore8(add(out, shl(1, add(13, i))), shl(2, and(shr(i, flags), 1)))
            }

            for { let i := 0 } lt(i, 12) { i := add(i, 1) } {
                let v := byte(add(13, i), row)
                if and(iszero(iszero(color)), lt(i, 3)) {
                    v := and(shr(shl(3, sub(2, i)), color), 255)
                }
                let encoded := div(shl(10, v), 255)
                let pos := add(out, shl(1, add(i, 16)))
                mstore8(pos, shr(8, encoded))
                mstore8(add(pos, 1), encoded)
            }
        }
    }

    function _colorWord(uint256 h) private pure returns (uint24 rgb) {
        assembly ("memory-safe") {
            switch h
            case 0x65405ac24a7e5da0 { rgb := 0xf7a932 } // amber
            case 0xc46dc1ba8e1f6931 { rgb := 0x23345f } // navy
            case 0x968f20d12b150b56 { rgb := 0xf5f0da } // ivory
            case 0x9cefc8720ea680d3 { rgb := 0xffc857 } // gold
            case 0xdb7d47cb10b772a0 { rgb := 0xb9c4d1 } // silver
            case 0xfa23daef19afc4df { rgb := 0x2db6a3 } // teal
            case 0xda4e06a2a78ec519 { rgb := 0x8de2bb } // mint
            case 0xbffedf1f6f66c727 { rgb := 0xb65b42 } // rust
            case 0x89e9be1960f4c21c { rgb := 0xe4545f } // red
            case 0xced973885856e206 { rgb := 0xf5f8ff } // white
            case 0xc5ccd29bc2dda64d { rgb := 0x5899f8 } // blue
            case 0xd713e919b76e1232 { rgb := 0x9560db } // violet
            case 0x1d8e0fe9bdf5fc5f { rgb := 0x9560db } // purple
            case 0x0f40f029637fecbc { rgb := 0x47ac68 } // green
            case 0x4b5dd0abbc6fc1e4 { rgb := 0x202333 } // black
            case 0xce64498e5552be32 { rgb := 0xf77e6d } // coral
            case 0x8346a574925e75a9 { rgb := 0xf8d971 } // yellow
            case 0xa6dd3abcdd8405eb { rgb := 0xf89b4f } // orange
            case 0xbf30ec0dc5331c0d { rgb := 0xf28fc4 } // pink
            case 0xfb6faa7243f4459a { rgb := 0x8491a6 } // gray
            case 0xfb61a27243e7faa6 { rgb := 0x8491a6 } // grey
            case 0xea78181e1cf48dcf { rgb := 0x97664c } // brown
            case 0x18ed4a6bce03e40e { rgb := 0x53779c } // slate
            case 0xae5668718c2f3012 { rgb := 0x333849 } // charcoal
            case 0x70ae2e90c1bce27a { rgb := 0x57cef3 } // cyan
            case 0x32b02d44980684ba { rgb := 0x53d9bc } // turquoise
            case 0xbf5595ad6957925c { rgb := 0x9ed456 } // lime
            case 0x85a4a42ab8880ab1 { rgb := 0xc68558 } // bronze
            case 0xb5c7ba9ed9150b35 { rgb := 0xf8d9a6 } // cream
        }
    }
}
