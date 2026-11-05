// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IGH0STBountyToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice A creator funds one reward per board key, then pays one submission or cancels for a refund.
/// @dev The creator's wallet chooses the submission and recipient. The contract does not evaluate evidence.
contract GH0STBountyEscrow {
    enum Status {
        Empty,
        Funded,
        Paid,
        Cancelled
    }

    struct Reward {
        Status status;
        uint64 submissionId;
        address recipient;
        uint256 amount;
    }

    IGH0STBountyToken public constant token = IGH0STBountyToken(0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559);
    mapping(address creator => mapping(bytes32 bountyKey => Reward)) private rewards;
    bool private entered;

    event RewardFunded(address indexed creator, bytes32 indexed bountyKey, uint256 amount);
    event RewardPaid(
        address indexed creator,
        bytes32 indexed bountyKey,
        uint64 indexed submissionId,
        address recipient,
        uint256 amount
    );
    event RewardCancelled(address indexed creator, bytes32 indexed bountyKey, uint256 amount);

    error WrongChain();
    error MissingToken();
    error InvalidKey();
    error InvalidAmount();
    error InvalidSubmission();
    error InvalidRecipient();
    error InvalidStatus();
    error TransferFailed();
    error Reentrancy();

    constructor() {
        if (block.chainid != 4663) revert WrongChain();
        if (address(token).code.length == 0) revert MissingToken();
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    function getReward(address creator, bytes32 bountyKey)
        external
        view
        returns (uint8 status, uint256 amount, uint64 submissionId, address recipient)
    {
        Reward storage reward = rewards[creator][bountyKey];
        return (uint8(reward.status), reward.amount, reward.submissionId, reward.recipient);
    }

    function fund(bytes32 bountyKey, uint256 amount) external nonReentrant {
        if (bountyKey == bytes32(0)) revert InvalidKey();
        if (amount == 0) revert InvalidAmount();
        Reward storage reward = rewards[msg.sender][bountyKey];
        if (reward.status != Status.Empty) revert InvalidStatus();

        reward.status = Status.Funded;
        reward.amount = amount;
        emit RewardFunded(msg.sender, bountyKey, amount);
        _transferExact(msg.sender, address(this), amount);
    }

    function approve(bytes32 bountyKey, uint64 submissionId, address recipient) external nonReentrant {
        if (submissionId == 0) revert InvalidSubmission();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        Reward storage reward = rewards[msg.sender][bountyKey];
        if (reward.status != Status.Funded) revert InvalidStatus();

        reward.status = Status.Paid;
        reward.submissionId = submissionId;
        reward.recipient = recipient;
        uint256 amount = reward.amount;
        emit RewardPaid(msg.sender, bountyKey, submissionId, recipient, amount);
        _transferExact(address(this), recipient, amount);
    }

    function cancel(bytes32 bountyKey) external nonReentrant {
        if (bountyKey == bytes32(0)) revert InvalidKey();
        Reward storage reward = rewards[msg.sender][bountyKey];
        if (reward.status != Status.Empty && reward.status != Status.Funded) revert InvalidStatus();

        reward.status = Status.Cancelled;
        uint256 amount = reward.amount;
        emit RewardCancelled(msg.sender, bountyKey, amount);
        if (amount != 0) _transferExact(address(this), msg.sender, amount);
    }

    function _transferExact(address from, address to, uint256 amount) private {
        uint256 senderBefore = token.balanceOf(from);
        uint256 recipientBefore = token.balanceOf(to);
        if (senderBefore < amount) revert TransferFailed();

        // Every entry point holds the reentrancy lock. A revert also removes the reward event.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        bool transferred = from == address(this) ? token.transfer(to, amount) : token.transferFrom(from, to, amount);
        // Compare deltas on both sides to reject transfer fees and partial credits.
        // forge-lint: disable-start(incorrect-strict-equality)
        if (
            !transferred || token.balanceOf(from) != senderBefore - amount
                || token.balanceOf(to) != recipientBefore + amount
        ) revert TransferFailed();
        // forge-lint: disable-end(incorrect-strict-equality)
    }
}
