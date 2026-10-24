// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {INovaModel} from "experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol";

/// @dev Local adversarial fixture only. Uses the supplied word index because inference is static.
contract NovaSentenceMockModel is INovaModel {
    enum Mode { TwoWords, RevertSecond, InvalidSecond, NeverTerminal, TerminalAt32, ExhaustSecond, BadTextSecond }
    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("NOVA_SENTENCE_ADVERSARIAL_LOCAL_ONLY_V1");
    Mode public mode;
    function setMode(Mode value) external { mode = value; }
    function word(uint16 token) external pure returns (bytes32 value, uint8 length) {
        require(token < 2);
        return token == 0 ? (bytes32("nova"), 4) : (bytes32("speaks"), 6);
    }
    function stepSampled(uint16 previous, uint8 previousPunct, int16[768] memory state,
        int32[6] memory, bytes32, uint256 wordIndex, uint16) external view
        returns (uint16 token, uint8 punct, int16[768] memory next,
            int256[197] memory scores, string memory text, bool terminal)
    {
        bool second = wordIndex % 2 == 1;
        if (mode == Mode.RevertSecond && second) revert("second inference failed");
        if (mode == Mode.ExhaustSecond && second) {
            assembly ("memory-safe") { for {} 1 {} { pop(keccak256(0, 32)) } }
        }
        // Check that the caller actually advances canonical recurrent state for each word.
        require(wordIndex < 1024 && state[0] == int16(int256(wordIndex)), "stale neural state");
        if (second) require(previous == 0 && previousPunct == 0, "stale prior token");
        next = state;
        next[0] = int16(int256(wordIndex + 1));
        scores[0] = int256(wordIndex);
        terminal = mode == Mode.NeverTerminal ? false
            : mode == Mode.TerminalAt32 ? wordIndex % 32 == 31 : second;
        token = terminal ? 1 : 0;
        punct = terminal ? 2 : 0;
        text = terminal ? "speaks." : "nova";
        if (mode == Mode.InvalidSecond && second) next[0] = 1025;
        if (mode == Mode.BadTextSecond && second) text = "forged.";
    }
}
