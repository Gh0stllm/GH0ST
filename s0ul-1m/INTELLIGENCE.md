# S0UL Intel: chain-native observations

**Status: deployed on Robinhood Chain mainnet (chain ID 4663).** Three contracts,
three registered subjects and six paid observation reports are confirmed in the
deployment journal. The original S0UL agent and its 984,192-parameter language
model remain unchanged. This is a bounded observation MVP; it does not provide
autonomous scheduling, freeform research, trading predictions or contract audits.

S0UL Intel reads registered contracts on the same chain, retains observations,
calculates changes, runs an independent numeric model, and renders factual
reports in Solidity. Live measurements, features, classifications and report
text are not supplied by an indexer, external model, API, oracle or transaction
caller. Public RPC is a transport for reading the contracts and submitting
transactions; it is not an analytics source.

## Mainnet deployment and launch evidence

The deployment completed on **2026-10-22**. Exact transaction receipts, deployed
runtime hashes, constructor arguments and artifact identities are recorded in
[`deployments/robinhood-mainnet-intel.json`](deployments/robinhood-mainnet-intel.json).
The journal is complete and has no unresolved transaction. The reviewed build
fingerprint is `2c1515d43c2fd0ac252172b7a69e7850c23bafe3b7da380166fde40c03b2e132`.

| Contract | Mainnet address | Deployment transaction |
| --- | --- | --- |
| Numeric model | `0x9329833849A0938647217D1e42A1199d174Cf8c0` | `0x97268004da8c6368e37b54d7dd426e6c6923f56f6f013685a9c67bca24fa896d` |
| Observations | `0x291b579580304337358114a855085A35354a0D3F` | `0xbe0aaf81d69bede6b63979f979ceb6a6f46149c1894d884391ab696330067167` |
| Reports | `0x02B2B80d7c3753d5E4aF3B8C94180FB0b3Fb3760` | `0x7c53cb1739bbbbe2a2c0b83dee96e3d06e206990663e3b63677b4ab5044264f5` |

The registry owner is `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`.
The public read transport is `https://rpc.mainnet.chain.robinhood.com`.
Launch subjects and their retained report evidence are:

| Subject ID | Registered source | Baseline report | Comparison report | Actual comparison window |
| --- | --- | ---: | ---: | ---: |
| 1 | GH0ST total supply, target `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559` | 1 | 4 | 112 seconds |
| 2 | Same GH0ST target; watched account is the public deployer above | 2 | 5 | 157 seconds |
| 3 | Raphael RAPH/WETH pool, target `0xCC6e395c870E36AEC40ace400c32FD253966415e` | 3 | 6 | 158 seconds |

Reports **1–3** correctly returned label **5**, insufficient comparable history,
for each first snapshot. Reports **4–6** returned label **0**, routine
observation: the observed supply, watched balance, pool reserves and LP supply
were unchanged between the respective stored samples. These are actual
observations, not a forecast or an accuracy benchmark. The pool source is
**RAPH/WETH**, not a GH0ST pool.

[`reports/intel-mainnet-proof.json`](reports/intel-mainnet-proof.json) retains all
six transaction hashes and receipts, raw snapshots, feature vectors, integer
scores, observation commitments and Solidity-rendered commentary. Runtime
identity and getter checks establish the deployed build used by this run;
receipt block numbers/hashes identify its Robinhood transaction blocks. They do
not turn the snapshot's EVM block counter or `BLOCKHASH` output into a canonical
ancestry or finality proof; the distinction is detailed below.

The twelve successful launch transactions—three deployments, three subject
registrations and six capture/report calls—spent **164,999,379,704,000 wei
(0.000164999379704 ETH)** in total. Deployment and registration accounted for
93,188,673,840,000 wei; the six reports accounted for 71,810,705,864,000 wei.
The cumulative authorization ceiling was 0.001 ETH. These are receipt costs for
this completed run, not estimates for future tasks. This record establishes the
contract launch; frontend publication is tracked separately.

## Runtime

| Contract | Responsibility |
| --- | --- |
| [`S0ULObservations`](contracts/intel/S0ULObservations.sol) | Fixed-getter readers, code-pinned subject registry, bounded snapshots and feature calculations |
| [`S0ULIntelModel`](contracts/intel/S0ULIntelModel.sol) | Independent 25-parameter integer observation router |
| [`S0ULIntelReports`](contracts/intel/S0ULIntelReports.sol) | Bind real input frames to model results, retain evidence and render report strings on-chain |
| [`S0ULIntelTypes`](contracts/intel/S0ULIntelTypes.sol) | Explicit reader, snapshot, feature and quality definitions |

