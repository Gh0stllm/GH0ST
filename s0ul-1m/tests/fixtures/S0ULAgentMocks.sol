// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IMockAgentTokenizer {
    function encode(string calldata text) external view returns (uint16[] memory);
}

interface IMockAgentModel {
    function modelId() external view returns (bytes32);
}

/// @dev Test-only mutable identity. No production contract imports this file.
contract MockS0ULModel {
    struct Config {
        uint16 vocabSize;
        uint16 dim;
        uint16 layers;
        uint16 heads;
        uint16 hiddenDim;
        uint16 maxSeqLen;
        uint32 epsQ28;
        uint32 attentionScaleQ14;
    }

    bytes32 public modelId;
    bytes32 public sourceCheckpoint;
    Config private _config;

    constructor(bytes32 identity, bytes32 checkpoint) {
        modelId = identity;
        sourceCheckpoint = checkpoint;
        _config = Config(512, 8, 1, 2, 16, 128, 2684, 8192);
    }

    function configuration() external view returns (Config memory) { return _config; }
    function setIdentity(bytes32 identity, bytes32 checkpoint) external {
        modelId = identity;
        sourceCheckpoint = checkpoint;
    }
    function setConfiguration(Config calldata config) external { _config = config; }
    function readTensor(uint256, uint256, uint256 length) external pure returns (bytes memory) {
        return new bytes(length);
    }
}

/// @dev Deliberately configurable engine for controller provenance/auth tests.
contract MockS0ULEngine {
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
    struct Request {
        Status state;
        uint16[] ids;
        uint16[] output;
        uint16[] completion;
        bool completeOnAdvance;
    }

    address public model;
    address public tokenizer;
    bytes32 public modelId;
    uint256 public nextRequestId = 1;
    uint256 public constant MAX_ROWS = 128;
    uint256 public constant MAX_NEW_TOKENS = 32;
    address public lastBeginCaller;
    address public lastAdvanceCaller;
    address public lastAdvanceOwner;
    uint256 public advanceCount;
    address public reentryTarget;
    bytes public reentryData;
    bool public reenterOnBegin;
    bool public reenterOnAdvance;
    bool public propagateReentryFailure;
    uint256 public reentryAttempts;
    bool public reentryAttempted;
    bool public lastReentrySucceeded;
    mapping(uint256 => Request) private _requests;

    event Begun(uint256 indexed requestId, address indexed owner);
    event RequestCancelled(uint256 indexed requestId);

    constructor(address model_, address tokenizer_) {
        model = model_;
        tokenizer = tokenizer_;
        modelId = IMockAgentModel(model_).modelId();
    }

    function configurePins(address model_, address tokenizer_, bytes32 identity) external {
        model = model_;
        tokenizer = tokenizer_;
        modelId = identity;
    }

    function configureReentry(address target, bytes calldata data, bool onBegin, bool onAdvance, bool propagate) external {
        reentryTarget = target;
        reentryData = data;
        reenterOnBegin = onBegin;
        reenterOnAdvance = onAdvance;
        propagateReentryFailure = propagate;
        reentryAttempted = false;
        lastReentrySucceeded = false;
    }

    function begin(uint16[] calldata prompt, uint16 maximum) external returns (uint256 id) {
        return _begin(prompt, maximum);
    }

    function beginText(string calldata text, uint16 maximum) external returns (uint256 id) {
        uint16[] memory encoded = IMockAgentTokenizer(tokenizer).encode(text);
        uint16[] memory prompt = new uint16[](encoded.length + 2);
        prompt[0] = 1;
        for (uint256 i; i < encoded.length; ++i) prompt[i + 1] = encoded[i];
        prompt[prompt.length - 1] = 3;
        return _begin(prompt, maximum);
    }

    function _begin(uint16[] memory prompt, uint16 maximum) private returns (uint256 id) {
        require(prompt.length != 0 && maximum != 0 && maximum <= MAX_NEW_TOKENS, "request");
        require(prompt.length + maximum <= 128, "context");
        id = nextRequestId++;
        Request storage r = _requests[id];
        r.state.owner = msg.sender;
        r.state.phase = 1;
        r.state.promptLength = uint16(prompt.length);
        r.state.maxNewTokens = maximum;
        r.ids = prompt;
        lastBeginCaller = msg.sender;
        if (reenterOnBegin) _reenter();
        emit Begun(id, msg.sender);
    }

    function status(uint256 id) external view returns (Status memory) { return _request(id).state; }
    function tokens(uint256 id) external view returns (uint16[] memory) { return _request(id).ids; }
    function outputTokens(uint256 id) external view returns (uint16[] memory) { return _request(id).output; }

    function advance(uint256 id, uint256 rows) external returns (bool) {
        require(rows > 0 && rows <= MAX_ROWS, "rows");
        Request storage r = _request(id);
        require(!r.state.done && !r.state.cancelled, "terminal");
        lastAdvanceCaller = msg.sender;
        lastAdvanceOwner = r.state.owner;
        ++advanceCount;
        if (reenterOnAdvance) _reenter();
        if (r.completeOnAdvance) {
            uint16[] memory completion = r.completion;
            _output(r, completion, true);
        }
        return r.state.done;
    }

    function cancel(uint256 id) external {
        Request storage r = _request(id);
        require(msg.sender == r.state.owner, "owner");
        require(!r.state.done && !r.state.cancelled, "terminal");
        r.state.cancelled = true;
        r.state.phase = 18;
        emit RequestCancelled(id);
    }

    function setOutput(uint256 id, uint16[] calldata output, bool complete) external {
        _output(_request(id), output, complete);
    }

    function setCompletion(uint256 id, uint16[] calldata output) external {
        Request storage r = _request(id);
        r.completion = output;
        r.completeOnAdvance = true;
    }

    function setTokens(uint256 id, uint16[] calldata ids) external { _request(id).ids = ids; }
    function setOwner(uint256 id, address owner) external { _request(id).state.owner = owner; }
    function setStatus(uint256 id, Status calldata state) external { _request(id).state = state; }
    function setFlags(uint256 id, uint8 phase, bool done, bool cancelled, uint256 saturation) external {
        Status storage s = _request(id).state;
        s.phase = phase;
        s.done = done;
        s.cancelled = cancelled;
        s.saturationCount = saturation;
    }
    function setCounters(uint256 id, uint16 promptLength, uint16 maximum, uint16 generated) external {
        Status storage s = _request(id).state;
        s.promptLength = promptLength;
        s.maxNewTokens = maximum;
        s.generated = generated;
    }

    function _output(Request storage r, uint16[] memory output, bool complete) private {
        r.output = output;
        uint16[] memory ids = new uint16[](uint256(r.state.promptLength) + output.length);
        for (uint256 i; i < r.state.promptLength; ++i) ids[i] = i < r.ids.length ? r.ids[i] : 0;
        for (uint256 i; i < output.length; ++i) ids[uint256(r.state.promptLength) + i] = output[i];
        r.ids = ids;
        r.state.generated = uint16(output.length);
        r.state.done = complete;
        r.state.cancelled = false;
        r.state.phase = complete ? 17 : 1;
        r.state.logitsReady = complete;
    }

    function _request(uint256 id) private view returns (Request storage r) {
        r = _requests[id];
        require(r.state.owner != address(0), "unknown");
    }

    function _reenter() private {
        ++reentryAttempts;
        reentryAttempted = true;
        (bool success,) = reentryTarget.call(reentryData);
        lastReentrySucceeded = success;
        if (propagateReentryFailure) require(success, "reentry failed");
    }
}

