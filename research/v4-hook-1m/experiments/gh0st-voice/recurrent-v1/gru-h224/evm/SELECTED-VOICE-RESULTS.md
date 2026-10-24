# Selected GRU voice checkpoint: local technical result

**128/128 real local v4 swaps succeeded. Each swap emitted exactly one newly
generated word. Language quality remains unapproved.**

The tested checkpoint is
`training/runs/voice-v3-1m/checkpoint-08253456`, exported with the locked
`data-v3` vocabulary. Sampling uses seed42 and Q10 temperature256. The model
starts from its start-token embedding and zero state; no visible prompt or
stored sentence is inserted.

| Measurement | Result |
|---|---:|
| Successful local swaps / requested swaps | 128 / 128 |
| Generated words | 128 |
| Minimum whole-swap gas | 21,998,012 |
| Mean whole-swap gas | 22,006,666 |
| Maximum whole-swap gas | **22,280,162** |
| Headroom below32M | 9,719,838 (30.37%) |
| Natural terminal words | 12 |
| Transitions after natural terminals preserving state | 12 / 12 |
| Independent exact hidden-state/decoder comparisons | 128 / 128 |
| Model constructor gas | 5,585,371 |
| Model runtime bytes | 5,200 |
| Public transactions | 0 |

Every generated token, all224 signed hidden values and all13 visited decoder
scores agree with the independent Q10 reference. The reference recomputes
unfused input matrix products, and every step additionally checks input and
recurrent products with scalar Python sums. The export audit verifies all
5,505,696 fused values, every artifact hash, the8192 word records and the exact
sigmoid table. Twelve random signed-state/feature inputs also pass scalar
arithmetic checks.

The sequence counter advances once per successful word. All12 selected
terminal words retain the hidden state and previous token for the next swap.
The final state has224 nonzero values,113 negative. This is numerical state
continuity; it does not establish coherent meaning across sentences.

The actual local PoolManager swaps settle both test tokens. Tests pass for
forced rollback after inference, low gas, malformed/stale input, changed model
runtime, unauthorized callbacks and isolated pool state. Every failed swap
preserves the corresponding state and balances. Inference failure cannot
silently skip speech: it reverts the swap.

## Actual language limitation

The generated text begins:

> i asked a coin to a friend by the future. it looked at the same space every
> day a black than any of the loss was only to make it and i have to be talking.

It then switches to a boy, a map and the wind, with malformed or disconnected
clauses. The complete128-word output is preserved in
`selected-voice-128-transcript.txt`. Nothing was rewritten or filtered. This
checkpoint meets the requested local gas and emission behavior, but it does
not meet the intended fluent, sustained GH0ST voice and should not be presented
as a quality-approved release.

## Scope and evidence

The unforked local Hardhat chain enforces chain31337 and a32M transaction/block
cap. Both model and hook constructors reject other chain IDs. There are1326
data shards and four packed-address catalogs, installed locally after byte/hash
checks. Their deployment cost is excluded from per-swap gas. The source model
has3,983,967 learned parameters; its compact runtime also stores derived input
values, which are not additional independently learned parameters.

- `selected-voice-128-local.json`: receipts, words, signed states, features,
  scores and guard checks.
- `selected-voice-128-reference.json`: exact independent parity result.
- `selected-voice-8253456-export-audit.json`: full derived-array and source
  arithmetic audit.
- `selected-voice-128-summary.json`: hashes tying those artifacts together.

Checkpoint SHA256:
`1444fac961a8228b87c111920869d51ec09cd7a5a16786a35e07bda983765347`.

Raw local result SHA256:
`8c8f153c68fdc689217b8fe21c427a224336adc210c66ebd7ac707d0be5d3cc1`.
