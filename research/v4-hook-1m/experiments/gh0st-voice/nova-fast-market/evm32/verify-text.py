"""Independent exact-Q10 replay of each bounded-text swap; no chain access."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location("nova_reference", ROOT.parent / "voice-v8/evm/reference.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--report", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
raw = args.report.read_bytes()
report = json.loads(raw)
assert report["status"] == "PASS"
ref = module.Reference(ROOT / "selected")
all_states, all_words, rows = [], [], []
prior = None
for swap in report["swaps"]:
    before, after = swap["before"], swap["after"]
    if prior is not None:
        assert before["hidden"] == prior["hidden"]
        assert before["context"] == prior["context"]
    previous, punct = int(before["context"][5]), int(before["context"][6])
    hidden = list(map(int, before["hidden"]))
    words, states = [], []
    for i in range(swap["wordCount"]):
        sequence = int(before["context"][4]) + i + 1
        result = ref.step(previous, punct, hidden, swap["features"], report["seed"], sequence-1,
                          report["temperatureQ10"], scalar=True)
        assert i == swap["wordCount"]-1 or not result["terminal"]
        words.append({"sequence": sequence, "token": result["token"], "punct": result["punct"],
                      "text": result["text"], "terminal": result["terminal"]})
        states.append([sequence, result["token"], result["punct"], result["hidden"]])
        hidden, previous, punct = result["hidden"], result["token"], result["punct"]
    assert " ".join(w["text"] for w in words) == swap["text"]
    assert words[-1]["terminal"] == swap["terminal"]
    assert hidden == list(map(int, after["hidden"]))
    assert previous == int(after["context"][5]) and punct == int(after["context"][6])
    assert swap["previousStateHash"] == before["context"][8]
    all_states.extend(states)
    all_words.extend(words)
    rows.append({"firstWord": int(swap["firstWord"]), "lastWord": int(swap["lastWord"]),
                 "text": swap["text"], "terminal": swap["terminal"], "gas": int(swap["gasUsed"]),
                 "finalStateHash": swap["stateHash"]})
    prior = after

node = os.environ.get("NODE_BINARY", "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
script = """import fs from 'node:fs';import{AbiCoder,keccak256}from'ethers';const x=JSON.parse(fs.readFileSync(process.argv[1]));const c=AbiCoder.defaultAbiCoder();console.log(JSON.stringify(x.states.map(s=>keccak256(c.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[768]'],[x.model,x.pool,...s])))));"""
args.out.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=args.out.parent) as tmp:
    path = Path(tmp) / "states.json"
    path.write_text(json.dumps({"model": report["model_hash"], "pool": report["poolId"], "states": all_states}))
    hashes = json.loads(subprocess.check_output([node, "--input-type=module", "-e", script, str(path)], cwd=ROOT.parents[2]))
index = 0
for swap in report["swaps"]:
    index += swap["wordCount"]
    assert hashes[index-1] == swap["stateHash"] == swap["after"]["context"][8]

result = {"status": "PASS", "report_sha256": hashlib.sha256(raw).hexdigest(),
          "swaps": len(rows), "neural_words": len(all_words), "all_text_and_final_768_states_match": True,
          "all_final_state_hashes_match": True, "continuous_state_across_swaps": True,
          "no_forced_punctuation_or_words": True, "per_word_scores_compared_to_events": False,
          "rows": rows, "words": all_words}
args.out.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({k:v for k,v in result.items() if k not in ("rows","words")}))
