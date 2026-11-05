// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GH0STBountyEscrow, IGH0STBountyToken} from "../src/GH0STBountyEscrow.sol";

interface ForkVm {
    function envOr(string calldata, string calldata) external returns (string memory);
    function envOr(string calldata, address) external returns (address);
    function createSelectFork(string calldata) external returns (uint256);
    function skip(bool) external;
    function prank(address) external;
}

interface ApproveToken is IGH0STBountyToken {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract GH0STBountyEscrowForkTest {
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CONTRIBUTOR = address(0xCAFE);
    uint256 private constant AMOUNT = 1 ether;

    function testForkCanonicalTokenPaysAndRefundsExactly() public {
        string memory rpc = vm.envOr("GH0ST_ESCROW_FORK_RPC", string(""));
        vm.skip(bytes(rpc).length == 0);
        address creator = vm.envOr("GH0ST_ESCROW_FORK_CREATOR", address(0));
        require(creator != address(0), "Set GH0ST_ESCROW_FORK_CREATOR to a public GH0ST holder");
        vm.createSelectFork(rpc);

        GH0STBountyEscrow escrow = new GH0STBountyEscrow();
        ApproveToken token = ApproveToken(address(escrow.token()));
        uint256 creatorBefore = token.balanceOf(creator);
        uint256 contributorBefore = token.balanceOf(CONTRIBUTOR);
        require(creatorBefore >= AMOUNT * 2, "Fork creator needs at least 2 GH0ST");

        bytes32 payKey = keccak256("pay fork submission");
        bytes32 refundKey = keccak256("refund fork bounty");
        _fund(escrow, token, creator, payKey);
        _fund(escrow, token, creator, refundKey);
        assert(token.balanceOf(address(escrow)) == AMOUNT * 2);

        vm.prank(creator);
        escrow.approve(payKey, 1, CONTRIBUTOR);
        vm.prank(creator);
        escrow.cancel(refundKey);

        assert(token.balanceOf(creator) == creatorBefore - AMOUNT);
        assert(token.balanceOf(CONTRIBUTOR) == contributorBefore + AMOUNT);
        assert(token.balanceOf(address(escrow)) == 0);
        (uint8 paid, uint256 amount, uint64 submission, address recipient) = escrow.getReward(creator, payKey);
        (uint8 refunded, uint256 refund,,) = escrow.getReward(creator, refundKey);
        assert(paid == 2 && amount == AMOUNT && submission == 1 && recipient == CONTRIBUTOR);
        assert(refunded == 3 && refund == AMOUNT);
    }

    function _fund(GH0STBountyEscrow escrow, ApproveToken token, address creator, bytes32 key) private {
        vm.prank(creator);
        assert(token.approve(address(escrow), AMOUNT));
        vm.prank(creator);
        escrow.fund(key, AMOUNT);
    }
}
