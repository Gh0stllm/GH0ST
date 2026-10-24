# SimpleStories V2: persistent, exact local inference

This is a local-only implementation for generating one new token per step while retaining the preceding causal context. Read [STREAMING_PROTOCOL.md](STREAMING_PROTOCOL.md) for the cache layout and hook integration rules. The local benchmark report is the source for measured gas and parity results; the implementation alone is not a deployment or a gas guarantee.

## Model and numerical identity

- Model: `SimpleStories/SimpleStories-V2-1.25M`, revision `2f445183fbfc45753adb1f9444f81bbdddde9b84`.
- Unique parameters: **1,235,968**. All four transformer layers, 128 hidden dimensions and all **4,019 vocabulary logits** remain.
- Original checkpoint SHA-256: `4d7b846d32e636c70ed3a342ec53775d10d56b404c357865a75eb2dce0b78f94`.
- Original Q12 weights SHA-256: `4185c1e2ca8258bc2fdc057f8767f74dd9d8c4f74d64ecf8ed3b56dfc12f8e29`.
- Lossless packed weights SHA-256: `b2618006eb6695796e5d5d822852049c2ed5f31d92c972561a0fb077b6bcf02f`.
- Packed weights: 6,258,016 bytes. The larger representation trades storage for cheaper exact multiplication. It does not add model parameters or change quantization.
- Lookup tables SHA-256: `e2e330f3ceb2f661d833b16e432b35bf0725c8df053a47189d726c48a9228986`.

The Q12 model is the existing approximation of the original FP32 checkpoint. Optimizations preserve that Q12 model exactly; they do not claim bitwise identity to FP32. Signed 12-bit weight packing is lossless for every exported matrix weight. Eight-way multiplication is used only after checking the entire input vector fits the proven signed 17-bit range. Other int32 input vectors use an exact scalar fallback.

## Interfaces

```
step(bytes32 sessionId, uint16 token, bool reset)
prefill(bytes32 sessionId, uint16 token, bool reset)
    -> (uint16 nextToken, int32[128] lastHidden, bytes32 logitHash)

sessionState(address owner, bytes32 sessionId)
    -> (uint8 length, bool ended, uint64 epoch, bytes32 prefixHash)
```

`step` performs fresh inference for the newly appended input, using prior keys/values computed by earlier calls. It ends the session when its prediction is EOS or the 16-position context is full. `prefill` also returns the full next-token result, but ignores temporary EOS predictions while the caller is still providing a prompt. Both reject an already ended session unless `reset` is explicitly true. A new untouched session may start with either reset value.

The original `forward`, `inspect`, and `generate` functions remain unchanged and stateless for comparison. Generating a sentence still requires multiple token steps. A full arbitrary question cannot be prefetched for free: earlier prompt tokens need separate, paid inference calls.

## Manual state and arithmetic review

- Session ownership is derived from the actual caller and caller-selected ID; one address cannot mutate another address's namespace through this API.
- A hook is the model's caller. The hook must separately authenticate its user/pool sessions; the model does not identify the end user behind a router.
- Input token validation precedes all state mutation. Position is checked below 16 before cache access. Internal layer indices range from zero through three.
- Cache indices range from zero through 1,023 and live inside each session's mapping. Keys and values occupy separate eight-word ranges per layer/position.
- Packing retains all 32 bits of every component, and unpacking explicitly sign-extends them. There is no KV quantization or truncation.
- Reset invalidates the active prefix. Subsequent positions are fully overwritten before they become readable; stale cache values outside the active length are not read.
- Metadata advances only after full inference succeeds. Reverts during computation, cache writing, metadata updates, or an enclosing swap roll back every change atomically.
- The model makes no external calls while a session is being updated; weight reads use `EXTCODECOPY`. A hook must revert if post-call output validation fails, so an acknowledged token and cache advancement cannot diverge.
- Epoch overflow reverts rather than wrapping. Reaching the context limit requires an explicit new session/reset; no hidden sliding-window approximation is applied.

All tests and artifacts stay local. No mainnet read, write, signing, or deployment is part of this work.
