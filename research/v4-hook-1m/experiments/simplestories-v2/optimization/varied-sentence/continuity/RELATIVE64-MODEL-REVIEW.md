# Position-independent continuity model: local review

`SimpleStoriesV2Relative64Model.sol` keeps the full 1,235,968 learned parameters, all four layers, and the 4,019-token vocabulary. It stores authenticated, append-only raw projected keys and values for generated history. The next token attends the most recent 64 positions, including itself.

The query remains unrotated. Each key is rotated by its age, from 0 through 63. This removes absolute-position table indexing and the previous 2,048-position cutoff. In exact real arithmetic this follows rotary attention's translation identity. Integer rounding changes, so this is a distinct Q12 arithmetic variant, not bit-identical to the earlier absolute-position model.

## Verified model results

The local model test completed 135 real advancement transactions, processing 150 tokens. Every generated token, natural stopping flag, state counter, and complete 4,019-logit hash matched the independent relative-key reference. No prompt reset or software-generated punctuation was used.

- Solidity source SHA-256: `e11808d3b4ebb1828ec2bd09be84738f688ee30081bb1e62ce6fe548d68143df`
- Runtime: 15,694 bytes; full deployment input: 34,819 bytes.
- Constructor: 17,937,991 gas, excluding separately stored weights, tiles, and table.
- Saturated one-token advancement: 28,046,104–28,294,210 gas in this stream.
- The previous two-token policy reached 29,940,099 gas at position 32, above the intended 29,250,000 model-call budget. The hook must request two tokens only while `processed <= 26`, then one.

The single 6,152-byte numeric table has SHA-256 `414c3e8bb8647dd829c688dfaf2ddfc82debf4cc4309bba54834bf9ff1e6bcea` and pinned shard commitment `0xaac9d1c1dd09ab974cce813d5d612d3bd2c3d0951f3c9df7ee3e6bce49cfb4af`.

A separate **synthetic local-state control** shifted all active chunk positions and the processed counter forward by 65,536, preserving numeric state and the sampling counter. The next tokens and full-logit hash stayed identical; an actual local advancement then reached processed position 65,687 at 28,293,307 gas. This validates the implementation's position independence but is not evidence of 65,687 generated tokens. The separate uninterrupted PoolManager run completed 2,060 successful swaps and 2,073 generated tokens, crossing position 2,048 without a reset. Its maximum whole-swap gas was 28,423,709; all 2,060 token sequences and full-logit hashes matched the independent reference.

## State and safety

Model state is namespaced by caller and story identifier. A hook owns its pool namespace; an unrelated caller cannot alter it. Callers supply a seed and the expected current context hash, not arbitrary numeric state. Each advancement recomputes the actual next model step and creates an immutable data child before committing the new head.

Checks passed for stale context rejection, caller isolation, altered active-chunk rejection, and ignoring expired chunks outside attention. Chunk headers use a 64-bit absolute start index; model counters are also 64-bit. Arithmetic overflow reverts. There is no short table-lifetime limit, but no claim of mathematically infinite storage or computation.

## Practical limits

A swap produces one or two incremental tokens. Complete sentences generally span several swaps. Sixty-four recent positions are directly attended; their cached states can carry older influence, but indefinite plot coherence is not guaranteed. The long reference contains repetition, semantic errors, and naturally emitted EOS tokens. EOS remains the next input rather than triggering a software reset.

Measured gas comes from one seed-42 stream with top-k 8 and temperature 800. Other activations and seeds need preview and gas checks. Stored data contracts accumulate over time. The earlier 10,000 independent-sentence catalog concerns a different decoding setup and does not establish 10,000 unique continuous stories.

No public-chain transaction was sent for this work. The separate relative-benchmark report passed PoolManager gas, stale-state, per-pool isolation, active-cache tampering, and post-settlement rollback checks. The hook remains restricted to local chain 31337; a production deployment artifact and review are still separate work.
