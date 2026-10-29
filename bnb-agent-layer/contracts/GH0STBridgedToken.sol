// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {GH0STBridgeBase} from "./GH0STBridgeBase.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice 1:1 representation of GH0ST locked on Robinhood. No owner mint function.
contract GH0STBridgedToken is ERC20, ERC20Permit, GH0STBridgeBase {
    uint256 public immutable supplyCap;
    constructor(address router, uint64 local, uint64 remote, address token, address owner_, uint256 transferCap, uint256 supplyCap_)
        ERC20("GH0ST (BNB bridged)", "GH0ST") ERC20Permit("GH0ST (BNB bridged)")
        GH0STBridgeBase(router, local, remote, token, owner_, transferCap) {
        if (block.chainid != 56 || supplyCap_ == 0 || transferCap > supplyCap_) revert InvalidBridge();
        supplyCap = supplyCap_;
    }
    function _outboundAction() internal pure override returns (uint8) { return 2; }
    function _inboundAction() internal pure override returns (uint8) { return 1; }
    function _debit(address sender, uint256 amount) internal override { _burn(sender, amount); }
    function _credit(address recipient, uint256 amount) internal override {
        if (totalSupply() + amount > supplyCap) revert InvalidMessage();
        _mint(recipient, amount);
    }
}
