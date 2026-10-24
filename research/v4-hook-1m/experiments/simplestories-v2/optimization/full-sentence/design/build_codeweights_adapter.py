"""Build an isolated executable-weight adapter with exact packed fallback."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "codeweights"
NODE = "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"


def extract(source, marker):
    start = source.index(marker)
    depth, opened = 0, False
    for i in range(start, len(source)):
        if source[i] == "{": depth, opened = depth + 1, True
        if source[i] == "}":
            depth -= 1
            if opened and depth == 0: return source[start:i+1]
    raise ValueError(marker)


def shard_commit(file):
    js = '''import fs from 'node:fs';import {keccak256,AbiCoder} from 'ethers';
const b=fs.readFileSync(process.argv[1]),a=AbiCoder.defaultAbiCoder();let h='0x'+'00'.repeat(32);
for(let i=0;i<b.length;i+=24000){const c=Buffer.concat([Buffer.from([0]),b.subarray(i,i+24000)]);h=keccak256(a.encode(['bytes32','bytes32'],[h,keccak256(c)]));}process.stdout.write(h);'''
    return subprocess.check_output([NODE, "--input-type=module", "-e", js, str(file)], cwd=ROOT.parents[3]).decode()


def main():
    metadata = json.loads((OUT / "tile-manifest.json").read_text())
    base = ROOT / "generation-faststart/SimpleStoriesV2ModelOptimized.sol"
    source = base.read_text()
    data = ROOT.parents[0] / "kernel8/model"
    wc, tc = shard_commit(data / "weights.bin"), shard_commit(data / "tables.bin")
    source = source.replace("    address[] private _tables;", "    address[] private _tables;\n    address[] private _tiles;")
    source = source.replace("constructor(address[] memory weights, address[] memory tables)", "constructor(address[] memory weights, address[] memory tables, address[] memory tiles)")
    source = source.replace('        modelHash = keccak256(abi.encode("GH0ST_SIMPLESTORIES_V2_Q12_SWAR8_CTX16_V1", a, b));',
                            f'''        if (a != {wc} || b != {tc}) revert InvalidModel();
        bytes32 c = _pinTiles(tiles);
        modelHash = keccak256(abi.encode("{metadata['model_hash_domain']}", a, b, c));''')
    assert "bytes32 c = _pinTiles(tiles);" in source
    old_linear = extract(source, "function _linear(")
    source = source.replace(old_linear, old_linear.replace("function _linear(", "function _linearFallback("))
    old_head = extract(source, "function _headWithScratch(")
    source = source.replace(old_head, old_head.replace("function _headWithScratch(", "function _headFallback("))
    ranges = []
    for key, entry in metadata["matrices"].items():
        tiles = [metadata["code_tiles"][i] for i in entry["tile_indices"]]
        assert sum(t["row_count"] for t in tiles) == entry["rows"]
        ranges.append(f"        if (offset == {key}) return ({entry['first_tile']}, {entry['tile_count']});")
    row_counts = []
    for start in range(0, metadata["tile_count"], 32):
        word = sum(t["row_count"] << (8 * i) for i, t in enumerate(metadata["code_tiles"][start:start+32]))
        row_counts.append(f"        if (index < {start+32}) return (uint256(0x{word:064x}) >> ((index % 32) * 8)) & 255;")
    added = f'''
    function _pinTiles(address[] memory sources) private returns (bytes32 commitment) {{
        if (sources.length != {metadata['tile_count']}) revert InvalidModel();
        for (uint256 i; i < sources.length; ++i) {{
            if (sources[i].code.length == 0 || sources[i].code.length > 24000) revert InvalidModel();
            commitment = keccak256(abi.encode(commitment, sources[i].codehash));
            _tiles.push(sources[i]);
        }}
        if (commitment != {metadata['code_commitment']}) revert InvalidModel();
    }}
    function _tileRange(uint256 offset) private pure returns (uint256 first, uint256 count) {{
{chr(10).join(ranges)}
        revert InvalidInput();
    }}
    function _tileRowCount(uint256 index) private pure returns (uint256) {{
{chr(10).join(row_counts)}
        revert InvalidInput();
    }}
    function _executeTiles(uint256 offset, uint256 rows, uint256[] memory packed,
        int256 inputSum, uint256 outputPointer) private view
    {{
        (uint256 first, uint256 count) = _tileRange(offset);
        uint256 groups = packed.length;
        bytes memory payload = new bytes((groups + 1) * 32);
        assembly ("memory-safe") {{
            mcopy(add(payload, 32), add(packed, 32), shl(5, groups))
            let correction := add(shl(11, inputSum), shl(27, mul(groups, 8)))
            mstore(add(add(payload, 32), shl(5, groups)), correction)
        }}
        for (uint256 i; i < count; ++i) {{
            uint256 currentRows = _tileRowCount(first + i);
            if (currentRows > rows) revert InvalidModel();
            uint256 size = currentRows * 32;
            address target = _tiles[first + i];
            bool ok;
            assembly ("memory-safe") {{
                ok := staticcall(gas(), target, add(payload, 32), mload(payload), outputPointer, size)
                if iszero(eq(returndatasize(), size)) {{ ok := 0 }}
            }}
            if (!ok) revert InvalidModel();
            outputPointer += size;
            rows -= currentRows;
        }}
        if (rows != 0) revert InvalidModel();
    }}
    function _linear(uint256 offset, uint256 rows, uint256 columns, int32[] memory input,
        int32[] memory output, bytes memory buffer) private view
    {{
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        if (!fast) {{ _linearFallback(offset, rows, columns, input, output, buffer); return; }}
        uint256 pointer;
        assembly ("memory-safe") {{ pointer := add(output, 32) }}
        _executeTiles(offset, rows, packed, inputSum, pointer);
    }}
    function _headWithScratch(int32[] memory norm, bytes memory matrixWeights, int256[] memory logits)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {{
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(norm, 128);
        if (!fast) return _headFallback(norm, matrixWeights, logits);
        uint256 pointer;
        assembly ("memory-safe") {{ pointer := add(logits, 32) }}
        _executeTiles(HEAD_OFFSET, VOCABULARY, packed, inputSum, pointer);
        assembly ("memory-safe") {{
            let maximum := shl(255, 1)
            let ptr := add(logits, 32)
            for {{ let token := 0 }} lt(token, 4019) {{ token := add(token, 1) ptr := add(ptr, 32) }} {{
                let value := mload(ptr)
                if sgt(value, maximum) {{ maximum := value nextToken := token }}
            }}
            logitHash := keccak256(sub(logits, 32), 128672)
        }}
    }}
'''
    source = source[:source.rfind("}")] + added + "\n}\n"
    (OUT / "SimpleStoriesV2ModelOptimized.sol").write_text(source)
    model = OUT / "model"
    model.mkdir(exist_ok=True)
    for name in ["weights.bin", "tables.bin"]:
        if not (model / name).exists(): os.link(data / name, model / name)
    manifest = json.loads((data / "manifest.json").read_text())
    manifest["model_hash_domain"] = metadata["model_hash_domain"]
    manifest["executable_tiles"] = [{**t, "path": "../" + t["path"]} for t in metadata["code_tiles"]]
    manifest["expected_weight_commitment"] = wc
    manifest["expected_table_commitment"] = tc
    manifest["expected_tile_commitment"] = metadata["code_commitment"]
    (model / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (OUT / "adapter-derivation.json").write_text(json.dumps({"base": str(base.relative_to(ROOT)),
        "base_sha256": hashlib.sha256(base.read_bytes()).hexdigest(), "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "tiles": metadata["tile_count"], "tile_commitment": metadata["code_commitment"],
        "fallback": "Original exact packed8 matrix implementation for out-of-range inputs"}, indent=2) + "\n")
    print(OUT)


if __name__ == "__main__": main()
