// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GH0STBountyEscrow} from "../src/GH0STBountyEscrow.sol";

interface Vm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
}

contract MockToken {
    enum Behavior {
        Normal,
        ReturnFalse,
        RecipientFee,
        SenderFee,
        Reenter
    }

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    Behavior public behavior;
    address private callback;
    bytes32 private callbackKey;
    bool public reentryBlocked;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function setBehavior(Behavior behavior_) external {
        behavior = behavior_;
    }

    function setCallback(address callback_, bytes32 key) external {
        callback = callback_;
        callbackKey = key;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (behavior == Behavior.ReturnFalse) return false;
        if (behavior == Behavior.Reenter) {
            (bool success, bytes memory data) = callback.call(abi.encodeCall(GH0STBountyEscrow.cancel, (callbackKey)));
            reentryBlocked = !success && bytes4(data) == GH0STBountyEscrow.Reentrancy.selector;
        }
        balanceOf[from] -= behavior == Behavior.SenderFee ? amount + 1 : amount;
        balanceOf[to] += behavior == Behavior.RecipientFee ? amount - 1 : amount;
        return true;
    }
}

contract GH0STBountyEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GH0ST = 0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559;
    address private constant CREATOR = address(0xA11CE);
    address private constant OTHER_CREATOR = address(0xB0B);
    address private constant CONTRIBUTOR = address(0xCAFE);
    bytes32 private constant KEY = keccak256("test board reward");
    uint256 private constant REWARD = 50 ether;
    uint256 private constant INITIAL = 100 ether;

    GH0STBountyEscrow private escrow;
    MockToken private token;

    event RewardFunded(address indexed creator, bytes32 indexed bountyKey, uint256 amount);
    event RewardPaid(
        address indexed creator,
        bytes32 indexed bountyKey,
        uint64 indexed submissionId,
        address recipient,
        uint256 amount
    );
    event RewardCancelled(address indexed creator, bytes32 indexed bountyKey, uint256 amount);

    function setUp() public {
        vm.chainId(4663);
        vm.etch(GH0ST, address(new MockToken()).code);
        token = MockToken(GH0ST);
        escrow = new GH0STBountyEscrow();
        token.mint(CREATOR, INITIAL);
        token.mint(OTHER_CREATOR, INITIAL);
    }

    function testConstructorPinsChainAndToken() public {
        assert(address(escrow.token()) == GH0ST);
        vm.chainId(46630);
        vm.expectRevert(GH0STBountyEscrow.WrongChain.selector);
        new GH0STBountyEscrow();
        vm.chainId(4663);
        vm.etch(GH0ST, "");
        vm.expectRevert(GH0STBountyEscrow.MissingToken.selector);
        new GH0STBountyEscrow();
    }

    function testIndependentCreatorFundsAndPaysExactlyOnce() public {
        _approveAllowance(OTHER_CREATOR);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit RewardFunded(OTHER_CREATOR, KEY, REWARD);
        vm.prank(OTHER_CREATOR);
        escrow.fund(KEY, REWARD);
        _expectReward(OTHER_CREATOR, 1, REWARD, 0, address(0));
        assert(token.balanceOf(address(escrow)) == REWARD);
        assert(token.balanceOf(OTHER_CREATOR) == INITIAL - REWARD);
        assert(token.allowance(OTHER_CREATOR, address(escrow)) == 0);

        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.approve(KEY, 7, CREATOR);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit RewardPaid(OTHER_CREATOR, KEY, 7, CONTRIBUTOR, REWARD);
        vm.prank(OTHER_CREATOR);
        escrow.approve(KEY, 7, CONTRIBUTOR);
        _expectReward(OTHER_CREATOR, 2, REWARD, 7, CONTRIBUTOR);
        assert(token.balanceOf(CONTRIBUTOR) == REWARD);
        assert(token.balanceOf(address(escrow)) == 0);

        vm.prank(OTHER_CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.approve(KEY, 8, CREATOR);
        vm.prank(OTHER_CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.cancel(KEY);
    }

    function testCreatorCanCancelAndRefundWhenCancellationWins() public {
        _fund(CREATOR);
        _fund(OTHER_CREATOR);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit RewardCancelled(CREATOR, KEY, REWARD);
        vm.prank(CREATOR);
        escrow.cancel(KEY);
        _expectReward(CREATOR, 3, REWARD, 0, address(0));
        _expectReward(OTHER_CREATOR, 1, REWARD, 0, address(0));
        assert(token.balanceOf(CREATOR) == INITIAL);
        assert(token.balanceOf(address(escrow)) == REWARD);

        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.approve(KEY, 7, CONTRIBUTOR);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.cancel(KEY);
    }

    function testEmptyCancellationRejectsStaleFundingWithoutSpendingAllowance() public {
        _approveAllowance(CREATOR);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit RewardCancelled(CREATOR, KEY, 0);
        vm.prank(CREATOR);
        escrow.cancel(KEY);

        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.fund(KEY, REWARD);
        _expectReward(CREATOR, 3, 0, 0, address(0));
        assert(token.balanceOf(CREATOR) == INITIAL);
        assert(token.balanceOf(address(escrow)) == 0);
        assert(token.allowance(CREATOR, address(escrow)) == REWARD);

        _fund(OTHER_CREATOR);
        _expectReward(OTHER_CREATOR, 1, REWARD, 0, address(0));
    }

    function testRevertsOnShortCreditExcessDebitAndFalseTransfer() public {
        _approveAllowance(CREATOR);
        for (uint256 i = 1; i <= 3; ++i) {
            token.setBehavior(MockToken.Behavior(i));
            vm.prank(CREATOR);
            vm.expectRevert(GH0STBountyEscrow.TransferFailed.selector);
            escrow.fund(KEY, REWARD);
            _expectReward(CREATOR, 0, 0, 0, address(0));
            assert(token.balanceOf(CREATOR) == INITIAL);
            assert(token.balanceOf(address(escrow)) == 0);
            assert(token.allowance(CREATOR, address(escrow)) == REWARD);
        }
        token.setBehavior(MockToken.Behavior.Normal);
        _fund(CREATOR);
        token.setBehavior(MockToken.Behavior.RecipientFee);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.TransferFailed.selector);
        escrow.approve(KEY, 7, CONTRIBUTOR);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.TransferFailed.selector);
        escrow.cancel(KEY);
        _expectReward(CREATOR, 1, REWARD, 0, address(0));
        assert(token.balanceOf(CONTRIBUTOR) == 0);
        assert(token.balanceOf(address(escrow)) == REWARD);
    }

    function testTokenCallbackCannotChangeEvenAnotherCreatorNamespace() public {
        token.setCallback(address(escrow), KEY);
        token.setBehavior(MockToken.Behavior.Reenter);
        _fund(CREATOR);
        assert(token.reentryBlocked());
        _expectReward(GH0ST, 0, 0, 0, address(0));
        _expectReward(CREATOR, 1, REWARD, 0, address(0));
    }

    function testInvalidInputsDoNotTouchExistingReward() public {
        vm.expectRevert(GH0STBountyEscrow.InvalidKey.selector);
        escrow.fund(bytes32(0), REWARD);
        vm.expectRevert(GH0STBountyEscrow.InvalidKey.selector);
        escrow.cancel(bytes32(0));
        vm.expectRevert(GH0STBountyEscrow.InvalidAmount.selector);
        escrow.fund(KEY, 0);

        _fund(CREATOR);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidStatus.selector);
        escrow.fund(KEY, REWARD);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidSubmission.selector);
        escrow.approve(KEY, 0, CONTRIBUTOR);
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidRecipient.selector);
        escrow.approve(KEY, 7, address(0));
        vm.prank(CREATOR);
        vm.expectRevert(GH0STBountyEscrow.InvalidRecipient.selector);
        escrow.approve(KEY, 7, address(escrow));
        _expectReward(CREATOR, 1, REWARD, 0, address(0));
    }

    function _approveAllowance(address creator) private {
        vm.prank(creator);
        token.approve(address(escrow), REWARD);
    }

    function _fund(address creator) private {
        _approveAllowance(creator);
        vm.prank(creator);
        escrow.fund(KEY, REWARD);
    }

    function _expectReward(address creator, uint8 status, uint256 amount, uint64 submissionId, address recipient)
        private
        view
    {
        (uint8 gotStatus, uint256 gotAmount, uint64 gotSubmission, address gotRecipient) =
            escrow.getReward(creator, KEY);
        assert(gotStatus == status && gotAmount == amount && gotSubmission == submissionId && gotRecipient == recipient);
    }
}
