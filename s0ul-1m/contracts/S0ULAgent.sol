// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULActionCodec} from "./S0ULActionCodec.sol";

interface IS0ULAgentEngine {
    struct Status {
        address owner;
        uint8 phase;
        uint16 position;
        uint16 layer;
        uint16 row;
        uint16 head;
        uint16 promptLength;
        uint16 maxNewTokens;
        uint16 generated;
        uint256 saturationCount;
        bool done;
        bool cancelled;
        bool logitsReady;
    }
    function model() external view returns (address);
    function tokenizer() external view returns (address);
    function modelId() external view returns (bytes32);
    function beginText(string calldata text, uint16 maxNewTokens) external returns (uint256);
    function advance(uint256 requestId, uint256 maxRows) external returns (bool);
    function cancel(uint256 requestId) external;
    function status(uint256 requestId) external view returns (Status memory);
    function tokens(uint256 requestId) external view returns (uint16[] memory);
    function outputTokens(uint256 requestId) external view returns (uint16[] memory);
}

interface IS0ULAgentModel {
    function modelId() external view returns (bytes32);
    function sourceCheckpoint() external view returns (bytes32);
}

interface IS0ULAgentTokenizer {
    function domainSha256() external view returns (bytes32);
    function decode(uint16[] calldata ids, bool skipSpecial) external view returns (bytes memory);
}

