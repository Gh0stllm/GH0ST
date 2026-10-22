# GH0ST Observatory: achievements and status

The S0UL wallet integration is published at https://gh0st.wiki/#s0ul as of 22 October 2026. Netlify deploy `6ad997f47d3f02d1b3399de8` updated one page and added four assets while retaining all 547 prior production files, eight redirect rules and the security-header rule. The historical Falcon figures later in this document retain their 20 October 2026 scope. The Execution Theatre remains a labelled simulation, separate from either inference client.

## Published S0UL wallet panel

The new `#s0ul` panel connects a browser wallet to the existing S0UL controller on **Robinhood Chain mainnet, chain ID 4663**, at `0x9F92776e33087DCF0d77b9BE23145efAC6cE695D`. The client checks the pinned controller, engine, model, tokenizer and GH0ST token identities. Its source is [the client](website/s0ul-client.mjs), [gas forecast](website/s0ul-gas.mjs), [UI](website/s0ul-ui.mjs) and [styles](website/s0ul-agent.css); [deployed-model and agent evidence](s0ul-1m/AGENT.md) is separate from frontend validation. Live browser checks verified module loading, task selection and disabled execution before wallet/quote approval; no funded browser/wallet QA was performed.

1. Select a browser wallet and **Connect wallet**. Switch to Robinhood Chain when prompted.
2. Choose a task: save/read a preference, add/list/complete a task, read a balance, or wait. Review **Only permitted action**, the prompt and the maximum output-token budget, which includes EOS. The expected action is your authorization commitment; it is not model output.
3. Choose **Estimate full task**. This makes read-only chain calls and sends no transaction. Review startup, full inference and finalization estimates, the estimated wallet-transaction count and the buffered recommendation.
4. Set a positive **Total spending limit (ETH)**, tick the review checkbox and choose **Start task** within the quote's 60-second validity window. The limit must cover the quoted buffered work and any already recorded fees.
5. Choose **Run batches** or **Next batch** and confirm each transaction in the wallet. The panel displays confirmed model output, the executed tool result, request progress, receipt hashes and actual recorded fees separately. One task can require hundreds of wallet confirmations. A mismatched model output pauses automatic progress; finalizing it records the controller's rejection rather than performing the approved write. Gas already consumed remains payable.

The wallet pays normal network gas directly; the S0UL panel sends zero-value controller calls and requires no prepaid executor deposit. Each batch contains at most four existing engine steps and stops before Select after progressing so decision logits can be captured. The browser does not run inference after it stops submitting transactions.

### Forecast and spending limits

The whole-task forecast uses the two recorded S0UL mainnet requests and reserves work through the full selected output budget. It is a conservative forecast, not a guaranteed price. It includes controller overhead, finalization and a cancellation reserve, with at least **25% gas headroom**, increasing to at least **50%** beyond the measured position-8 range. The accepted fee ceiling is **1.5 times** the current quoted gas price. Historical posting gas is already included; the forecast does not add a second L1 fee or divide total gas by four for batching.

Before each wallet request, the client estimates the next concrete transaction again, adds **20% gas headroom** and fits the batch within the smaller of the current block gas limit and **31 million gas**. It checks live fees, wallet balance and recorded spending plus the next transaction's maximum reserve against the accepted limit. It pauses when these checks fail. The limit is a browser guard, not an on-chain spending restriction; wallet-edited parameters can exceed it, in which case the app records the actual fee and pauses for review. Recorded spending covers receipts in this browser's journal; loading an externally created request does not reconstruct every earlier payment by other clients.

### Pause and recovery

**Pause** stops future wallet requests; a transaction already submitted can still settle. A same-session pause can retain its approved cap. Reloading/reconnecting or loading a different request clears spending authorization: reconnect the original wallet, load its request ID, review its original action, choose **Estimate remaining task** and explicitly approve the remaining-work quote and total limit again. Quotes and approvals are bound to the wallet, chain, request and exact action; changing those invalidates the review.

Browser storage retains request intent, receipts and pending wallet operations. An unresolved or ambiguous send blocks further submissions. Use **Check transaction** with the exact wallet hash; recovery checks sender, target, nonce, chain, calldata and canonical receipt before proceeding. It does not blindly resend. Missing browser storage prevents further wallet requests.

