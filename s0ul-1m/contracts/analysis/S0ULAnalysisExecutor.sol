// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IS0ULAnalysisEngine {
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
    function configuration() external view returns (Config memory);
    function begin(uint16[] calldata prompt, uint16 maxNewTokens) external returns (uint256);
    function advance(uint256 requestId, uint256 maxRows) external returns (bool);
    function status(uint256 requestId) external view returns (Status memory);
    function tokens(uint256 requestId) external view returns (uint16[] memory);
    function outputTokens(uint256 requestId) external view returns (uint16[] memory);
    function cancel(uint256 requestId) external;
}
interface IS0ULAnalysisModel {
    function modelId() external view returns (bytes32);
}
interface IS0ULAnalysisFacts {
    function schemaHash() external view returns (bytes32);
    function capture(address target) external view returns (bytes memory facts, uint16[] memory prompt);
}
interface IS0ULAnalysisCodec {
    function domainSha256() external view returns (bytes32);
    function decode(uint16[] calldata ids, bool skipSpecial) external view returns (bytes memory);
}

/// @notice Prepaid, bounded continuation of real transformer jobs with on-chain fact inputs.
/// @dev Reimbursements are an explicitly capped policy, not exact transaction-receipt fees:
/// gasleft does not measure all parent-chain posting fees. No caller supplies prompts or reports.
contract S0ULAnalysisExecutor {
    uint256 public constant MAX_FACT_BYTES = 8192;
    uint256 public constant MAX_PROMPT_TOKENS = 96;
    uint256 public constant MAX_OUTPUT_TOKENS = 32;
    uint256 public constant MAX_REPORT_BYTES = 4096;
    uint256 public constant FIRST_WORD_ID = 64;
    uint256 public constant LAST_WORD_ID = 150;
    uint256 public constant REWARD_OVERHEAD_GAS = 75_000;
    uint256 public constant PAID_ROWS = 128;

    enum State { None, Running, Completed, Rejected, Cancelled }
    enum Failure { None, EngineCancelled, InvalidOutput, PromptChanged, DecodeFailed, InvalidReport }
    struct Job {
        address owner;
        address target;
        uint256 requestId;
        State state;
        Failure failure;
        uint16 promptLength;
        uint16 maxNewTokens;
        uint64 deadline;
        uint64 capturedAt;
        uint64 evmBlockCounter;
        bytes32 targetCodeHash;
        bytes32 modelId;
        bytes32 factsHash;
        bytes32 promptHash;
        bytes32 outputHash;
        uint256 feeCeilingWeiPerGas;
        uint256 maxRewardPerBatchWei;
        uint256 totalFunded;
        uint256 remaining;
        uint256 totalPaid;
    }

    IS0ULAnalysisEngine public immutable engine;
    IS0ULAnalysisFacts public immutable adapter;
    IS0ULAnalysisCodec public immutable codec;
    address public immutable model;
    bytes32 public immutable engineCodeHash;
    bytes32 public immutable adapterCodeHash;
    bytes32 public immutable codecCodeHash;
    bytes32 public immutable modelCodeHash;
    bytes32 public immutable modelId;
    bytes32 public immutable domainSha256;
    bytes32 public immutable schemaHash;
    bytes32 public immutable configurationHash;
    uint256 public immutable chainId;
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => bytes) private _facts;
    mapping(uint256 => bytes) private _reports;
    mapping(uint256 => uint16[]) private _outputs;
    mapping(uint256 => uint256) public engineRequestToJob;
    mapping(address => uint256) public credits;
    bool private _entered;

    error InvalidConfiguration();
    error DependencyChanged();
    error InvalidJob();
    error UnknownJob();
    error NotOwner();
    error NotRunning();
    error NotReady();
    error InvalidBudget();
    error Expired();
    error FeeCeilingExceeded();
    error InsufficientBudget();
    error InvalidEngineState();
    error NoProgress();
    error NoCredit();
    error TransferFailed();
    error Reentrant();

    event JobOpened(uint256 indexed jobId, address indexed owner, address indexed target,
        uint256 requestId, bytes32 modelId, bytes32 targetCodeHash, bytes32 factsHash,
        bytes32 promptHash, uint16 promptLength, uint16 maxNewTokens, uint64 deadline,
        uint256 fundedWei, uint256 feeCeilingWeiPerGas, uint256 maxRewardPerBatchWei);
    event Advanced(uint256 indexed jobId, address indexed worker, uint256 steps,
        uint8 phase, uint16 position, uint16 generated, bool done);
    event RewardCredited(uint256 indexed jobId, address indexed worker,
        uint256 amountWei, uint256 measuredGas, uint256 remainingWei);
    event ReportCompleted(uint256 indexed jobId, uint256 indexed requestId, bytes32 indexed modelId,
        bytes32 factsHash, bytes32 promptHash, bytes32 outputHash, bytes report);
    event JobRejected(uint256 indexed jobId, uint8 reason, bytes32 outputHash);
    event JobCancelled(uint256 indexed jobId, address indexed owner, bool engineCancelled);
    event ToppedUp(uint256 indexed jobId, uint256 amountWei, uint256 remainingWei);
    event Refunded(uint256 indexed jobId, address indexed owner, uint256 amountWei);
    event Withdrawn(address indexed owner, uint256 amountWei);

    modifier nonReentrant() {
        if (_entered) revert Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address engine_, address adapter_, address codec_, bytes32 expectedEngineCodeHash,
        bytes32 expectedAdapterCodeHash, bytes32 expectedCodecCodeHash, bytes32 expectedModelId,
        bytes32 expectedDomainSha256, bytes32 expectedSchemaHash)
    {
        if (engine_.code.length == 0 || adapter_.code.length == 0 || codec_.code.length == 0
            || expectedEngineCodeHash == 0 || expectedAdapterCodeHash == 0 || expectedCodecCodeHash == 0
            || expectedModelId == 0 || expectedDomainSha256 == 0 || expectedSchemaHash == 0
            || engine_.codehash != expectedEngineCodeHash || adapter_.codehash != expectedAdapterCodeHash
            || codec_.codehash != expectedCodecCodeHash) revert InvalidConfiguration();
        IS0ULAnalysisEngine e = IS0ULAnalysisEngine(engine_);
        IS0ULAnalysisEngine.Config memory cfg = e.configuration();
        address m = e.model();
        if (cfg.vocabSize != 512 || cfg.dim != 128 || cfg.layers != 4 || cfg.heads != 4
            || cfg.hiddenDim != 640 || cfg.maxSeqLen != 128 || cfg.epsQ28 == 0
            || cfg.epsQ28 > (1 << 28) || cfg.attentionScaleQ14 == 0
            || cfg.attentionScaleQ14 > (1 << 14)
            || m.code.length == 0 || e.tokenizer() != address(0) || e.modelId() != expectedModelId
            || IS0ULAnalysisModel(m).modelId() != expectedModelId
            || IS0ULAnalysisFacts(adapter_).schemaHash() != expectedSchemaHash
            || IS0ULAnalysisCodec(codec_).domainSha256() != expectedDomainSha256)
            revert InvalidConfiguration();
        engine = e; adapter = IS0ULAnalysisFacts(adapter_); codec = IS0ULAnalysisCodec(codec_);
        model = m; engineCodeHash = expectedEngineCodeHash; adapterCodeHash = expectedAdapterCodeHash;
        codecCodeHash = expectedCodecCodeHash; modelCodeHash = m.codehash; modelId = expectedModelId;
        domainSha256 = expectedDomainSha256; schemaHash = expectedSchemaHash; chainId = block.chainid;
        configurationHash = keccak256(abi.encode(cfg));
    }

    function open(address target, uint16 maxNewTokens, uint256 feeCeilingWeiPerGas,
        uint256 maxRewardPerBatchWei, uint64 deadline, bytes32 expectedTargetCodeHash)
        external payable nonReentrant returns (uint256 id)
    {
        _checkDependencies();
        if (maxNewTokens < 2 || maxNewTokens > MAX_OUTPUT_TOKENS || feeCeilingWeiPerGas == 0
            || maxRewardPerBatchWei == 0 || msg.value < maxRewardPerBatchWei
            || deadline <= block.timestamp || target.codehash != expectedTargetCodeHash
            || block.timestamp > type(uint64).max || block.number > type(uint64).max) revert InvalidJob();
        (bytes memory facts, uint16[] memory prompt) = adapter.capture(target);
        if (facts.length == 0 || facts.length > MAX_FACT_BYTES || prompt.length < 3
            || prompt.length > MAX_PROMPT_TOKENS || prompt.length + maxNewTokens > 128
            || prompt[0] != 1 || prompt[prompt.length - 1] != 3) revert InvalidJob();
        for (uint256 i; i < prompt.length; ++i) {
            if (prompt[i] >= 512 || (i != 0 && i + 1 != prompt.length && prompt[i] < 4))
                revert InvalidJob();
        }
        uint256 requestId = engine.begin(prompt, maxNewTokens);
        IS0ULAnalysisEngine.Status memory s = engine.status(requestId);
        if (requestId == 0 || engineRequestToJob[requestId] != 0 || s.owner != address(this)
            || s.phase != 1 || s.done || s.cancelled || s.generated != 0
            || s.promptLength != prompt.length || s.maxNewTokens != maxNewTokens)
            revert InvalidEngineState();
        uint16[] memory initial = engine.tokens(requestId);
        bytes32 promptHash = keccak256(abi.encode(prompt));
        if (keccak256(abi.encode(initial)) != promptHash) revert InvalidEngineState();
        id = nextJobId++;
        Job storage j = _jobs[id];
        j.owner = msg.sender; j.target = target; j.requestId = requestId; j.state = State.Running;
        j.promptLength = uint16(prompt.length); j.maxNewTokens = maxNewTokens; j.deadline = deadline;
        j.capturedAt = uint64(block.timestamp); j.evmBlockCounter = uint64(block.number);
        j.targetCodeHash = expectedTargetCodeHash; j.modelId = modelId;
        j.factsHash = keccak256(facts); j.promptHash = promptHash;
        j.feeCeilingWeiPerGas = feeCeilingWeiPerGas; j.maxRewardPerBatchWei = maxRewardPerBatchWei;
        j.totalFunded = msg.value; j.remaining = msg.value;
        _facts[id] = facts; engineRequestToJob[requestId] = id;
        emit JobOpened(id, msg.sender, target, requestId, modelId, expectedTargetCodeHash, j.factsHash,
            promptHash, j.promptLength, maxNewTokens, deadline, msg.value,
            feeCeilingWeiPerGas, maxRewardPerBatchWei);
    }

    /// @notice Advances only the bound engine; a third party funds each transaction and earns bounded credit.
    /// @dev Only the standard128-row quantum is reimbursed, preventing paid row fragmentation.
    /// Direct permissionless engine advancement is an unpaid donation. Splitting steps1..4
    /// still incurs overhead; a total quote must reserve overhead per logical step.
    function advance(uint256 id, uint256 rows, uint256 steps)
        external nonReentrant returns (bool done)
    {
        uint256 initialGas = gasleft();
        Job storage j = _running(id);
        if (rows != PAID_ROWS || steps == 0 || steps > 4) revert InvalidBudget();
        _authorizeWork(j);
        if (j.remaining < j.maxRewardPerBatchWei) revert InsufficientBudget();
        _checkDependencies();
        uint256 executed;
        while (executed < steps) {
            IS0ULAnalysisEngine.Status memory beforeState = engine.status(j.requestId);
            _validateStatus(j, beforeState);
            if (beforeState.cancelled || beforeState.done) {
                if (executed == 0) revert NoProgress();
                done = beforeState.done; break;
            }
            if (executed != 0 && beforeState.phase == 16) break;
            bool returnedDone = engine.advance(j.requestId, rows);
            IS0ULAnalysisEngine.Status memory afterState = engine.status(j.requestId);
            _validateStatus(j, afterState);
            if (afterState.cancelled || returnedDone != afterState.done
                || _progressHash(beforeState) == _progressHash(afterState)
                || afterState.generated < beforeState.generated
                || afterState.generated > beforeState.generated + 1) revert NoProgress();
            if (afterState.generated != beforeState.generated) {
                uint16[] memory generated = engine.outputTokens(j.requestId);
                if (generated.length != afterState.generated) revert InvalidEngineState();
            }
            ++executed;
            done = afterState.done;
            if (done) break;
        }
        if (executed == 0) revert NoProgress();
        IS0ULAnalysisEngine.Status memory finalState = engine.status(j.requestId);
        emit Advanced(id, msg.sender, executed, finalState.phase, finalState.position,
            finalState.generated, done);
        _reward(id, j, initialGas);
    }

    /// @notice Records only actual completed model tokens, after strict codec decoding.
    /// Finalization may earn a smaller reward when only a partial reserve remains.
    function finalize(uint256 id) external nonReentrant returns (bool completed) {
        uint256 initialGas = gasleft();
        Job storage j = _running(id);
        _authorizeWork(j);
        _checkDependencies();
        IS0ULAnalysisEngine.Status memory s = engine.status(j.requestId);
        _validateStatus(j, s);
        if (!s.done && !s.cancelled) revert NotReady();
        j.state = State.Rejected;
        if (s.cancelled) return _reject(id, j, Failure.EngineCancelled, initialGas);
        uint16[] memory ids = engine.outputTokens(j.requestId);
        j.outputHash = keccak256(abi.encode(ids));
        if (ids.length < 2 || ids.length > MAX_OUTPUT_TOKENS || ids.length != s.generated
            || ids[ids.length - 1] != 2) return _reject(id, j, Failure.InvalidOutput, initialGas);
        _outputs[id] = ids;
        for (uint256 i; i + 1 < ids.length; ++i) {
            if (ids[i] < FIRST_WORD_ID || ids[i] > LAST_WORD_ID)
                return _reject(id, j, Failure.InvalidOutput, initialGas);
        }
        if (!_promptMatches(j, ids)) return _reject(id, j, Failure.PromptChanged, initialGas);
        bytes memory report;
        // The strict word codec validates the complete generated sequence, including EOS.
        try codec.decode(ids, false) returns (bytes memory decoded) { report = decoded; }
        catch { return _reject(id, j, Failure.DecodeFailed, initialGas); }
        if (report.length == 0 || report.length > MAX_REPORT_BYTES)
            return _reject(id, j, Failure.InvalidReport, initialGas);
        _reports[id] = report;
        j.state = State.Completed;
        emit ReportCompleted(id, j.requestId, j.modelId, j.factsHash, j.promptHash, j.outputHash, report);
        _reward(id, j, initialGas);
        return true;
    }

    function topUp(uint256 id) external payable nonReentrant {
        Job storage j = _running(id);
        if (msg.sender != j.owner) revert NotOwner();
        if (msg.value == 0) revert InvalidBudget();
        j.totalFunded += msg.value; j.remaining += msg.value;
        emit ToppedUp(id, msg.value, j.remaining);
    }

    /// @notice Owner cancellation/refund does not depend on a healthy model or adapter.
    /// Engine cancellation is best-effort and the exact result is emitted.
    function cancel(uint256 id) external nonReentrant {
        Job storage j = _known(id);
        if (msg.sender != j.owner) revert NotOwner();
        if (j.state != State.Running && j.state != State.Rejected) revert NotRunning();
        j.state = State.Cancelled;
        bool engineCancelled;
        if (address(engine).codehash == engineCodeHash && block.chainid == chainId) {
            try engine.status(j.requestId) returns (IS0ULAnalysisEngine.Status memory s) {
                if (s.owner == address(this)) {
                    if (s.cancelled) engineCancelled = true;
                    else if (!s.done) {
                        try engine.cancel(j.requestId) { engineCancelled = true; } catch {}
                    }
                }
            } catch {}
        }
        _refund(id, j);
        emit JobCancelled(id, j.owner, engineCancelled);
    }

    function refundCompleted(uint256 id) external nonReentrant {
        Job storage j = _known(id);
        if (msg.sender != j.owner) revert NotOwner();
        if (j.state == State.Running) revert NotReady();
        _refund(id, j);
    }

    /// @notice Pull all credited funds to their original credit owner's own address.
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        credits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function getJob(uint256 id) external view returns (Job memory) { return _known(id); }
    function factsOf(uint256 id) external view returns (bytes memory) { _known(id); return _facts[id]; }
    function reportOf(uint256 id) external view returns (bytes memory) { _known(id); return _reports[id]; }
    function outputTokensOf(uint256 id) external view returns (uint16[] memory) { _known(id); return _outputs[id]; }

    function _authorizeWork(Job storage j) private view {
        if (block.timestamp > j.deadline) revert Expired();
        if (tx.gasprice > j.feeCeilingWeiPerGas) revert FeeCeilingExceeded();
    }
    function _checkDependencies() private view {
        if (block.chainid != chainId || address(engine).codehash != engineCodeHash
            || address(adapter).codehash != adapterCodeHash || address(codec).codehash != codecCodeHash
            || model.codehash != modelCodeHash || engine.model() != model
            || engine.tokenizer() != address(0) || engine.modelId() != modelId
            || keccak256(abi.encode(engine.configuration())) != configurationHash
            || IS0ULAnalysisModel(model).modelId() != modelId
            || adapter.schemaHash() != schemaHash || codec.domainSha256() != domainSha256)
            revert DependencyChanged();
    }
    function _validateStatus(Job storage j, IS0ULAnalysisEngine.Status memory s) private view {
        if (s.owner != address(this) || s.promptLength != j.promptLength
            || s.maxNewTokens != j.maxNewTokens || s.generated > j.maxNewTokens
            || s.phase == 0 || s.phase > 18 || s.position >= 128
            || s.layer >= 4 || s.row > 640 || s.head > 4
            || s.done != (s.phase == 17) || s.cancelled != (s.phase == 18))
            revert InvalidEngineState();
    }
    function _progressHash(IS0ULAnalysisEngine.Status memory s) private pure returns (bytes32) {
        // Saturation-only changes are not paid progress.
        return keccak256(abi.encode(s.phase, s.position, s.layer, s.row, s.head,
            s.generated, s.done, s.cancelled, s.logitsReady));
    }
    function _promptMatches(Job storage j, uint16[] memory output) private view returns (bool) {
        uint16[] memory all = engine.tokens(j.requestId);
        if (all.length != uint256(j.promptLength) + output.length) return false;
        uint16[] memory prompt = new uint16[](j.promptLength);
        for (uint256 i; i < prompt.length; ++i) prompt[i] = all[i];
        if (keccak256(abi.encode(prompt)) != j.promptHash) return false;
        for (uint256 i; i < output.length; ++i) if (all[prompt.length + i] != output[i]) return false;
        return true;
    }
    function _reward(uint256 id, Job storage j, uint256 initialGas) private {
        uint256 measuredGas = initialGas - gasleft() + REWARD_OVERHEAD_GAS;
        uint256 amount = measuredGas * tx.gasprice;
        if (amount > j.maxRewardPerBatchWei) amount = j.maxRewardPerBatchWei;
        if (amount > j.remaining) amount = j.remaining;
        j.remaining -= amount; j.totalPaid += amount; credits[msg.sender] += amount;
        emit RewardCredited(id, msg.sender, amount, measuredGas, j.remaining);
    }
    function _reject(uint256 id, Job storage j, Failure reason, uint256 initialGas)
        private returns (bool)
    {
        j.failure = reason;
        emit JobRejected(id, uint8(reason), j.outputHash);
        _reward(id, j, initialGas);
        return false;
    }
    function _refund(uint256 id, Job storage j) private {
        uint256 amount = j.remaining;
        j.remaining = 0;
        credits[j.owner] += amount;
        emit Refunded(id, j.owner, amount);
    }
    function _known(uint256 id) private view returns (Job storage j) {
        j = _jobs[id];
        if (id == 0 || j.owner == address(0)) revert UnknownJob();
    }
    function _running(uint256 id) private view returns (Job storage j) {
        j = _known(id);
        if (j.state != State.Running) revert NotRunning();
    }
}
