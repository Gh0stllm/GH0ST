# Aggressive optimization and deployment rehearsal

2026-10-20. **The experiment did not achieve a useful full model deployable in millions of total gas.** Six new quantized exports were evaluated against the original Falcon checkpoint without training. The 2/3-bit versions lost coherence; the tested 4-bit and mixed variants showed meaningful regressions. No variant is approved as a production agent model.

The current package contains real quantization/export code, CPU comparisons, a reproducible weight-shard deployment manifest and successful local deployment samples. It does not yet contain complete Falcon inference or tokenization contracts. Nothing was broadcast publicly, and no real ETH was spent.

## Full-model weight measurements

All variants preserve all 91,131,072 unique parameters and 386 tensors of `tiiuae/Falcon-H1-Tiny-90M-Instruct`, revision `e6389502a0b12cd8da894b395ba5bf7436873b16`. No layers or vocabulary rows were removed. Embedding/output-head tying is preserved.

| Encoding | Weight bytes | Code-deposit gas only | Exact responses / 14 | First-token agreement with original / 16 |
|---|---:|---:|---:|---:|
| Original BF16 tensor payload | 182,262,144 | 36,452,428,800 | 3 | 16 |
| NF4-style, group 128 | 48,879,392 | 9,775,878,400 | 2 | 10 |
| NF4-style, group 64 | 51,723,040 | 10,344,608,000 | 1 | 7 |
| Affine 4-bit, group 64 | 57,410,336 | 11,482,067,200 | 0 | 6 |
| Affine 3-bit, group 64 | 46,035,744 | 9,207,148,800 | 0 | 1 |
| Affine 2-bit, group 64 | 34,661,152 | 6,932,230,400 | 0 | 0 |
| NF4 group 64 + 8-bit embedding/head | 61,160,224 | 12,232,044,800 | 0 | 6 |

The gas column uses 200 gas per deposited byte and excludes all other deployment costs. Original BF16 is tensor payload only; new export sizes include quantization metadata and a 32-byte codebook but exclude tokenizer/configuration and the external tensor manifest. They are not complete chatbot sizes. Baseline inference loads the unchanged original BF16 values into float32.

The 14 scored prompts require an exact short answer; two additional prompts inspect chat. Correct but verbose responses fail this strict formatting score, so it is **not a general intelligence or semantic accuracy score**. All prompts and outputs are retained in `quantization-results.json`. This is a small development suite, not a held-out benchmark. First-token agreement and KL divergence measure drift from the original, not correctness. The original itself misreads limits and permissions.

The NF4-style group-128 payload is 13.5% smaller than the previous 56,514,099-byte losslessly compressed Q4_K_M GGUF, and 16.6% smaller than its uncompressed 58,600,064-byte file. Those earlier files were not inference-tested here. This comparison is storage size only and does not establish equal quality or identical file contents. The new format omits the tokenizer and requires its own runtime decoder.

## Implemented encoding changes

- Store low-bit matrix codes densely, with no per-weight ABI/storage slot.
- Share one fixed 16-entry NF4-style codebook, rounded to signed Q15. Store unsigned Q24 group scales. This is a custom fixed-point export, not the official bitsandbytes runtime.
- Compare affine 2/3/4-bit encodings with signed Q24 group offsets and unsigned Q24 scales. Metadata is included in every size calculation.
- Keep non-matrix parameters in signed Q24, including convolution/norm/bias/state parameters. The range is checked before export.
- Keep the original shared embedding/head once. Compare a higher-precision embedding/head variant rather than silently accepting degraded text.
- Check all packed-code roundtrips, record tensor spans and hashes, and independently reload complete exports for the action probe.

All neural computation in these comparisons still uses float32 activations and dequantized CPU weights. Fixed-point activation error, Mamba recurrence, integer nonlinearities and EVM execution have **not** been validated. Binary exports remain in the local public-model cache; scripts and manifests are supplied, not redistributed model weights. The publisher uses a custom Falcon-LLM License.

## Action-path computation experiment

`action_router_probe.py` compares a four-row vocabulary projection with selecting those same rows from the full model output. The local comparisons match exactly in this environment. A four-label action head needs 2,048 multiply-accumulates instead of 16,777,216 for the 32,768-token output head.

This reduces **only the final head**. All 24 model layers and prompt processing still run, and unrestricted chat still requires its normal output vocabulary. It is not an 8,192-fold whole-model speedup, a measured gas reduction, or a storage reduction. The original embedding table is still needed.

| Routing prompt | Original | NF4 group 128 | Affine 4-bit group 64 |
|---|---:|---:|---:|
| Instructions only | 3/12 | 3/12 | 3/12 |
| Four in-context examples | 6/12 | 4/12 | 4/12 |

The examples do not train the model, but they increase prefill work to 164–170 tokens. This small routing probe is inadequate for deployment: restricting output format does not fix wrong action choices. Arguments, recipient permissions and budgets must remain independently checked by the controller. Neither prompt is promoted to production.

## Measured storage deployment path

