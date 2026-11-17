// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @notice Manual type-1 Nitro fee-token pricer. This is not an oracle or a TWAP.
/// @dev Rate is GH0ST base units per one parent ETH, scaled by 1e18.
///      The operator must review/update it; this contract does not enforce freshness.
contract GH0STManualFeeTokenPricer {
    error Unauthorized();
    error ZeroOwner();
    error ZeroRate();
    address public owner;
    address public pendingOwner;
    uint256 public exchangeRate;
    event ExchangeRateSet(uint256 oldRate, uint256 newRate);
    event OwnershipProposed(address indexed owner, address indexed proposedOwner);
    event OwnershipAccepted(address indexed previousOwner, address indexed newOwner);

    constructor(address owner_, uint256 initialExchangeRate) {
        if (owner_ == address(0)) revert ZeroOwner();
        if (initialExchangeRate == 0) revert ZeroRate();
        owner = owner_;
        exchangeRate = initialExchangeRate;
        emit OwnershipAccepted(address(0), owner_);
        emit ExchangeRateSet(0, initialExchangeRate);
    }
    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    function getExchangeRate() external view returns (uint256) { return exchangeRate; }
    function setExchangeRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroRate();
        uint256 previous = exchangeRate;
        exchangeRate = newRate;
        emit ExchangeRateSet(previous, newRate);
    }
    function proposeOwner(address proposedOwner) external onlyOwner {
        if (proposedOwner == address(0)) revert ZeroOwner();
        pendingOwner = proposedOwner;
        emit OwnershipProposed(owner, proposedOwner);
    }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipAccepted(previous, msg.sender);
    }
}
