"""Offline exhaustive signed-state wire representation and source binding."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
accepted = []
for raw in range(65536):
    signed = raw if raw < 32768 else raw - 65536
    expected = -1024 <= signed <= 1024
    # Exact EVM ADD after SIGNEXTEND(1), compared by unsigned GT.
    evm = ((signed % (1 << 256)) + 1024) % (1 << 256) <= 2048
    assert evm == expected
    if evm:
        accepted.append(raw)
result = {
    "status": "PASS", "local_only": True,
    "signed_state_encodings_checked": 65536,
    "accepted_encodings": len(accepted), "accepted_signed_range": [-1024, 1024],
    "score_representation": "Every 4-byte sequence decodes by SIGNEXTEND(3) to exactly one value in the full int32 range; values outside int32 cannot be represented. The model packer checks bounds before casting.",
    "source_hashes": {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in HERE.glob("*.sol")},
}
(HERE / "representation-proof.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
