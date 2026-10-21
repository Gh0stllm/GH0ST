# Artifacts and reproducibility

[Documentation](README.md) · [Getting started](GETTING-STARTED.md) · [Results index](RESULTS-INDEX.md) · [Recovery status](../RECOVERY-STATUS.md)

The Git repository contains source, reports, manifests and small supporting artifacts. Large model binaries are distributed or regenerated separately. A missing weight file in a fresh clone does not mean the experiment directory is empty.

## Recovered historical archive

The [research-archive-v13 release](https://github.com/8tk8m2kv9f-lang/GH0ST/releases/tag/research-archive-v13) contains the uploaded archive below. This is the saved historical snapshot through the first Falcon six-bit optimization study, not a bundle of every subsequent branch.

| Field | Recorded value |
| --- | --- |
| Archive | `GH0ST-recovered-experiments-v13.zip` |
| Size | 216,479,111 bytes |
| Contents | 4,828 files, including 4,552 binary weight/checkpoint artifacts |
| Preserved root directory | `lfm-robinhood-benchmark/` |
| SHA-256 | `44fee2c717891e06c546908056eacb6f3044b3be09e7baf665059a07ce4317b7` |

[Download the archive](https://github.com/8tk8m2kv9f-lang/GH0ST/releases/download/research-archive-v13/GH0ST-recovered-experiments-v13.zip) · [Binary size/hash inventory](../binary-artifacts.json)

Verify the downloaded file's SHA-256 before extracting it into a separate directory. Do not extract over a running experiment or treat the release's older status text as the status of later runtime work.

## Where each kind of artifact belongs

| Artifact | Authoritative entry point | Availability boundary |
| --- | --- | --- |
| Historical `.bin` and `.safetensors` files | [Binary inventory](../binary-artifacts.json) and release above | The inventory describes the recovered archive, not all newer exports |
| Selected Falcon checkpoint identity | [Selected model](../selected-model.json) | Follow the pinned upstream revision and applicable model terms |
| Selected four-bit format and export preparation | [Four-bit reproduction](../falcon-agent/fourbit-study/README.md#reproduce) | Preparation requires the matching source checkpoint and study dependencies |
| Falcon runtime reference traces and local tests | [Runtime reproduction](../falcon-agent/runtime/README.md#reproduce) | Read artifact prerequisites before running the harness |
| Public deployment identities | [Weight manifest](../falcon-agent/fourbit-study/mainnet/deployment-manifest.json), [runtime receipt](../falcon-agent/runtime/mainnet-runtime.json) | A deployment receipt is distinct from a completed inference receipt |
| S0UL checkpoints and evaluation artifacts | [S0UL training guide](https://github.com/8tk8m2kv9f-lang/GH0ST/blob/research/GH0ST-S0UL-1M/s0ul-1m/TRAINING.md) | Workflow artifacts have retention limits; use the exact run and manifest |
| Qwen exports and publication evidence | [Qwen calldata guide](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen3-30b-budget/qwen3-calldata) | Committed proofs establish integrity; retrieval and availability are separate concerns |

## Record enough to reproduce a result

Keep the source commit, upstream revision, artifact hashes, dependency versions, compiler settings, workload and raw report together. Record whether a result comes from a CPU reference, local EVM, modelled estimate or public receipt. Compare candidates against the same baseline and inputs.

Generate new results in a separate output location. Preserve the original report when a new measurement supersedes it. For setup problems, include the exact command, commit and missing artifact in an issue; do not substitute unrelated weights or create placeholder checkpoints.

## Unrecovered history

The later historical six-bit rounds and final 50-experiment series are explicitly absent from the recovered snapshot. Their source and raw results cannot be reconstructed from the written claims alone. [Recovery status](../RECOVERY-STATUS.md) remains the record of this limitation; restoring the original archive or source is required to close it.
