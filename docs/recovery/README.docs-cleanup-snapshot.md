<p align="center">
  <img src="docs/assets/gh0st-banner.svg" alt="GH0ST — on-chain intelligence research, with the cyan [0_0] ghost" width="100%">
</p>

<p align="center">
  <a href="docs/GETTING-STARTED.md"><strong>Start here</strong></a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/RESEARCH.md">Research</a> ·
  <a href="docs/RESULTS-INDEX.md">Results</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://gh0st-observatory.netlify.app/">Observatory</a>
</p>

# GH0ST

**Language-model weights, verifiable computation and agent research on Robinhood Chain.**

GH0ST explores how language models can execute through smart contracts: from packed model weights and resumable Solidity inference to authenticated calldata and compact models designed for agent tasks. Source, measurements and historical experiments are published together so each claim can be traced to evidence.

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute. Upstream model terms and attribution remain attached to the relevant work.

## Explore the project

| Track | What to explore | Entry point |
| --- | --- | --- |
| **Falcon inference** | Contract-resident weights, integer kernels, resumable token generation and prepaid execution | [Architecture](docs/ARCHITECTURE.md) · [runtime](falcon-agent/runtime/README.md) |
| **GH0ST S0UL-1M** | Experimental 984,192-parameter model for short instructions and typed agent proposals | [Research branch](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/GH0ST-S0UL-1M/s0ul-1m) · [build tracker](https://github.com/8tk8m2kv9f-lang/GH0ST/blob/research/GH0ST-S0UL-1M/s0ul-1m/BUILD-STATUS.md) |
| **Qwen3 calldata** | Authenticated weight publication and inference with supplied weight proofs | [Calldata and runtime](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen3-30b-budget/qwen3-calldata) · [compression study](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/qwen3-30b-budget/qwen3-compression) |
| **Model comparison** | Twenty pinned small-model checkpoints, quantization and reproducible measurements | [Campaign](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/sub1b-campaign/model-campaign) · [all research branches](docs/RESEARCH.md) |

[Genesis NFT](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/feature/genesis-burn-to-mint/genesis-nft) · [Frontend source](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/frontend/observatory-v1) · [Historical studies](docs/REPOSITORY-MAP.md#research-and-benchmarks)

## Start with the evidence

| Question | Read |
| --- | --- |
| How does the computation work? | [Architecture](docs/ARCHITECTURE.md) and [request lifecycle](docs/REQUEST-LIFECYCLE.md) |
| What has been measured or deployed? | [Evidence and costs](docs/EVIDENCE.md) and [results index](docs/RESULTS-INDEX.md) |
| Where is the code for each part? | [Repository map](docs/REPOSITORY-MAP.md) |
| How do I set up a separate research environment? | [Getting started](docs/GETTING-STARTED.md) and [artifact guide](docs/ARTIFACTS.md) |
| What is still missing or incomplete? | [Known gaps](docs/KNOWN-GAPS.md) and [FAQ](docs/FAQ.md) |

The **20 October Falcon snapshot** records 495 weight shards, a kernel, an index and a runtime: **498 active-stack contracts**, or **500 including two historical pilots**. Its local prepaid chat test produced **“Hello!” from “Hi”**, with **288/288 layer checkpoints matching**. Deployment receipts, local inference and a paid public response are distinct milestones. [Inspect the evidence](docs/EVIDENCE.md).

Newer branches carry their own reports and timestamps. This page is a navigation hub, not a live training monitor or an aggregate count of every later deployment.

## Contribute

Ideas, focused fixes and reproducible experiments are welcome. Start with the [contribution guide](CONTRIBUTING.md), [suggest an improvement](https://github.com/8tk8m2kv9f-lang/GH0ST/issues/new/choose), or browse [open pull requests](https://github.com/8tk8m2kv9f-lang/GH0ST/pulls). Use the [security policy](SECURITY.md) for sensitive findings.

**$GH0ST · Research-support token**

Token contract: `0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`

[License and attribution guide](docs/LICENSES.md) · [Recovered archive](docs/ARTIFACTS.md#recovered-historical-archive)

---

<details>
<summary><strong>Preserved project record — original overview, milestones and research index</strong></summary>

The complete previous README is retained below, including its original artwork and historical measurements. Its dated statements describe their own snapshot; use the research directory for subsequent branches.

<!-- GH0ST reading guide: additive introduction; the original record follows. -->

```text
       .-""""-.          ____ _   _  ___  ____ _____
      /        \        / ___| | | |/ _ \/ ___|_   _|
     |  [0_0]   |      | |  _| |_| | | | \___ \ | |
     |    __    |      | |_| |  _  | |_| |___) || |
     |          |       \____|_| |_|\___/|____/ |_|
     \_/\_/\_/\_/

          MODEL WEIGHTS IN CONTRACTS. INFERENCE IN SOLIDITY.
```

<p align="center">
  <a href="https://gh0st-observatory.netlify.app/">Observatory</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/REQUEST-LIFECYCLE.md">Request lifecycle</a> ·
  <a href="docs/EVIDENCE.md">Evidence and costs</a>
</p>

<p align="center">
  <strong>$GH0ST · Research-support token</strong><br>
  Token contract: <code>0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559</code>
</p>


## Contributions welcome

GH0ST welcomes code improvements, optimization ideas, bug reports, reproducible experiments and documentation fixes. You can suggest an improvement through GitHub Issues or submit a pull request from your fork; no token ownership or paid deployment is required.

**[Read the contribution guide](CONTRIBUTING.md)** · **[Suggest an improvement](https://github.com/8tk8m2kv9f-lang/GH0ST/issues/new/choose)** · **[Browse pull requests](https://github.com/8tk8m2kv9f-lang/GH0ST/pulls)**

## Meet GH0ST

GH0ST investigates a concrete question: **can a language model execute from on-chain weights, with the inference itself performed by smart contracts?** Its selected Falcon-H1-Tiny model is exported into a 48.63 MB four-bit file, stored across 495 deployed weight contracts, and read by a Solidity matrix kernel. A separate resumable runtime implements the rest of bounded token generation and requester-funded execution.

The central engineering idea is **continuation**: computation is divided into bounded transactions, with numerical checkpoints saved between them. An executor submits the transactions; the contracts compute the activations and token selection from their pinned weights and session state. The executor does not supply the model's answer.

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute. The model's attribution, pinned revision and original license terms remain part of the project.

### Milestone at a glance

*Repository evidence snapshot: 20 October 2026. These are dated results, not a live network dashboard.*

| Layer | Recorded achievement | Evidence boundary |
| --- | --- | --- |
| Deployed model and runtime | **500 contracts** including two historical pilots; prepaid runtime byte-for-byte verified on Robinhood Chain | Creation and verification records; no paid public chat recorded |
| Bounded inference | Chat-template **“Hi” → “Hello!”**, **288/288** fixed-point layer checkpoints matched | Local EVM mirror, 11 prompt tokens and 2 output tokens |
| Requester-funded execution | Contract-computed maximum escrow, selected executor, capped credits and unused-fund refunds | Local inference/payment validation; executor service and website chat still need integration |

The longer-term goal is an on-chain agent. The current evidence establishes deployed model data and a bounded inference runtime; the earlier action controller remains a separate study. [Read what each milestone proves](docs/EVIDENCE.md).

### Choose your route

| You want to… | Start here |
| --- | --- |
| Understand the project in plain language | [Documentation guide](docs/README.md) |
| Follow weights, inference and checkpoints through the contracts | [Architecture](docs/ARCHITECTURE.md) |
| Understand who pays, who submits transactions and how answers appear | [Request lifecycle](docs/REQUEST-LIFECYCLE.md) |
| Inspect achievements, gas, fees and quality measurements | [Evidence and costs](docs/EVIDENCE.md) |
| Connect a frontend to the deployed runtime | [Frontend integration kit](falcon-agent/runtime/FRONTEND-INTEGRATION.md) |
| Reproduce the numerical and payment checks | [Runtime reproduction instructions](falcon-agent/runtime/README.md#reproduce) |
| Explore earlier experiments and rejected approaches | [Research index](#research-index) and [recovery status](RECOVERY-STATUS.md) |

<details>
<summary><strong>Deployed runtime and accounting snapshot</strong></summary>

- Chain: **Robinhood Chain**, ID **4663**.
- Runtime: `0x69996912a59a241763c71810193cf1021ddbb8c0`.
- Recorded total deployment gas, including pilots: **15,359,893,400**.
- Recorded total deployment fees, including pilots: **0.324805606209776000 ETH**.
- These totals cover deployment. Inference measurements and maximum escrow quotes are separate quantities.

[Runtime receipt and code hash](falcon-agent/runtime/mainnet-runtime.json) · [Itemized spending record](falcon-agent/runtime/ACCOUNTING-AND-MILESTONE.md) · [Full address manifest](falcon-agent/fourbit-study/mainnet/deployment-manifest.json)

</details>

---

*The original project record follows unchanged. Earlier experiment statements retain their historical scope; use the dated deployment and runtime evidence for the current snapshot.*

# GH0ST

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute.

Research toward an on-chain language model and agent: Solidity kernels, weight encodings, local gas measurements, model quality checks, and agent-control experiments.

**Current direction:** [optimized four-bit weights and cross-shard reader](falcon-agent/fourbit-study/README.md). The selected research candidate is **48.63 MB**. Lossless creation encoding keeps every runtime byte unchanged while fitting RH's conservative transaction-size bound: all 495 shards were verified locally, with a maximum signed size of **94,998 bytes** and maximum local creation gas of **30,221,500**. The current stage costs **14.809 billion local deployment gas** including kernel/index (5.37% below the selected six-bit package). The earlier 10.554 billion raw-payload estimate was rejected by RH and is retained only as a research comparison. Matrix execution remains **1.132 billion gas** (61.82% below the selected six-bit kernel; 4.67% below the fastest earlier six-bit experiment). This stage needs **497 new contracts, or 499 including the two old pilot contracts**; full inference may require more. Held-out next-token agreement is 79.67%, versus 94.33% for six-bit: material drift, not an accuracy score. See the [pinned deployment plan](falcon-agent/fourbit-study/deployment-plan.json).

**Previous experiment:** [five-bit weights](falcon-agent/fivebit-study/README.md) reduced the file to 60.67 MB and modeled weight deployment to 13.179 billion gas. Its evidence and the historical six-bit manifests are preserved.

**Deployment status: the four-bit weights/kernel/index stage is complete on Robinhood Chain.** All **497 four-bit contracts** are deployed and verified: one matrix kernel, 495 weight shards and the final immutable address index. Including the two historical six-bit pilots, that completed weight stage accounts for **499 contracts**, with **zero remaining in this stage**. The subsequently deployed execution runtime brings the current public total to **500 contracts**. The final 122 contracts used **4,000,758,321 gas** and cost **0.084967911586284000 ETH**. Across all deployments including the pilots, actual totals are **15,352,086,000 gas** and **0.324643352822976000 ETH**. Wallet balance at completion: **0.010509448211852451 ETH**. [Final deployment report](falcon-agent/fourbit-study/mainnet/batch-0004.md), [address manifest](falcon-agent/fourbit-study/mainnet/deployment-manifest.json), [complete receipt journal](falcon-agent/fourbit-study/mainnet/deployment-state.json). The bounded inference runtime is implemented locally; public inference and website integration remain outstanding.

**Research milestone: bounded inference and prepaid runtime deployed on RH.** The [single-contract runtime](falcon-agent/runtime/README.md) is **35,852 bytes**, reuses the deployed kernel/index, and requires no additional helper deployments. A chat-template “Hi” generated “Hello!” in a local mirror of the deployed code, with all 288 layer checkpoints matching the independent fixed-point reference. The runtime is deployed at `0x69996912a59a241763c71810193cf1021ddbb8c0`, bringing the total to **500 contracts**. Deployment used **7,807,400 gas** and cost **0.000162253386800000 ETH**. Its complete runtime matches the locally validated pin byte for byte. Across all deployments including pilots, the updated totals are **15,359,893,400 gas** and **0.324805606209776000 ETH**. No public chat deposit or inference transaction was sent. See the [mainnet receipt and verification](falcon-agent/runtime/mainnet-runtime.json) and [frontend integration kit](falcon-agent/runtime/FRONTEND-INTEGRATION.md). The [spending record and milestone](falcon-agent/runtime/ACCOUNTING-AND-MILESTONE.md) distinguish actual deployment fees from local inference measurements. Execution cost remains a substantial optimization target.

**The requester funds chat execution in advance:** the contract computes a [conservative maximum escrow](falcon-agent/runtime/PREPAID-BUDGET.md) from prompt/output bounds and requester-approved fee caps. The chosen executor submits continuations, earns bounded withdrawal credits, and the requester can withdraw unused funds after completion or cancellation. This is an enforceable maximum, not exact advance knowledge of future gas fees. The conservative deposit is substantially higher than measured consumption. There is no connected web chat, production executor service, on-chain raw-text tokenizer or agent-action system in this update.

**Deployment-cost research:** [reduce deployment gas](falcon-agent/gas-refinement/DEPLOYMENT-PRIORITY.md). Weight bytes account for 92.13% of the balanced layout's modeled deployment. The new assessment gives concrete size budgets and separates existing compression results from model-changing alternatives; it does not claim a new gas reduction.

**Earlier exact-weight work:** [gas refinement](falcon-agent/gas-refinement/README.md) reduces the complete matrix benchmark to **1.214 billion gas** with the balanced candidate, or **1.187 billion** with the fastest candidate. All 165,440 output rows match exactly. Modeled weight deployment rises to **16.421 billion** or **17.016 billion gas**, respectively. These are matrix-kernel experiments, not complete token generation.

**Publication status:** the historical archive was saved on 20 October 2026 at 06:46 UTC and covers work through the first Falcon six-bit optimization round. The new gas-refinement work above was performed after recovery. The intervening historical rounds, including the final 50-experiment series, remain **missing**. See [RECOVERY-STATUS.md](RECOVERY-STATUS.md).

**The mainnet runtime is available for integration; website chat is not connected.** The bounded runtime has passed local end-to-end token generation and is deployed, but a complete paid chat has not been executed on mainnet. A frontend and a transaction-sending executor still need integration. Its measured local inference cost and conservative upfront escrow remain substantial. Earlier matrix benchmarks and scripted-controller tests remain separate historical experiments; they are not full-token cost measurements.

**Website and achievement record:** [Observatory status and evidence](OBSERVATORY.md) separates deployed contracts, local inference, controller tests and frontend demonstrations.

## Research index

| Area | Records and source |
| --- | --- |
| Single-contract resumable inference prototype and full-token gas measurements | [falcon-agent/runtime/README.md](falcon-agent/runtime/README.md) |
| Four-bit calibration, packed kernels, actual cross-shard reads and deployment draft | [falcon-agent/fourbit-study/README.md](falcon-agent/fourbit-study/README.md) |
| Manual six-bit RH deployment batches and fee tracking | [falcon-agent/rh-deployment/README.md](falcon-agent/rh-deployment/README.md) |
| Five-bit weight quality, encodings and Solidity kernels | [falcon-agent/fivebit-study/README.md](falcon-agent/fivebit-study/README.md) |
| New exact arithmetic and metadata gas refinement | [falcon-agent/gas-refinement/README.md](falcon-agent/gas-refinement/README.md) |
| Historical project overview and reproduction instructions | [EXPERIMENTS.md](EXPERIMENTS.md) |
| Falcon model selection, quality and agent controller | [falcon-agent/README.md](falcon-agent/README.md) |
| First exact six-bit packing and matrix optimization study | [falcon-agent/sixbit-optimization/README.md](falcon-agent/sixbit-optimization/README.md) |
| Lossless compression and quality-preserving research | [falcon-agent/research-quality/RESEARCH.md](falcon-agent/research-quality/RESEARCH.md) |
| Quantization and modeled deployment | [falcon-agent/OPTIMIZATION-AND-DEPLOYMENT.md](falcon-agent/OPTIMIZATION-AND-DEPLOYMENT.md) |
| Historical LFM Solidity and complete-block tests | [contract-benchmark/README.md](contract-benchmark/README.md), [block-benchmark/README.md](block-benchmark/README.md) |
| Compiled fixed-weight kernels | [COMPILED-WEIGHTS-RESULTS.md](COMPILED-WEIGHTS-RESULTS.md) |
| Rust/Wasm and Stylus feasibility | [stylus-benchmark/README.md](stylus-benchmark/README.md) |
| FLAN-T5 baseline | [FLAN-T5-BASELINE.md](FLAN-T5-BASELINE.md) |
| Stopped distillation pilots | [distillation-pilot/README.md](distillation-pilot/README.md) |

## Complete recovered archive

The Git tree contains the recovered source, reports, manifests, and small supporting artifacts. Binary weight shards and student checkpoints (`.bin` and `.safetensors`) are listed with sizes and SHA-256 hashes in [binary-artifacts.json](binary-artifacts.json). They belong in the complete recovered archive, distributed with the repository's Releases, rather than in ordinary Git history.

Archive: `GH0ST-recovered-experiments-v13.zip` (216,479,111 bytes; 4,828 files).

SHA-256: `44fee2c717891e06c546908056eacb6f3044b3be09e7baf665059a07ce4317b7`

The archive preserves its original `lfm-robinhood-benchmark/` directory and README. Extract it to reproduce historical runs with bundled binary data. The repository's `EXPERIMENTS.md` is that original README, renamed to make room for this GH0ST overview.

## Scope and licensing

The selected model in this snapshot is Falcon-H1-Tiny-90M-Instruct (91,131,072 parameters), with its pinned revision recorded in `selected-model.json`. Earlier LFM and FLAN studies and stopped distillation pilots are retained for traceability.

Original model licenses, notices, and source-file license identifiers are preserved. This publication does not apply a new blanket license or replace upstream model terms. Consult the included notices and pinned upstream sources before reuse.

</details>