All **42 frontend tests passed**: 11 gas, 24 client and 7 UI tests. [Validation report](frontend-tests/validation-report.json). They use mocked wallets/providers/contracts and a minimal DOM with real ABI/hash encoding; they make no network requests, sign no transactions and establish no funded browser or production-deployment result.

## Historical Falcon achievements and evidence

| Milestone | Measured scope | Primary record |
| --- | --- | --- |
| 500 contracts deployed on RH Chain | 497 four-bit contracts: 495 weight shards, one matrix kernel and one immutable address index; plus two historical pilots and the verified prepaid inference runtime. | [Final deployment report](falcon-agent/fourbit-study/mainnet/batch-0004.md), [reconciliation](falcon-agent/fourbit-study/mainnet/reconciliation.json) |
| Prepaid bounded runtime deployed | One 35,852-byte execution contract, byte-for-byte verified on RH; “Hi” generated “Hello!” in local EVM validation with all 288 fixed-point layer checkpoints matching. No paid public chat has been sent. | [Runtime receipt](falcon-agent/runtime/mainnet-runtime.json), [prepaid chat validation](falcon-agent/runtime/prepaid-chat-validation.json), [frontend kit](falcon-agent/runtime/FRONTEND-INTEGRATION.md) |
| Exact cross-shard matrix validation | 217 matrices, 90,996,736 weights and all 165,440 output rows checked against integer arithmetic. Matrix-pass gas is not full-token gas. | [Four-bit study](falcon-agent/fourbit-study/README.md) |
| Pinned 48.63 MB four-bit export | 495 shards preserve the export bytes. Held-out next-token agreement was 79.67% across 300 positions; quantization causes material behavioral drift. This is not a task-accuracy score. | [Quality and provenance](falcon-agent/fourbit-study/README.md) |
| 48.36% less continuation gas on the same local smoke test | The three-position workload fell from 15,957,162,305 to 8,240,553,260 gas. The longer chat is a separate workload. | [Runtime cost measurements](falcon-agent/runtime/README.md) |
| Bounded controller and factory | Owner isolation, allowlisted transfers, spending/action limits, persisted observations and cancellation; 36 local integration checks. Controller tests use ScriptedEngine, not a language model. | [Historical controller study](falcon-agent/README.md), [Agent.sol](falcon-agent/Agent.sol) |

## Historical Falcon functionality

At the historical snapshot, the Falcon weights/kernel/index stage and bounded prepaid inference runtime were deployed, totaling **500 contracts**. The runtime address is `0x69996912a59a241763c71810193cf1021ddbb8c0`. Its creation used 7,807,400 gas and cost 0.0001622533868 ETH. Website chat, an operating executor and controller actions still need integration; the contract count alone does not establish a fully functional autonomous agent.

The earlier direct-payment local “Hi” chat required 34,036,992,062 continuation gas across 1,552 transactions. The current prepaid local chat used 33,891,488,817 gas across 1,546 transactions. Neither is a mainnet inference receipt. Only runtime creation was subsequently authorized and sent; no public chat deposit or inference has been initiated. The prototype permits 64 total tokens, uses off-chain tokenization and has no demonstrated affordable production inference path. See the runtime record for numerical approximations and remaining product limits.

The front-page world-first language describes the project’s mission. Priority has not been independently established. These historical Falcon records alone do not establish a fully functional autonomous agent; the bounded S0UL evidence is linked separately above.

## Frontend behavior

The centred hero retains the approved banner silhouette, cyan/teal body, lavender eyes and pink mouth. Larger round phosphor dots wrap a three-dimensional shell. Pointer movement turns the sculpture and creates local light and surface responses; idle flow, scan sweeps, blinking and detached neon spots keep it moving. Clicks or Enter/Space send glow waves through the intact figure and hero. ASCII, palettes and pause remain; reduced-motion preferences start paused.

The architecture inspectors, contract dialogs, plain/technical explanations and three execution scenarios remain. The Execution Theatre stays a simulation. The S0UL panel initiates chain reads and wallet-confirmed controller transactions only through the explicit flow above; it is separate from the legacy Falcon prepaid chat. Frontend validation is separate from contract validation and independent security review.

## Publication maintenance

Use dated, scoped figures and link to primary reports. Distinguish deployed contracts, local EVM tests, CPU quality checks and simulations. Preserve the Technology Innovation Institute attribution and upstream license notices. Keep credentials out of source, public files and logs. Frontend deployment targets the existing `gh0st-observatory` Netlify project; it does not authorize contract deployment or further mainnet spending.
