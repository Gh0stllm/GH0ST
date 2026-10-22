// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice On-chain structural inspection and bounded read-only calls for any address.
/// @dev Getter compatibility and bytecode patterns are evidence, not a security verdict.
/// No source code, oracle, supplied metric, privileged registry or model is used here.
contract S0ULUniversalReader {
    uint256 public constant MAX_CODE_SCAN = 24_576;
    uint256 public constant MAX_SELECTOR_SCAN = 4_096;
    uint256 public constant MAX_SELECTORS = 32;
    uint256 public constant PROBE_GAS = 50_000;
    uint256 public constant INTERFACE_GAS = 30_000;
    uint256 public constant READ_GAS = 200_000;
    uint256 public constant MAX_CALLDATA = 4_096;
    uint256 public constant MAX_RETURN = 2_048;

    // Counts in order: CALL, STATICCALL, DELEGATECALL, CALLCODE, SELFDESTRUCT,
    // SSTORE, ORIGIN, CREATE, CREATE2, LOG0..LOG4. PUSH payloads are skipped.
    // Metadata and unreachable bytes may still be counted; this is not control-flow analysis.
    struct Profile {
        address target;
        uint256 nativeBalance;
        bytes32 codeHash;
        uint256 codeBytes;
        uint256 scannedBytes;
        bool complete;
        uint32 opcodeCount;
        uint32 push4Count;
        uint8 selectorCount;
        bytes4[32] selectorCandidates;
        uint32[10] opcodeSignals;
        uint8 interfaceMask; // 1 ERC165, 2 ERC721, 4 ERC1155, 8 ERC2981
        bool ownerAvailable;
        address owner;
        bool pausedAvailable;
        bool paused;
        bool implementationAvailable;
        address implementation;
        bool assetAvailable;
        address asset;
        uint64 observedAt;
        uint64 blockCounter;
    }

    error InsufficientGas();
    error CalldataTooLarge();
    error InvalidClock();

    /// @notice One read returns current facts and commentary computed by this contract.
    function analyze(address target) external view returns (Profile memory facts, string memory text) {
        facts = _profile(target);
        text = _describe(facts);
    }

    function profile(address target) external view returns (Profile memory) { return _profile(target); }

    /// @notice Execute caller-selected calldata under STATICCALL with fixed gas/output bounds.
    /// @return status 0 success, 1 target reverted/failed, 2 successful but truncated return.
    /// @return returnSize Full returndata size; data is at most MAX_RETURN bytes, even on failure.
    /// @dev A successful call, empty return, selector or decoded value does not certify semantics.
    /// Calls originate from this reader, which can differ from a direct wallet call.
    function read(address target, bytes calldata callData)
        external view returns (uint8 status, uint256 returnSize, bytes memory data)
    {
        if (callData.length > MAX_CALLDATA) revert CalldataTooLarge();
        if (gasleft() < READ_GAS + 40_000) revert InsufficientGas();
        bytes memory input = callData;
        bool ok;
        uint256 copied;
        assembly ("memory-safe") {
            ok := staticcall(200000, target, add(input, 32), mload(input), 0, 0)
            returnSize := returndatasize()
            copied := returnSize
            if gt(copied, 2048) { copied := 2048 }
            data := mload(0x40)
            mstore(data, copied)
            returndatacopy(add(data, 32), 0, copied)
            mstore(0x40, and(add(add(data, 63), copied), not(31)))
        }
        status = !ok ? 1 : returnSize > MAX_RETURN ? 2 : 0;
    }

    function _profile(address target) private view returns (Profile memory p) {
        if (block.timestamp > type(uint64).max || block.number > type(uint64).max) revert InvalidClock();
        p.target = target;
        p.nativeBalance = target.balance;
        p.codeHash = target.codehash;
        p.codeBytes = target.code.length;
        p.scannedBytes = p.codeBytes > MAX_CODE_SCAN ? MAX_CODE_SCAN : p.codeBytes;
        p.complete = p.scannedBytes == p.codeBytes;
        p.observedAt = uint64(block.timestamp);
        p.blockCounter = uint64(block.number);
        if (p.codeBytes == 0) return p;

        // Copy only the bounded prefix, even on chains with larger runtime-code limits.
        bytes memory code = new bytes(p.scannedBytes);
        assembly ("memory-safe") { extcodecopy(target, add(code, 32), 0, mload(code)) }
        uint256 i;
        while (i < code.length) {
            uint8 op = uint8(code[i]);
            ++p.opcodeCount;
            if (op == 0x63) {
                ++p.push4Count;
                // Candidate discovery has a separate prefix bound: an adversarial
                // stream of duplicate PUSH4 values must not multiply a full-code
                // scan by 32 memory comparisons at every instruction.
                if (i + 4 < code.length && i + 4 < MAX_SELECTOR_SCAN && p.selectorCount < MAX_SELECTORS) {
                    bytes4 candidate;
                    assembly ("memory-safe") {
                        candidate := and(mload(add(add(code, 33), i)), shl(224, 0xffffffff))
                    }
                    bool seen;
                    for (uint256 j; j < p.selectorCount; ++j) {
                        if (p.selectorCandidates[j] == candidate) { seen = true; break; }
                    }
                    if (!seen) p.selectorCandidates[p.selectorCount++] = candidate;
                }
            }
            if (op == 0xf1) ++p.opcodeSignals[0];
            else if (op == 0xfa) ++p.opcodeSignals[1];
            else if (op == 0xf4) ++p.opcodeSignals[2];
            else if (op == 0xf2) ++p.opcodeSignals[3];
            else if (op == 0xff) ++p.opcodeSignals[4];
            else if (op == 0x55) ++p.opcodeSignals[5];
            else if (op == 0x32) ++p.opcodeSignals[6];
            else if (op == 0xf0) ++p.opcodeSignals[7];
            else if (op == 0xf5) ++p.opcodeSignals[8];
            else if (op >= 0xa0 && op <= 0xa4) ++p.opcodeSignals[9];
            if (op >= 0x60 && op <= 0x7f) i += uint256(op) - 0x5f;
            ++i;
        }

        // ERC165 conformance requires the standard interface and rejection of 0xffffffff.
        (bool standardAvailable, bool standard) = _interfaceResponse(target, 0x01ffc9a7);
        (bool invalidAvailable, bool invalid) = _interfaceResponse(target, 0xffffffff);
        if (standardAvailable && standard && invalidAvailable && !invalid) {
            p.interfaceMask = 1;
            (, bool supported) = _interfaceResponse(target, 0x80ac58cd);
            if (supported) p.interfaceMask |= 2;
            (, supported) = _interfaceResponse(target, 0xd9b67a26);
            if (supported) p.interfaceMask |= 4;
            (, supported) = _interfaceResponse(target, 0x2a55205a);
            if (supported) p.interfaceMask |= 8;
        }
        (bool ok, uint256 value) = _word(target, 0x8da5cb5b); // owner()
        if (ok && value <= type(uint160).max) { p.ownerAvailable = true; p.owner = address(uint160(value)); }
        (ok, value) = _word(target, 0x5c975abb); // paused()
        if (ok && value <= 1) { p.pausedAvailable = true; p.paused = value == 1; }
        (ok, value) = _word(target, 0x5c60da1b); // implementation()
        if (ok && value <= type(uint160).max) {
            p.implementationAvailable = true; p.implementation = address(uint160(value));
        }
        (ok, value) = _word(target, 0x38d52e0f); // asset(); compatibility hint, not ERC4626 certification
        if (ok && value <= type(uint160).max) { p.assetAvailable = true; p.asset = address(uint160(value)); }
    }

    function _interfaceResponse(address target, bytes4 interfaceId) private view returns (bool available, bool supported) {
        if (gasleft() < 80_000) revert InsufficientGas();
        bool ok;
        uint256 size;
        uint256 result;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x01ffc9a7))
            mstore(add(ptr, 4), interfaceId)
            ok := staticcall(30000, target, ptr, 36, ptr, 32)
            size := returndatasize()
            result := mload(ptr)
        }
        available = ok && size == 32 && result <= 1;
        supported = available && result == 1;
    }

    function _word(address target, uint32 selector) private view returns (bool ok, uint256 value) {
        if (gasleft() < 80_000) revert InsufficientGas();
        uint256 size;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, selector))
            ok := staticcall(50000, target, ptr, 4, ptr, 32)
            size := returndatasize()
            value := mload(ptr)
        }
        ok = ok && size == 32;
    }

    function _describe(Profile memory p) private pure returns (string memory text) {
        text = string.concat("On-chain address inspection. Native balance ", _uint(p.nativeBalance), " wei. ");
        if (p.codeBytes == 0) {
            return string.concat(text, "No deployed runtime bytecode. This does not prove the address is a wallet; precompiles and undeployed addresses may also have no code.");
        }
        text = string.concat(text, "Runtime bytecode ", _uint(p.codeBytes), " bytes; scanned ", _uint(p.scannedBytes),
            " bytes. ", _uint(p.opcodeSignals[0]), " CALL, ", _uint(p.opcodeSignals[2]), " DELEGATECALL, ",
            _uint(p.opcodeSignals[5]), " SSTORE positions outside PUSH data. ");
        if (!p.complete) text = string.concat(text, "The scan is a bounded prefix, not the entire runtime. ");
        if ((p.interfaceMask & 2) != 0) text = string.concat(text, "Reports ERC721 interface support. ");
        if ((p.interfaceMask & 4) != 0) text = string.concat(text, "Reports ERC1155 interface support. ");
        if ((p.interfaceMask & 8) != 0) text = string.concat(text, "Reports ERC2981 interface support. ");
        if (p.ownerAvailable) text = string.concat(text, "An owner() getter responded. ");
        if (p.pausedAvailable) text = string.concat(text, p.paused ? "paused() returned true. " : "paused() returned false. ");
        if (p.implementationAvailable) text = string.concat(text, "An implementation() getter responded. ");
        if (p.assetAvailable) text = string.concat(text, "An asset() getter responded. ");
        return string.concat(text, "PUSH4 candidates cover at most the first 4096 code bytes. These structural signals can include unreachable code or metadata. Getters may be misleading. Internal storage, source logic and safety are not established.");
    }

    function _uint(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 copy = value;
        uint256 digits;
        while (copy != 0) { ++digits; copy /= 10; }
        bytes memory output = new bytes(digits);
        while (value != 0) { output[--digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(output);
    }
}
