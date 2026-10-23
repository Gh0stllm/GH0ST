// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Only failure-injection fixtures. None implement useful inference.
abstract contract SentenceV4AdversarialModelBase {
    uint16 public constant VOCABULARY = 8192;
    bytes32 public constant modelHash = keccak256("adversarial-sentence-model-fixture");
    function generateSampled(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords, bytes32)
        external view returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        // Preserve each fixture's exact malformed/reverting behavior under the sampled API.
        (bool ok, bytes memory result) = address(this).staticcall(abi.encodeWithSignature(
            "generate(uint16,int16[32],int32[6],uint8)", previous, state, features, maximumWords));
        assembly ("memory-safe") {
            if iszero(ok) { revert(add(result, 32), mload(result)) }
            return(add(result, 32), mload(result))
        }
    }
}

/// @dev A successful call with insufficient ABI data must be treated as a skipped inference.
contract SentenceV4MalformedModel is SentenceV4AdversarialModelBase {
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        assembly ("memory-safe") {
            mstore(0, 0)
            return(0, 32)
        }
    }
}

/// @dev The caller must reject by RETURNDATASIZE before copying or decoding the payload.
contract SentenceV4OversizedModel is SentenceV4AdversarialModelBase {
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        bytes memory oversized = new bytes(10_240);
        assembly ("memory-safe") { return(add(oversized, 32), mload(oversized)) }
    }
}

/// @dev A model consuming its entire stipend must leave enough gas to skip and settle.
contract SentenceV4GasBurningModel is SentenceV4AdversarialModelBase {
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        // An exceptional halt consumes all gas forwarded to this call.
        assembly ("memory-safe") { invalid() }
    }
}

/// @dev Every mode returns structurally valid ABI, but violates one output invariant.
contract SentenceV4InvalidOutputModel is SentenceV4AdversarialModelBase {
    // 0: invalid previous token; 1: negative hidden; 2: hidden above clamp;
    // 3: empty tokens; 4: too many tokens; 5: invalid token;
    // 6: previous differs from final token; 7: oversized text; 8: empty text.
    uint8 public immutable mode;

    constructor(uint8 mode_) { require(mode_ <= 8); mode = mode_; }

    function generate(uint16, int16[32] memory, int32[6] memory, uint8 maximumWords)
        external view returns (uint16 previous, int16[32] memory state, uint16[] memory tokens,
            string memory text, bool ended)
    {
        previous = 1;
        tokens = new uint16[](1);
        tokens[0] = 1;
        text = "test.";
        ended = true;
        if (mode == 0) previous = 8192;
        else if (mode == 1) state[0] = -1;
        else if (mode == 2) state[0] = 8193;
        else if (mode == 3) tokens = new uint16[](0);
        else if (mode == 4) tokens = new uint16[](uint256(maximumWords) + 1);
        else if (mode == 5) tokens[0] = 8192;
        else if (mode == 6) previous = 2;
        else if (mode == 7) text = string(new bytes(uint256(maximumWords) * 33 + 2));
        else if (mode == 8) text = "";
    }
}

/// @dev This output has a noncanonical boolean and must fail an isolated ABI decoder.
contract SentenceV4InvalidBooleanModel is SentenceV4AdversarialModelBase {
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        int16[32] memory state;
        uint16[] memory tokens = new uint16[](1);
        tokens[0] = 1;
        bytes memory result = abi.encode(uint16(1), state, tokens, "test.", true);
        // The bool follows the previous token, 32 hidden-state words, and two offsets.
        assembly ("memory-safe") {
            mstore(add(add(result, 32), mul(35, 32)), 2)
            return(add(result, 32), mload(result))
        }
    }
}

/// @dev A small payload claims a huge dynamic array to exercise decoder allocation limits.
contract SentenceV4InvalidLengthModel is SentenceV4AdversarialModelBase {
    function generate(uint16, int16[32] memory, int32[6] memory, uint8)
        external pure returns (uint16, int16[32] memory, uint16[] memory, string memory, bool)
    {
        int16[32] memory state;
        uint16[] memory tokens = new uint16[](1);
        tokens[0] = 1;
        bytes memory result = abi.encode(uint16(1), state, tokens, "test.", true);
        assembly ("memory-safe") {
            let payload := add(result, 32)
            // The token-array offset follows previous and 32 state words.
            let tokenOffset := mload(add(payload, mul(33, 32)))
            mstore(add(payload, tokenOffset), shl(128, 1))
            return(payload, mload(result))
        }
    }
}
