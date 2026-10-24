# Buffered complete-sentence hook review

Scope: `kernels/NovaSentenceBufferedHook.sol`, SHA-256 `20fa9fc808d36cf6ac8b3c2ed9cb5b382aafd752cd3e726bfc5513abce64a07d`. This is an internal local review, not an external audit or a deployment approval.

The buffered version keeps the same sentence loop and fail-closed policy as the initial sentence candidate. Every word comes from another model call using the previous hidden state and a new sample index. It accepts a completed sentence only when the validated model output contains terminal punctuation; it never forces punctuation. The loop stops after 32 words and reverts if none is terminal. Stored hidden state, context, sentence count, token balances, and emitted logs all roll back on failure.

Eight existing functions are byte-for-byte unchanged: callback permissions, pool/caller authorization, initialization callbacks, the 12-bit hidden-state loader/saver, word verification, and `decodeStep`. The decoder still checks canonical ABI, token and punctuation bounds, all 768 hidden values, all 197 scores, terminal consistency and exact vocabulary spelling. The immutable model code hash is checked before every inference. The 2M callback reserve, 1.5M decoder cap, and 150k word-lookup cap remain. Reserve amounts are safeguards, not a claim that every allowed path always succeeds with exactly that much remaining gas.

The change allocates bounded buffers once, including 24,932 bytes for model calldata, 31,172 bytes for decoder calldata, 24,736 bytes for state hashing, 6,816 bytes for word-event data, and 1,087 bytes for the sentence. It also explicitly allocates 192 bytes for the six-field `Generation` memory struct. It does not rewind Solidity's free-memory pointer or reuse memory still needed by the caller.

The model's static-call return is copied into the decoder buffer with a fixed maximum copy size. `returndatasize` is checked before the decoder receives it. The unchanged decoder runs in a bounded self-call. Only after that call succeeds does the hook borrow typed pointers from the canonical bytes: hidden state at byte 64, scores at 24,640, string length/data at 31,008/31,040, and terminal flag at 30,976. The outer frame keeps these bytes stable until the next inference. Before that next model call overwrites the decoder buffer, the previous hidden state is copied to the separate model-input buffer.

The event data follows the original `WordSpoken` ABI and topic order. The string offset is 6,720; the maximum event data length is 6,816. State hashing uses the same `abi.encode(modelHash, poolId, sequence, token, punct, hiddenState)` layout as before. The sentence buffer copies actual word bytes and optional spaces, then shortens its length after completion. Its maximum size follows directly from 32 words of at most 33 bytes plus 31 spaces.

Evidence:

- `buffered-abi-proof.json`: 48 independent standard-ABI comparisons, including negative hidden/score/feature limits and maximum-size strings, with all model calldata, decoder calldata, borrowed views, state hashes and event encodings matching.
- `buffered-sentence-callback-results.json`: seven local callback cases. Two words commit a sentence; a second-word revert, invalid hidden state, gas exhaustion, or forged text roll everything back; missing terminal punctuation hits the explicit cap; terminal punctuation on word 32 commits.
- `buffered-sentence-abi-results.json`: passes actual EVM checks of 36 event encodings and 34 independent word-state hashes, in addition to the seven callback cases.
- `buffered-max-text-abi-results.json`: repeats the seven EVM cases with 33-byte words, 31,104-byte model returns, and an exact 1,087-byte 32-word sentence. All 34 word-state hashes and 36 event encodings match. The successful mock boundary sentence consumes 28,086,999 gas; this is not the real model cost.

The callback fixtures do not execute the real PoolManager or transfer assets. Actual model quality, total sentence gas, and pool settlement are established only by the separate real-model integration reports. A successful mock sentence is not evidence of real-model throughput. The initial complete-sentence model experiment already exceeded the 32M target; this optimization does not imply ten real sentences per second.
