// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlockWide5U2.sol";

/// @notice Exact wide-lane kernel plus bounded, atomic progress batching.
/// @dev Each self-call executes the existing permissionless deterministic step.
///      Activation storage remains warm between calls within one transaction.
///      A failed step reverts the entire batch. No caller supplies arithmetic.
contract LfmBlockOptimized is LfmBlockWide5U2 {
    constructor(address[] memory data) LfmBlockWide5U2(data) {}

    function advance(uint256 count) external returns (bytes32 digest) {
        if (count == 0 || count > 8) revert InvalidInput();
        if (stage == 0 || stage == 11) revert WrongStage();
        for (uint256 i; i < count; ++i) {
            digest = this.step();
            if (stage == 11) break;
        }
    }
}
