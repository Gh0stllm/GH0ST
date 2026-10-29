"""Generate the strict Solidity decoder for the analysis capability pilot."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis-model"))
from analysis_codec import WORDS, canonical_json, schema_spec  # noqa: E402

domain = hashlib.sha256(canonical_json(list(WORDS))).hexdigest()
schema = hashlib.sha256(canonical_json(schema_spec())).hexdigest()
assert domain == "c0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e"
assert schema == "eadc97e902dcdadbc655ee8b920562997737c5aa5690f181f7860bf1543c41f0"
assert len(WORDS) == 87 and all(word.isascii() and " " not in word for word in WORDS)
source = '''// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Strict word decoding for an experimental, separately trained S0UL model.
/// @dev This decoder supplies vocabulary only; it does not select report content.
/// Model quality is evaluated separately from decoder and arithmetic correctness.
contract S0ULAnalysisCodec {
    bytes32 public constant DOMAIN_SHA256 = 0xDOMAIN;
    bytes32 public constant SCHEMA_SHA256 = 0xSCHEMA;
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
CASES
        revert InvalidOutput();
    }
}
'''
# Replace exact value placeholders rather than public getter identifiers.
source = source.replace("0xDOMAIN", "0x" + domain).replace("0xSCHEMA", "0x" + schema)
cases = "\n".join(f"        if (id == {i + 64}) return bytes({json.dumps(word)});" for i, word in enumerate(WORDS))
source = source.replace("CASES", cases)
destination = ROOT / "contracts" / "analysis" / "S0ULAnalysisCodec.sol"
destination.write_text(source)
print(json.dumps({"path": str(destination), "sha256": hashlib.sha256(source.encode()).hexdigest(),
                  "domainSha256": domain, "schemaSha256": schema, "words": len(WORDS)}))
