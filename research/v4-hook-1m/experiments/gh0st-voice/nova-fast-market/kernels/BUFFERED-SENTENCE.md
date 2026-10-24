# Bounded-memory strict sentence hook

`NovaSentenceBufferedHook.sol` is a local-only candidate using the exact same public interface and failure policy as `../sentence/NovaSentencePoolHook.sol`. Its SHA-256 is `20fa9fc808d36cf6ac8b3c2ed9cb5b382aafd752cd3e726bfc5513abce64a07d`.

Every successful callback still requires neural terminal punctuation within 32 generated words. A failed inference, malformed result, exhausted sequence or missing terminal punctuation reverts the entire callback, including all previously emitted logs and state changes. This change does not make the real N0VA sentence fit the 32M-gas target; the full model must be tested separately.

## Measured callback-only results

These local fixtures use a small adversarial mock, not N0VA, and do not execute complete PoolManager token settlement.

| Case | Previous hook gas | Buffered hook gas |
| --- | ---: | ---: |
| Two-word sentence | 2,798,581 | 2,053,904 |
| Terminal punctuation on word 32 | 96,240,560 | 27,753,509 |
| No terminal punctuation within 32 words, full revert | 96,118,937 | 27,632,144 |

The 32-word success case uses 71.16% less gas. Its diagnostic transaction was permitted 500M gas to ensure both hooks could be compared; this is not a mainnet block-throughput result.

## Buffer boundaries

Allocated once per callback:

- 24,932 bytes for `stepSampled` calldata.
- 31,172 bytes for the decoder calldata: 4-byte selector, 32-byte dynamic offset, 32-byte length and at most 31,104 bytes of model output.
- 24,736 bytes for the state-hash input.
- 6,816 bytes for a complete `WordSpoken` event payload.
- 1,087 bytes for 32 words of at most 33 bytes plus 31 spaces.
- 192 bytes for the six-field `Generation` memory struct.

There are no free-memory-pointer rewinds. The model's output occupies the decoder's bytes argument directly. The bounded external self-call runs the original `decodeStep` function unchanged and discards its redundant ABI return. Only after that call succeeds does the caller point the typed state, scores and text views at the validated result. Before the next model call overwrites the result, the old state is copied into the reusable model calldata buffer.

`decodeStep`, `_checkWord`, `hiddenState`, `_saveState`, `_authorize`, both initialization callbacks and hook permissions are byte-identical to the prior source. The inference code-hash check, inference cap, 1.5M decoder cap, vocabulary lookup cap and 2M reserve remain in force.

The state hash and word event use fixed buffers containing the exact original ABI encoding. The sentence buffer is bounded independently before every append.

## Evidence

- `buffered-event-proof.json`: seven callback behavior checks plus independent byte-for-byte checks of all 32 word-event payloads and topics, the sentence event, final state and chained state hashes.
- `buffered-hook-summary.json`: source hash, unchanged validation functions and memory boundaries.
- `../audit/buffered-sentence-callback-results.json`: independent callback suite against the same source.
- `../audit/` contains the separate security review and boundary checks.

The callback checks verify atomic rollback after a failing second word, invalid hidden state, forged text, gas exhaustion and no terminal punctuation at the word cap. The full-word event check includes all 6,304 emitted score values and state hashes over 24,576 hidden values.

Run the local callback and event checks from `research/v4-hook-1m`:

```sh
node experiments/gh0st-voice/nova-fast-market/kernels/check-buffered-events.mjs --hook="$PWD/experiments/gh0st-voice/nova-fast-market/kernels/NovaSentenceBufferedHook.sol" --out=buffered-event-proof.json
```
