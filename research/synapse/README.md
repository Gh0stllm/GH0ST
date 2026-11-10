# GH0ST SYNAPSE

A research prototype for composing a neural model from separately deployed Solidity modules. A shared backbone supplies positional embeddings and the language-model head. Two expert contracts process the intermediate activations. An immutable graph combines their outputs and credits module beneficiaries for paid inference.

## Current status

SYNAPSE is live on Robinhood mainnet at [gh0st.fyi/synapse](https://gh0st.fyi/synapse/). The selected [domain V2 model](candidates/domain/README.md) has 22,720 parameters, a 128-word vocabulary and four-token context. Its weights run directly in the [V2 Solidity modules](contracts/v2/SynapseModulesV2.sol), including two bounded bytecode shards for the shared backbone.

All nine release transactions and all 52 live Python/EVM reference traces are verified. The paid example `the expert reads` returns token 25, `context`; the alternate expert returns `tokens` in free preview. Paid inference costs six GH0ST per next token plus network gas. Public read-only previews require no wallet or module payment. In the release smoke test, six GH0ST was credited and withdrawn back to the same project wallet, leaving zero allowance, escrow balance and credits. Total deployment and smoke-test network fees were 0.000370609438888 ETH. [Public deployment](deployments/robinhood-mainnet.json) and [canonical receipts, traces and payment evidence](results/v2/robinhood-mainnet-verification.json) record the live result.

V2 also passes 65 paid simulated inferences and 32 accounting/security checks. Fixture inference uses 1,331,016 to 1,417,003 gas in simulation; the live paid example used 1,364,214 gas. The canonical GH0ST token fork passed all 52 reference traces and the exact six-GH0ST approve/infer/withdraw flow before mainnet release. [Local V2 evidence](results/v2/local-report.json), [fork evidence](results/v2/robinhood-fork-report.json) and [deployment/signing instructions](deploy/README.md) distinguish those runs from mainnet receipts.

The preserved V1 proof uses an 894-parameter model and passes 63 exact Python/Solidity trace comparisons, 73 paid inference transactions and 16 accounting/security checks. Its harness uses an in-memory chain and a mock ERC20. The measured V1 results below remain a record of that first proof.

The model and experts are authored by the GH0ST project. The initial mainnet V2 configuration directs all three module fees to the same sponsor beneficiary. Separate accounts in the local tests demonstrate distinct fee recipients; they do not establish independent authorship. An external contributor integration remains a later milestone.

## Reproduce

Use Node.js 24, Python 3 and the pinned dependency lock. Run these commands from this directory.

```sh
npm ci
npm run test:v2
```

The V2 tests compile the modules with Solidity 0.8.30, run the independent Python integer reference, deploy an isolated in-memory Ganache chain, execute paid inference and check every intermediate activation and logit. The chain is closed after the run. An existing sibling GH0ST research dependency installation can also satisfy the exact package versions, which the harness checks before compiling. [Domain V2 training instructions](candidates/domain/README.md) describe its synthetic corpus and held-out measurements. The original V1 reproduction remains available through `npm test`.

## Preserved local V1 result

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

- [SynapseModulesV2.sol](contracts/v2/SynapseModulesV2.sol) stores signed int16 weights in immutable bytecode shards and runs the Q8 embedding, expert and projection operations.
- [SynapseGraphV2.sol](contracts/v2/SynapseGraphV2.sol) composes one backbone and two compatible experts, selects the next token and accounts for exact ERC20 payments.
- [reference.py](candidates/domain/reference.py) independently computes every intermediate activation and logit with matching signed integer division.

The graphs accept the specific published neural kernels. Contributors can publish new weights against the same backbone representation. Tensor dimensions alone do not demonstrate useful compatibility. Module quality must be measured against the resulting model.

The payment token is fixed when a graph is deployed. Robinhood's GH0ST token is `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. The local proof uses a mock token. Module prices and recipients are fixed, fees are credited only after successful computation and exact funding, and beneficiaries withdraw their credits separately. Public weights can be copied, so payment accounting applies to use through a paid graph.

## Research scope

The selected V2 model has 22,720 parameters, a four-token context and a 128-word vocabulary. Its reported training and held-out measurements concern an authored synthetic corpus with shared grammar and vocabulary; they do not establish broad language understanding or general reasoning. The preserved V1 model has a two-token context and 30-token vocabulary. A new expert and a new graph can demonstrate a different output while preserving the matching backbone, without establishing a general quality improvement.

Existing relevant work includes [Microsoft's onchain model training](https://github.com/microsoft/0xDeCA10B), [Zirconium's composable neural proofs](https://ethglobal.com/showcase/zirconium-3632e), [SMART's inference framework](https://huangjunqin.com/assets/pdf/HuangWWW2024Advancing.pdf), and [ML2SC's Solidity neural-network generation](https://arxiv.org/abs/2404.16967). The research question here concerns actual EVM tensor computation across separately published weight modules with atomic payment accounting. Global novelty remains unestablished.
