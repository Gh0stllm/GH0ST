"""Read-only bounded reference extraction; no machine execution or compilation."""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import resource

if platform.system() != "Linux":
    raise RuntimeError("Runpod Linux only")
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:2])
resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
root = Path(__file__).resolve().parent
if not str(root).startswith("/root/gl3-host-cache-integration/"):
    raise RuntimeError("Isolated integration prefix required")
source = Path("/root/bounded-restore/fast-comparison/C-combined/interpreter")
proof_file = source / "full-proofs.json"
log_file = source / "prover.log"


def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


proof_sha = sha(proof_file)
log_sha = sha(log_file)
if proof_sha != "74473cd9a4e149aa8230baf8cefca1736a0201d7111a5c00bc20ecb93397a448":
    raise RuntimeError("Wrong frozen full-proof file")
if log_sha != "fb3fae1ea87198078d75817bab1b9f07b5598175f1999e96df2307f95d0b6a96":
    raise RuntimeError("Wrong frozen CLI log")
log = re.sub(r"\x1b\[[0-9;]*m", "", log_file.read_text())
trace = re.findall(r"Generating proof\s+(\d+)\s+\(inst\s+(\d+)\) for ([^\n]+)", log)
with proof_file.open() as file:
    proofs = json.load(file)
if len(proofs) != len(trace) + 1:
    raise RuntimeError("Trace/proof count mismatch")
samples = []
for raw_step in [0, 100_000_000, 200_000_000]:
    matches = [(i, item) for i, item in enumerate(trace) if int(item[1]) == raw_step]
    if len(matches) != 1:
        raise RuntimeError("Missing or ambiguous exact raw sample")
    index, (printed_index, printed_step, opcode) = matches[0]
    if int(printed_index) != index:
        raise RuntimeError("Proof index mismatch")
    row = proofs[index]
    samples.append({"rawStep": str(raw_step), "wrappedStep": str(raw_step + 1),
                    "beforeHash": "0x" + row["before"], "afterHash": "0x" + row["after"],
                    "proofSHA256": hashlib.sha256(bytes.fromhex(row["proof"])).hexdigest(),
                    "proofBytes": len(row["proof"]) // 2, "opcodeFromFrozenLog": opcode})
report = {"schema": "gh0st.gl3.host-cache-prefix-reference.v1", "passed": True,
          "scope": "Reference extraction only; no new execution, cache or performance acceptance",
          "fullProofFileSHA256": proof_sha, "fullProofFileBytes": proof_file.stat().st_size,
          "fullProofCount": len(proofs), "rawProverLogSHA256": log_sha,
          "moduleRoot": "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086",
          "inputSHA256": "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90",
          "rawToWrappedOffset": 1, "samples": samples, "allExecutionOnRunpod": True,
          "machineExecuted": False, "fullReplayExecuted": False}
(root / "prefix-reference.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