The normal write interfaces accept only a registered subject ID and, for
analysis, a lookback of 1–15 samples:

```solidity
observations.snapshot(subjectId);
reports.analyze(subjectId, lookback);
reports.captureAndAnalyze(subjectId, lookback);
```

`snapshot` reads the target itself. `analyze` uses retained observations.
`captureAndAnalyze` atomically captures a new observation and publishes its
analysis; a failure rolls back the combined operation. The report controller
does not accept an arbitrary price, feature vector, label, score or report text.
The model's public pure `classify` method can evaluate a supplied vector, but
only controller-bound reports attest to an actual observation frame.

Anyone may pay gas to capture or analyse an enabled subject. Contracts do not
start themselves on a timer. This version has no scheduler reward, autonomous
funding mechanism, trading function or asset-transfer authority.

## Sources and registry trust

The immutable registry owner registers and enables/disables subjects. Registration
selects a reader kind, deployed target, optional watched account and expected
runtime hash. The owner chooses which sources deserve observation; a runtime
hash establishes code identity, not the honesty, economic meaning or safety of
that code. Existing subject targets, account identities and code pins cannot be
edited through the registry API.

| Reader | Fixed getters | Recorded raw values |
| --- | --- | --- |
| ERC20 supply | `totalSupply()` | Supply |
| ERC20 watched balance | `totalSupply()`, `balanceOf(registeredAccount)` | Account balance and supply |
| V2-style pool | `token0()`, `token1()`, `getReserves()`, `totalSupply()` | Token0 reserve, token1 reserve, LP-token supply and pool reserve timestamp |

Calls use `STATICCALL`, a fixed 50,000-gas allowance, bounded return copying and
exact return-size checks. Malformed, reverting, oversized or unsupported getter
results do not enter history. Token values must fit `uint128`; reserves must fit
their V2 `uint112` encoding. A watched balance greater than reported supply is
rejected. Pool asset identities are checked against registration.

Target code hashes are checked before sampling and before permitting a new
report. Reports additionally pin the observation contract, classifier bytecode,
model ID, training manifest and chain identity. A proxy runtime pin does **not**
pin a hidden implementation or its upgrade authority; generic proxy-slot
inspection is outside this version.

Read-only candidate discovery is recorded separately in
[`reports/intel-candidates.json`](reports/intel-candidates.json). Candidate evidence
is not a deployment journal or proof that a subject was registered.

## History, units and quality

Each subject retains a **16-snapshot ring**. A sample contains its sequence,
timestamp, EVM block counter, raw EVM `BLOCKHASH` output and integer values.
On Nitro, Solidity `block.number` estimates the counter of the first
non-Arbitrum ancestor chain; it differs from the L2 block number in an RPC
transaction receipt. For example, the first supply sample stores counter
**26,246,317**, while its Robinhood receipt has L2 block number **94,899,766**.
Snapshot `blockNumber` and report `observedBlock`/`createdBlock` use the EVM
counter. See the official [block numbers and time documentation](https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/block-numbers-and-time).

The existing ABI field `parentBlockHash` is the **EVM `BLOCKHASH` output at EVM
block counter minus one**. Nitro documents this output as a pseudo-random,
cryptographically insecure value that does not come from the parent chain. It
is not a canonical Robinhood L2 parent hash, an ancestor-chain block hash, a
sampling-block hash or a finality proof. The deployment proof separately
retains actual RPC receipt block numbers and block hashes; `currentHash` and
`previousHash` are observation content digests. See the official
[Solidity opcode differences](https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/solidity-support).
These qualifications describe the deployed ABI without changing its names.

The deployed observation contract uses **60-second minimum spacing** and
**3,600-second maximum sample age**, as recorded in its constructor arguments.
The implementation permits spacing of 1–86,400 seconds and a maximum age
between that spacing and 86,400 seconds.

Features are computed from this contract's retained snapshots. Signed relative
changes are truncated in integer basis points and clipped to ±10,000 bps. The
zero-baseline flag marks undefined ordinary percentage comparisons. The model
abstains before scoring if history, freshness or reader quality is missing, or
if a zero baseline is present. Clipped changes remain explicitly flagged.
Freshness applies to the current observation; a retained comparison observation
may be older, and the report preserves that actual comparison window.

The elapsed-time model feature is capped at 86,400 seconds. Actual observation
timestamps and comparison duration are retained in each report, separately from
that model feature; the `uint32` duration saturates only beyond 4,294,967,295
seconds. Elapsed-time capping does not set the BPS-clipping flag.

These measurements have deliberate limits:

