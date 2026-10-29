// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULUniversalReader} from "../intel/v2/S0ULUniversalReader.sol";

/// @notice Authenticated current-chain inputs for a separately trained S0UL analyst.
/// @dev Builds the complete prompt on-chain. No caller supplies features or prose.
/// Getter compatibility and opcode positions do not certify contract semantics.
contract S0ULAnalysisFacts {
    bytes32 public constant SCHEMA_HASH = keccak256(
        "S0UL-ANALYSIS-FACTS-v1|code:2|native:2|interfaces:16|owner:3|pause:3|implementation:3|asset:3|supply:3|pool:3|delegate:2|writes:2|origin:2|externalCall:2|scan:2|BOS:1|SEP:3|bases:4,6,8,24,27,30,33,36,39,42,44,46,48,50"
    );
    uint256 public constant PROBE_GAS = 50_000;
    S0ULUniversalReader public immutable reader;
    bytes32 public immutable readerCodeHash;
    uint256 public immutable chainId;

    struct Evidence {
        S0ULUniversalReader.Profile profile;
        uint8[14] features;
        bool supplyAvailable;
        uint256 totalSupply;
        bool poolAvailable;
        uint112 reserve0;
        uint112 reserve1;
        uint32 reserveTimestamp;
        address token0;
        address token1;
    }

    error InvalidConfiguration();
    error ReaderChanged();
    error InvalidEvidence();
    error InsufficientGas();

    constructor(address reader_, bytes32 expectedReaderCodeHash) {
        if (reader_.code.length == 0 || expectedReaderCodeHash == 0
            || reader_.codehash != expectedReaderCodeHash) revert InvalidConfiguration();
        reader = S0ULUniversalReader(reader_);
        readerCodeHash = expectedReaderCodeHash;
        chainId = block.chainid;
    }

    function schemaHash() external pure returns (bytes32) { return SCHEMA_HASH; }

    function capture(address target) external view returns (bytes memory facts, uint16[] memory prompt) {
        if (block.chainid != chainId || address(reader).codehash != readerCodeHash) revert ReaderChanged();
        Evidence memory e;
        e.profile = reader.profile(target);
        if (e.profile.target != target || e.profile.codeHash != target.codehash
            || e.profile.codeBytes != target.code.length || e.profile.nativeBalance != target.balance
            || e.profile.interfaceMask > 15 || e.profile.observedAt != block.timestamp
            || e.profile.blockCounter != block.number) revert InvalidEvidence();
        uint8[14] memory f;
        f[0] = e.profile.codeBytes == 0 ? 0 : 1;
        f[1] = e.profile.nativeBalance == 0 ? 0 : 1;
        f[2] = e.profile.interfaceMask;
        f[3] = _addressClass(e.profile.ownerAvailable, e.profile.owner);
        f[4] = !e.profile.pausedAvailable ? 0 : e.profile.paused ? 2 : 1;
        f[5] = _addressClass(e.profile.implementationAvailable, e.profile.implementation);
        f[6] = _addressClass(e.profile.assetAvailable, e.profile.asset);
        if (e.profile.codeBytes != 0) {
            (e.supplyAvailable, e.totalSupply) = _word(target, 0x18160ddd);
            f[7] = !e.supplyAvailable ? 0 : e.totalSupply == 0 ? 1 : 2;
            _pool(target, e);
            f[8] = !e.poolAvailable ? 0 : e.reserve0 == 0 || e.reserve1 == 0 ? 1 : 2;
        }
        f[9] = e.profile.opcodeSignals[2] == 0 ? 0 : 1;
        f[10] = e.profile.opcodeSignals[5] == 0 ? 0 : 1;
        f[11] = e.profile.opcodeSignals[6] == 0 ? 0 : 1;
        f[12] = e.profile.opcodeSignals[0] == 0 ? 0 : 1;
        f[13] = e.profile.complete ? 1 : 0;
        e.features = f;
        prompt = new uint16[](16);
        prompt[0] = 1;
        uint16[14] memory bases = [uint16(4),6,8,24,27,30,33,36,39,42,44,46,48,50];
        for (uint256 i; i < 14; ++i) prompt[i + 1] = bases[i] + f[i];
        prompt[15] = 3;
        facts = abi.encode(e);
    }

    function _addressClass(bool available, address value) private pure returns (uint8) {
        return !available ? 0 : value == address(0) ? 1 : 2;
    }

    function _word(address target, uint32 selector) private view returns (bool ok, uint256 value) {
        if (gasleft() < PROBE_GAS + 40_000) revert InsufficientGas();
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

    function _pool(address target, Evidence memory e) private view {
        if (gasleft() < PROBE_GAS + 40_000) revert InsufficientGas();
        bool ok;
        uint256 size;
        uint256 r0;
        uint256 r1;
        uint256 reserveTime;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x0902f1ac))
            ok := staticcall(50000, target, ptr, 4, ptr, 96)
            size := returndatasize()
            r0 := mload(ptr)
            r1 := mload(add(ptr, 32))
            reserveTime := mload(add(ptr, 64))
        }
        if (!ok || size != 96 || r0 > type(uint112).max || r1 > type(uint112).max
            || reserveTime > type(uint32).max) return;
        (bool a0, uint256 v0) = _word(target, 0x0dfe1681);
        (bool a1, uint256 v1) = _word(target, 0xd21220a7);
        if (!a0 || !a1 || v0 == 0 || v1 == 0 || v0 == v1
            || v0 > type(uint160).max || v1 > type(uint160).max
            || address(uint160(v0)).code.length == 0 || address(uint160(v1)).code.length == 0) return;
        e.poolAvailable = true;
        e.reserve0 = uint112(r0);
        e.reserve1 = uint112(r1);
        e.reserveTimestamp = uint32(reserveTime);
        e.token0 = address(uint160(v0));
        e.token1 = address(uint160(v1));
    }
}
