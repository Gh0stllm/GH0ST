// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Immutable STOP-prefixed model data, with a portable EIP-170 size.
contract S0ULDataShard {
    error InvalidPayloadLength();

    constructor(bytes memory payload) {
        if (payload.length == 0 || payload.length > 23_000) revert InvalidPayloadLength();
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") {
            return(add(runtime, 32), mload(runtime))
        }
    }
}
