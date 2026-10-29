// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Local test fixtures only. Unrestricted setters deliberately model hostile
/// dependencies; these contracts are never model-inference evidence.
contract AnalysisModelMock {
    bytes32 public modelId;
    bytes32 public sourceCheckpoint = keccak256("local-mock-checkpoint");
    constructor(bytes32 id) { modelId = id; }
    function setModelId(bytes32 id) external { modelId = id; }
}

contract AnalysisEngineMock {
    struct Status {
        address owner; uint8 phase; uint16 position; uint16 layer; uint16 row;
        uint16 head; uint16 promptLength; uint16 maxNewTokens; uint16 generated;
        uint256 saturationCount; bool done; bool cancelled; bool logitsReady;
    }
    struct Config {
        uint16 vocabSize; uint16 dim; uint16 layers; uint16 heads;
        uint16 hiddenDim; uint16 maxSeqLen; uint32 epsQ28; uint32 attentionScaleQ14;
    }
    address public model;
    address public tokenizer;
    bytes32 public modelId;
    uint256 public nextRequestId = 1;
    uint256 public totalAdvanceCalls;
    uint256 public completionAfter = 6;
    uint8 public mode;
    uint8 public configurationMode;
    address public callback;
    bytes public callbackData;
    bool public callbackSucceeded;
    mapping(uint256 => Status) private _status;
    mapping(uint256 => uint16[]) private _prompts;
    mapping(uint256 => uint16[]) private _outputs;
    mapping(uint256 => uint256) public advances;
    uint16[] private _nextOutput;

    constructor(address model_, bytes32 id) {
        model = model_; modelId = id;
        _nextOutput.push(64); _nextOutput.push(65); _nextOutput.push(2);
    }
    function configuration() external view returns (Config memory value) {
        value = Config(512, 128, 4, 4, 640, 128, 2684, 2048);
        if (configurationMode == 1) value.dim = 64;
        else if (configurationMode == 2) value.maxSeqLen = 127;
        else if (configurationMode == 3) value.epsQ28 = 0;
        else if (configurationMode == 4) value.attentionScaleQ14 = 20000;
    }
    function setConfigurationMode(uint8 value) external { configurationMode = value; }
    // Modes: 0 normal, 1 no progress, 2 revert, 3 wrong owner on begin,
    // 4 begin cancelled, 5 begin already done, 6 change only saturation,
    // 7 attempt callback during advancement.
    function setMode(uint8 value) external { mode = value; }
    function setCompletionAfter(uint256 value) external { completionAfter = value; }
    function setOutput(uint16[] calldata value) external { _nextOutput = value; }
    function setIdentity(address model_, address tokenizer_, bytes32 id) external {
        model = model_; tokenizer = tokenizer_; modelId = id;
    }
    function setCallback(address target, bytes calldata data) external {
        callback = target; callbackData = data;
    }
    function begin(uint16[] calldata prompt, uint16 maxNewTokens) external returns (uint256 id) {
        id = nextRequestId++;
        _prompts[id] = prompt;
        Status storage s = _status[id];
        s.owner = mode == 3 ? address(0xdead) : msg.sender;
        s.phase = 1; s.promptLength = uint16(prompt.length); s.maxNewTokens = maxNewTokens;
        s.cancelled = mode == 4; s.done = mode == 5;
    }
    function advance(uint256 id, uint256 rows) external returns (bool done) {
        Status storage s = _status[id];
        require(s.owner != address(0) && !s.done && !s.cancelled, "terminal or unknown");
        require(rows > 0 && rows <= 128, "bad rows");
        ++totalAdvanceCalls;
        if (mode == 2) revert("configured engine failure");
        if (mode == 1) return false;
        if (mode == 6) { ++s.saturationCount; return false; }
        if (mode == 7 && callback != address(0)) {
            (callbackSucceeded,) = callback.call(callbackData);
        }
        ++advances[id];
        // The Select boundary is intentionally reached on every second step.
        // The executor must stop before consuming it after earlier progress.
        if (s.phase == 16) {
            if (s.generated < _nextOutput.length) {
                _outputs[id].push(_nextOutput[s.generated]); ++s.generated;
            }
            if (s.generated == _nextOutput.length && advances[id] >= completionAfter) {
                s.done = true; s.phase = 17; s.logitsReady = false; return true;
            }
            s.phase = 1; ++s.position; s.row = 0; s.logitsReady = false;
        } else if (s.phase == 1) {
            s.phase = 2; s.row = uint16(rows);
        } else {
            s.phase = 16; s.row = 0; s.logitsReady = true;
        }
    }
    function cancel(uint256 id) external {
        Status storage s = _status[id]; require(s.owner == msg.sender, "not engine owner");
        require(!s.done && !s.cancelled, "terminal"); s.cancelled = true; s.phase = 18;
    }
    function status(uint256 id) external view returns (Status memory) { return _status[id]; }
    function tokens(uint256 id) external view returns (uint16[] memory result) {
        uint16[] storage p = _prompts[id]; uint16[] storage o = _outputs[id];
        result = new uint16[](p.length + o.length);
        for (uint256 i; i < p.length; ++i) result[i] = p[i];
        for (uint256 i; i < o.length; ++i) result[p.length+i] = o[i];
    }
    function outputTokens(uint256 id) external view returns (uint16[] memory) { return _outputs[id]; }
    function forceStatus(uint256 id, address owner, uint8 phase, bool done, bool cancelled,
        uint16 generated, uint256 saturationCount) external
    {
        Status storage s = _status[id]; s.owner = owner; s.phase = phase;
        s.done = done; s.cancelled = cancelled; s.generated = generated;
        s.saturationCount = saturationCount;
    }
}

