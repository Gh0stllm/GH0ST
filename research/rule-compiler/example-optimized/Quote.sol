// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract Quote {
    function quote(uint8 qty, uint8 tier) external pure returns (uint32) {
        return uint32((uint256(qty) * ((uint256(tier) == uint256(1)) ? uint256(95) : ((uint256(tier) == uint256(2)) ? uint256(90) : uint256(100)))));
    }
}