/// @dev Test-only malformed/failing/gas-consuming balanceOf implementations.
contract MockS0ULBalanceToken {
    mapping(address => uint256) public balances;
    uint8 public mode;
    address public callbackTarget;
    bytes public callbackData;

    function setBalance(address account, uint256 value) external { balances[account] = value; }
    function setMode(uint8 mode_) external { mode = mode_; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }

    function balanceOf(address account) external view returns (uint256) {
        if (mode == 1) revert("token failed");
        if (mode == 2) assembly { mstore(0, 123) return(0, 1) }
        if (mode == 3) assembly { for { } 1 { } { } }
        if (mode == 4) {
            (bool success,) = callbackTarget.staticcall(callbackData);
            return success ? type(uint256).max : balances[account];
        }
        if (mode == 5) assembly { mstore(0, 123) mstore(32, 456) return(0, 64) }
        if (mode == 6) {
            bytes memory oversized = new bytes(65536);
            assembly { return(add(oversized, 32), 65536) }
        }
        return balances[account];
    }
}

contract MockS0ULFakeTokenizer {
    function domainSha256() external pure returns (bytes32) {
        return 0x7de4830b9e32e5884d2ee9776fdae6c8c1b42a9278342ae22d7105b039e9a726;
    }
    function encode(string calldata) external pure returns (uint16[] memory) { return new uint16[](0); }
    function decode(uint16[] calldata, bool) external pure returns (bytes memory) { return bytes("WAIT"); }
}

interface IFixtureAgent {
    function begin(string calldata prompt, uint16 maximum, uint16 mask) external returns (uint256);
    function finalize(uint256 id) external returns (bool);
}

interface IFixtureEngine {
    function setCompletion(uint256 id, uint16[] calldata output) external;
    function advance(uint256 id, uint256 rows) external returns (bool);
}

/// @dev Efficiently fill the driver's own task namespace, never another owner.
contract AgentBatchDriver {
    function run(address agent, address engine, uint16[] calldata output, uint16 mask, uint256 count) external {
        for (uint256 i; i < count; ++i) {
            uint256 id = IFixtureAgent(agent).begin("fixture", 32, mask);
            IFixtureEngine(engine).setCompletion(id, output);
            IFixtureEngine(engine).advance(id, 128);
            require(IFixtureAgent(agent).finalize(id), "fixture finalize");
        }
    }

    function runOne(address agent, address engine, uint16[] calldata output, uint16 mask)
        external returns (uint256 id, bool applied)
    {
        id = IFixtureAgent(agent).begin("fixture", 32, mask);
        IFixtureEngine(engine).setCompletion(id, output);
        IFixtureEngine(engine).advance(id, 128);
        applied = IFixtureAgent(agent).finalize(id);
    }
}