- A balance difference does not identify a transfer, sender or recipient.
- Reserve changes are not trading volume. No volume metric is inferred here.
- LP-token supply is not a dollar liquidity valuation.
- The raw `reserve1/reserve0` ratio uses token raw units. It is not automatically
  a quote-token price adjusted for decimals, a USD price, a marginal stable-pool
  price or a TWAP.
- Samples are caller-timed spot observations. Temporary or manipulated on-chain
  states can be sampled; spacing and freshness checks do not make them TWAPs.
- The registry does not scan the whole chain, discover arbitrary new contracts,
  enumerate all token holders or read social/news/web data.

## Model and provenance

The new [Intel model](intel-model/README.md) is an **independent 25-parameter
linear head**, not a fine-tune, continuation, distillation or replacement of
S0UL's 984,192-parameter language model. The original selected language-model
checkpoint is `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`;
that identity is context, not ancestry of the numeric head's learned weights.

The new head was fitted on **8,192 synthetic examples** for 2,200 Adam steps. Its
explicit teacher policy routes the largest eligible absolute observed change
against a **250-bps baseline**. The threshold is a product policy, not a learned
financial-risk threshold. Direction and every numerical fact come from the
stored input frame. The output labels are normal, supply change, watched-balance
change, LP-supply change, reserve-ratio change and insufficient comparable
history. Integer scores are discriminants, not confidence percentages.

The quantized export matched the teacher on all 8,192 training examples,
4,096 independently seeded held-out examples and 291 boundary/quality cases.
Those figures measure synthetic policy recovery only. They establish no market
prediction, profitability, alpha, real-market generalization or security-audit
accuracy. A deterministic rule can implement the same routing policy more
cheaply; this head is a small, reproducible learned-model integration whose
additional execution cost must be measured.

The model exposes these SHA-256-based artifact identities:

| Identity | Value |
| --- | --- |
| Model ID | `033f3bbf93ed8c7465a86389cd01aecb8fa64a582dfd9ff403da7b47fe04cbbd` |
| Training manifest | `06c8d5497bba57f04b6418dd1510711cfe9383450a1464b6d73d9169f9a6c070` |
| Weights | `9c5c068599f09de30b16a8f106476e1912ef78788f0ac5bace887b22f790fd9a` |
| Generated training rows | `d279784dd86802fb1939fd5d7d4db298129179348f141fe8337bc4dc190a3a36` |

Training and export are reproducible predeployment activities. This extension
does not implement on-chain training. All live feature calculations and
inference execute in the contracts.

## Reports and public memory

`report(id)` retains the subject and sample sequences, raw current/previous
values, feature vector, quality flags, integer scores, model identity, input
commitments, observation timestamps, comparison duration and publication
provenance. `latestReport(subjectId)` returns its newest report ID.

Reports keep their stored raw values and comparison window after corresponding
snapshots leave the ring. Input hashes identify committed observations; they
must not be confused with block hashes. The controller deduplicates the same
current/previous input pair and model identity. Failed, stale or disabled source
frames cannot become a new report.

`render(id)` returns the actual commentary string assembled by Solidity from
the stored report. The frontend displays that string and raw evidence. It does
not substitute external research text, invented observations or expected model
output. Reports are factual observations and model routing results, not trading
instructions, forecasts or contract-safety verdicts.

## Operation and validation

From the repository root, the reproducible local checks are:

```sh
python3 s0ul-1m/intel-model/reference.py
node --test s0ul-1m/test/intel-test.mjs
node s0ul-1m/scripts/intel-deploy.mjs compile
node s0ul-1m/scripts/intel-deploy.mjs plan --subjects gh0st,pool
```

`compile` writes reviewed build artifacts and a build fingerprint. `plan` reads
the public chain and executes deployment, registration and sample transactions
only in a local Ganache fork. Its predicted addresses and locally funded balance
are not evidence of a mainnet deployment. The plan is saved to
[`reports/intel-deploy-plan.json`](reports/intel-deploy-plan.json).

The write command has explicit chain, cumulative fee cap and build identity:

```sh
node s0ul-1m/scripts/intel-deploy.mjs deploy --subjects gh0st,pool \
  --chain 4663 --cap-wei APPROVED_CAP_WEI --build-hash REVIEWED_BUILD_FINGERPRINT
```

