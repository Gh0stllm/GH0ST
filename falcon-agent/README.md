<!-- GH0ST reading guide: additive navigation. -->

**GH0ST / MODEL AND CONTROLLER RESEARCH**

[Project home](../README.md) · [Documentation guide](../docs/README.md) · [Architecture](../docs/ARCHITECTURE.md) · [Evidence and costs](../docs/EVIDENCE.md)

This directory connects model selection, weight-format experiments and a bounded agent-controller study. The deployed token-generation runtime is in [runtime/](runtime/README.md); the selected deployed weights are in [fourbit-study/](fourbit-study/README.md). The controller's scripted-engine tests and runtime inference tests establish different properties. [See the integration boundary](../docs/ARCHITECTURE.md#how-the-agent-controller-fits).

---

# Falcon deployment study and agent controller

**Current snapshot — 20 October 2026:** the [four-bit weight/kernel/index stage](fourbit-study/README.md) is complete with 499 contracts including historical pilots. A [separate bounded inference prototype](runtime/README.md) has generated tokens in a local EVM mirror and its validated prepaid runtime is now deployed on RH, bringing the total to 500 contracts. It remains unintegrated with this controller and website chat. No paid mainnet chat has been sent. See the [runtime deployment receipt](runtime/mainnet-runtime.json) and [frontend integration kit](runtime/FRONTEND-INTEGRATION.md). See the [Observatory achievement record](../OBSERVATORY.md).

**Historical scope:** the six-bit targets and missing-engine statements below describe this earlier controller study. They are preserved as research history; use the current records above for deployment and runtime status.

Current target: **existing Robinhood Chain only**, with the user-selected **six-bit export**. Read `sixbit-optimization/README.md` first. The exact compact file is **72,045,528 bytes**, modeled complete weight-shard deployment is **15,648,599,873 gas**, and all 217 matrices pass local integer validation. Their full synthetic linear pass uses **2,965,180,308 gas**, excluding the rest of inference. Neither sub-billion target is achieved. The top-level deployment and selected-weight manifests now refer to this six-bit format; earlier NF4 manifests remain in `historical-weight-layouts/`. No full engine or public deployment exists.

Newest study: `research-quality/RESEARCH.md` tests exact full-model compression, a Solidity decoder, authenticated weight delivery and model preallocation at local genesis. Exact BF16 compression saves 32.38%; the code-deposit floor remains 24.648 billion gas. All 78 architecture checks passed. The new-chain genesis alternative changes deployment assumptions; it is not an ordinary Base/RH deployment or a complete LLM.

Latest work: read `OPTIMIZATION-AND-DEPLOYMENT.md` for six new quantization comparisons, action-routing probes and a six-shard local deployment rehearsal. The experimental NF4 group-128 export is 48,879,392 bytes, but output quality regresses. Its 796-contract layout implies 10,596,258,549 local Cancun gas for weight deployment, excluding the engine/tokenizer and L1 fees. No tested aggressive export is accepted as a production model. The scripts and complete results are included.

The active candidate is `tiiuae/Falcon-H1-Tiny-90M-Instruct`, revision `e6389502a0b12cd8da894b395ba5bf7436873b16`, 91,131,072 unique parameters. No training or fine-tuning is performed. It uses the publisher's custom Falcon-LLM License; original/quantized model binaries are not redistributed in this package.

## What works

`Agent.sol` implements a bounded run loop with an owner, a pinned inference-engine address/code hash/model ID, permissionless progress, cancellation, current prompt/reply, persistent note and on-chain observations. The supported actions are reading its own native balance, saving a bounded note, and sending native currency to owner-allowlisted recipients. Transfers enforce both a per-transfer cap and a cumulative run budget. The owner configures permissions while idle and authorizes each new run. Arithmetic and permissions are enforced by contracts independently of generated text. No arbitrary external protocol calls or token approvals are provided.

The controller uses a shared non-upgradeable implementation and 45-byte EIP-1167 clones. All agents can refer to the same separately deployed model engine and weights. This reduces the incremental agent cost; it does not reduce the first deployment's weight bill. All model state must be scoped to the calling agent and job inside the eventual engine.

