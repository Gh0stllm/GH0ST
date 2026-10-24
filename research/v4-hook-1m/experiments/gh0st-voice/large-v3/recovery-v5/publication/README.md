# Recovery experiment publication bundle

This is an incremental local research snapshot for `research/v4-hook-1m`. It includes the 250 original short vignettes and fixed splits, cleaned grammar replay, both WordLevel preparation corpora, preparation and decoder reviews, completed CPU failure/stoppage evidence, the device-aware trainer, original-WordPiece export adapter and top2 GPU training evidence.

Only `runs/gpu-top2-voice-2m/checkpoint-000282/model.safetensors` is a model weight file in this update. Its selection by validation loss is not proof of good language quality. Both completed GPU runs retain semantic repetition and voice limitations. Their probes, reports and frozen-tensor comparisons are included. The selected top2 checkpoint completed 128 local v4 swaps with exact token/logit parity and a maximum whole-swap gas measurement of 28,416,204. This is local technical evidence, not approval of its language quality. No mainnet transaction or deployment is included here. Read both `recovery-v5/RESULTS.md` and `recovery-v5-bpe/RESULTS.md` for the release decision and limitations.

## Restore

Run `python3 research/v4-hook-1m/experiments/gh0st-voice/large-v3/recovery-v5/publication/restore.py --repo-root .` from a repository checkout. It expands the nine deterministic gzip text files and the completed-evidence archive to their original repository paths, verifies all lengths and SHA256 hashes, and refuses to replace differing files. The archive preserves every checkpoint probe, metadata and numerical audit from the included completed runs without publishing their other weights.

## Reproduction scope

Use the existing GH0ST research checkout and its pinned Python/Node dependencies. This update does not vendor PyTorch, Transformers, tokenizers, NumPy, safetensors, PyArrow, ethers, solc, Uniswap, Foundry or the original SimpleStories pretrained artifacts. The clean grammar replay files avoid needing the 238 MB upstream Parquet merely to rerun preparation. Retrieving that raw shard, if desired, is documented and hash-pinned by `grammar-replay/manifest.json`, `source-license.json` and `README.md`. The dataset card declares MIT licensing; a copy of its exact pinned bytes is not included in the excluded raw folder.

The original tokenizer is WordPiece; “bpe” is only the historical directory label. The selected checkpoint retains that original vocabulary and tied embedding/output. Training starts a new optimizer. CPU numeric experiments and original-model GPU runs have different starting states; their results should not be represented as one continuous resumed run.

The existing repository supplies the original `experiments/simplestories-v2/model-cache`, original packed weights/protocol and reviewed Relative64 kernel, plus referenced support files under `optimization/`. Weight/tile deployment costs are not swap gas. Local chain runners restrict execution to fresh chain 31337. Language evaluation remains a separate requirement from token/logit parity and gas.

Publication metadata lives in `restore-manifest.json`; external staging `manifest.json` lists each publishable file's encoding, SHA256 and Git blob SHA1. No cache, environment, key, token, raw Parquet or vendor package is intended for publication.