contract AnalysisFactsAdapterMock {
    bytes32 public schemaHash;
    uint8 public mode;
    uint256 public salt = 7;
    constructor(bytes32 schema) { schemaHash = schema; }
    function setMode(uint8 value) external { mode = value; }
    function setSchemaHash(bytes32 value) external { schemaHash = value; }
    function setSalt(uint256 value) external { salt = value; }
    function targetCodeHash(address target) external view returns (bytes32) { return target.codehash; }
    // Modes: 1 empty facts; 2 >8192 facts; 3 empty prompt; 4 bad BOS;
    // 5 bad SEP; 6 token512; 7 >96 prompt; 8 revert.
    function capture(address target) external view returns (bytes memory facts, uint16[] memory prompt) {
        if (mode == 8) revert("configured capture failure");
        facts = mode == 1 ? new bytes(0) : mode == 2 ? new bytes(8193) : abi.encode(target, salt);
        uint256 n = mode == 3 ? 0 : mode == 7 ? 97 : 16;
        prompt = new uint16[](n);
        if (n == 0) return (facts, prompt);
        prompt[0] = mode == 4 ? 4 : 1;
        for (uint256 i = 1; i + 1 < n; ++i) prompt[i] = 4 + uint16(i);
        prompt[n-1] = mode == 5 ? 4 : 3;
        if (mode == 6) prompt[1] = 512;
    }
}

contract AnalysisCodecMock {
    bytes32 public domainSha256;
    uint8 public mode;
    constructor(bytes32 domain) { domainSha256 = domain; }
    function setMode(uint8 value) external { mode = value; }
    function setDomainSha256(bytes32 value) external { domainSha256 = value; }
    // Match the real codec's full-output contract: terminal EOS is mandatory,
    // special/input/unassigned IDs are never accepted as report words.
    function decode(uint16[] calldata ids, bool) external view returns (bytes memory text) {
        if (mode == 1) revert("configured decode failure");
        if (mode == 2) return new bytes(0);
        if (mode == 3) return new bytes(4097);
        require(ids.length >= 2 && ids.length <= 32 && ids[ids.length-1] == 2, "missing terminal EOS");
        for (uint256 i; i + 1 < ids.length; ++i) {
            uint16 id = ids[i];
            require(id >= 64 && id <= 150, "invalid word token");
            bytes memory word = id == 64 ? bytes("alpha") : id == 65 ? bytes("beta") : bytes("gamma");
            text = bytes.concat(text, text.length == 0 ? bytes("") : bytes(" "), word);
        }
    }
}

contract AnalysisTargetMock {
    uint256 public immutable marker;
    constructor(uint256 value) { marker = value; }
}

interface IAnalysisExecutorFixture {
    function advance(uint256 id, uint256 rows, uint256 steps) external returns (bool);
    function finalize(uint256 id) external returns (bool);
    function withdraw() external;
}

contract AnalysisReentrantWorkerMock {
    address public executor;
    uint256 public received;
    uint256 public receiveCount;
    bool public reentrySucceeded;
    bool public rejectPayment;
    function runAdvance(address destination, uint256 id, uint256 rows, uint256 steps) external {
        executor = destination;
        IAnalysisExecutorFixture(destination).advance(id, rows, steps);
    }
    function runFinalize(address destination, uint256 id) external {
        executor = destination; IAnalysisExecutorFixture(destination).finalize(id);
    }
    function setRejectPayment(bool value) external { rejectPayment = value; }
    function claim(address destination) external { executor = destination; IAnalysisExecutorFixture(destination).withdraw(); }
    receive() external payable {
        require(!rejectPayment, "payment rejected");
        received += msg.value; ++receiveCount;
        try IAnalysisExecutorFixture(executor).withdraw() { reentrySucceeded = true; } catch {}
    }
}
