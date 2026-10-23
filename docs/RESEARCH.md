# Research directory

[Documentation](README.md) · [Repository map](REPOSITORY-MAP.md) · [Results index](RESULTS-INDEX.md) · [Recovery record](recovery/RECOVERY.md)

The recovery staging tree brings the surviving research, website and Genesis files together for `Gh0stllm/GH0ST`. Individual-file restoration to the new repository is **in progress**. The relative links below identify recovered local paths; they do not certify that every file has already been uploaded or that historical branches were restored.

## Recovered tracks

Current research: [approximately 1M-parameter Uniswap v4 hook](../research/v4-hook-1m/README.md), with [status and research gates](../research/v4-hook-1m/STATUS.md). This new local study is separate from the recovered historical tracks below.

| Track | Recovered entry point | Scope |
| --- | --- | --- |
| Falcon inference | [Runtime](../falcon-agent/runtime/README.md) · [four-bit weights](../falcon-agent/fourbit-study/README.md) | Deployed-weight records, fixed-point reference and resumable Solidity inference research |
| GH0ST S0UL-1M | [Model and training](../s0ul-1m/README.md) · [complete Solidity runtime](../s0ul-1m/FULL-SOLIDITY.md) · [20-lane report](../s0ul-1m/reports/hard-max-39630021281/SUMMARY.md) | Experimental 984,192-parameter model, selected checkpoint, measured training results and local integer/Solidity inference evidence |
| Genesis NFT | [Recovery guide](../genesis/README.md) · [contract project](../genesis/contracts-project/) · [recorded deployment](../genesis/contracts-project/deployment/mainnet-deployment.json) | Recovered contracts, tests, collection metadata, artwork and historical deployment evidence |
| Observatory frontend | [Website source](../website/) · [homepage](../website/index.html) · [mint interface](../website/mint/index.html) | Latest surviving saved deployment package; source recovery does not establish current hosting state |
| Qwen frontend assets | [Qwen interface](../website/qwen/index.html) · [archive index](../website/qwen/archive-index.json) · [model metadata](../website/qwen/profile.json) | Partial recovery of frontend, tokenizer and publication-index assets; the original research/backend source is unavailable |
| Models and research artifacts | [Artifact guide](ARTIFACTS.md) · [S0UL checkpoint/export bundles](../artifacts/s0ul/) · [large-file reconstruction](../artifacts/large-files/README.md) | Recovered binary inputs and exports, with hashes and reconstruction instructions |

Earlier LFM, FLAN-T5, compression, distillation and Stylus studies are grouped in the [repository map](REPOSITORY-MAP.md). The [recovery record](recovery/RECOVERY.md) distinguishes recovered bytes from missing material and historical references.

## Inspect S0UL without changing a run

[Build tracker](../s0ul-1m/BUILD-STATUS.md) · [Training and resume guide](../s0ul-1m/TRAINING.md) · [Reports](../s0ul-1m/reports/) · [Saved workflow definitions](../.github/workflows/)

Use the report's campaign, lane, checkpoint hash and timestamp when comparing results. The tracker and reports preserve historical measurements; they do not certify that a job is currently running. Recovered workflows are set to manual dispatch and require reviewed artifact/run references before reuse. Reading these files does not restart training.

## Historical research branches: unavailable

The references in this section identify paths from the original `8tk8m2kv9f-lang/GH0ST` repository. Their original remote branches are unavailable through this recovery, and they have **not** been recreated merely by restoring files to the new repository. Links are retained as provenance, not as working entry points or evidence of completed experiments.

| Original track | Historical reference | Recovery boundary |
| --- | --- | --- |
| Qwen3 calldata and runtime | [`research/qwen3-30b-budget/qwen3-calldata`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen3-30b-budget/qwen3-calldata) | Original research/backend branch unavailable; only the frontend and associated index/metadata assets above were recovered |
| Qwen3 compression | [`research/qwen3-30b-budget/qwen3-compression`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen3-30b-budget/qwen3-compression) | Original compression research branch unavailable |
| Qwen 0.5B study | [`research/qwen-0.5b-onchain/qwen-onchain`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen-0.5b-onchain/qwen-onchain) | Original source and result branch unavailable |
| Sub-billion model campaign | [`research/sub1b-campaign/model-campaign`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-campaign/model-campaign) | Complete 20-model comparison campaign unavailable; do not confuse it with the recovered 20-lane S0UL training campaign |

### Historical twenty-model comparison index

This is the original branch-name index, not a recovered set of experiments. The original [campaign protocol reference](https://github.com/8tk8m2kv9f-lang/GH0ST/blob/research/sub1b-campaign/model-campaign/README.md) and result branches below remain unavailable here. No completion or cross-model capability ranking can be established from their names alone.

| Original model branch | Unavailable historical source/result reference |
| --- | --- |
| `lfm2-350m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-lfm2-350m) |
| `lfm2-700m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-lfm2-700m) |
| `pythia-160m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-pythia-160m) |
| `pythia-410m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-pythia-410m) |
| `qwen2-0.5b` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2-0.5b) |
| `qwen2-0.5b-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2-0.5b-instruct) |
| `qwen2.5-0.5b` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2.5-0.5b) |
| `qwen2.5-0.5b-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2.5-0.5b-instruct) |
| `qwen2.5-coder-0.5b` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2.5-coder-0.5b) |
| `qwen2.5-coder-0.5b-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen2.5-coder-0.5b-instruct) |
| `qwen3-0.6b` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen3-0.6b) |
| `qwen3-0.6b-base` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-qwen3-0.6b-base) |
| `smollm2-135m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm2-135m) |
| `smollm2-135m-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm2-135m-instruct) |
| `smollm2-360m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm2-360m) |
| `smollm2-360m-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm2-360m-instruct) |
| `smollm-135m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm-135m) |
| `smollm-135m-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm-135m-instruct) |
| `smollm-360m` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm-360m) |
| `smollm-360m-instruct` | [Historical reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-smollm-360m-instruct) |

Historical [gas-finalization reference](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-gas-finalization): original branch unavailable.

### Earlier runtime branch references

| Original branch | Purpose and recovery boundary |
| --- | --- |
| [`gh0st-runtime-mainnet-20261020`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/gh0st-runtime-mainnet-20261020) | Historical dated runtime branch; the available source and records are indexed through the recovered [Falcon runtime](../falcon-agent/runtime/README.md), rather than a restored remote branch |
| [`gh0st-prepaid-runtime-20261020`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/gh0st-prepaid-runtime-20261020) | Historical dated prepaid-runtime branch; available prepaid documentation is under the recovered [runtime directory](../falcon-agent/runtime/) |

The pre-restoration version of this directory is preserved in [the documentation snapshot](recovery/pre-individual-upload-docs/docs/RESEARCH.md). The 43 surviving pre-recovery commits remain preserved locally; individual-file uploads do not transfer that Git history.
