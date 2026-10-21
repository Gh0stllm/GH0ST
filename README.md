<p align="center"><img src="docs/assets/gh0st-banner.svg" alt="GH0ST — model weights in contracts, inference in Solidity"></p>

# GH0ST

> **Migration in progress.** Files are being restored individually. Some weight/checkpoint files and other assets are not yet uploaded; the recovery inventory describes the available backup, not a completed remote migration. Original Git history remains preserved in the backup and has not been imported here.

Research into language models and agents with weights, inference and execution records on-chain. This recovery combines the surviving research Git history, model artifacts, verified S0UL runtime, website and Genesis collection from the project's separate workspaces and saved files.

[Research index](docs/RESEARCH.md) · [Repository map](docs/REPOSITORY-MAP.md) · [Recovery record](docs/recovery/RECOVERY.md) · [Website](website/) · [Contributing](CONTRIBUTING.md)

## Recovered work

| Area | Source and evidence |
| --- | --- |
| Falcon-H1-Tiny research | [Model/runtime and deployment studies](falcon-agent/) |
| S0UL-1M | [984,192-parameter model and training](s0ul-1m/) · [Complete Solidity inference](s0ul-1m/FULL-SOLIDITY.md) |
| Completed 20-lane campaign | [Final results and predictions](s0ul-1m/reports/hard-max-39630021281/SUMMARY.md) · [Winner and baseline weights](artifacts/s0ul/) |
| Genesis NFT | [Contracts, tests and recorded deployment](genesis/contracts-project/) · [Collection and IPFS records](genesis/) |
| Website and Qwen UI | [Latest recovered published assets](website/) · [Qwen archive index](website/qwen/) |
| Research paper and media | [Recovered original files](assets/recovered/) |
| Earlier experiments | [Results](results/) · LFM, distillation, FLAN and Stylus folders retained at their original paths |

## Verification and measured limits

The selected S0UL checkpoint scores **41.48%** exact correctness on the harder 540-request challenge and **58.06%** on the historical 360-request challenge. These are task-quality results, separate from execution parity.

Complete trained S0UL Solidity inference matched **1,024/1,024 integer logits** for `Wait.` → `WAIT`, EOS, with zero saturation. The 128-row run used **398 transactions and 892,989,640 gas**. It is a local EVM measurement; no public S0UL deployment is claimed. [Raw evidence](s0ul-1m/reports/solidity-inference-ci-128.json).

Historical Falcon/Qwen/Genesis deployment records are preserved as source evidence. This restoration does not deploy contracts, move funds, mint NFTs or change any live website. The Qwen frontend and publication index are recovered; its original research/backend branch and the complete sub1b campaign are still missing. [Exact recovery boundaries](docs/recovery/RECOVERY.md).

## Reproduce

```bash
cd s0ul-1m
python -m pip install -e .
npm ci --ignore-scripts --no-audit --no-fund
python -m unittest discover -s tests -p 'test_*.py' -v
```

Trained baseline and winner artifacts are included under `artifacts/s0ul/`. Two older model files exceed GitHub's per-file limit; their verified parts and reconstruction command are documented in the recovery record.

Recovered workflows are manual-only during migration. Their original definitions are preserved in [the workflow archive](docs/recovery/original-workflows/). Old run IDs refer to the previous repository and are historical identifiers.

## Original records

Earlier README versions are preserved in [the recovery documents](docs/recovery/). Research failures, incomplete work and unsupported claims remain identifiable. File provenance and content hashes distinguish recovered bytes from reconstructed documentation.

$GH0ST research-support token: `0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`.

Falcon research uses artificial intelligence technology from the Technology Innovation Institute. [Model-specific licenses](docs/LICENSES.md) remain applicable.
