<p align="center"><img src="docs/assets/gh0st-banner.svg" alt="GH0ST — model weights in contracts, inference in Solidity"></p>

# GH0ST

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

## S0UL on Robinhood Chain mainnet

The **984,192-parameter S0UL model is deployed on chain 4663**: 48 weight-data contracts, a model registry, tokenizer and Solidity inference engine, **51 contracts in total**. The deployment CLI checked every creation transaction and runtime against the verified build and all 48 shard hashes against the model export. [Deployment receipts and identities](s0ul-1m/deployments/robinhood-mainnet.json) · [Deployment details](s0ul-1m/FULL-SOLIDITY.md#robinhood-chain-mainnet-deployment).

| Contract | Mainnet address |
| --- | --- |
| Inference engine | `0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650` |
| Model registry | `0xa62C2d6fbba575732AAB38c56fCd73B2361B1D98` |
| Tokenizer | `0x3Cf3739D8e587C3AB5706fd459e75A6fCE26d333` |
| Agent controller | `0x9F92776e33087DCF0d77b9BE23145efAC6cE695D` |

Deployment used **257,254,365 gas** and paid **0.005238250757104 ETH** across the 51 creation receipts. A separate read-only check confirmed those receipts, tokenizer output and a simulated `beginText` call. [Receipt, fee and smoke-check report](s0ul-1m/reports/robinhood-mainnet-deployment-check.json).

**Real mainnet generation completed:** request `1` turned `Wait.` into `WAIT`, EOS (`[268, 2]`) using **398 successful transactions**, **892,989,640 gas** and **0.018193921167636 ETH**, with no failed transactions or saturation. An independent read-only checker confirmed all receipts and reread **1,024/1,024 logits** from the two on-chain decision states; every value matched the Python integer reference exactly. [Mainnet generation journal](s0ul-1m/deployments/robinhood-mainnet-generation.json) · [Independent verification and fees](s0ul-1m/reports/robinhood-mainnet-inference-check.json).

The registry, tokenizer and inference engine are source verified on Sourcify with exact creation and runtime matches. [Inference engine source](https://repo.sourcify.dev/4663/0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650) · [Verification evidence](s0ul-1m/reports/robinhood-mainnet-verification/sourcify-verification-status.json).

**Bounded agent live:** request `2` turned `theme=dark` into `MEM_SET|theme|dark`, EOS and saved the preference in its owner's on-chain memory. Independent verification confirmed **2,560/2,560 historical logits**, all receipts and the resulting memory. Four-step batches completed the remaining 423 engine steps in 108 transactions; the mixed direct/batched run used 409 inference transactions. The controller provides memory, tasks and balance reads, with explicit write intent enforced by the CLI. [Agent guide and costs](s0ul-1m/AGENT.md) · [Complete execution proof](s0ul-1m/reports/robinhood-mainnet-agent-check.json) · [Verified controller source](https://repo.sourcify.dev/4663/0x9F92776e33087DCF0d77b9BE23145efAC6cE695D).

## Verification and measured limits

The selected S0UL checkpoint scores **41.48%** exact correctness on the harder 540-request challenge and **58.06%** on the historical 360-request challenge. These are task-quality results, separate from execution parity.

The earlier local EVM run matched **1,024/1,024 integer logits** for `Wait.` → `WAIT`, EOS, with zero saturation, using **398 transactions and 892,989,640 gas** at 128 rows. These local measurements are preserved separately from the subsequent mainnet receipts and fee evidence above. [Local evidence](s0ul-1m/reports/solidity-inference-ci-128.json).

Historical Falcon/Qwen/Genesis deployment records are preserved as source evidence. The Qwen frontend and publication index are recovered; its original research/backend branch and the complete sub1b campaign are still missing. [Exact recovery boundaries](docs/recovery/RECOVERY.md).

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
