# Exact persistent inference, local experiment

This variant retains all 1,235,968 original parameters, Q12 equations, 128 hidden outputs and all 4,019 vocabulary logits. It reuses the lossless eight-lane weight representation from `../kernel8/model/`. The original stateless `forward`, `inspect` and `generate` remain available for parity testing.

## Session ownership and state

The cache key is `keccak256(abi.encode(msg.sender, sessionId))`. Every calling address owns its own namespace. In a hook integration the caller is the hook; the hook must independently authenticate any end-user or pool session IDs. Neither `tx.origin` nor the PoolManager callback's router address establishes end-user ownership.

`sessionState(owner, sessionId)` returns processed length, whether the session ended, its reset epoch, and a hash of the processed input tokens. A reset increments the epoch, clears active length/end/hash metadata, and starts the new prefix at position zero. Old cache storage is not deleted: it is ignored outside the active length, and every new active position is overwritten before use.

`step(sessionId, token, reset)` processes exactly one new input at the current position and computes a fresh next token. It returns `(nextToken, lastHidden[128], completeLogitHash)`. An EOS prediction ends the generation session. Length 16 also ends it; no sliding-window approximation is performed. Appending to an ended session requires an explicit reset.

`prefill(sessionId, token, reset)` computes the same exact result, but a temporary EOS prediction does not end the session while an externally specified prompt is still being supplied. Its input is an on-chain token, not an externally supplied cache tensor. Length 16 remains the maximum.

After every successful append, the prefix hash is `keccak256(abi.encode(oldPrefixHash, uint16(token)))`. Input tokens are validated before mutation. Any revert rolls back all writes.

## Lossless KV storage

For each layer, cache post-RoPE keys and raw projected values for all previous positions. Each vector has 64 signed int32 components. Eight components are stored per 256-bit word, with component zero in the low 32 bits. Loads use signed 32-bit extension.

The mapping word index is:

```
position * 64 + layer * 16 + kind * 8 + componentWord
```

where `kind = 0` for keys and `1` for values, and `componentWord` is `0..7`. Each newly processed token writes 64 words across four layers. The implementation loads only positions strictly less than the current position.

Causal attention makes this reuse exact: a previously processed position cannot depend on later inputs. The current token still executes all four transformer layers, all nonlinear functions, and the complete vocabulary projection during its own call.

## Hook requirements

A stateful hook must use a normal call, not a static call. The session mutator must be covered by the swap's revert boundary. If the model succeeds and output validation then fails, the hook must revert; merely emitting a skipped event would leave an advanced cache without an acknowledged output. Required speech is therefore the initial integration mode.

One swap generates one new token. A multi-token question requires separately metered prefill work; this design does not claim that an entire arbitrary question or sentence fits one transaction. Cache initialization, every prefix token, and final generation all have explicit costs.

All testing is restricted to local, unforked Anvil chain 31337. This experiment includes no mainnet deployment or RPC access.
