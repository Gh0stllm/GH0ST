// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "./vendor/openzeppelin-5.0.2/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed supply token. The sole mint is performed during construction.
/// @dev No owner, external mint/burn, transfer customizations, or upgrade mechanism.
contract NovaToken is ERC20 {
    uint256 public constant FIXED_SUPPLY = 1_000_000 ether;

    constructor(address initialRecipient) ERC20("GH0ST N0VA", "N0VA") {
        _mint(initialRecipient, FIXED_SUPPLY);
    }
}
