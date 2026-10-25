// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IGPT2Shard} from "../interfaces/IGPT2Shard.sol";

/// @notice TEST ONLY. Controlled fake math for adversarial transport/state-machine tests.
/// @dev Must not be used in the full-model benchmark, accuracy claims, or production routes.
contract MockGPT2Shard is IGPT2Shard {
    address public immutable testAdmin;
    address public immutable override controller;
    bytes32 public immutable override modelId;
    uint8 public immutable override firstLayer;
    uint8 public immutable override endLayer;
    bool public immutable override doesEmbedding;
    bool public immutable override doesOutput;
    uint8 public override phase;
    uint32 public override position;
    uint32 public override pendingToken;
    uint32 public override bestToken;
    int256 public override bestLogit;
    bytes32 public override stateCommitment;
    bool private _begun;
    bytes private _hidden;

    error TestOnlyUnauthorized();
    error InvalidTestState();

    constructor(address controller_, bytes32 modelId_, uint8 firstLayer_, uint8 endLayer_, bool embedding_, bool output_) {
        testAdmin = msg.sender;
        controller = controller_;
        modelId = modelId_;
        firstLayer = firstLayer_;
        endLayer = endLayer_;
        doesEmbedding = embedding_;
        doesOutput = output_;
        stateCommitment = keccak256(abi.encode("TEST_ONLY_FAKE_MATH", address(this), modelId_));
    }

    function begin(uint32 tokenPosition, uint32 inputToken, bytes32 inputCommitment, bytes calldata hidden) external override {
        if (msg.sender != controller) revert TestOnlyUnauthorized();
        if ((_begun && (phase != 12 && phase != 13)) || tokenPosition != (_begun ? position + 1 : 0)
            || inputToken >= 50257 || tokenPosition >= 1024
            || hidden.length != (doesEmbedding ? 0 : 3072)) revert InvalidTestState();
        _begun = true;
        position = tokenPosition;
        pendingToken = inputToken;
        phase = doesEmbedding ? 1 : 2;
        _hidden = hidden;
        stateCommitment = keccak256(abi.encode(stateCommitment, tokenPosition, inputToken, inputCommitment, hidden));
    }

    /// @dev Explicitly fabricates test output. This is not neural network computation.
    function finishForTest(bytes calldata hidden, uint32 outputToken, int256 logit) external {
        if (msg.sender != testAdmin) revert TestOnlyUnauthorized();
        if (!_begun || phase == 12 || phase == 13 || (!doesOutput && hidden.length != 3072)
            || outputToken >= 50257) revert InvalidTestState();
        _hidden = hidden;
        bestToken = outputToken;
        bestLogit = logit;
        phase = doesOutput ? 12 : 13;
        stateCommitment = keccak256(abi.encode(stateCommitment, "TEST_ONLY_FABRICATED_RESULT", hidden, outputToken, logit));
    }

    function exportHidden() external view override returns (bytes memory) {
        if (phase != 13) revert InvalidTestState();
        return _hidden;
    }
}
