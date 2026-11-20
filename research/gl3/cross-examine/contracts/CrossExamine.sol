// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice One funded invariance claim and its permanent regression case.
contract CrossExamine {
    uint16 public constant BASELINE_AGE = 365;
    uint16 public constant MAX_WALLET_AGE = 36_600;
    uint16 public constant REVEAL_WINDOW = 256;
    uint8 public constant FIXTURE_QUALITY = 72;
    uint8 public constant FIXTURE_COMPLETION = 18;
    int32 public constant APPROVAL_THRESHOLD = 100;
    uint32 public constant CLAIM_VERSION = 1;
    bytes32 public constant CLAIM_ID = keccak256("GH0ST_CROSS_EXAMINE_WALLET_AGE_INVARIANCE_V1");
    address private constant ARB_SYS = address(0x64);
    bytes4 private constant ARB_BLOCK_NUMBER = bytes4(keccak256("arbBlockNumber()"));

    struct Model {
        int16 ageWeight;
        int16 baseAdjustment;
    }

    struct Commitment {
        bytes32 digest;
        uint64 blockNumber;
    }

    struct RegressionCase {
        address challenger;
        uint16 editedAge;
        bool requiredApproval;
    }

    address public immutable curator;
    uint256 public immutable rewardWei;
    uint32 public activeVersion;
    RegressionCase public counterexample;
    mapping(uint32 => Model) public models;
    mapping(address => Commitment) public commitments;
    mapping(address => uint256) public rewardCredit;

    error InvalidFunding();
    error InvalidCurator();
    error InvalidAge();
    error UnknownModel();
    error ClaimClosed();
    error InvalidCommitment();
    error RevealTooEarly();
    error RevealExpired();
    error VerdictUnchanged();
    error Unauthorized();
    error CounterexampleRequired();
    error NoReward();
    error InvalidRecipient();
    error TransferFailed();

    event ClaimOpened(
        bytes32 indexed claimId,
        uint32 indexed modelVersion,
        uint16 baselineAge,
        uint256 reward
    );
    event ChallengeCommitted(address indexed challenger, bytes32 commitment, uint64 blockNumber);
    event CounterexampleAccepted(
        uint32 indexed modelVersion,
        address indexed challenger,
        uint16 baselineAge,
        uint16 editedAge,
        int32 baselineScore,
        int32 editedScore,
        bool baselineApproved,
        bool editedApproved
    );
    event RewardCredited(address indexed challenger, uint256 amount);
    event RewardWithdrawn(address indexed challenger, address indexed recipient, uint256 amount);
    event ModelUpgradeBlocked(
        uint32 indexed activeVersion,
        bytes32 indexed candidateId,
        uint16 baselineAge,
        uint16 editedAge,
        bool baselineApproved,
        bool editedApproved,
        bool requiredApproval
    );
    event ModelUpgraded(uint32 indexed version, bytes32 indexed candidateId, int16 ageWeight, int16 baseAdjustment);

    constructor(address curator_, uint256 rewardWei_) payable {
        if (curator_ == address(0)) revert InvalidCurator();
        if (rewardWei_ == 0 || msg.value != rewardWei_) revert InvalidFunding();
        curator = curator_;
        rewardWei = rewardWei_;
        activeVersion = CLAIM_VERSION;
        models[CLAIM_VERSION] = Model({ageWeight: 1, baseAdjustment: 0});
        emit ClaimOpened(CLAIM_ID, CLAIM_VERSION, BASELINE_AGE, rewardWei_);
    }

    function verdict(uint16 age) external view returns (bool approved, int32 score) {
        return verdictAt(activeVersion, age);
    }

    function verdictAt(uint32 version, uint16 age) public view returns (bool approved, int32 score) {
        if (version == 0 || version > activeVersion) revert UnknownModel();
        if (age > MAX_WALLET_AGE) revert InvalidAge();
        return _score(models[version], age);
    }

    function commitmentFor(address challenger, uint16 age, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), CLAIM_ID, challenger, age, salt));
    }

    function commitChallenge(bytes32 digest) external {
        if (counterexample.challenger != address(0)) revert ClaimClosed();
        if (digest == bytes32(0)) revert InvalidCommitment();
        uint64 committedBlock = uint64(_blockNumber());
        commitments[msg.sender] = Commitment(digest, committedBlock);
        emit ChallengeCommitted(msg.sender, digest, committedBlock);
    }

    function revealChallenge(uint16 age, bytes32 salt) external {
        if (counterexample.challenger != address(0)) revert ClaimClosed();
        if (age == BASELINE_AGE || age > MAX_WALLET_AGE) revert InvalidAge();
        Commitment memory challenge = commitments[msg.sender];
        if (challenge.digest == bytes32(0) || challenge.digest != commitmentFor(msg.sender, age, salt)) {
            revert InvalidCommitment();
        }
        uint256 currentBlock = _blockNumber();
        if (currentBlock <= challenge.blockNumber) revert RevealTooEarly();
        if (currentBlock > uint256(challenge.blockNumber) + REVEAL_WINDOW) revert RevealExpired();

        (bool baselineApproved, int32 baselineScore) = verdictAt(CLAIM_VERSION, BASELINE_AGE);
        (bool editedApproved, int32 editedScore) = verdictAt(CLAIM_VERSION, age);
        if (baselineApproved == editedApproved) revert VerdictUnchanged();

        delete commitments[msg.sender];
        counterexample = RegressionCase(msg.sender, age, baselineApproved);
        rewardCredit[msg.sender] = rewardWei;
        emit CounterexampleAccepted(
            CLAIM_VERSION,
            msg.sender,
            BASELINE_AGE,
            age,
            baselineScore,
            editedScore,
            baselineApproved,
            editedApproved
        );
        emit RewardCredited(msg.sender, rewardWei);
    }

    function withdrawReward(address payable recipient) external {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        uint256 amount = rewardCredit[msg.sender];
        if (amount == 0) revert NoReward();
        rewardCredit[msg.sender] = 0;
        (bool paid,) = recipient.call{value: amount}("");
        if (!paid) revert TransferFailed();
        emit RewardWithdrawn(msg.sender, recipient, amount);
    }

    /// @notice Leaves the active model in place and logs a failed regression check.
    function attemptUpgrade(int16 ageWeight, int16 baseAdjustment) external returns (bool) {
        if (msg.sender != curator) revert Unauthorized();
        RegressionCase memory recorded = counterexample;
        if (recorded.challenger == address(0)) revert CounterexampleRequired();

        Model memory candidate = Model(ageWeight, baseAdjustment);
        bytes32 candidateId = keccak256(abi.encode(ageWeight, baseAdjustment));
        (bool baselineApproved,) = _score(candidate, BASELINE_AGE);
        (bool editedApproved,) = _score(candidate, recorded.editedAge);
        if (baselineApproved != recorded.requiredApproval || editedApproved != recorded.requiredApproval) {
            emit ModelUpgradeBlocked(activeVersion, candidateId, BASELINE_AGE, recorded.editedAge,
                baselineApproved, editedApproved, recorded.requiredApproval);
            return false;
        }

        uint32 version = activeVersion + 1;
        models[version] = candidate;
        activeVersion = version;
        emit ModelUpgraded(version, candidateId, ageWeight, baseAdjustment);
        return true;
    }

    function _blockNumber() private view returns (uint256) {
        // Nitro exposes the child height through ArbSys; BLOCKNUMBER can track the parent.
        (bool ok, bytes memory result) = ARB_SYS.staticcall(abi.encodeWithSelector(ARB_BLOCK_NUMBER));
        return ok && result.length == 32 ? abi.decode(result, (uint256)) : block.number;
    }

    function _score(Model memory model, uint16 age) private pure returns (bool approved, int32 score) {
        int32 ageMonths = int32(uint32(age / 30));
        score = int32(uint32(FIXTURE_QUALITY) + FIXTURE_COMPLETION)
            + int32(model.baseAdjustment)
            + int32(model.ageWeight) * ageMonths;
        approved = score >= APPROVAL_THRESHOLD;
    }
}
