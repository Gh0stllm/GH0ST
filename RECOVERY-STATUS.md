# Recovery status

Project name: **GH0ST**.

**Subsequent work:** `falcon-agent/gas-refinement/` contains new experiments performed after recovery. The pinned public Falcon checkpoint was downloaded and verified, and the selected six-bit export was regenerated with its original SHA-256 and all compact tensor hashes matching. This restores the underlying weight data for new measurements; it does not restore the missing historical optimization code or run records.

This publication recovers the saved `LFM-Robinhood-Benchmark.zip` snapshot, version 13, last saved on **2026-10-20 at 06:46:56 UTC**. The ZIP integrity check passed. Its 4,828 files include 276 non-weight files and 4,552 `.bin` / `.safetensors` artifacts. The Git tree preserves the non-weight files and adds publication documentation plus a hash inventory of the binary files.

## Included

- Historical LFM reference, Solidity, first-block, compiled-weight, Rust/Wasm and chain-comparison experiments.
- Stopped distillation pilots and their saved checkpoints.
- FLAN-T5 baseline.
- Falcon model selection, CPU quality tests, agent controller with scripted integration fixtures, quantization, deployment modeling, and lossless research.
- The first exact six-bit optimization study, including the all-matrix result files.

## Missing from this snapshot

The later six-bit optimization rounds and the final 50-experiment series were discussed and prepared after this saved snapshot, but their source files and raw results were no longer available in the working directory during publication. They were not recovered from this archive and must not be inferred to be present.

The newest reported numbers are deliberately not substituted for the historical result files. Restoring the later project ZIP or original source directory is necessary to complete the requested publication of all experiments.

## Verification performed for publication

- ZIP integrity verification.
- SHA-256 inventory of all binary artifacts omitted from the Git tree.
- Source-tree scan for common credential patterns; no candidates were found.
- No benchmark reruns, new chain deployments, or new model-quality evaluations are claimed.

Archive SHA-256: `44fee2c717891e06c546908056eacb6f3044b3be09e7baf665059a07ce4317b7`.
