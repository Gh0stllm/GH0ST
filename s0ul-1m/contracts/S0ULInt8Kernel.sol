// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Bounded integer inference primitive, not a complete neural network.
/// @dev Every packed byte is signed INT8 [-128, 127]; activations are signed INT32.
///      Exporters may restrict weights to symmetric [-127, 127]. No scale is applied.
contract S0ULInt8Kernel {
    uint256 public constant MAX_WIDTH = 640;

    error InvalidDimensions();
    error InvalidCodeRange();

    function dot(bytes calldata weights, int32[] calldata activations) external pure returns (int256 sum) {
        uint256 width = activations.length;
        if (width == 0 || width > MAX_WIDTH || weights.length != width) revert InvalidDimensions();
        for (uint256 i; i < width; ++i) {
            sum += int256(int8(uint8(weights[i]))) * int256(activations[i]);
        }
    }

    /// @notice Read one row from already deployed code rather than resending its weights.
    /// @dev The caller chooses the code and offset. A future model runtime must pin both.
    ///      Offset is a byte offset in runtime code, including any STOP/data header.
    function dotFromCode(address shard, uint256 offset, int32[] calldata activations)
        external view returns (int256 sum)
    {
        uint256 width = activations.length;
        if (width == 0 || width > MAX_WIDTH) revert InvalidDimensions();
        uint256 size = shard.code.length;
        if (offset > size || width > size - offset) revert InvalidCodeRange();
        bytes memory weights = new bytes(width);
        assembly ("memory-safe") {
            extcodecopy(shard, add(weights, 32), offset, width)
        }
        for (uint256 i; i < width; ++i) {
            sum += int256(int8(uint8(weights[i]))) * int256(activations[i]);
        }
    }
}
