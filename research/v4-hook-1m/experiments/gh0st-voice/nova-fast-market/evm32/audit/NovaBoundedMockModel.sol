// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {INovaModel} from "experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol";

/// @dev Adversarial local-only fixture. Mutable controls are not a production model feature.
contract NovaBoundedMockModel is INovaModel {
    enum Fault { None, RevertStep, ExhaustGas, HiddenHigh, HiddenLow, TokenRange, PunctRange,
        TerminalMismatch, BadText, ScoreHigh, ScoreLow, BoolEncoding, OversizedReturn,
        UndersizedReturn, TextOffset, TextPadding }
    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("NOVA_BOUNDED_ADVERSARIAL_LOCAL_ONLY_V1");
    uint256 public startIndex;
    uint256 public terminalStep;
    uint256 public faultStep;
    uint256 public gasWork;
    bool public denseState;
    Fault public fault;
    function setPlan(uint256 start, uint256 terminalAt, uint256 faultAt, Fault kind) external {
        startIndex = start; terminalStep = terminalAt; faultStep = faultAt; fault = kind;
    }
    function setGasWork(uint256 amount) external { gasWork = amount; }
    function setDenseState(bool enabled) external { denseState = enabled; }
    function word(uint16 token) external pure returns (bytes32 value, uint8 length) {
        require(token < 2);
        return token == 0 ? (bytes32("nova"), 4) : (bytes32("speaks"), 6);
    }
    function stepSampled(uint16 previous, uint8 previousPunct, int16[768] memory state,
        int32[6] memory, bytes32, uint256 wordIndex, uint16) external view
        returns (uint16 token, uint8 punct, int16[768] memory next,
            int256[197] memory scores, string memory text, bool terminal)
    {
        require(wordIndex >= startIndex && wordIndex < 1024);
        uint256 ordinal = wordIndex - startIndex + 1;
        require(state[0] == int16(int256(wordIndex)), "stale neural state");
        if (ordinal > 1) require(previous == 0 && previousPunct == 0, "stale prior token");
        Fault selected = ordinal == faultStep ? fault : Fault.None;
        if (selected == Fault.RevertStep) revert("inference failed");
        if (selected == Fault.ExhaustGas) {
            assembly ("memory-safe") { for {} 1 {} { pop(keccak256(0, 32)) } }
        }
        uint256 remaining = gasleft();
        if (gasWork != 0) {
            uint256 target = remaining > gasWork ? remaining - gasWork : 0;
            assembly ("memory-safe") { for {} gt(gas(), target) {} { pop(keccak256(0, 32)) } }
        }
        next = state; next[0] = int16(int256(wordIndex + 1));
        if (denseState) for (uint256 i = 1; i < 768; ++i)
            next[i] = (wordIndex + i) % 2 == 0 ? int16(1024) : int16(-1024);
        scores[0] = int256(wordIndex);
        terminal = terminalStep != 0 && ordinal == terminalStep;
        token = terminal ? 1 : 0; punct = terminal ? 2 : 0;
        text = terminal ? "speaks." : "nova";
        if (selected == Fault.HiddenHigh) next[0] = 1025;
        if (selected == Fault.HiddenLow) next[767] = -1025;
        if (selected == Fault.TokenRange) token = 8192;
        if (selected == Fault.PunctRange) punct = 5;
        if (selected == Fault.TerminalMismatch) terminal = !terminal;
        if (selected == Fault.BadText) text = "forged.";
        if (selected == Fault.ScoreHigh) scores[196] = int256(type(int32).max) + 1;
        if (selected == Fault.ScoreLow) scores[196] = int256(type(int32).min) - 1;
        if (selected >= Fault.BoolEncoding) {
            bytes memory encoded = abi.encode(token, punct, next, scores, text, terminal);
            uint256 kind = uint256(selected);
            assembly ("memory-safe") {
                let output := add(encoded, 32)
                let length := mload(encoded)
                // ABI head: token, punct, hidden[768], scores[197], text offset, terminal.
                switch kind
                case 11 { mstore(add(output, 30976), 2) }
                case 12 { return(output, 31136) }
                case 13 { return(output, 31040) }
                case 14 { mstore(add(output, 30944), 0) }
                case 15 { mstore8(add(output, sub(length, 1)), 1) }
                return(output, length)
            }
        }
    }
}
