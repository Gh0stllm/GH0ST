# Large-corpus voice research: execution passes, language quality does not

Research milestone, 24 October 2026. Training and EVM tests are local only. No public-chain transaction was sent. Code, corpora, checkpoints and completed reports are being published to `Gh0stllm/GH0ST`, branch `research/v4-hook-1m`, for reproducibility; publication is not approval for release.

## Completed data

The corrected combined corpus contains **78,102 passages and 7,518,466 tokenizer tokens**. It combines 433 authored GH0ST monologues, 61,440 offline compositional passages, 2,801 attributed public-domain prose paragraphs and 13,428 distinct licensed teacher paragraphs. The composition count is not a count of independently authored ideas. The final teacher set contains 7,140 Hermes and 6,288 Opus-Candid paragraphs. The publishers declare Apache-2.0 licensing; the cards, notices, pinned source revisions and cleaning audit are retained.

The earlier 78,130-document snapshot included 28 paragraphs removed in a final contact-information filter. Its run is retained as superseded provenance. The corrected run uses `data/mixed-teacher-v4-final` and cache fingerprint `59e61c5857ed74fe8b70183e79ac0bb5dd19f5950a7463729763eea7eb3af52f`.

Another 100 short, original comic monologues were authored for a separate style experiment. They are not part of the 78,102-document corpus or the corrected 4M run. Exact split assignments and counts are in the data manifests. See the independent corpus reviews under `evaluation/`.

## Completed training

| Run | Supervised token exposures | Observation |
|---|---:|---|
| Original large mix | 8,000,442 | Best saved validation snapshot at step 500; later training overfit and all reviewed outputs remained weak. |
| Public-domain-heavy comparison | 4,000,402 | Better broad prose prediction; persistent free-generation loops. |
| Initial teacher snapshot, superseded | 4,000,117 | Preserved separately; not the corrected dataset result. |
| Corrected teacher mixture | 4,001,124 | Validation 5.6988 to 4.5444; still fails coherent long narration. |

All four runs retain 1,235,968 parameters, the 4,019-token vocabulary, tied output weights and a 64-position attention window. There were no numerical weight projections. Validation losses from different source mixtures are not directly comparable. Basic repetition guards passing does not establish good writing. Each run began with a fresh optimizer; no optimizer state is included in the saved model checkpoint.

The corrected teacher checkpoint is `runs/teacher-v4-final-4m/checkpoint-003126`; its safetensors SHA-256 is `c24d7fe2c13b14a3bf49924723580578a27666668fd9f92638f1fc29a386fa57`. It is an **experimental failed-quality checkpoint**, not a release candidate. Complete 512-token probes show semantic loops such as repeated assertions about a man, doors and windows. Longer training on the same objective was stopped because lower loss did not resolve that failure.

## Measured local gas result

The independently exported step-1,000 checkpoint from the original large mix passed **128 actual local PoolManager swaps** and generated 141 tokens with persistent context. Every checked token and full 4,019-logit hash matched the independent Q12 calculation. Whole-swap gas was **13,323,188 to 28,420,946**, below the 32,000,000 cap. Rollback, tamper, stale-preview, caller and pool isolation checks passed.

These are measurements for that exact checkpoint only. This benchmark does not certify every future set of weights. The corrected teacher checkpoint subsequently passed its own 128 local swaps, with 142 generated tokens and full token/logit parity. Its maximum whole-swap gas was **28,406,679**, leaving 3,593,321 gas below the cap. All four 256-token integer-generated streams still failed language review. See `evaluation/TEACHER_FINAL_FAILURE_BENCHMARK.md` for the separate measured result.

The node was fresh, unforked Anvil chain 31337 with local-only identity guards. Executable weight runtimes were installed and hash-verified locally; public contract deployment costs are excluded. See `evaluation/GAS_PROBE_001000.md` and `evm/large-corpus-probe-local.json`.

## Quality decision

**Do not replace the current hook with these weights.** The larger corpus and completed retraining did not yet deliver the requested witty, coherent, continuous voice. There is no evidence here for 10,000 good generated sentences or reliable question answering. The hook still computes tokens from neural weights rather than selecting a stored sentence. Execution feasibility and language quality are separate findings.

## Bounded short-voice comparison

Two isolated 200-step tone-finish runs compared the original pretrained base with the corrected teacher checkpoint on 80 training / 20 held-out short comic monologues, mixed with the earlier authored material. Each processed 177,360 supervised tokens. Both improved their own held-out prediction loss, but all four selected 512-token streams and 16 short-prefix outputs still failed coherent comic speech. The sharp training set had only 3,856 tokens and roughly 32 repeat exposures; it cannot substitute for broad independent data. No further same-objective training was launched. See `tone-finish/RESULTS.md`.
