# Exact Solidity batching under 32M gas

Local research only. No public RPC, signing, transaction submission, model retraining, weight changes, or WASM execution is used.

`GRU2BatchCheckedModel.sol` keeps the 8,175,493-parameter Q10 model and the original `stepSampled` ABI. The additive `stepBatchChecked` method executes one to three neural word steps in the same EVM call. It stops immediately at model-generated terminal punctuation. It does not require the returned text to be a complete sentence, insert punctuation, alter sampling, or reset story state.

The implementation allocates reusable GRU, row, table, head, and sampler scratch buffers once. Each generated word has its own returned hidden state and 197 scores, so a calling hook can validate every step and reconstruct exactly the original state-hash chain. No free-memory pointer rewind or memory reuse outside explicitly owned buffers occurs.

## ABI and bounds

```solidity
stepBatchChecked(
    uint16 previous, uint8 previousPunct, int16[768] state,
    int32[6] features, bytes32 seed, uint256 wordIndex,
    uint16 temperature, uint8 maxWords
) returns (
    uint16[3] tokens, uint8[3] puncts, int16[768][3] states,
    int256[197][3] scores, string[3] texts, uint8 count, bool terminal
)
```

`maxWords` must be 1–3. `wordIndex + maxWords - 1` must not overflow. All existing input bounds are retained. Every unused token, punctuation, hidden-state, score, and text slot is zero/empty. `count` is at least one on success. `terminal` describes the final generated word.

The canonical return is at most **93,312 bytes**, independently checked with ethers ABI encoding for 12 combinations of count and string length. The maximum assumes three 33-byte word-plus-punctuation strings. Actual three-short-word returns are 93,216 bytes. A hook must bound return data, validate canonical scalar values and offsets, validate all active hidden states/scores/texts, require zero unused entries, and retain its existing rollback policy. This model primitive does not replace those responsibilities.

## Measured direct-call results

Solc 0.8.30, viaIR, optimizer 200 runs, Cancun, unforked Hardhat chain 31337, 32M transaction limit. Model shard data is injected locally for inference benchmarking; this is not a deployment cost simulation. `checked-results.json` contains all measurements.

| Generated words | Direct checked-batch gas | Example |
|---|---:|---|
| 1 | 9,447,131–9,624,443 | `the` |
| 2 | 17,281,970–17,469,031 | `the cost` |
| 3 | 25,110,841–25,242,795 | `the cost cache` |

The third mixed input terminates naturally after two words; requesting a cap of three returns that same two-word result. Every generated token, punctuation, hidden state, score, and text matches sequential calls to the prior validated model. These are **direct model-call costs**. Pool execution, hook validation, events, and storage still need independent integration measurements before stating a complete-swap gas cost.

A final-state-only prototype is retained in `GRU2BatchModel.sol` as a baseline, with `results.json`. Its three-word gas is 25,017,749–25,149,703. Its corresponding sequential wrapper costs 27,035,377–27,167,010 in the same transaction, so the batching benefit is not solely a comparison against cold separate transactions. The checked version uses the newer exact `evm32/kernel/combined.sol` kernel and returns all intermediate states.

The checked runtime is 13,667 bytes; initcode is 16,070 bytes. `stepSampled` return bytes remain identical, including text, all 768 hidden values, all 197 scores, and terminal status. The extended run passes all 23 full-return compatibility vectors, nine capped batch comparisons, and 11 invalid-input cases. Rejected inputs include: zero/oversized cap, invalid token/punctuation, low/high temperature, word-index overflow, low/high hidden state, and low/high feature.

## Reproduction

From the research root, with its installed Node dependencies:

```sh
python3 experiments/gh0st-voice/nova-fast-market/evm32/batch/build.py
python3 experiments/gh0st-voice/nova-fast-market/evm32/batch/build.py --combined
node experiments/gh0st-voice/nova-fast-market/evm32/batch/benchmark.mjs
node experiments/gh0st-voice/nova-fast-market/evm32/batch/benchmark-checked.mjs
node experiments/gh0st-voice/nova-fast-market/evm32/batch/benchmark-checked.mjs --full
node experiments/gh0st-voice/nova-fast-market/evm32/batch/check-abi.mjs
```

`--full` adds the saved extreme-state, sampler-boundary, and temperature vectors to single-step compatibility checking; batch comparisons retain the three fixed vectors. Source hashes are pinned in `build.py` and recorded in each report.
