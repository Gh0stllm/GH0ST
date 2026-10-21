// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// A production implementation must compute every result from on-chain weights
/// and state. This interface alone does not establish that property.
interface IOnchainInference {
    function modelId() external view returns (bytes32);
    function begin(bytes calldata prompt, bytes calldata observation, uint16 tokenLimit)
        external returns (uint256 job);
    function advance(uint256 job, uint8 work) external;
    // kind: 0=final reply, 1=read balance, 2=native transfer, 3=save note.
    function result(uint256 job) external view returns
        (bool done, uint8 kind, address recipient, uint96 amount, bytes memory text);
}

/// Small, non-upgradeable agent instances share one separately deployed engine.
/// No arbitrary external call, delegatecall, unlimited approval, or model upgrade.
contract OnchainAgent {
    error Unauthorized();
    error Invalid();
    error Busy();
    error EngineChanged();
    error PolicyViolation();
    error TransferFailed();
    error Reentrant();

    enum Status { Idle, Running, Completed, Cancelled }
    address public owner;
    IOnchainInference public engine;
    bytes32 public engineCodeHash;
    bytes32 public modelId;
    Status public status;
    uint64 public runId;
    uint256 public job;
    uint96 public spent;
    uint96 public runBudget;
    uint96 public transferCap;
    uint16 public tokenLimit;
    uint8 public maxActions;
    uint8 public actions;
    bool private entered;
    bytes public prompt;
    bytes public reply;
    bytes public note;
    bytes public observation;
    mapping(address => bool) public allowedRecipient;

    event Opened(uint64 indexed run, uint256 indexed job, bytes prompt);
    event Acted(uint64 indexed run, uint8 kind, address recipient, uint96 amount, bytes text);
    event Replied(uint64 indexed run, bytes text);
    event Cancelled(uint64 indexed run);

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier lock() { if (entered) revert Reentrant(); entered = true; _; entered = false; }
    modifier idle() { if (status == Status.Running) revert Busy(); _; }

    // Locks the implementation itself; EIP-1167 instances have empty storage.
    constructor() { owner = address(1); }

    function initialize(address owner_, address engine_, bytes32 model_) external lock {
        if (owner != address(0) || owner_ == address(0) || engine_.code.length == 0) revert Invalid();
        owner = owner_;
        engine = IOnchainInference(engine_);
        if (engine.modelId() != model_) revert Invalid();
        modelId = model_;
        engineCodeHash = engine_.codehash;
    }

    receive() external payable {}

    function setRecipient(address recipient, bool allowed) external onlyOwner lock idle {
        if (recipient == address(0) || recipient == address(this)) revert Invalid();
        allowedRecipient[recipient] = allowed;
    }

    function open(bytes calldata text, uint96 budget, uint96 cap, uint8 actionLimit, uint16 tokens)
        external onlyOwner lock idle
    {
        if (text.length == 0 || text.length > 1024 || actionLimit == 0 || actionLimit > 8
            || tokens == 0 || tokens > 256 || cap > budget || budget > address(this).balance) revert Invalid();
        _checkEngine();
        runId++;
        prompt = text;
        delete reply;
        spent = 0;
        actions = 0;
        runBudget = budget;
        transferCap = cap;
        maxActions = actionLimit;
        tokenLimit = tokens;
        status = Status.Running;
        observation = abi.encode(uint8(0), block.chainid, address(this), owner,
            address(this).balance, runBudget, transferCap, note);
        job = engine.begin(prompt, observation, tokens);
        emit Opened(runId, job, text);
    }

    /// Anyone can pay to advance a run; only the pinned engine supplies outputs.
    function drive(uint8 work) external lock {
        if (status != Status.Running || work == 0 || work > 32) revert Invalid();
        _checkEngine();
        engine.advance(job, work);
        (bool done, uint8 kind, address recipient, uint96 amount, bytes memory text) = engine.result(job);
        if (!done) return;
        if (text.length > 2048) revert Invalid();
        if (kind == 0) {
            if (recipient != address(0) || amount != 0) revert Invalid();
            reply = text;
            status = Status.Completed;
            emit Replied(runId, text);
            return;
        }
        if (actions >= maxActions) revert PolicyViolation();
        actions++;
        if (kind == 1) {
            if (recipient != address(0) || amount != 0 || text.length != 0) revert Invalid();
            observation = abi.encode(kind, address(this).balance, runBudget-spent);
        } else if (kind == 2) {
            if (!allowedRecipient[recipient] || amount == 0 || amount > transferCap
                || amount > runBudget-spent || amount > address(this).balance) revert PolicyViolation();
            spent += amount;
            (bool success,) = recipient.call{value:amount,gas:30000}("");
            if (!success) revert TransferFailed();
            observation = abi.encode(kind, recipient, amount, address(this).balance, runBudget-spent);
        } else if (kind == 3) {
            if (recipient != address(0) || amount != 0 || text.length > 256) revert Invalid();
            note = text;
            observation = abi.encode(kind, text);
        } else revert Invalid();
        emit Acted(runId, kind, recipient, amount, text);
        uint256 oldJob = job;
        job = engine.begin(prompt, observation, tokenLimit);
        if (job == oldJob) revert Invalid();
    }

    function cancel() external onlyOwner lock {
        if (status != Status.Running) revert Invalid();
        status = Status.Cancelled;
        emit Cancelled(runId);
    }

    function withdraw(address payable recipient, uint256 amount) external onlyOwner lock idle {
        if (recipient == address(0)) revert Invalid();
        (bool success,) = recipient.call{value:amount}("");
        if (!success) revert TransferFailed();
    }

    function _checkEngine() private view {
        if (address(engine).codehash != engineCodeHash || engine.modelId() != modelId) revert EngineChanged();
    }
}

/// EIP-1167 clone factory. Weights/engine are shared, not redeployed per user.
contract AgentFactory {
    address public immutable implementation;
    address public immutable engine;
    bytes32 public immutable modelId;
    event Created(address indexed agent, address indexed owner);

    constructor(address engine_, bytes32 model_) {
        require(engine_.code.length != 0 && IOnchainInference(engine_).modelId() == model_, "engine");
        engine = engine_;
        modelId = model_;
        implementation = address(new OnchainAgent());
    }

    function create() external returns (address agent) {
        bytes memory code = abi.encodePacked(hex"3d602d80600a3d3981f3",hex"363d3d373d3d3d363d73",
            implementation,hex"5af43d82803e903d91602b57fd5bf3");
        assembly ("memory-safe") { agent := create(0, add(code,32), mload(code)) }
        require(agent != address(0), "create");
        OnchainAgent(payable(agent)).initialize(msg.sender,engine,modelId);
        emit Created(agent,msg.sender);
    }
}