`fixtures/ScriptedEngine.sol` is explicitly **not a language model**. Tests set its output directly to exercise state transitions and adverse outputs. It cannot support a claim of an autonomous AI agent. There is no production engine implementation or public deployment script in this package.

## Measured local controller costs

Solidity 0.8.30, optimizer 200, via IR, Paris bytecode on local Anvil Cancun, chain 31337. No real funds spent or public transactions submitted.

| Item | Gas |
|---|---:|
| Factory plus shared controller implementation | 2,063,576 |
| First agent clone and initialization | 162,069 |
| Initial factory/controller/agent total | 2,225,645 |
| Each additional agent clone | 162,069 |

These totals **exclude model weights and the inference engine**. Test-fixture deployment is separately recorded and excluded. Example action receipts include scripted-engine calls and must not be used as Falcon inference estimates.

All 36 integration checks pass. Coverage includes isolation between two owners, locked initialization, authorized progress, bounded inputs, spending limits, recipient restrictions, persisted observations/replies/notes, forbidden replay, cancellation/recovery, rollback of a genuinely reverting transaction, failed transfers, reentrancy, action-loop bounds and rejection of changed engine bytecode. This is testing, not an independent security audit. Code-hash pinning does not prove an engine is correct or prevent upgrades hidden inside a proxy; a production engine must be reproducibly built, non-upgradeable and reviewed.

## Weight deployment target

The standard EVM code-deposit rate is 200 gas per byte. A 10-million-gas budget leaves at most 50,000 bytes for code/data; 100 million leaves 500,000 bytes; 999 million leaves 4,995,000 bytes. These are optimistic capacities before transaction, constructor, engine, decompression, metadata and L1 data costs.

The publisher's full Q4_K_M checkpoint contains 386 tensors and all 91,131,072 elements. It is mixed Q4/Q6/F32, so it exceeds the earlier idealized 45.6 MB estimate which assumed exactly four bits for every parameter and no overhead.

| Measured artifact | Bytes | Code-deposit gas only |
|---|---:|---:|
| Published Q4_K_M complete GGUF | 58,600,064 | 11,720,012,800 |
| Same file, lossless zlib-9 | 56,514,099 | 11,302,819,800 |
| Same file, lossless bzip2-9 | 57,382,237 | 11,476,447,400 |
| Q4_K_M tensor payload, lossless zlib-9 | 56,190,216 | 11,238,043,200 |
| Published Q8_0 complete GGUF | 98,353,792 | 19,670,758,400 |
| Same file, lossless zlib-9 | 93,010,598 | 18,602,119,600 |

Compression and exact decompression roundtrips are measured on CPU. **No on-chain zlib/bzip2 decompressor is implemented.** The gas column is the arithmetic cost of depositing those bytes under standard EVM code pricing, not a transaction receipt. Decompressing to full permanent code would pay for the expanded code. Keeping compressed bytes would require a decoder at inference time, with extra execution cost and blockwise random-access layout. Quantization quality was not measured in this earlier compression pass; the subsequent custom-quantization study is documented separately above.

The unusually small upstream `IQ2_M` file was downloaded and its SHA-256 matched upstream, but its header is zero bytes rather than `GGUF`. It is excluded as an invalid GGUF artifact at this pinned revision. It is not evidence of a working 12.7 MB model.

The tested codecs provide only small savings. Reaching 100 million gas with these complete weights would require over 113x further size reduction before overhead. No such quality-preserving method was demonstrated. This is evidence against the present target, not a proof that every conceivable model encoding is incompressible.

## What was deliberately not counted as meeting the goal

