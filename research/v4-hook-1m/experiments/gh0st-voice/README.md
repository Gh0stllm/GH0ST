# GH0ST voice tuning — local research

This experiment adapts the existing 1,235,968-parameter SimpleStories V2 model toward an original GH0ST voice: a small machine thinking aloud about pools, people, value, memory and culture. High-level inspiration came from the public Truth Terminal website. Its text, identity and mythology are not copied into the training corpus.

This folder is separate from the published base model and deployment plans. Nothing here authorizes or performs a public-chain deployment. No wallet, mainnet RPC, posting account or credential is required.

## Preserved execution design

- 4 layers, hidden width128, intermediate width341, 4query/2key-value heads, fixed4019-token WordPiece vocabulary and tied output weights.
- Full causal transformer inference; learned token prediction, not a runtime sentence catalog.
- Q12 integer export, signed12 matrix constraint for executable SWAR weight tiles, exact Relative64 attention.
- Persistent model state, one or two new tokens per swap, same64-position active attention window. Long-range recall outside that window remains limited.

A fixed parameter count does not prove a gas bound. Each changed checkpoint must be exported, independently checked and measured through local PoolManager swaps.

## Artifacts

- `data/`: original synthetic corpus, deterministic split builders and provenance. `expanded-v2/` preserves the original splits and adds independently split original monologues.
- `training/`: local-only training and FP32 evaluation tools. `train_voice_pilot_v1.py` freezes the first runner; the current runner adds opt-in continuous-stream training and frozen-lower-layer comparisons.
- `evaluation/`: voice brief, held-out prefixes, diagnostics and first-pilot review. Text diagnostics are not a reliable automatic measure of fluency or thought quality.
- `runs/pilot-600/`: first document/EOS pilot. It improved domain loss but **failed the language-quality gate**.
- `runs/continuous-sweep/`: six validation-selected training trials comparing learning rates and which layers are tuned. No evaluation prompt is training material.
- `export/selected/`: first-pilot exact integer exports, independent reference and deterministic generation transcripts.
- `evm/`: first-pilot local-only v4 test. 80/80 swaps matched the independent integer reference; highest whole-swap gas28,427,411. This confirms execution, not good prose.

## First-pilot finding

The initial112-document corpus trained each monologue to end with EOS. The tested continuity runtime continues through EOS rather than resetting the story. The pilot therefore learned some first-person machine language while its continued stream could fall back into the original model's children’s-story distribution. It also produced short/empty continuations on several diagnostic prefixes. It is not release-ready.

The second pass tests continuous training streams and expands the original writing corpus. Results and release conclusions belong in `RESULTS.md`; do not infer success from training loss or the presence of checkpoint files.

## Reproduction requirements

Python with PyTorch, Transformers, NumPy, safetensors; Node with the research workspace's existing ethers/solc dependencies; Anvil for optional local v4 tests. All checkpoints load with `local_files_only=True`, and all EVM test transactions target chain31337. Never point a local test at a funded public network.

The corpus is a small synthetic development set. A small local benchmark cannot establish10,000 high-quality unique thoughts, reliable question answering, sentience, live market knowledge, or the reasoning capabilities of Truth Terminal.
