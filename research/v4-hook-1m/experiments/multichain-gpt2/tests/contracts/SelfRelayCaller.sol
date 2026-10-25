// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ILayerZeroExecutor} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/interfaces/ILayerZeroExecutor.sol";
import {UlnOptions} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/libs/UlnOptions.sol";

/// @dev Test-only authorized-library stand-in and official options decoder.
contract SelfRelayCaller {
    function assign(address executor, uint32 eid, address app, uint256 size, bytes calldata options) external returns (uint256) {
        return ILayerZeroExecutor(executor).assignJob(eid, app, size, options);
    }
    function split(bytes calldata options) external pure returns (bytes memory, bytes memory) {
        return UlnOptions.decode(options);
    }
}
