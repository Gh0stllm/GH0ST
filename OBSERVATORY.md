# GH0ST Observatory: achievements and status

Snapshot: 20 October 2026. The Observatory is a frontend for the project’s research and architecture. Its execution theatre is a labelled simulation, not a live chain feed or an inference client.

## Achievements and evidence

| Milestone | Measured scope | Primary record |
| --- | --- | --- |
| 500 contracts deployed on RH Chain | 497 four-bit contracts: 495 weight shards, one matrix kernel and one immutable address index; plus two historical pilots and the verified prepaid inference runtime. | [Final deployment report](falcon-agent/fourbit-study/mainnet/batch-0004.md), [reconciliation](falcon-agent/fourbit-study/mainnet/reconciliation.json) |
| Prepaid bounded runtime deployed | One 35,852-byte execution contract, byte-for-byte verified on RH; “Hi” generated “Hello!” in local EVM validation with all 288 fixed-point layer checkpoints matching. No paid public chat has been sent. | [Runtime receipt](falcon-agent/runtime/mainnet-runtime.json), [prepaid chat validation](falcon-agent/runtime/prepaid-chat-validation.json), [frontend kit](falcon-agent/runtime/FRONTEND-INTEGRATION.md) |
| Exact cross-shard matrix validation | 217 matrices, 90,996,736 weights and all 165,440 output rows checked against integer arithmetic. Matrix-pass gas is not full-token gas. | [Four-bit study](falcon-agent/fourbit-study/README.md) |
| Pinned 48.63 MB four-bit export | 495 shards preserve the export bytes. Held-out next-token agreement was 79.67% across 300 positions; quantization causes material behavioral drift. This is not a task-accuracy score. | [Quality and provenance](falcon-agent/fourbit-study/README.md) |
| 48.36% less continuation gas on the same local smoke test | The three-position workload fell from 15,957,162,305 to 8,240,553,260 gas. The longer chat is a separate workload. | [Runtime cost measurements](falcon-agent/runtime/README.md) |
| Bounded controller and factory | Owner isolation, allowlisted transfers, spending/action limits, persisted observations and cancellation; 36 local integration checks. Controller tests use ScriptedEngine, not a language model. | [Historical controller study](falcon-agent/README.md), [Agent.sol](falcon-agent/Agent.sol) |

## Public functionality

The weights/kernel/index stage and bounded prepaid inference runtime are deployed. The current public total is **500 contracts**. The runtime address is `0x69996912a59a241763c71810193cf1021ddbb8c0`. Its creation used 7,807,400 gas and cost 0.0001622533868 ETH. Website chat, an operating executor and controller actions still need integration; the contract count alone does not establish a fully functional autonomous agent.

The earlier direct-payment local “Hi” chat required 34,036,992,062 continuation gas across 1,552 transactions. The current prepaid local chat used 33,891,488,817 gas across 1,546 transactions. Neither is a mainnet inference receipt. Only runtime creation was subsequently authorized and sent; no public chat deposit or inference has been initiated. The prototype permits 64 total tokens, uses off-chain tokenization and has no demonstrated affordable production inference path. See the runtime record for numerical approximations and remaining product limits.

The front-page world-first language describes the project’s mission. Priority has not been independently established. A claim of a currently fully functional public on-chain AI agent is not supported by these records.

## Frontend behavior

The centred hero retains the approved banner silhouette, cyan/teal body, lavender eyes and pink mouth. Larger round phosphor dots wrap a three-dimensional shell. Pointer movement turns the sculpture and creates local light and surface responses; idle flow, scan sweeps, blinking and detached neon spots keep it moving. Clicks or Enter/Space send glow waves through the intact figure and hero. ASCII, palettes and pause remain; reduced-motion preferences start paused.

The architecture inspectors, contract dialogs, plain/technical explanations and three execution scenarios remain. No wallet, RPC, transfer or model inference is initiated by the website. Frontend validation is separate from contract validation and independent security review.

## Publication maintenance

Use dated, scoped figures and link to primary reports. Distinguish deployed contracts, local EVM tests, CPU quality checks and simulations. Preserve the Technology Innovation Institute attribution and upstream license notices. Keep credentials out of source, public files and logs. Frontend deployment targets the existing `gh0st-observatory` Netlify project; it does not authorize contract deployment or further mainnet spending.
