// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Strict word decoding for an experimental, separately trained S0UL model.
/// @dev This decoder supplies vocabulary only; it does not select report content.
/// Model quality is evaluated separately from decoder and arithmetic correctness.
contract S0ULAnalysisCodec {
    bytes32 public constant DOMAIN_SHA256 = 0xc0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e;
    bytes32 public constant SCHEMA_SHA256 = 0xeadc97e902dcdadbc655ee8b920562997737c5aa5690f181f7860bf1543c41f0;
    uint16 public constant FIRST_WORD = 64;
    uint16 public constant LAST_WORD = 150;
    error InvalidOutput();

    function domainSha256() external pure returns (bytes32) { return DOMAIN_SHA256; }
    function schemaSha256() external pure returns (bytes32) { return SCHEMA_SHA256; }

    /// @dev Always requires EOS at the end; arbitrary special/input IDs are rejected.
    function decode(uint16[] calldata ids, bool) external pure returns (bytes memory output) {
        if (ids.length < 2 || ids.length > 32 || ids[ids.length - 1] != 2) revert InvalidOutput();
        bytes[] memory parts = new bytes[](ids.length - 1);
        uint256 length = parts.length - 1;
        for (uint256 i; i < parts.length; ++i) {
            parts[i] = _word(ids[i]);
            length += parts[i].length;
        }
        if (length > 4096) revert InvalidOutput();
        output = new bytes(length);
        uint256 cursor;
        for (uint256 i; i < parts.length; ++i) {
            if (i != 0) output[cursor++] = 0x20;
            for (uint256 j; j < parts[i].length; ++j) output[cursor++] = parts[i][j];
        }
    }

    function word(uint16 id) external pure returns (bytes memory) { return _word(id); }
    function _word(uint16 id) private pure returns (bytes memory) {
        if (id == 64) return bytes("Asset");
        if (id == 65) return bytes("Delegate");
        if (id == 66) return bytes("ERC1155");
        if (id == 67) return bytes("ERC165");
        if (id == 68) return bytes("ERC721");
        if (id == 69) return bytes("External");
        if (id == 70) return bytes("Getter");
        if (id == 71) return bytes("Implementation");
        if (id == 72) return bytes("Interface");
        if (id == 73) return bytes("NFT");
        if (id == 74) return bytes("Native");
        if (id == 75) return bytes("No");
        if (id == 76) return bytes("Origin");
        if (id == 77) return bytes("Owner");
        if (id == 78) return bytes("Paused");
        if (id == 79) return bytes("Pool");
        if (id == 80) return bytes("Positive");
        if (id == 81) return bytes("Royalty");
        if (id == 82) return bytes("Runtime");
        if (id == 83) return bytes("Safety");
        if (id == 84) return bytes("Scan");
        if (id == 85) return bytes("Selected");
        if (id == 86) return bytes("Storage");
        if (id == 87) return bytes("This");
        if (id == 88) return bytes("Unpaused");
        if (id == 89) return bytes("Zero");
        if (id == 90) return bytes("absent.");
        if (id == 91) return bytes("address");
        if (id == 92) return bytes("and");
        if (id == 93) return bytes("are");
        if (id == 94) return bytes("asset");
        if (id == 95) return bytes("balance");
        if (id == 96) return bytes("calls");
        if (id == 97) return bytes("cannot");
        if (id == 98) return bytes("checks");
        if (id == 99) return bytes("claimed.");
        if (id == 100) return bytes("code");
        if (id == 101) return bytes("delegate");
        if (id == 102) return bytes("detected");
        if (id == 103) return bytes("establish");
        if (id == 104) return bytes("evidence");
        if (id == 105) return bytes("execution");
        if (id == 106) return bytes("external");
        if (id == 107) return bytes("funds");
        if (id == 108) return bytes("getter");
        if (id == 109) return bytes("history,");
        if (id == 110) return bytes("identity,");
        if (id == 111) return bytes("implementation");
        if (id == 112) return bytes("incomplete;");
        if (id == 113) return bytes("inconclusive.");
        if (id == 114) return bytes("inspection.");
        if (id == 115) return bytes("interface");
        if (id == 116) return bytes("interfaces");
        if (id == 117) return bytes("is");
        if (id == 118) return bytes("limited.");
        if (id == 119) return bytes("observed.");
        if (id == 120) return bytes("or");
        if (id == 121) return bytes("owner");
        if (id == 122) return bytes("partial.");
        if (id == 123) return bytes("pattern");
        if (id == 124) return bytes("patterns");
        if (id == 125) return bytes("positive");
        if (id == 126) return bytes("present.");
        if (id == 127) return bytes("probes");
        if (id == 128) return bytes("remain");
        if (id == 129) return bytes("reported.");
        if (id == 130) return bytes("reports");
        if (id == 131) return bytes("require");
        if (id == 132) return bytes("reserves.");
        if (id == 133) return bytes("review.");
        if (id == 134) return bytes("runtime");
        if (id == 135) return bytes("safety.");
        if (id == 136) return bytes("scan");
        if (id == 137) return bytes("snapshot");
        if (id == 138) return bytes("state");
        if (id == 139) return bytes("storage");
        if (id == 140) return bytes("supply");
        if (id == 141) return bytes("unknown.");
        if (id == 142) return bytes("unverified.");
        if (id == 143) return bytes("value");
        if (id == 144) return bytes("value,");
        if (id == 145) return bytes("warrant");
        if (id == 146) return bytes("warrants");
        if (id == 147) return bytes("with");
        if (id == 148) return bytes("writes");
        if (id == 149) return bytes("zero");
        if (id == 150) return bytes("zero.");
        revert InvalidOutput();
    }
}
