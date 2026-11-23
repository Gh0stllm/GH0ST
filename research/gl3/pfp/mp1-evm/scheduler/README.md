# Bounded M-P1 execution on Robinhood

This is the pinned workload and an execution protocol for the 2,976,901-byte M-P1 Q5 pack. The workload replay counts the original browser algorithm. The transaction protocol describes the stateful executor that must join the separately tested kernels.

## Reproduce the workload

Run this from the workspace containing the pack. In a separate checkout, point the two arguments at the same packed assets and pinned upstream source.

```sh
python3 gh0st-chess/research/gl3/pfp/mp1-evm/scheduler/workload.py \
  --pack output/gh0st-image-model-2to3mb-20261123/pack/q5 \
  --browser-source output/gh0st-image-model-2to3mb-20261123/pack/upstream/index.html
```

The script verifies every pack component, the concatenation order and hash, the original predictor, the quantized matrix shapes, and the sampler settings. It emits the [full operator breakdown](workload.json).

One 16×16 image uses 269 tokens, 16 denoising steps and 32 transformer passes with guidance. The pinned browser graph has **37,590,663,168 logical multiply-accumulates**, including the two attention products. It also evaluates 74,097,664 softmax exponentials and 145,920 LayerNorm rows. It checks up to 1,048,576 palette distances, depending on the output alpha mask.

The simple scalar EVM scenario counts one `MUL` and one `ADD` for each logical multiply-accumulate. Its 300,725,305,344 gas is about **6.69535 ETH** at the earlier sampled 22,264,000 wei per gas, with 9,398 equivalents of a full 32 million gas transaction. This excludes loads, loops, rounding, state, and nonlinear functions. Packing changes the opcode count. A purely illustrative effective rate of one gas per logical multiply-accumulate would charge **0.83692 ETH** before those same costs. Both numbers describe specific assumptions. A full-image fee requires executing and summing the real schedule. [EVM opcodes](https://ethereum.org/developers/docs/evm/opcodes/) · [Publisher inference source](https://github.com/AnticPan/mini-pixel-art/blob/b0ba29f8994082ab1af89351bcce9f2d86919269/docs/index.html)

`python3 gh0st-chess/research/gl3/pfp/mp1-evm/scheduler/project_prototype.py` applies the same graph counts to the [raw linear](../kernel/robinhood-linear-gas.json) and [batched fixed operator](../runtime/robinhood-batched.json) RPC fixtures. The [projection](prototype-projection.json) prices standalone calls at the fixture gas. It prefers authentic blue-crystal tensors when available, selects the cheaper exact cover using 64- and 128-output linear tiles, and uses four-query attention groups that share K/V. The measured batch repeats the authentic query four times. The logical operation coverage describes the two dominant matrix stages. The projection also lists the remaining work that needs gas measurements.

## Pin the model and arithmetic

- Use the exact Q5 pack with SHA-256 `14b714ef8c016b1a321becfa5397d18d9011878e03d46a00eda1cdf68e6491a1`. Publish the ordered shard lengths, chain ID 4663, code hashes, fixed arithmetic version, and constant/address manifest together. Read the shard data with `EXTCODECOPY`, including the shard boundary rules and one-byte STOP prefix. Binds chosen at registry creation remain fixed through a job.
- Treat the caption and seed as request inputs. Run vocabulary lookup, padding, unknown handling, seed expansion, palette matching, and alpha thresholding deterministically. Bound the caption input bytes before beginning. Token IDs or activations supplied by a relayer require on-chain derivation from the request before use. The [fixed reference](../reference/mp1_fixed.py) uses uint32 Mulberry32 and fixed-point Box-Muller, including deterministic CORDIC and logarithm approximations.
- The first integer reference uses signed int32 little-endian Q16.16 values, signed divisions truncated toward zero, and integer Q24 scales obtained from the packed Float16 scales. Keep sums wide until the published output narrowing. For the 768-wide second feedforward projection, accumulate and apply the four separately scaled 192-wide groups before adding the bias according to the fixed reference. Compare exact tensor bytes at checkpoints, including the conditional lane and unconditional lane in their reference order.
- Pin the 16 timestep numerators to `300, 281, …, 15` with denominator 300. Append zero only as the final Euler target. Pin 3/2 guidance for color and alpha. The final Euler output equals its guided prediction. Time-embedding constants can be shared across jobs if generated and verified for the pinned arithmetic.

## State and phase ownership

Create a job from the caller, a monotonically increasing job nonce, caption hash, seed, and model/arithmetic version. Keep its step, branch, layer, stage, and tile cursor in consensus state. An operator advances it with the expected cursor and a small maximum number of units. The contract decides the tile shape, source buffer, weight offset, and legal destination for each unit. Each successful call writes every result it claims and advances once. A revert leaves both buffer and cursor at their previous state. A repeated or stale cursor fails before work. A second job's buffers are keyed by its own ID.

For a given step, initialize from the previous latent. Sequence slots 0 through 12 hold time and caption, and slots 13 through 268 hold pixels. Each branch runs the following dependency order through eight blocks.

1. Normalize and generate Q/K/V. A barrier ensures the necessary K/V rows exist before any attention query executes.
2. For each head and query, compute all 269 scores and the global maximum, then normalize and multiply by V. If an attention row spans calls, retain enough exact state for a second pass with the final maximum. Commit attention in head-channel order.
3. Project attention and add the untouched residual. Normalize the completed post-attention values.
4. Compute the first feedforward layer and ReLU, apply the second feedforward layer, and add the untouched post-attention value. Retain feedforward scratch only for the output rows that still need it. Publish the block barrier before consuming those rows in the next block.
5. Normalize/project the 256 pixel tokens when the eighth block completes.

Save the conditional and unconditional predictions before guidance and Euler. Start the next step only after the latent checkpoint. After the final step, evaluate the palette and alpha for every pixel and publish 256 little-endian uint16 indices and the resulting hash.

Batching multiple rows in one transaction allows exact reuse of decoded weights and K/V. A unit is a measured tile with a fixed maximum size and deterministic byte ranges. Example working-set sizes for one branch at Q16.16 are 206,592 bytes for the sequence and 619,776 bytes for full Q/K/V. Each feedforward row adds 3,072 bytes of temporary state. Memory can be reused within a call. State crossing transactions needs committed buffers. A hash checkpoint authenticates those buffers. Each later call also requires access to the committed values, and their cold reads and writes must be measured.

## Fee and release gates

Pin the gas limit, fee cap, chosen chain, recipient contracts, and operation envelope in any eventual signed review. Read the current nonce and chain ID, use only the authorized signer and transactions, and calculate landed cost from canonical receipts as `gasUsed × effectiveGasPrice`. A failed or uncertain broadcast is reconciled by hash and nonce before considering any retry. The early quote measured deployment of the immutable data shards. Inference and the stateful executor need separate tests.

Before requesting a deployment review, prove one completed image on the chosen pre-deployment execution path, match all available fixed-reference checkpoints, and run each candidate stateful stage at its actual storage footprint. Test the highest-cost stage under Robinhood's sampled 32 million gas transaction limit, including cold storage reads, writes, state consistency, and any reported data posting fee. Sum every bounded call actually needed for the replay. A raw arithmetic kernel or isolated `eth_call` does not establish that full-image cost.
