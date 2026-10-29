// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULUniversalReader} from "../../intel/v2/S0ULUniversalReader.sol";

/// @dev Local EVM fixtures only. Unrestricted setters deliberately model hostile getters.
contract AnalysisFactsGetterMock {
    struct Getter { bool configured; uint8 mode; uint256 value; }
    mapping(bytes4 => Getter) private getters;
    uint8 public interfaceFlags;
    uint8 public interfaceMode;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public reserveTimestamp;
    uint8 public reserveMode;
    uint256 public counter;

    function setGetter(bytes4 selector, uint8 mode, uint256 value) external {
        getters[selector] = Getter(true, mode, value);
    }
    function clearGetter(bytes4 selector) external { delete getters[selector]; }
    function setInterfaces(uint8 flags, uint8 mode) external { interfaceFlags = flags; interfaceMode = mode; }
    function setReserves(uint256 r0, uint256 r1, uint256 timestamp, uint8 mode) external {
        reserve0 = r0; reserve1 = r1; reserveTimestamp = timestamp; reserveMode = mode;
    }

    fallback() external {
        if (msg.sig == 0x01ffc9a7) {
            bytes4 id = abi.decode(msg.data[4:], (bytes4));
            uint8 mode = interfaceMode;
            if (mode == 3) { assembly { mstore(0, 1) return(0, 31) } }
            if (mode == 4) {
                uint256 initial = gasleft();
                while (initial - gasleft() < 35_000) {}
            }
            uint256 result;
            if (mode == 1) result = 1;
            else if (mode == 2 && id == 0xffffffff) result = 2;
            else if (id == 0x01ffc9a7 || (id == 0x80ac58cd && (interfaceFlags & 1) != 0)
                || (id == 0xd9b67a26 && (interfaceFlags & 2) != 0)
                || (id == 0x2a55205a && (interfaceFlags & 4) != 0)) result = 1;
            assembly { mstore(0, result) return(0, 32) }
        }
        if (msg.sig == 0x0902f1ac) {
            uint256 r0 = reserve0;
            uint256 r1 = reserve1;
            uint256 time = reserveTimestamp;
            uint8 mode = reserveMode;
            if (mode == 1) revert("reserve failure");
            if (mode == 2) { assembly { return(0, 0) } }
            if (mode == 3) { assembly { mstore(0, r0) mstore(32, r1) return(0, 64) } }
            if (mode == 4) { assembly { mstore(0, r0) mstore(32, r1) mstore(64, time) return(0, 65536) } }
            if (mode == 5) { assembly { mstore(0, r0) revert(0, 65536) } }
            if (mode == 6) { assembly { for { } 1 { } { } } }
            if (mode == 7) { ++counter; }
            if (mode == 8) { assembly { mstore(0, r0) mstore(32, r1) mstore(64, time) return(0, 95) } }
            if (mode == 9) { assembly { mstore(0, r0) mstore(32, r1) mstore(64, time) return(0, 97) } }
            assembly { mstore(0, r0) mstore(32, r1) mstore(64, time) return(0, 96) }
        }
        Getter memory getter = getters[msg.sig];
        require(getter.configured, "getter unavailable");
        uint8 mode = getter.mode;
        uint256 value = getter.value;
        if (mode == 1) revert("scalar failure");
        if (mode == 2) { assembly { mstore(0, value) return(0, 31) } }
        if (mode == 3) { assembly { mstore(0, value) return(0, 64) } }
        if (mode == 4) { assembly { mstore(0, value) return(0, 65536) } }
        if (mode == 5) { assembly { mstore(0, value) revert(0, 65536) } }
        if (mode == 6) { assembly { for { } 1 { } { } } }
        if (mode == 7) { ++counter; }
        if (mode == 8) { assembly { return(0, 0) } }
        if (mode == 9) { assembly { mstore(0, value) return(0, 33) } }
        assembly { mstore(0, value) return(0, 32) }
    }
}

contract AnalysisFactsAssetMock { function marker() external pure returns (uint256) { return 1; } }

/// @dev This deliberately bad reader exercises cross-checks, not general reader behavior.
contract AnalysisFactsBadReaderMock {
    uint8 public mode;
    function setMode(uint8 selected) external { mode = selected; }
    function profile(address target) external view returns (S0ULUniversalReader.Profile memory p) {
        p.target = target;
        p.nativeBalance = target.balance;
        p.codeHash = target.codehash;
        p.codeBytes = target.code.length;
        p.scannedBytes = p.codeBytes;
        p.complete = true;
        p.observedAt = uint64(block.timestamp);
        p.blockCounter = uint64(block.number);
        uint8 selected = mode;
        if (selected == 1) p.target = address(0x1111);
        else if (selected == 2) ++p.nativeBalance;
        else if (selected == 3) p.codeHash = bytes32(uint256(123));
        else if (selected == 4) ++p.codeBytes;
        else if (selected == 5) p.interfaceMask = 16;
        else if (selected == 6) --p.observedAt;
        else if (selected == 7) ++p.blockCounter;
    }
}
