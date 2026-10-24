# Compact sentence event interface

`NovaSentenceCompactHook.sol` is the bounded-memory strict sentence hook with only the per-word diagnostic emission call removed. SHA-256: `86d0806dbbb6f6f29f75966edb313d4b0b5c6b1790b30a5440e7c083dc1c55f9`.

Every generated word still passes the same model identity check, bounded inference call, bounded canonical ABI/numeric/vocabulary decoder, and recurrent state-hash update. Failure anywhere or absent terminal punctuation within 32 words still reverts the whole trade.

The output interface now emits one `SentenceSpoken` event containing the complete text, sentence number, first/last word indices and final state hash. `WordSpoken` diagnostic events are no longer emitted. Its declaration remains in the ABI for compatibility, but event consumers must use `SentenceSpoken` for new sentence output.

Local adversarial mock results are recorded in `compact-event-proof.json`:

- Two-word sentence: 1,939,327 gas.
- Terminal punctuation at word 32: 25,923,922 gas.
- No terminal punctuation within 32 words: full rollback at 25,802,716 gas.
- Second-word inference failure, invalid hidden state, gas exhaustion and forged text all roll back state and leave no committed logs.
- The final sentence event matches standard ABI encoding; the final state hash matches an independently computed chain over all 32 words.

These are callback-only fixture measurements using a small mock. They are not real N0VA inference gas, full PoolManager settlement gas, or proof of 10 swaps per second.
