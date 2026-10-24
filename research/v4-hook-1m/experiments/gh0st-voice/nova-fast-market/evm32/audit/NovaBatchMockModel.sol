// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {INovaModel} from "experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol";

/// @dev Local adversarial batch fixture. None of its controls belong in a production model.
contract NovaBatchMockModel is INovaModel {
    enum Fault { None, RevertBatch, ExhaustGas, HiddenHigh, HiddenLow, TokenRange, PunctRange,
        TerminalMismatch, BadText, ScoreHigh, ScoreLow, BoolEncoding, OversizedReturn,
        UndersizedReturn, TextOffset, TextPadding, CountZero, CountHigh, EarlyTerminal,
        UnusedToken, UnusedPunct, UnusedHidden, UnusedScore, UnusedText, AliasTexts }
    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("NOVA_BATCH_ADVERSARIAL_LOCAL_ONLY_V1");
    uint256 public startIndex;
    uint256 public terminalStep;
    uint256 public faultStep;
    Fault public fault;
    uint256 public gasWork;
    bool public denseState;
    function setPlan(uint256 start, uint256 terminalAt, uint256 faultAt, Fault kind) external {
        startIndex = start; terminalStep = terminalAt; faultStep = faultAt; fault = kind;
    }
    function setGasWork(uint256 amount) external { gasWork = amount; }
    function setDenseState(bool enabled) external { denseState = enabled; }
    function word(uint16 token) external pure returns (bytes32 value, uint8 length) {
        require(token < 2);
        return token == 0 ? (bytes32("nova"), 4) : (bytes32("speaks"), 6);
    }
    function stepSampled(uint16, uint8, int16[768] memory, int32[6] memory, bytes32, uint256, uint16)
        external pure returns (uint16,uint8,int16[768] memory,int256[197] memory,string memory,bool)
    { revert("batch-only fixture"); }
    function stepBatchChecked(uint16, uint8, int16[768] memory state, int32[6] memory,
        bytes32, uint256 wordIndex, uint16, uint8 maxWords) external view
        returns (uint16[3] memory tokens,uint8[3] memory puncts,int16[768][3] memory states,
            int256[197][3] memory scores,string[3] memory texts,uint8 count,bool terminal)
    {
        require(wordIndex == startIndex && wordIndex < 1024 && maxWords > 0 && maxWords <= 3);
        require(state[0] == int16(int256(wordIndex)), "stale neural state");
        if (fault == Fault.RevertBatch) revert("batch inference failed");
        if (fault == Fault.ExhaustGas) assembly ("memory-safe") { for {} 1 {} { pop(keccak256(0,32)) } }
        if (gasWork != 0) {
            uint256 remaining = gasleft();
            uint256 target = remaining > gasWork ? remaining - gasWork : 0;
            assembly ("memory-safe") { for {} gt(gas(),target) {} { pop(keccak256(0,32)) } }
        }
        count = terminalStep != 0 && terminalStep <= maxWords ? uint8(terminalStep) : maxWords;
        terminal = terminalStep != 0 && terminalStep <= maxWords;
        for (uint256 i; i < 3; ++i) {
            texts[i] = "";
            if (i < count) {
                states[i] = state;
                states[i][0] = int16(int256(wordIndex+i+1));
                if (denseState) for (uint256 j=1; j<768; ++j)
                    states[i][j] = (wordIndex+i+j)%2==0 ? int16(1024) : int16(-1024);
                scores[i][0] = int256(wordIndex+i);
                bool end = terminal && i+1==count;
                tokens[i] = end ? 1 : 0; puncts[i] = end ? 2 : 0;
                texts[i] = end ? "speaks." : "nova";
            }
        }
        uint256 index = faultStep == 0 ? 0 : faultStep - 1;
        require(index < 3);
        if (fault == Fault.HiddenHigh) states[index][0] = 1025;
        if (fault == Fault.HiddenLow) states[index][767] = -1025;
        if (fault == Fault.TokenRange) tokens[index] = 8192;
        if (fault == Fault.PunctRange) puncts[index] = 5;
        if (fault == Fault.TerminalMismatch) terminal = !terminal;
        if (fault == Fault.BadText) texts[index] = "forged.";
        if (fault == Fault.ScoreHigh) scores[index][196] = int256(type(int32).max)+1;
        if (fault == Fault.ScoreLow) scores[index][196] = int256(type(int32).min)-1;
        if (fault == Fault.CountZero) count = 0;
        if (fault == Fault.CountHigh) count = 4;
        if (fault == Fault.EarlyTerminal) { puncts[0]=2;tokens[0]=1;texts[0]="speaks."; }
        if (fault == Fault.UnusedToken) tokens[2]=1;
        if (fault == Fault.UnusedPunct) puncts[2]=1;
        if (fault == Fault.UnusedHidden) states[2][767]=1;
        if (fault == Fault.UnusedScore) scores[2][196]=1;
        if (fault == Fault.UnusedText) texts[2]="nova";
        if (fault >= Fault.BoolEncoding && fault <= Fault.TextPadding || fault == Fault.AliasTexts) {
            bytes memory encoded=abi.encode(tokens,puncts,states,scores,texts,count,terminal);
            uint256 kind=uint256(fault);
            assembly ("memory-safe") {
                let out:=add(encoded,32)
                let length:=mload(encoded)
                // Head: 3 tokens, 3 puncts, 3*768 states, 3*197 scores, texts offset, count, bool.
                switch kind
                case 11 { mstore(add(out,92896),2) }
                case 12 { return(out,93344) }
                case 13 { return(out,93088) }
                case 14 { mstore(add(out,92832),0) }
                case 15 { mstore8(add(out,sub(length,1)),1) }
                case 24 {
                    let strings:=add(out,mload(add(out,92832)))
                    mstore(add(strings,32),mload(strings))
                }
                return(out,length)
            }
        }
    }
}
