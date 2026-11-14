# GH0ST Forge

[Open Forge](https://gh0st.fyi/forge/) · [Synapse foundation](../synapse/README.md)

Train a small numerical classifier in your browser, inspect its measured results, export it, and deploy one immutable model from your wallet on Robinhood Chain. Uploaded CSV rows stay on your device. Creation is free in this first release; a creator pays native network gas for their own deployment and can optionally charge GH0ST to record a prediction. Public read-only predictions remain available without a module payment.

## Creator flow

1. Load the explicitly generated NPC dataset or import a numeric CSV.
2. Train for a fixed number of epochs in a cancellable worker.
3. Inspect quantized held-out accuracy, majority and single-rule baselines, a confusion matrix, and exact integer prediction traces.
4. Download the model JSON, dataset CSV, standalone inference replay, Solidity source or compiled artifact.
5. Connect a compatible direct-deployment Ethereum wallet, review a fresh gas estimate and confirm its Robinhood Chain transaction.
6. Export the updated model package with its deployment transaction. Reopen it to verify the contract, query predictions, approve an exact optional fee, record a result or withdraw accrued credits.

This release supports one fixed numerical architecture: one to eight inputs, one hidden layer of up to sixteen neurons, and two to four output classes. It does not import arbitrary model architectures or train language models. The model is immutable after deployment and has no administrator or upgrade setter. Its creator is the fixed fee beneficiary.

## What reuses Synapse

Forge carries forward [Synapse](../synapse/contracts/v2/SynapseModulesV2.sol)'s Q8 signed integer inference, bounded activations, STOP-prefixed bytecode weight storage, lowest-index ties, exact token balance checks and pull-based beneficiary credits. The [ForgeModel runtime](contracts/ForgeModel.sol) specializes those patterns for numerical vectors. It uses the same pinned compiler/toolchain and GH0ST payment token. It deploys separately for each creator; it does not change or spend from existing Synapse contracts.

GH0ST on Robinhood Chain (`4663`): `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. The browser pins its runtime hash and 18 decimals before financial actions. Network gas is paid in ETH. No global factory, treasury top-up, ICP upgrade or funded project-wallet transaction is required to publish this creator interface. The numerical training service is the browser worker, not an existing ICP canister.

## Data and evaluation

CSV limits are 2 MB and 5,000 rows; use finite numerical features and a short class label. The default generated example has 360 rows and four inputs. Exact input duplicates remain grouped. Normalization is fitted only to training rows. Validation/test inputs that collapse to a Q8 vector in an earlier partition are excluded, and insufficient independent holdouts are rejected. Scores are calculated from the final quantized weights on the retained holdout, with both baselines fitted only on training rows. See [training details](training/README.md).

An imported model's hashes and deployed computation can be verified. Its reported accuracy cannot be independently reconstructed without the omitted dataset; the interface hides imported scores rather than presenting them as a newly measured evaluation. Published weights are inspectable and copyable. A recorded-prediction fee applies to use of the paid entry point.

## Reproduce

Node.js 24 and Python 3:

```sh
npm ci
npm test
npm run test:frontend
npm run build
python3 -m http.server 4181 --directory frontend/dist
```

Open `http://127.0.0.1:4181/forge/`. The hosted product needs no local installation. This command is for developers reproducing the build.

## Verification evidence

- Eleven training/worker checks cover CSV parsing, grouping, train-only normalization, Q8 leakage, reproducible weights, arithmetic, limits and cancellation.
- [Runtime report](runtime/test-report.json): 44 independent Python/EVM hidden/logit/class comparisons and 36 constructor, quote, accounting and adversarial checks on an isolated chain.
- [Training-to-runtime integration](results/training-to-runtime.json): the generated dataset is actually trained, exported, deployed to an isolated EVM, and all 54 final held-out traces match. The default 100-epoch run measured 46/54 (85.19%), versus 33.33% majority and 57.41% single-rule baselines. These are synthetic-example measurements.
- Frontend unit, isolated wallet/EVM and actual production-bundle DOM checks cover training, exports, gas estimates, creator deployment, exact approvals, recorded predictions, withdrawal and pending recovery. Their reports explicitly record zero public transactions.

The browser verifies official creation bytecode and exact constructor arguments before enabling model payments, along with runtime code, repeated immutable fields, weight-shard bytes, schema/model identities, token binding, fee and exact prediction traces. Missing creation provenance permits read queries only. Each financial step requires its own wallet action; unresolved hashes block new sends.

Simulation receipts, browser-local outputs, gas estimates, creator deployments and public chain confirmations are separate evidence. The website publication does not establish that a user has deployed a Forge model on mainnet.