`prepare_deployment.py` validates every tensor hash and splits the experimental NF4 group-128 payload into immutable, STOP-prefixed code shards. Its tiny init program returns exactly those bytes as runtime code. `deployment-manifest.json` records offsets, sizes, hashes and per-shard estimates. The name `selected-weight-manifest.json` means selected for this storage rehearsal only, not selected as a release model.

| Layout | Weight contracts | Largest estimated transaction | Estimated total weight deployment |
|---|---:|---:|---:|
| Portable 24 KiB runtime | 1,989 | 5,368,876 gas | 10,656,506,106 gas |
| Robinhood candidate: 60 KiB runtime | 796 | 13,346,764 gas | 10,596,258,549 gas |

The local gas formula includes transaction creation, zero/nonzero init calldata, initcode metering, code copying, memory expansion, STOP prefixes and code deposit. The first, middle and last shard of each layout were actually deployed to local Anvil Cancun, with an explicitly configured 96 KiB code-size allowance and 16,777,216 block gas limit. All six returned-code comparisons passed, and all six receipts match the formula exactly. The totals are calculated for every shard; they are **not receipts from deploying the entire model**.

Using larger shards saves 60,247,557 gas, about 0.57% of this weight deployment. Robinhood documents a 96 KB contract-code limit, but the local rehearsal does not prove its current usable transaction budget. Actual Robinhood fees, including L1 data posting, still require chain-specific estimation. These totals exclude the tensor/address index, tokenizer, inference engine, controller, state initialization and future inference.

Thus deployment transactions can individually cost millions while aggregate model deployment still costs billions. The 2,225,645-gas controller/factory/first-agent result and 162,069-gas additional clones remain valid local results, but exclude weights and inference. Sharing one model amortizes the initial bill across users; it does not erase it.

## How a working agent must be deployed

1. **Finish the local runtime before publishing weights.** Implement the Falcon hybrid attention/Mamba forward pass, on-chain tokenizer, fixed-point nonlinearities, persistent per-job state and complete next-token decoding. Check full generated sequences against the numerical reference, including overflow, long runs and continuation across transactions. Benchmark prefill separately from decode. A cheap controller and stored weights alone cannot chat.
2. **Choose a weight encoding that passes a meaningful use-case evaluation.** The aggressive exports above have not met that gate. Pin the checkpoint, quantization parameters, tokenizer, compiler, all hashes and required license notices in a reproducible build. Complete the model's distribution-license review before public weight publication.
3. **Deploy on Robinhood testnet, chain 46630.** Obtain test ETH and an accessible RPC; the documented public endpoint is `https://rpc.testnet.chain.robinhood.com`. Read chain ID, current fees and limits before signing. Finalize the shard layout from current estimates. Deploy data shards in bounded transactions, record each receipt/address, and verify every returned code hash. Resume from verified receipts after interruptions.
4. **Deploy the immutable model index, tokenizer and inference engine.** The engine must identify the exact weight/configuration set, read its own stored weights, enforce job ownership and derive its outputs from contract computation. Externally supplied answers, API calls or supplied inference proofs do not meet the requested boundary. The existing `ScriptedEngine` is a fixture and must not be used as the live model.
5. **Deploy `AgentFactory` against the actual engine and create the agent.** Configure the owner, recipient allowlist and spending limits. Run read-only balance/note tasks before payment tests. Verify cancellation, per-run isolation and complete on-chain replies. Public production use needs measured full-run costs and a review of the contracts that will hold funds.
6. **Operate through a wallet or keeper.** The owner opens a run and authorizes its budget. A transaction submitter calls bounded `drive(work)` steps until completion. Model state, decisions, observations and execution stay on-chain; the submitter supplies transaction gas rather than intelligence. A frontend displays contract state/events. Contracts do not initiate their own transactions.

There is no complete public deployment command for a functioning Falcon agent yet because step 1 is unfinished. Public deployment was not attempted. The supplied executable deployment script intentionally targets only a loopback chain and rehearses data storage. It cannot accidentally publish the weights or spend public funds.

## Reproduce the new work

Run from the project root with the existing pinned Python environment and local Anvil:

```bash
python falcon-agent/check_pretrained.py
python falcon-agent/quantize_compare.py
python falcon-agent/action_router_probe.py
python falcon-agent/action_router_probe.py --few-shot
python falcon-agent/prepare_deployment.py \
  --export ../falcon-public-cache/quantized-exports/nf4_g128 \
  --anvil /absolute/path/to/anvil
```

The first command downloads the original pinned checkpoint if absent. Exports remain in `../falcon-public-cache/quantized-exports/`. No training, model API, public-chain key or public transaction is used.

## Primary references

- Model and license identification: https://huggingface.co/tiiuae/Falcon-H1-Tiny-90M-Instruct
- NF4 technique: https://arxiv.org/abs/2305.14314 (only the weight encoding idea is used; no QLoRA training)
- EVM gas constants: https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go (measurements explicitly pin local Cancun rules)
- Robinhood code limits: https://docs.robinhood.com/chain/differences-from-ethereum/
- Robinhood networks: https://docs.robinhood.com/chain/connecting/
- Robinhood fee accounting: https://docs.robinhood.com/chain/gas-and-fees/
- Deployment tooling: https://docs.robinhood.com/chain/deploy-smart-contracts/
