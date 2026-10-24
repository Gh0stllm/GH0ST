# Exact KV reuse: feasibility and implementation outline

Status: design only. No cache implementation, transaction, or mainnet operation is implied by this document. The optimized full-model local benchmark remains the source of measured gas.

## Immediate stateless optimization

On the final transformer layer, prefix tokens need only input RMS normalization, key projection, value projection, and key rotary positions. Only the final position needs query projection, attention, output projection, the MLP, and residuals. There is no later layer that reads the final-layer hidden states of the preceding positions, and the vocabulary head reads only the final position.

The existing two-loop implementation can retain all key/value work but skip final-layer query/query-RoPE for earlier positions, then begin that layer's attention/MLP loop at `length - 1`. All preceding layers retain the complete prefix computations.

This removes exactly 163,712 matrix multiply-accumulate terms per earlier prompt token, plus its final-layer attention and other nonmatrix work. For a ten-token prompt, this is 1,473,408 terms saved from 7,718,272. No weights, context, output logits, or rounding rules change. This is useful before introducing persistent state.

## Why caching is numerically exact

For token position `t`, each layer's normalization acts only on that token. Its query, key, and value projections also act only on that token. The rotary transform depends on its fixed position. Its causal attention reads only positions `0..t`. Therefore appending a later token cannot change any earlier position's key/value tensors.

Induct on layers and positions: if the stored keys and values equal those from the full-prefix computation, a new token receives identical attention scores, exponent interpolation, normalized attention values, residuals, and MLP outputs. The next layer receives the same hidden vector, proving equality through final normalization and all 4,019 logits. The fixed-point sums and divisions must retain their existing definitions; storing each signed int32 value losslessly does not add rounding.

The cache stores **post-RoPE keys** and unrotated projected values separately for every layer. It must not reuse a key/value across models, positions, resets, or different token prefixes.

## In-memory reuse within one generation call

A stateful memory workspace can prefill the prompt once, then append each previously generated token once. It keeps four layers of keys and values in memory, and discards them when the call ends. The public `generate(prompt, maximumNewTokens)` interface, view mutability, output tokens, EOS behavior, and full-logit hashes can remain unchanged.

For an original prompt of length `p` and `n` generated tokens:

- Current recomputation processes `n*p + n*(n-1)/2` token positions through the transformer.
- A memory KV cache processes `p + n - 1` positions.
- Both execute the full 4,019-token vocabulary head `n` times.

Before final-layer dead-work elimination, matrix work is:

| Prompt / outputs | Existing multiply-accumulate terms | Cached terms |
| --- | ---: | ---: |
| 1 / 1 | 1,234,816 | 1,234,816 |
| 1 / 4 | 9,261,568 | 4,939,264 |
| 10 / 4 | 35,195,392 | 11,422,720 |

The cached path is promising for several outputs, but those counts alone do not prove a complete four-token swap fits 32M gas. Vocabulary projection and nonmatrix work remain, and an output cap of four tokens does not imply a complete sentence.

## Persistent cache across swaps

Each token requires 64 key int32 values and 64 value int32 values per layer. Four layers need 512 int32 values = 2,048 bytes per token. Packing eight int32 values into each storage word requires **64 storage slots per cached token**. At the supported 16-token context, a full cache uses 1,024 words plus metadata.

Conservative EVM storage accounting, excluding loop/packing/account overhead:

- Reading all 15 preceding positions cold: `15 * 64 * 2,100 = 2,016,000` gas.
- Writing a new position into zero slots cold: `64 * (20,000 + 2,100) = 1,414,400` gas.
- Metadata, token IDs, and events cost extra.

These are storage component calculations, not measured total swap gas. Warm accesses can cost less; no refund or warm-access discount is needed for this planning bound. Compute, calldata, swap settlement, and hook overhead must be measured together on local Anvil.

To avoid calling previously computed output “fresh inference,” keep one queued input token:

1. For a ten-token question, prefill and cache the first nine tokens on chain using one or more separately metered transactions.
2. Queue the final question token.
3. During the swap, process that queued token through every layer using cached preceding keys/values, calculate all vocabulary logits, emit the newly selected token, and queue it as the next input.
4. The next swap processes that emitted token and computes the next new output.

Every emitted token is then selected during its swap. The initial prefill cost is explicit and additional. This does **not** permit an arbitrary new ten-token question to be fully processed free inside one swap. New or changed questions require their own correct prefix cache.

Cache contents must be computed by the on-chain implementation. User-supplied keys/values without verification would let a caller invent model state and would not establish faithful model inference.

## State isolation and limits

For a shared pool story, use a cache namespace containing the exact `PoolId`, model commitment, and generation epoch. All swaps may intentionally advance the same pool story. For independent user sessions, include an authenticated session owner and session ID as well. The callback's `sender` is often a router; it must not be assumed to be the end user. Do not derive session ownership from `tx.origin`.

Suggested metadata:

```
modelHash, epoch, processedLength, generationStep,
queuedInputToken, hasQueuedInput, ended,
processedTokenIds / prefixHash
```

`processedLength` addresses only fully computed cached tokens. Each token stores four layers of separate key/value arrays. A deterministic word index is `position*64 + layer*16 + kind*8 + componentWord`, with `kind=0` for keys and `kind=1` for values. Decode each packed component with signed 32-bit sign extension.

The baseline supports a maximum context of 16 positions. Preserve that bound. Silently dropping old keys and shifting positions would not generally equal recomputing the model on a new window, because the cached hidden states were conditioned on the removed prefix. At the limit, stop or explicitly reset to a new epoch with a newly processed prompt. EOS also ends or explicitly resets the session. Old storage outside the active length must never be read after reset.

## Hook interface and atomicity

The current hook uses `staticcall` to a view-only model. Persistent state requires a deliberate non-view cache adapter and ordinary `call`, plus authorization permitting only the intended hook/session initializer to mutate cache state. This is an interface change; memory-only reuse does not require it.

One successful callback should advance one generation step. Required-speech failure, invalid model output, insufficient gas, swap failure, and failed settlement must leave both pool and cache state unchanged. Reverting an outer swap rolls back descendant cache writes. If optional speech catches failure, a model call that reverts also rolls back its own writes.

A special hazard is accepting a successful state-mutating call, finding malformed return data afterward, and merely emitting a skip event. Cache writes would survive while the hook reports no output. Validate output within the same reverting child call that mutates state, or revert the swap on post-call validation failure. Preserve separate swap-sequence and successful-generation-step counters so skipped swaps do not desynchronize the cache.

## Proposed file outline and validation

Possible isolated research files:

```
optimization/cache/SimpleStoriesMemoryCache.sol
optimization/cache/SimpleStoriesPersistentCache.sol
optimization/cache/SimpleStoriesCachedV4Hook.sol
optimization/cache/cache-reference.py
optimization/cache/run-cache-benchmark.mjs
optimization/cache/cache-parity.json
```

First implement memory-only reuse against the frozen optimized kernel. Compare every generated token, EOS decision, final hidden vector, and complete-logit hash to recomputation for prompt lengths 1, 2, 10, and 13 and outputs 1 through 4, respecting the 16-position cap. Include zero-length/overlong rejection and EOS early exit.

Only if useful, add persistent sessions and compare each append to full-prefix recomputation. Test two pools, two owners/sessions, stale epoch/step rejection, unauthorized writes, resets, EOS, context exhaustion, required/optional speech failure, and settlement rollback. Benchmark first cold append, later append at lengths 1/10/15, and cumulative prefill cost separately. Every experiment remains on isolated local Anvil with no public-chain RPC or signing.
