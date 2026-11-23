// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Deterministically generates 32×32 three-color images from a seed and prompt controls.
contract Gh0stPfp {
    error InvalidModel();
    error InvalidSubject();
    error WeightDeploymentFailed();

    event ImageGenerated(bytes16 indexed seed, uint8 indexed subject, uint8 indexed style, bytes32 imageHash);

    address public immutable weights;
    bytes32 public immutable modelHash;

    constructor(bytes memory model, bytes32 expectedModelHash) {
        // 474-byte header, at least twelve 256-byte baselines, and room for the
        // STOP prefix within the EVM's 24,576-byte deployed-code limit.
        if (model.length < 3546 || model.length > 24_575 || keccak256(model) != expectedModelHash) {
            revert InvalidModel();
        }
        if (!_validModel(model)) revert InvalidModel();
        modelHash = expectedModelHash;

        address shard;
        assembly ("memory-safe") {
            let size := mload(model)
            let data := add(model, 32)
            // Return size + 1 bytes at offset 10: a STOP byte and the blob.
            // Temporarily reuse the length word for the 11-byte header.
            let header := or(0x61000080600a5f395ff300, shl(64, add(size, 1)))
            mstore(model, header)
            shard := create(0, sub(data, 11), add(size, 11))
            mstore(model, size)
        }
        if (shard == address(0)) revert WeightDeploymentFailed();
        weights = shard;
    }

    /// @notice Four row-major palette indices per byte, from least to most significant.
    /// @dev Palette indices 0, 1 and 2 are black, amber and ivory.
    function generate(bytes16 seed, uint8 subject, uint8 style) public view returns (bytes memory pixels) {
        if (subject >= 12) revert InvalidSubject();
        address dataAccount = weights;
        pixels = new bytes(256);

        assembly ("memory-safe") {
            function u16le(offset) -> value {
                let word := mload(offset)
                value := or(byte(0, word), shl(8, byte(1, word)))
            }

            function i32le(offset) -> value {
                let word := mload(offset)
                value := signextend(3, or(
                    or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), shl(24, byte(3, word)))
                ))
            }

            function active(lane, predicate, hidden) -> bit {
                switch eq(lane, 255)
                case 1 { bit := predicate }
                default {
                    let atLeast := iszero(lt(byte(lane, hidden), and(predicate, 127)))
                    bit := xor(atLeast, shr(7, predicate))
                }
            }

            let model := mload(0x40)
            let input := add(model, 480)
            let patches := add(input, 768)
            extcodecopy(dataAccount, model, 1, 474)
            for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                mstore(add(input, shl(5, i)), sub(byte(i, seed), 128))
            }
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                mstore(add(input, shl(5, add(16, i))), sub(mul(and(shr(i, style), 1), 254), 127))
            }

            let hidden := 0
            for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                let sum := i32le(add(add(model, 384), shl(2, i)))
                let rowWeights := mload(add(model, mul(24, i)))
                for { let j := 0 } lt(j, 24) { j := add(j, 1) } {
                    let weight := signextend(0, byte(j, rowWeights))
                    sum := add(sum, mul(weight, mload(add(input, shl(5, j)))))
                }
                let feature := 0
                if sgt(sum, 0) {
                    feature := shr(7, sum)
                    if gt(feature, 127) { feature := 127 }
                }
                hidden := or(hidden, shl(sub(248, shl(3, i)), feature))
            }

            // Read only the requested head. The baseline holds constant pixels.
            // Each six-byte patch computes one conditional palette index.
            let tableEntry := add(add(model, 448), shl(1, subject))
            let start := u16le(tableEntry)
            let size := sub(u16le(add(tableEntry, 2)), start)
            let output := add(pixels, 32)
            let patchBytes := sub(size, 256)
            mstore(0x40, add(patches, and(add(patchBytes, 63), not(31))))
            extcodecopy(dataAccount, output, add(start, 475), 256)
            extcodecopy(dataAccount, patches, add(start, 731), patchBytes)

            for { let row := patches } lt(row, add(patches, patchBytes)) { row := add(row, 6) } {
                let entry := mload(row)
                let pixel := or(byte(0, entry), shl(8, byte(1, entry)))
                let foreground := active(byte(2, entry), byte(3, entry), hidden)
                let ivory := active(byte(4, entry), byte(5, entry), hidden)
                let index := mul(foreground, add(1, ivory))
                let offset := add(output, shr(2, pixel))
                let shift := shl(1, and(pixel, 3))
                mstore8(offset, or(and(byte(0, mload(offset)), not(shl(shift, 3))), shl(shift, index)))
            }
        }
    }

    /// @notice Runs inference and publishes a reproducible image hash in the transaction receipt.
    function record(bytes16 seed, uint8 subject, uint8 style) external returns (bytes32 imageHash) {
        imageHash = keccak256(generate(seed, subject, style));
        emit ImageGenerated(seed, subject, style, imageHash);
    }

    function _validModel(bytes memory model) private pure returns (bool valid) {
        assembly ("memory-safe") {
            function u16le(offset) -> value {
                let word := mload(offset)
                value := or(byte(0, word), shl(8, byte(1, word)))
            }

            function validPredicate(lane, predicate) -> yes {
                yes := or(lt(lane, 16), and(eq(lane, 255), lt(predicate, 2)))
            }

            let data := add(model, 32)
            let table := add(data, 448)
            let heads := add(data, 474)
            let span := sub(mload(model), 474)
            valid := and(iszero(u16le(table)), eq(u16le(add(table, 24)), span))
            for { let subject := 0 } and(valid, lt(subject, 12)) { subject := add(subject, 1) } {
                let offset := add(table, shl(1, subject))
                let first := u16le(offset)
                let last := u16le(add(offset, 2))
                let size := sub(last, first)
                if or(or(lt(last, first), gt(last, span)), or(lt(size, 256), mod(sub(size, 256), 6))) {
                    valid := 0
                    break
                }

                let baseline := add(heads, first)
                let patches := add(baseline, 256)
                let lowestBitOfEachPixel := 0x5555555555555555555555555555555555555555555555555555555555555555
                for { let word := baseline } lt(word, patches) { word := add(word, 32) } {
                    let palette := mload(word)
                    if and(and(palette, shr(1, palette)), lowestBitOfEachPixel) {
                        valid := 0
                        break
                    }
                }
                if iszero(valid) { break }

                // Contract output writes only inside its 256-byte image, and
                // requires sorted unique indices and a valid feature selector.
                let previous := 0
                for { let row := patches } lt(row, add(baseline, size)) { row := add(row, 6) } {
                    let entry := shl(208, mload(sub(row, 26)))
                    let index := add(or(byte(0, entry), shl(8, byte(1, entry))), 1)
                    if or(or(gt(index, 1024), iszero(gt(index, previous))),
                        iszero(and(validPredicate(byte(2, entry), byte(3, entry)),
                            validPredicate(byte(4, entry), byte(5, entry))))) {
                        valid := 0
                        break
                    }
                    previous := index
                }
            }
        }
    }
}
