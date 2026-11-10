# GH0ST SYNAPSE

A research prototype for composing a tiny neural model from separately deployed Solidity modules. A shared backbone supplies positional embeddings and the language-model head. Two expert contracts process the intermediate activations. An immutable graph combines their outputs and credits module beneficiaries for paid inference.

## Current status

The 894-parameter model is trained on an original synthetic corpus. The local EVM proof passes 63 exact Python/Solidity trace comparisons, 73 paid inference transactions and 16 accounting/security checks. The harness uses an in-memory chain and a mock ERC20. Public deployment is a later milestone.

The model and experts are authored by the GH0ST project. Separate deployment accounts demonstrate different fee recipients. An external contributor integration remains a later milestone.

## Reproduce

Use Node.js 24, Python 3 and the pinned dependency lock. Run these commands from this directory.

```sh
npm ci
npm test
```

The tests compile the modules with Solidity 0.8.30, run the independent Python integer reference, deploy an isolated in-memory Ganache chain, execute paid inference and check every intermediate activation and logit. The chain is closed after the run. An existing sibling GH0ST research dependency installation can also satisfy the exact package versions, which the harness checks before compiling. To retrain the model, install the NumPy version recorded in [model/model.json](model/model.json) and follow [model/README.md](model/README.md).

## Measured local result

| Measurement | Result |
| --- | --- |
| Exact intermediate/output comparisons | 63 of 63 |
| Paid inference transactions | 73 |
| Accounting and adversarial checks | 16 |
| Core deployment, including mock token | 4,038,301 gas |
| Fixture inference | 386,378 to 472,041 gas per token |
| Fixture inference mean | 389,228.92 gas per token |

The default greedy sequence through its first end token is `ghost runs inference on icp`. That text is a generated synthetic-corpus sample. It describes the corpus topic, while this proof's model computation executes in the local EVM.

Replacing only expert 1 changes `ghost checks → proof` into `ghost checks → models`. Both graphs use the same backbone and expert 0. The replacement is a trained change of behavior, with no general quality improvement claim.

Each paid call credits 1, 2 and 3 test tokens to the backbone, expert 0 and expert 1 beneficiaries respectively. These illustrative fees are test settings. Credits are verified against exact payer/escrow balance changes, then withdrawn by the recipients.

The security checks cover invalid contexts, deadlines, price caps, wrong graph IDs, taxed transfers, reentrancy callbacks, rejected foreign kernels, a forged canonical kernel with invalid initialization, withdrawal rollback and repeated beneficiaries. Source/artifact hashes and local transaction evidence are in [results/local-report.json](results/local-report.json), [results/gas-report.json](results/gas-report.json) and [results/receipts.json](results/receipts.json). These receipts and gas measurements come from the local simulator.

## Architecture

- [SynapseModules.sol](contracts/SynapseModules.sol) stores signed int16 weights in immutable bytecode shards and runs the Q8 embedding, expert and projection operations.
- [SynapseGraph.sol](contracts/SynapseGraph.sol) composes one backbone and two compatible experts, selects the next token and accounts for exact ERC20 payments.
- [reference.py](model/reference.py) independently computes every intermediate activation and logit with matching signed integer division.

The v1 graph accepts the specific published neural kernels. Contributors can publish new weights against the same backbone representation. Tensor dimensions alone do not demonstrate useful compatibility. Module quality must be measured against the resulting model.

The payment token is fixed when a graph is deployed. Robinhood's GH0ST token is `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. The local proof uses a mock token. Module prices and recipients are fixed, fees are credited only after successful computation and exact funding, and beneficiaries withdraw their credits separately. Public weights can be copied, so payment accounting applies to use through a paid graph.

## Research scope

This is a small two-token-context neural language model with a 30-token vocabulary. The reported accuracy concerns its synthetic training corpus. A new expert and a new graph can demonstrate a different output while preserving the backbone.

Existing relevant work includes [Microsoft's onchain model training](https://github.com/microsoft/0xDeCA10B), [Zirconium's composable neural proofs](https://ethglobal.com/showcase/zirconium-3632e), [SMART's inference framework](https://huangjunqin.com/assets/pdf/HuangWWW2024Advancing.pdf), and [ML2SC's Solidity neural-network generation](https://arxiv.org/abs/2404.16967). The research question here concerns actual EVM tensor computation across separately published weight modules with atomic payment accounting. Global novelty remains unestablished.
