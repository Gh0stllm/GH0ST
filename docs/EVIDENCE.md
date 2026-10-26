# Achievements, evidence and costs

**Historical Falcon snapshot:** this page preserves the evidence available on 20 October 2026. The later S0UL deployment and completed inference have separate [records in the project home](../README.md#s0ul-on-robinhood-chain-mainnet). [Provenance and verification](PROVENANCE.md) explains the recovered history and how to check those records.

[Documentation guide](README.md) · [Architecture](ARCHITECTURE.md) · [Request lifecycle](REQUEST-LIFECYCLE.md) · [Project home](../README.md)

GH0ST's strongest result is a concrete implementation trail: a pinned deployed weight file, integer matrix validation, a bounded full inference runtime, exact deployed-runtime verification and local end-to-end numerical/payment checks. These results establish different properties and should be read at their measured scope.

*Snapshot: 20 October 2026, based on the repository's source and recorded results. This page does not query current chain state or current gas prices.*

## Why the milestone matters

**The model data are actually deployed.** The selected export is readable through 495 data contracts and an immutable index. The runtime can read weights needed for computation from the chain rather than receiving an answer from an external inference API. [Deployment manifest](../falcon-agent/fourbit-study/mainnet/deployment-manifest.json).

**The implementation extends beyond a matrix benchmark.** The runtime includes normalization, Mamba/attention state, nonlinear functions, feed-forward blocks and greedy token generation. The local chat-template test exercised the entire bounded path and compared all 288 layer checkpoints with an independent fixed-point reference. [Runtime source](../falcon-agent/runtime/GH0STRuntime.sol), [validation report](../falcon-agent/runtime/prepaid-chat-validation.json).

**The computation survives transaction boundaries.** Numerical checkpoints and a deterministic state machine let the selected executor continue the same session over many transactions. This makes the path inspectable and reproducible within the implementation's context and numerical bounds. [Architecture](ARCHITECTURE.md#why-computation-is-resumable).

**The requester-funded execution model is implemented.** The contract computes a conservative budget, restricts continuation access to the chosen executor, caps compensation, records credits and releases unused funds. Local tests exercise both inference and settlement. [Prepaid specification](../falcon-agent/runtime/PREPAID-BUDGET.md).

Together, these are a meaningful engineering milestone toward self-contained on-chain inference. The next challenge is an integrated system with acceptable execution cost, validated numerical behavior and an operating frontend/executor/action path. The current records do not establish world-first priority; that would require a defined comparison scope and prior-work assessment.

## What each record proves

| Evidence | Recorded result | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Public deployment records | 500 contracts including historical pilots | Contracts were created and their recorded code was verified | A completed mainnet inference or autonomous agent |
| Four-bit matrix validation | 217 matrices, 90,996,736 elements and 165,440 output rows checked | Kernel output agrees with the selected integer arithmetic on the tested pass | Full-token cost or original-model quality |
| Local prepaid inference | “Hi” → “Hello!”, 288/288 layer checkpoint matches | Complete bounded inference agrees with the independent fixed-point reference on this workload | Broad task accuracy or a paid mainnet response |
| Small runtime quality regression | 8/8 predicted tokens agree across four short prompts | Q32/int16 and float32 using the same four-bit weights agree on these checks | General capability or correctness of every answer |
| Four-bit held-out comparison | 79.67% next-token agreement across 300 positions | Measured behavior relative to the original model on a small fixed held-out set | A task-accuracy score or percentage of intelligence retained |
| Controller integration tests | 36 local checks using ScriptedEngine | Controller permissions, limits, transitions and isolation under test | Language-model-driven actions |
| Observatory frontend | Labelled execution theatre and architecture views | A presentation of the project's research and mechanisms | A live chain execution feed or connected inference client |

Primary records: [runtime receipt](../falcon-agent/runtime/mainnet-runtime.json), [four-bit study](../falcon-agent/fourbit-study/README.md), [prepaid chat report](../falcon-agent/runtime/prepaid-chat-validation.json), [quality regression](../falcon-agent/runtime/quality-validation.json), [controller report](../falcon-agent/agent-test-results.json), [Observatory scope](../OBSERVATORY.md).

Matching a reference demonstrates numerical agreement with that reference. It does not by itself show that the generated answer is correct. Four-bit quantization also causes material drift relative to the original weights; the six-bit held-out comparison had 94.33% next-token agreement on the same 300 positions.

## The 500-contract count

| Deployed component | Contracts | Role |
| --- | ---: | --- |
| Four-bit weight shards | 495 | Selected export bytes |
| Four-bit matrix kernel | 1 | Packed integer matrix arithmetic |
| Immutable weight index | 1 | Shard-address and file metadata |
| Prepaid inference runtime | 1 | Bounded inference and escrow settlement |
| Historical six-bit pilots | 2 | Earlier deployment experiments |
| **Recorded total** | **500** | **498 in the four-bit inference stack, plus 2 historical pilots** |

`FixedMath`, `WeightReader` and inherited `PrepaidBudget` do not add separately deployed helper contracts. This count does not include a deployed production controller/adapter or operating executor service. [Architecture and recorded addresses](ARCHITECTURE.md#deployed-stack-and-identity).

## Gas, fees and budgets

A gas count describes computational/resource accounting. An ETH fee is an amount paid at a particular price, with the applicable chain fee components. A maximum escrow is an enforceable allowance under chosen caps. Keep all three separate.

### Actual recorded deployment fees

| Deployment stage | Contracts | Gas charged | Fee paid, ETH |
| --- | ---: | ---: | ---: |
| Historical six-bit pilots | 2 | 14,071,366 | 0.000283860789728000 |
| Four-bit kernel, shards and index | 497 | 15,338,014,634 | 0.324359492033248000 |
| Prepaid runtime | 1 | 7,807,400 | 0.000162253386800000 |
| **Total** | **500** | **15,359,893,400** | **0.324805606209776000** |

These are historical receipt totals. They are not a quote to redeploy today, an inference fee, or an available refundable balance. [Spending record](../falcon-agent/runtime/ACCOUNTING-AND-MILESTONE.md), [weight receipt journal](../falcon-agent/fourbit-study/mainnet/deployment-state.json), [runtime receipt](../falcon-agent/runtime/mainnet-runtime.json).

### Current prepaid chat: local measurement

| Quantity | Value | Scope |
| --- | ---: | --- |
| Templated prompt length | 11 tokens | “Hi” after official chat templating |
| Generated output | 2 token IDs | Decodes to “Hello!” |
| Continuation receipt gas | 33,891,488,817 | Local EVM mirror |
| Continuation transactions | 1,546 | Local EVM mirror |
| Session funding/start gas | 296,954 | Separate local receipt |
| Largest continuation | 24,854,317 gas | Observed local receipt |
| Layer checkpoints matched | 288 / 288 | Independent fixed-point reference |
| Payment/inference checks | 27 passed | Recorded local checks, not an independent audit |

The validator uses explicit local overrides and a mocked posting-fee precompile. Its ETH balances and transfers are simulated. The measured continuation gas is an aggregate for this prompt/output, not a per-token constant and not a mainnet fee. [Full prepaid validation](../falcon-agent/runtime/prepaid-chat-validation.json).

### Conservative maximum deposit

For that same 11-prompt-token/2-output-token length pair, the contract allows at most **26,190 work units** and **811,890,000,000 billed execution gas**. With the test's simulated gas price of **21,088,000 wei/gas** and posting cap of **100,000 wei per continuation**, the escrow is **17.121136322619000000 ETH**.

The local test credited **0.719686164542016000 ETH** to the executor and **16.401450158076984000 ETH** back to the requester. Both withdrew, leaving zero local balance and liability. These simulated values demonstrate settlement accounting. **17.121 ETH is not the expected price of a chat.** The conservative bound is much larger than observed consumption because it allows worst-case fragmentation into many small successful continuations.

The executor credit uses measured in-call gas plus the disclosed 120,000-gas overhead and the simulated posting charge. It is not identical to the sum of receipt fees. [Quote and settlement formulas](../falcon-agent/runtime/PREPAID-BUDGET.md).

### Historical figures remain useful in context

| Figure | Original meaning |
| --- | --- |
| 1,131,959,017 gas | Selected four-bit all-matrix local benchmark, including cross-shard reads; not complete inference |
| 10,553,905,726 gas | Earlier modeled raw-payload weight/kernel/index deployment; those payloads were rejected by RH |
| 14,809,327,109 gas | Locally validated lossless-creation stage, including kernel/index; not the final public receipt total |
| 8,240,553,260 gas | Earlier direct-payment short smoke workload after optimization; different from the longer templated chat |
| 34,036,992,062 gas | Earlier direct-payment templated-chat continuation measurement; different runtime artifact from the current prepaid build |

The lossless creation encoding preserves the selected runtime bytes while changing constructor work and signed-transaction size. The four-bit conversion itself changes model weights and behavior. Those are distinct transformations. [Four-bit report](../falcon-agent/fourbit-study/README.md), [runtime history](../falcon-agent/runtime/README.md#historical-measurements).

## What remains to demonstrate

| Area | Remaining work in this snapshot |
| --- | --- |
| Public execution | A complete funded chat and its continuation receipts on mainnet |
| Product integration | Website wallet/tokenizer wiring and an operating executor |
| Agent actions | A reviewed connection between token-generation output and the controller's typed, policy-checked action interface |
| Numerical coverage | Broader prompts and full permitted-context behavior; the maximum 64-token case is not fully benchmarked |
| Economics | Lower execution cost and tighter validated practical funding bounds |
| Review | Independent security review and broader assessment of numerical behavior |
| Historical publication | Recovery of still-missing research rounds described in the recovery record |

[Integration kit](../falcon-agent/runtime/FRONTEND-INTEGRATION.md) · [Controller boundary](ARCHITECTURE.md#how-the-agent-controller-fits) · [Recovery status](../RECOVERY-STATUS.md)

The achievement is clearest when its evidence is easy to inspect: deployed bytes, reproducible computation, measured costs and explicit next milestones. The original reports and source remain the detailed record behind this guide.