- A Merkle root or model hash is a commitment, not the model weights. Resupplying verified weights as calldata can keep arithmetic on-chain but introduces external weight transport and moves recurring costs; it changes the self-contained contract-state requirement.
- Blobs or historical transaction calldata are not arbitrary persistent bytes readable directly by future EVM execution. Keeping an archive and resupplying data is a distinct design.
- Clones share a previously deployed model; the initial model storage cost still exists.
- Off-chain inference with an on-chain proof does not meet the requested fully on-chain inference boundary.
- Compiling weights into executable programs previously reduced LFM inference gas by expanding code. It works against this deployment-size target.
- Pruning, a learned compressed model, a smaller replacement, or more aggressive quantization changes model behavior. No retraining is authorized and none was performed.

## Pretrained CPU check

`check_pretrained.py` verifies the original safetensors SHA-256, loads it locally in float32 without remote Python code, and tests six fixed prompts with greedy decoding. Results are in `pretrained-smoke-results.json`. These are CPU reference responses, not contract inference.

The model produces a coherent greeting, answers 12-2 correctly, outputs `BALANCE` for the simple action-name prompt, and recalls Rowan. It incorrectly reports a 12 ETH balance as 10 ETH after confusing a 2 ETH spending limit with an actual transfer. The permission prompt starts with “No” but adds text despite an exact yes/no request. This small check shows some useful behavior and concrete failures; it does not establish agent reliability. Protocol balance displays should use direct contract values, and permissions must never rely on the model's prose.

## Integration contract for the missing engine

1. `begin(prompt, observation, tokenLimit)` is called by the controller. It must create a fresh job scoped to `msg.sender`, render a documented input format, tokenize it on-chain, and initialize its own authenticated model state.
2. Initial observation is ABI-encoded `(uint8 tag=0, uint256 chainId, address agent, address owner, uint256 balance, uint96 runBudget, uint96 transferCap, bytes note)`. Tool observations are documented in `Agent.sol`; the engine must decode and render them itself. The current prototype does not pass a full historical conversation to the engine.
3. `advance(job, work)` must enforce caller/job ownership, bounded actual work and correct state transitions. Any address can call the controller to pay for progress, but the controller remains the engine's caller.
4. `result(job)` must derive its structured output and text from completed on-chain inference. Use a deterministic action grammar/parser; reject incomplete, malformed or unsupported actions. No privileged setter, oracle, externally supplied answer or hidden off-chain inference is acceptable.
5. An action causes the controller to feed its factual on-chain result into a new inference job. The controller caps actions at eight and generated tokens at 256 per inference job. An owner can cancel a stalled or invalid run. More elaborate tool execution is not implemented.

Outstanding work: deterministic quantized Falcon hybrid attention/Mamba runtime, tokenizer, fixed-point nonlinear operations, per-agent caches, complete next-token validation, reliable structured output, full-model gas/latency measurements and complete license review before model redistribution. A weight-only deployment manifest and local sample rehearsal now exist. Low controller gas does not resolve the missing inference implementation.

## Reproduce

Use the existing project's pinned Python environment (`requests`, `eth_abi`, `eth_utils`, PyTorch and Transformers) and its `contract-benchmark/node_modules/solc` 0.8.30. The paths below are examples to adapt to a local checkout.

```bash
node falcon-agent/compile.cjs
python falcon-agent/test_agent.py --anvil /absolute/path/to/anvil
python falcon-agent/measure_weights.py --cache /absolute/path/to/public-model-cache
python falcon-agent/check_pretrained.py
```

The agent test launches only its own loopback Anvil. Compression downloads public pinned artifacts and never publishes them. The CPU checker downloads the original checkpoint into a sibling cache directory outside this deliverable. Both model repositories and revisions are recorded in the scripts and JSON results.

Primary references accessed 2026-10-20:
- https://huggingface.co/tiiuae/Falcon-H1-Tiny-90M-Instruct
- https://huggingface.co/tiiuae/Falcon-H1-Tiny-90M-Instruct-GGUF/tree/578d134817c19bc48991ccff9a14709d664261cc
- https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go
- https://eips.ethereum.org/EIPS/eip-1167
- https://eips.ethereum.org/EIPS/eip-170
- https://docs.robinhood.com/chain/differences-from-ethereum/
- https://docs.soliditylang.org/en/latest/security-considerations.html