Replace the two uppercase placeholders with reviewed values. Supply the signing
credential as a JSON object containing only `privateKey` through protected,
non-terminal standard input. The command does not accept a signing secret from
an environment variable, file flag or CLI argument. It checks that the signer
matches the registry owner and does not fund the account. The maximum cumulative
fee cap is 1,000,000,000,000,000 wei. Each send reserves 20% gas headroom against
a fee ceiling 50% above the initial live gas price, subject to a 31-million-gas
and live-chain execution cap. The CLI submits legacy transactions at that
accepted fee ceiling to tolerate a moving chain minimum; the journal records
the actual submission gas price, fee reserve and eventual receipt fee. This
does not expand the approved cumulative cap. A persisted unresolved transaction
blocks further sends; `reconcile --hash TRANSACTION_HASH` resolves its exact saved hash before
the original command may resume. Confirmed deployment receipts are saved to
`deployments/robinhood-mainnet-intel.json`; `sample` performs a later paid
observation/report under the same explicit chain, cap and build checks.

Public source-code verification is separate from checking deployed runtime
bytes and getters. Compiler standard input and metadata are prepared, but no
external source-verification submission was completed and no public verified
source status is claimed. The current record is
[`reports/intel-source-verification.json`](reports/intel-source-verification.json).

The independent integer reference covers 419 exact score/label vectors and six
invalid vectors. All **16 contract tests passed**, including all 419 labels and
2,514 raw scores compared with the independent integer vectors. Tests compile
with Solidity 0.8.30, optimizer 200, viaIR and Shanghai, then use an in-process
Ganache chain with chain ID 31337. They make no public-chain transaction and
cannot establish a mainnet deployment.

The full frontend suite passed **64/64 tests**: 16 Intel checks plus the 48
existing S0UL page, character, wallet and gas checks. These tests cover verified
read-RPC chain identity, all deployment/model pins, actual decoded report tuples,
exact action calldata, fresh quotes, consent, budget reserves and durable
transaction recovery. The tests use in-process provider/wallet mocks, make no
network request and submit no public transaction. Browser checks and mainnet
receipts are separate evidence.

| Module or evidence | Record |
| --- | --- |
| Intel wallet/read client | [`website/s0ul-intel.mjs`](../website/s0ul-intel.mjs) |
| Intel frontend tests | [`frontend-tests/intel.test.mjs`](../frontend-tests/intel.test.mjs) |
| 64-test frontend validation | [`frontend-tests/intel-validation.json`](../frontend-tests/intel-validation.json) |
| 16 contract tests and gas measurements | [`test/intel-test.mjs`](test/intel-test.mjs) |
| Numeric-head training and limits | [`intel-model/training-report.json`](intel-model/training-report.json) |
| Independent integer evaluator | [`intel-model/reference.py`](intel-model/reference.py) |
| Exact integer parity vectors | [`intel-model/parity-vectors.json`](intel-model/parity-vectors.json) |

The test command prints a `s0ul-intel-local-gas-v1` measurement record. Recorded
gas includes transaction intrinsic gas where applicable:

| Local operation | Gas |
| --- | ---: |
| Supply snapshot | 138,222 |
| Watched-balance snapshot | 141,176 |
| V2-pool snapshot | 150,878 |
| Numeric head: normal / pool / abstention | 32,864 / 35,381 / 25,883 |
| Atomic baseline capture and report | 587,971 |
| Atomic trend capture and report | 617,428 |
| Report rendering estimate | 49,988 |

These are workload-specific local measurements, not Robinhood Chain receipts
or a quoted ETH cost. An ordinary read-only RPC call to `render` does not submit
a paid transaction. Live deployment and user actions still require their own
fresh estimates.

The targeted review fixed a reporting defect before deployment: an elapsed-time
feature cap previously shared the BPS-clipping flag, causing a false percentage
clipping caveat on long comparison windows. Time capping and relative-change
clipping now have distinct semantics, with a regression test for a two-day
comparison. Reports also preserve their actual comparison timestamps/duration.

The frontend module verifies deployment code/model pins, reads public records
without a wallet and requires a connected Robinhood Chain wallet for writes.
Each concrete action receives a fresh gas estimate, 20% gas headroom, a fee
ceiling 50% above the quoted gas price, explicit single-action fee-limit review
and wallet confirmation. Quotes expire after 45 seconds. The frontend adds up
to 10% gas-price headroom at submission, capped at the accepted fee ceiling;
the displayed estimated fee includes this submission margin, while the maximum
reserve uses the padded gas limit and accepted ceiling. State, identity,
freshness, gas and fees are checked again before sending. This browser limit
is not an on-chain restriction and a wallet can change transaction parameters.
No model weights, gas limit or stored evidence requires a private key in public
frontend configuration. Deployment signing material belongs only in protected
standard input to the deployment process, never source, CLI arguments or public
files.

Future deployment or configuration changes must retain compiled artifact
identities and exact receipts/code pins. The original S0UL contracts and
language-model deployment remain untouched by this extension.
