// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Local min/max import stand-in for the two OpenZeppelin Math operations used by
// the pinned third-party comparison source. It adds no state or external calls.
library Math {
    function max(uint256 a, uint256 b) internal pure returns (uint256) { return a > b ? a : b; }
    function min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}
