"""Explicit download of the pinned upstream checkpoint. Never trains or broadcasts."""
from pathlib import Path
import hashlib
import os
from huggingface_hub import snapshot_download

REVISION = "607a30d783dfa663caf39e06633721c8d4cfcd7e"
CHECKPOINT_SHA256 = "248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707"
destination = Path(os.environ.get("GH0ST_MODEL_CACHE") or Path(__file__).resolve().parent.parent / "model-cache")
snapshot_download("openai-community/gpt2", revision=REVISION, local_dir=destination,
                  allow_patterns=["model.safetensors", "config.json", "generation_config.json",
                                  "tokenizer.json", "vocab.json", "merges.txt", "tokenizer_config.json"])
with (destination / "model.safetensors").open("rb") as file:
    actual = hashlib.file_digest(file, "sha256").hexdigest()
if actual != CHECKPOINT_SHA256:
    raise SystemExit("Checkpoint integrity check failed")
print(f"Pinned GPT-2 checkpoint verified in {destination}")