/// @notice Executes one permitted, completed S0UL action in its requester's namespace.
/// @dev No custody, transfers, arbitrary calls, model replacement or automatic loop.
/// Model syntax is not authorization: each binding has an explicit action mask;
/// constrained bindings additionally commit the exact canonical action bytes.
contract S0ULAgent {
    uint16 public constant ALL_ACTIONS = 1023;
    uint256 public constant MAX_TASKS = 64;
    bytes32 public constant TOKENIZER_DOMAIN_SHA256 =
        0x7de4830b9e32e5884d2ee9776fdae6c8c1b42a9278342ae22d7105b039e9a726;

    enum Outcome { None, Running, Executed, Rejected, Cancelled }
    enum Reason {
        None, EngineCancelled, InvalidOutput, InvalidAction, ActionNotAllowed,
        StaleState, TaskLimit, TaskMissing, TokenDisabled, TokenChanged,
        TokenReadFailed, ActionMismatch
    }
    struct Request {
        address owner;
        uint16 allowedActions;
        uint64 stateRevision;
        bool adopted;
        Outcome outcome;
        uint8 action;
        Reason reason;
        bytes32 promptHash;
        bytes32 outputHash;
        bytes32 expectedActionHash;
    }
    struct Task { bytes title; bool done; }

    IS0ULAgentEngine public immutable engine;
    address public immutable model;
    address public immutable tokenizer;
    bytes32 public immutable engineCodeHash;
    bytes32 public immutable modelCodeHash;
    bytes32 public immutable tokenizerCodeHash;
    bytes32 public immutable modelId;
    bytes32 public immutable sourceCheckpoint;
    address public immutable gh0stToken;
    bytes32 public immutable gh0stCodeHash;

    mapping(uint256 => Request) public requests;
    mapping(address => uint64) public stateRevision;
    mapping(address => uint256) public taskCount;
    mapping(address => mapping(bytes32 => bytes)) private _memory;
    mapping(address => mapping(uint256 => Task)) private _tasks;
    mapping(uint256 => bytes) private _outputs;
    mapping(uint256 => bytes) private _results;
    bool private _entered;

    error InvalidConfiguration();
    error InvalidRequest();
    error UnknownRequest();
    error NotOwner();
    error NotReady();
    error AlreadySettled();
    error EngineChanged();
    error Reentrant();
    error InsufficientGas();

    /// @dev promptHash/outputHash hash ABI-encoded uint16 token arrays, including
    /// BOS/SEP for the original prompt and terminal EOS for the generated output.
    event Bound(uint256 indexed requestId, address indexed owner, bytes32 indexed modelId,
        uint16 allowedActions, bytes32 promptHash, bool adopted);
    event Executed(uint256 indexed requestId, address indexed owner, uint8 kind,
        bytes32 outputHash, bytes result);
    event Rejected(uint256 indexed requestId, address indexed owner, uint8 reason,
        bytes32 outputHash);
    event Cancelled(uint256 indexed requestId, address indexed owner, bool engineCancelled);
    event BatchAdvanced(uint256 indexed requestId, uint256 executed, bool done);

    modifier nonReentrant() {
        if (_entered) revert Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address engine_, bytes32 expectedEngineCodeHash, bytes32 expectedModelId,
        address gh0stToken_)
    {
        if (engine_.code.length == 0 || expectedEngineCodeHash == 0 || expectedModelId == 0
            || engine_.codehash != expectedEngineCodeHash) revert InvalidConfiguration();
        IS0ULAgentEngine candidate = IS0ULAgentEngine(engine_);
        address model_ = candidate.model();
        address tokenizer_ = candidate.tokenizer();
        if (model_.code.length == 0 || tokenizer_.code.length == 0
            || candidate.modelId() != expectedModelId
            || IS0ULAgentModel(model_).modelId() != expectedModelId
            || IS0ULAgentTokenizer(tokenizer_).domainSha256() != TOKENIZER_DOMAIN_SHA256)
            revert InvalidConfiguration();
        bytes32 checkpoint = IS0ULAgentModel(model_).sourceCheckpoint();
        if (checkpoint == 0 || (gh0stToken_ != address(0) && gh0stToken_.code.length == 0))
            revert InvalidConfiguration();
        engine = candidate;
        model = model_;
        tokenizer = tokenizer_;
        engineCodeHash = expectedEngineCodeHash;
        modelCodeHash = model_.codehash;
        tokenizerCodeHash = tokenizer_.codehash;
        modelId = expectedModelId;
        sourceCheckpoint = checkpoint;
        gh0stToken = gh0stToken_;
        gh0stCodeHash = gh0stToken_ == address(0) ? bytes32(0) : gh0stToken_.codehash;
    }

    function begin(string calldata prompt, uint16 maxNewTokens, uint16 allowedActions)
        external nonReentrant returns (uint256)
    { return _begin(prompt, maxNewTokens, allowedActions, bytes32(0)); }

    function beginConstrained(string calldata prompt, uint16 maxNewTokens, uint16 allowedActions,
        bytes32 expectedActionHash) external nonReentrant returns (uint256)
    {
        if (expectedActionHash == 0) revert InvalidRequest();
        return _begin(prompt, maxNewTokens, allowedActions, expectedActionHash);
    }

    function _begin(string calldata prompt, uint16 maxNewTokens, uint16 allowedActions,
        bytes32 expectedActionHash) private returns (uint256 id)
    {
        _checkEngine();
        _checkMask(allowedActions);
        if (bytes(prompt).length == 0 || maxNewTokens < 2 || maxNewTokens > 32)
            revert InvalidRequest();
        id = engine.beginText(prompt, maxNewTokens);
        IS0ULAgentEngine.Status memory s = engine.status(id);
        if (s.owner != address(this) || s.cancelled) revert InvalidRequest();
        _bind(id, msg.sender, allowedActions, false, expectedActionHash, s);
    }

    function adopt(uint256 id, uint16 allowedActions) external nonReentrant {
        _adopt(id, allowedActions, bytes32(0));
    }

    function adoptConstrained(uint256 id, uint16 allowedActions, bytes32 expectedActionHash)
        external nonReentrant
    {
        if (expectedActionHash == 0) revert InvalidRequest();
        _adopt(id, allowedActions, expectedActionHash);
    }

    function _adopt(uint256 id, uint16 allowedActions, bytes32 expectedActionHash) private {
        _checkEngine();
        _checkMask(allowedActions);
        IS0ULAgentEngine.Status memory s = engine.status(id);
        if (s.owner != msg.sender) revert NotOwner();
        if (s.cancelled) revert InvalidRequest();
        _bind(id, msg.sender, allowedActions, true, expectedActionHash, s);
    }

    function _bind(uint256 id, address owner, uint16 allowedActions, bool adopted,
        bytes32 expectedActionHash, IS0ULAgentEngine.Status memory s) private
    {
        if (id == 0 || requests[id].owner != address(0)) revert InvalidRequest();
        uint16[] memory all = engine.tokens(id);
        if (s.promptLength == 0 || s.promptLength > 128 || all.length < s.promptLength)
            revert InvalidRequest();
        uint16[] memory prompt = new uint16[](s.promptLength);
        for (uint256 i; i < prompt.length; ++i) prompt[i] = all[i];
        bytes32 promptHash = keccak256(abi.encode(prompt));
        requests[id] = Request(owner, allowedActions, stateRevision[owner], adopted,
            Outcome.Running, 0, Reason.None, promptHash, 0, expectedActionHash);
        emit Bound(id, owner, modelId, allowedActions, promptHash, adopted);
    }

    /// @notice Anyone may pay for deterministic continuation of a bound request.
    function advance(uint256 id, uint256 rows) external nonReentrant returns (bool done) {
        Request storage r = _running(id);
        if (rows == 0 || rows > 128) revert InvalidRequest();
        _checkEngine();
        IS0ULAgentEngine.Status memory s = engine.status(id);
        _checkOwner(r, s);
        if (s.cancelled) revert InvalidRequest();
        if (s.done) return true;
        return engine.advance(id, rows);
    }

    /// @notice Amortizes transaction overhead across at most four existing engine steps.
    /// Stops before Select after progressing, so the completed logits remain inspectable.
    function advanceBatch(uint256 id, uint256 rows, uint256 steps)
        external nonReentrant returns (bool done)
    {
        Request storage r = _running(id);
        if (rows == 0 || rows > 128 || steps == 0 || steps > 4) revert InvalidRequest();
        _checkEngine();
        uint256 executed;
        while (executed < steps) {
            IS0ULAgentEngine.Status memory s = engine.status(id);
            _checkOwner(r, s);
            if (s.cancelled) revert InvalidRequest();
            if (s.done) { done = true; break; }
            if (executed != 0 && s.phase == 16) break;
            done = engine.advance(id, rows);
            ++executed;
            if (done) break;
        }
        emit BatchAdvanced(id, executed, done);
    }

    /// @notice Consumes only the bound engine output. No caller supplies an action.
    function finalize(uint256 id) external nonReentrant returns (bool executed) {
        Request storage r = _running(id);
        _checkEngine();
        IS0ULAgentEngine.Status memory s = engine.status(id);
        _checkOwner(r, s);
        if (s.cancelled) return _reject(id, r, Reason.EngineCancelled);
        if (!s.done) revert NotReady();
        uint16[] memory ids = engine.outputTokens(id);
        r.outputHash = keccak256(abi.encode(ids));
        // Settled before decoding or any tool call; a revert still rolls back.
        r.outcome = Outcome.Rejected;
        if (ids.length < 2 || ids.length > 32 || s.generated != ids.length
            || ids[ids.length - 1] != 2) return _reject(id, r, Reason.InvalidOutput);
        uint16[] memory content = new uint16[](ids.length - 1);
        for (uint256 i; i < content.length; ++i) {
            if (ids[i] < 4 || ids[i] >= 421) return _reject(id, r, Reason.InvalidOutput);
            content[i] = ids[i];
        }
        bytes memory output = IS0ULAgentTokenizer(tokenizer).decode(content, false);
        _outputs[id] = output;
        (bool valid, S0ULActionCodec.Action memory action) = S0ULActionCodec.parse(output);
        if (!valid || action.kind > 9) return _reject(id, r, Reason.InvalidAction);
        r.action = action.kind;
        if ((r.allowedActions & (uint16(1) << action.kind)) == 0)
            return _reject(id, r, Reason.ActionNotAllowed);
        if (r.expectedActionHash != 0 && keccak256(output) != r.expectedActionHash)
            return _reject(id, r, Reason.ActionMismatch);
        bool writing = action.kind == 3 || action.kind == 5 || action.kind == 7;
        if (writing && r.stateRevision != stateRevision[r.owner])
            return _reject(id, r, Reason.StaleState);
        (bool ok, bytes memory result, Reason failure) = _execute(r.owner, action);
        if (!ok) return _reject(id, r, failure);
        if (writing) ++stateRevision[r.owner];
        _results[id] = result;
        r.outcome = Outcome.Executed;
        r.reason = Reason.None;
        emit Executed(id, r.owner, action.kind, r.outputHash, result);
        return true;
    }

    function _execute(address owner, S0ULActionCodec.Action memory a)
        private returns (bool, bytes memory, Reason)
    {
        if (a.kind == 0) return (true, bytes(""), Reason.None);
        if (a.kind == 1) return (true, abi.encode(owner.balance), Reason.None);
        if (a.kind == 2) {
            if (gh0stToken == address(0)) return (false, bytes(""), Reason.TokenDisabled);
            if (gh0stToken.codehash != gh0stCodeHash) return (false, bytes(""), Reason.TokenChanged);
            (bool ok, uint256 balance) = _tokenBalance(owner);
            if (!ok) return (false, bytes(""), Reason.TokenReadFailed);
            return (true, abi.encode(balance), Reason.None);
        }
        if (a.kind == 3) {
            _memory[owner][a.key] = a.value;
            return (true, abi.encode(a.key, a.value), Reason.None);
        }
        if (a.kind == 4) return (true, abi.encode(_memory[owner][a.key]), Reason.None);
        if (a.kind == 5) {
            if (taskCount[owner] >= MAX_TASKS) return (false, bytes(""), Reason.TaskLimit);
            uint256 id = ++taskCount[owner];
            _tasks[owner][id] = Task(a.value, false);
            return (true, abi.encode(id, a.value), Reason.None);
        }
        if (a.kind == 6) return (true, abi.encode(_taskList(owner)), Reason.None);
        if (a.kind == 7) {
            if (a.taskId == 0 || a.taskId > taskCount[owner])
                return (false, bytes(""), Reason.TaskMissing);
            _tasks[owner][a.taskId].done = true;
            return (true, abi.encode(a.taskId), Reason.None);
        }
        // CLARIFY and REFUSE are recorded terminal observations, never mutations.
        return (true, abi.encode(a.key), Reason.None);
    }

    function _tokenBalance(address owner) private view returns (bool ok, uint256 value) {
        address token = gh0stToken;
        uint256 size;
        // Underfunded permissionless callers must not turn gas starvation into
        // a terminal token failure. Reserve the entire fixed call budget.
        if (gasleft() < 80000) revert InsufficientGas();
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x70a08231))
            mstore(add(ptr, 4), owner)
            ok := staticcall(50000, token, ptr, 36, ptr, 32)
            size := returndatasize()
            value := mload(ptr)
        }
        ok = ok && size == 32;
    }

    function cancel(uint256 id) external nonReentrant {
        Request storage r = _running(id);
        if (r.owner != msg.sender) revert NotOwner();
        r.outcome = Outcome.Cancelled;
        bool forwarded;
        // An adopted request still belongs to the original user at the engine.
        // A changed engine never prevents the user from tombstoning this binding.
        if (!r.adopted && address(engine).codehash == engineCodeHash) {
            IS0ULAgentEngine.Status memory s = engine.status(id);
            if (s.owner == address(this) && !s.done && !s.cancelled) {
                engine.cancel(id);
                forwarded = true;
            }
        }
        emit Cancelled(id, r.owner, forwarded);
    }

    function memoryOf(address owner, bytes32 key) external view returns (bytes memory) {
        return _memory[owner][key];
    }
    function taskOf(address owner, uint256 id) external view returns (bytes memory title, bool done) {
        if (id == 0 || id > taskCount[owner]) revert InvalidRequest();
        Task storage t = _tasks[owner][id];
        return (t.title, t.done);
    }
    function tasksOf(address owner) external view returns (Task[] memory) { return _taskList(owner); }
    function _taskList(address owner) private view returns (Task[] memory result) {
        result = new Task[](taskCount[owner]);
        for (uint256 i; i < result.length; ++i) result[i] = _tasks[owner][i + 1];
    }
    function resultOf(uint256 id) external view returns (bytes memory output, bytes memory result) {
        return (_outputs[id], _results[id]);
    }

    function _running(uint256 id) private view returns (Request storage r) {
        r = requests[id];
        if (r.owner == address(0)) revert UnknownRequest();
        if (r.outcome != Outcome.Running) revert AlreadySettled();
    }
    function _reject(uint256 id, Request storage r, Reason reason) private returns (bool) {
        r.outcome = Outcome.Rejected;
        r.reason = reason;
        emit Rejected(id, r.owner, uint8(reason), r.outputHash);
        return false;
    }
    function _checkOwner(Request storage r, IS0ULAgentEngine.Status memory s) private view {
        if (s.owner != (r.adopted ? r.owner : address(this))) revert EngineChanged();
    }
    function _checkMask(uint16 mask) private pure {
        if ((mask & ~ALL_ACTIONS) != 0) revert InvalidRequest();
    }
    function _checkEngine() private view {
        if (address(engine).codehash != engineCodeHash || model.codehash != modelCodeHash
            || tokenizer.codehash != tokenizerCodeHash || engine.modelId() != modelId
            || engine.model() != model || engine.tokenizer() != tokenizer
            || IS0ULAgentModel(model).modelId() != modelId
            || IS0ULAgentModel(model).sourceCheckpoint() != sourceCheckpoint
            || IS0ULAgentTokenizer(tokenizer).domainSha256() != TOKENIZER_DOMAIN_SHA256)
            revert EngineChanged();
    }
    function decodeAction(bytes memory action) external pure returns (bool, S0ULActionCodec.Action memory) {
        return S0ULActionCodec.parse(action);
    }
}
