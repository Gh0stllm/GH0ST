// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {INovaModel} from "./NovaPoolHook.sol";

/// @notice Adversarial LOCAL TEST FIXTURE. Mutable controls must never be used as the deployed model.
contract NovaHookMockModel is INovaModel {
    enum Mode {
        Valid,
        RevertInference,
        ShortReturn,
        OversizedReturn,
        InvalidState,
        InvalidScore,
        TextMismatch,
        TerminalMismatch,
        InvalidToken,
        InvalidPunctuation,
        NoncanonicalReturn,
        WordMismatch,
        RevertWord,
        OversizedWordReturn,
        InvalidWordLength,
        ExhaustInferenceGas
    }

    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("GH0ST_NOVA_LOCAL_ADVERSARIAL_FIXTURE_V1");
    Mode public mode;

    function setMode(Mode mode_) external { mode = mode_; }

    function word(uint16 token) external view returns (bytes32 value, uint8 length) {
        require(token < VOCABULARY, "invalid mock token");
        if (mode == Mode.RevertWord) revert("word lookup failed");
        if (mode == Mode.OversizedWordReturn) {
            assembly ("memory-safe") { mstore(0, 0) return(0, 96) }
        }
        if (mode == Mode.WordMismatch) return (bytes32("wrong"), 5);
        if (mode == Mode.InvalidWordLength) return (bytes32("nova"), 33);
        return (bytes32("nova"), 4);
    }

    function stepSampled(uint16, uint8, int16[768] memory state, int32[6] memory,
        bytes32, uint256, uint16) external view
        returns (uint16 token, uint8 punct, int16[768] memory next,
            int256[197] memory scores, string memory text, bool terminal)
    {
        Mode current = mode;
        if (current == Mode.RevertInference) revert("inference failed");
        if (current == Mode.ShortReturn) {
            assembly ("memory-safe") { mstore(0, 0) return(0, 31) }
        }
        if (current == Mode.OversizedReturn) {
            bytes memory oversized = new bytes(49_153);
            assembly ("memory-safe") { return(add(oversized, 32), mload(oversized)) }
        }
        if (current == Mode.ExhaustInferenceGas) {
            assembly ("memory-safe") { for { } 1 { } { pop(keccak256(0, 32)) } }
        }
        token = 0;
        punct = 2;
        text = "nova.";
        terminal = true;
        for (uint256 i; i < 768; ++i) next[i] = state[i] == 1024 ? int16(-1024) : state[i] + 1;
        for (uint256 i; i < 197; ++i) scores[i] = int256(i);
        if (current == Mode.InvalidState) next[0] = 1025;
        if (current == Mode.InvalidScore) scores[0] = int256(type(int32).max) + 1;
        if (current == Mode.TextMismatch) text = "fake.";
        if (current == Mode.TerminalMismatch) terminal = false;
        if (current == Mode.InvalidToken) token = VOCABULARY;
        if (current == Mode.InvalidPunctuation) punct = 5;
        if (current == Mode.NoncanonicalReturn) {
            bytes memory noncanonical = bytes.concat(abi.encode(token, punct, next, scores, text, terminal), hex"00");
            assembly ("memory-safe") { return(add(noncanonical, 32), mload(noncanonical)) }
        }
    }
}
