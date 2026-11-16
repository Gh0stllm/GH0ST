// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
contract SyntheticArbSys {
    function arbOSVersion() external pure returns (uint256) { return 116; }
    function arbBlockNumber() external view returns (uint256) { return block.number; }
}
contract SyntheticArbGasInfo {
    function getL1BaseFeeEstimate() external pure returns (uint256) { return 0; }
}
contract LocalUnitRatePricer {
    function getExchangeRate() external pure returns (uint256) { return 1e18; }
}
