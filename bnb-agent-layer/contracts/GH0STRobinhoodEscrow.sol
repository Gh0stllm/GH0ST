// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {GH0STBridgeBase} from "./GH0STBridgeBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract GH0STRobinhoodEscrow is GH0STBridgeBase {
    using SafeERC20 for IERC20;
    uint256 public lockedBacking;
    constructor(address router, uint64 local, uint64 remote, address token, address owner_, uint256 cap)
        GH0STBridgeBase(router, local, remote, token, owner_, cap) {
        if (block.chainid != 4663 || token.code.length == 0 || IERC20Metadata(token).decimals() != 18) revert InvalidBridge();
    }
    function _outboundAction() internal pure override returns (uint8) { return 1; }
    function _inboundAction() internal pure override returns (uint8) { return 2; }
    function _debit(address sender, uint256 amount) internal override {
        IERC20 token = IERC20(nativeToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert InvalidBridge();
        lockedBacking += amount;
    }
    function _credit(address recipient, uint256 amount) internal override {
        if (amount > lockedBacking) revert InvalidMessage();
        lockedBacking -= amount;
        IERC20 token = IERC20(nativeToken);
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) - beforeBalance != amount) revert InvalidBridge();
    }
}
