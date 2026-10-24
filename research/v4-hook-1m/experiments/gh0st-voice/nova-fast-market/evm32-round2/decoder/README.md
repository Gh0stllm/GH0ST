# Lossless packed batch validation (local Solidity research)

No public-chain calls or deployments are used by these tests. The neural checkpoint and per-word hashes remain unchanged.

`NovaPackedBatchTextHook.sol` replaces the 93 KB ABI batch return with a canonical 7,168-byte ABI return containing a 7,089-byte fixed-format payload. The three slots retain every token, punctuation value, hidden-state cell, score, and text byte. The contract keeps the immutable pool/model binding, bounded static calls, strict atomic failure policy, sequence protection, all intermediate state hashes, and strict callback reserve. The initial packed hook preserves the 3.25M reserve; `NovaPackedBatchTextHookTuned.sol` restores the original 2M reserve after reducing the decoder cap from 2.4M to 800K and verifying the full security suite. It does not change the model, sampling, or maximum three words per swap.

The decoder verifies the exact outer offset, logical length, magic, count, terminal flag, and 15 trailing padding bytes. For each used slot it validates token and punctuation ranges, hidden-state range, natural sentence termination, text length and padding, and exact bounded vocabulary lookup. Every byte of unused slots must be zero. Every four-byte score has exactly one signed int32 interpretation, matching the prior score range; the model packer separately checks its full-width score before encoding. The hook expands only validated hidden states and text into memory. Scores are validated by their representation and remain unused after validation, as in the preceding compact event hook.

The 2,361-byte slot contains token (2 bytes), punctuation (1), text length (1), text padded to 33 bytes, 768 signed big-endian int16 state values, and 197 signed big-endian int32 scores. `NV01`, count, and terminal occupy the initial six bytes. All offsets are fixed; there are no payload pointers or aliases.

## Verification

- `test-oracle.mjs` compares the new packed decoder with the unchanged prior ABI decoder for 75 valid full-state vectors (all counts, punctuation choices, vocabulary edge lengths, exact numeric endpoints, and random cells). It also checks malformed raw ABI and packed values. The 214 total cases passed, including three vocabulary calls burning 140,000 gas each under the tuned 800,000-gas decoder cap. The packed decoder's measured execution, including its test wrapper, is 96,391 / 166,610 / 236,829 gas for 1 / 2 / 3 words. The old decoder measured 1,733,567 / 1,938,370 / 2,143,173 on the identical vectors.
- `prove-representation.py` exhaustively checks all 65,536 int16 bit patterns against the EVM range-check expression. Exactly the 2,049 values from -1024 to 1024 are accepted.
- `test-packed-security.mjs` runs the real local PoolManager, token, locked vault, router, and the packed hook with adversarial mock outputs. Its model fixture is deliberately much slower than the production assembly packer. The synthetic gas burn is calibrated using the fixture's actual packed entrypoint. The conservative and tuned hooks each passed 111 checks. `packed-tuned-headroom/sentence-security.json` records an additional 111-check run where the model executed for 25,799,998 gas inside the 26M cap; the entire trade used 26,869,000 gas. Contract-wallet buys and sells each retained three-word output with the tuned hook. All values are mock integration measurements, not neural-model swap costs.
- `NovaRawDecoderHook.sol` is an alternative preserving the original large ABI. It passed 111 full PoolManager mock security checks and the same independent oracle. It is retained as a fallback and comparison, not the selected packed transport.

The initial packed fixture run (`packed-security-initial-fixture-budget/`) failed its oversized 24M synthetic-burn case because the naive test adapter itself added roughly 3M gas. It reached 107 security checks. It was superseded by a run calibrated against the actual packed fixture call. That diagnostic is not a production-model failure.

Run these commands from the research root with the installed Node runtime:

```text
node experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/test-oracle.mjs
python3 experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/prove-representation.py
node experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/test-packed-security.mjs --source=evm32-round2/model/GRU2PackedModel.sol --export=selected --hook=evm32-round2/decoder/NovaPackedBatchTextHook.sol --out=evm32-round2/decoder/packed-security --budget=26000000 --tx-gas=32000000 --sentence-security
```

These are local research checks, not an external security audit or a claim of mainnet throughput.

For the selected tuned hook and calibrated headroom suite, run `test-packed-tuned-security.mjs` with `--hook=evm32-round2/decoder/NovaPackedBatchTextHookTuned.sol` and `--out=evm32-round2/decoder/packed-tuned-headroom`; all other arguments stay the same.
