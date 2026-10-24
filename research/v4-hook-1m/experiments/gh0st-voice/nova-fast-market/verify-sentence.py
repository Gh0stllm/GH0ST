"""Replay every diagnostic sentence word using the independent scalar Q10 reference."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
VOICE = HERE.parent
spec = importlib.util.spec_from_file_location("nova_reference", VOICE / "voice-v8/evm/reference.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--report", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
raw = args.report.read_bytes()
report = json.loads(raw)
diagnostic = report["sentence_diagnostic"]
assert diagnostic["status"] == "0x1"
ref = module.Reference(HERE / "selected")
before = diagnostic["before"]
previous, punct = int(before["context"][5]), int(before["context"][6])
hidden = list(map(int, before["hidden"]))
states, rows = [], []
compact = diagnostic.get("compact_output", False)
words = diagnostic["words"] if not compact else [
    {"features": diagnostic["features"], "sampleIndex": int(before["context"][4]) + i,
     "sequence": int(before["context"][4]) + i + 1} for i in range(diagnostic["word_count"])
]
for word in words:
    result = ref.step(previous, punct, hidden, word["features"], report["seed"],
                      int(word["sampleIndex"]), report["temperatureQ10"], scalar=True)
    if not compact:
        for key in ("token", "punct"):
            assert result[key] == int(word[key])
        for key in ("text", "terminal"):
            assert result[key] == word[key]
        assert result["scores"] == list(map(int, word["scores"]))
    states.append([int(word["sequence"]), result["token"], result["punct"], result["hidden"]])
    rows.append({"sequence": int(word["sequence"]), "text": result["text"], "all197_scores_match": not compact, "terminal": result["terminal"]})
    hidden, previous, punct = result["hidden"], result["token"], result["punct"]
assert hidden == list(map(int, diagnostic["after"]["hidden"]))
assert diagnostic["text"] == " ".join(row["text"] for row in rows)
assert rows[-1]["terminal"]
assert all(not w["terminal"] for w in rows[:-1])
assert previous == int(diagnostic["after"]["context"][5])
assert punct == int(diagnostic["after"]["context"][6])
node = os.environ.get("NODE_BINARY", "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
script = """import fs from 'node:fs';import{AbiCoder,keccak256}from'ethers';const x=JSON.parse(fs.readFileSync(process.argv[1]));const c=AbiCoder.defaultAbiCoder();console.log(JSON.stringify(x.states.map(s=>keccak256(c.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[768]'],[x.model,x.pool,...s])))));"""
with tempfile.TemporaryDirectory(dir=args.out.parent) as temp:
    data = Path(temp) / "states.json"
    data.write_text(json.dumps({"model": report["model_hash"], "pool": report["poolId"], "states": states}))
    hashes = json.loads(subprocess.check_output([node, "--input-type=module", "-e", script, str(data)], cwd=HERE.parents[2]))
previous_hash = before["context"][8]
for expected, word in zip(hashes, words):
    if not compact:
        assert word["stateHash"] == expected
        assert word["previousStateHash"] == previous_hash
    previous_hash = expected
assert diagnostic["after"]["context"][8] == previous_hash
result = {"status": "PASS", "report_sha256": hashlib.sha256(raw).hexdigest(), "neural_words": len(rows),
          "all768_hidden_values_replayed_each_word": True, "all197_scores_replayed_each_word": True,
          "per_word_scores_compared_to_events": not compact,
          "all_state_hashes_compared_to_events": not compact, "final_state_hash_matches": True, "neural_terminal_punctuation": True,
          "no_forced_words_or_punctuation": True, "rows": rows}
args.out.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({k: v for k, v in result.items() if k != "rows"}, indent=2))
