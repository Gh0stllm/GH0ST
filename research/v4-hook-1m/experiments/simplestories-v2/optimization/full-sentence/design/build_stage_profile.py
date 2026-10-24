"""Instrument a separate candidate copy; never modifies the measured kernel."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def extract(source, marker):
    begin = source.index(marker)
    depth, opened = 0, False
    for i in range(begin, len(source)):
        if source[i] == "{": depth, opened = depth + 1, True
        if source[i] == "}":
            depth -= 1
            if opened and depth == 0: return source[begin:i+1]
    raise ValueError(marker)


def main():
    source = (ROOT / "generation-faststart/SimpleStoriesV2ModelOptimized.sol").read_text()
    source = source.replace("contract SimpleStoriesV2Model {", "contract SimpleStoriesV2Model {\n    uint256[8] public stageGas;")
    source = re.sub(r"\bview\b", "", source)
    for name, index in [("_linear", 0), ("_rms", 1), ("_rope", 2), ("_attention", 3),
                        ("_siluMultiply", 4), ("_addResidual", 4), ("_headWithScratch", 5)]:
        old = extract(source, f"function {name}(")
        signature, body = old.split("{", 1)
        signature = re.sub(r"\bpure\b", "", signature)
        body = body[:-1]
        if name == "_attention":
            body = body.replace("            return;", f"            stageGas[{index}] += __profileStart - gasleft();\n            return;")
        new = signature + "{\n        uint256 __profileStart = gasleft();" + body + f"\n        stageGas[{index}] += __profileStart - gasleft();\n    }}"
        source = source.replace(old, new)
    source = source.replace("        _fill(_weights, uint256(token) * HIDDEN * 2, HIDDEN * 2, matrixWeights);", "        uint256 __embeddingStart = gasleft();\n        _fill(_weights, uint256(token) * HIDDEN * 2, HIDDEN * 2, matrixWeights);")
    source = source.replace("        for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = int32(_i16(matrixWeights, j * 2));", "        for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = int32(_i16(matrixWeights, j * 2));\n        stageGas[6] += __embeddingStart - gasleft();")
    source = source.replace("function generateSentence(uint16[] calldata prompt, uint8 maximumNewTokens) external", "function generateSentence(uint16[] calldata prompt, uint8 maximumNewTokens) public")
    wrapper = '''
    function profileSentence(uint16[] calldata prompt, uint8 limit) external
        returns (uint16[] memory tokens, bool endedEos, bool endedSentence, bytes32 hash)
    {
        for (uint256 i; i < 8; ++i) stageGas[i] = 0;
        uint256 start = gasleft();
        (tokens, endedEos, endedSentence, hash) = generateSentence(prompt, limit);
        stageGas[7] = start - gasleft();
    }
'''
    source = source[:source.rfind("}")] + wrapper + "}\n"
    (ROOT / "design/SimpleStoriesStageProfile.sol").write_text(source)


if __name__ == "__main__": main()
