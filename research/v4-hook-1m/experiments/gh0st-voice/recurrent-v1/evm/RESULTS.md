# One-word-per-swap continuation prototype

**30/30 local swaps emitted exactly one real model word.** The maximum whole
swap cost was **20,293,147 gas**, below the32M limit. This verifies the revised
continuation protocol using the earlier100-update capacity model; it is not an
evaluation of the new model currently being trained.

The word sequence, including its two naturally selected punctuation marks, was:

> the market moves but my questions remain quiet the pool still brings a
> shifting signal through another moment. i now find one restless rhythm
> beneath the price. the pool moves

There was no inserted period or supplied visible prompt. The initial input was
the model's start-token embedding. Both naturally punctuated words preserved
all recurrent hidden state and the previous token for the next swap. Every
successful swap produced text; inadequate gas or failed inference reverted.

| Measured property | Result |
|---|---:|
| Actual local PoolManager swaps | 30/30 successful |
| Model words emitted | 30 |
| Minimum whole-swap gas | 19,953,271 |
| Mean whole-swap gas | 19,974,107 |
| Maximum whole-swap gas | 20,293,147 |
| Natural terminal words | 2 |
| Hidden values compared per step | 265/265 |
| Visited decoder scores compared per step | 13/13 |
| Independent matching steps | 30/30 |
| Public-chain transactions | 0 |

The independent Q10 reference matched every output word, all265 hidden values,
all13 visited branch scores, and natural terminal flags. The first two steps
also compared NumPy matrix arithmetic against explicit scalar Python sums.
The sampling counter advanced exactly once per emitted word.

The local tests passed for stale/malformed input, low gas, a forced revert after
inference, changed model runtime, unauthorized callbacks, and isolated pool
state. A failed transaction left the model state, pool state and wallet balances
unchanged. Pool isolation compares the two pools' states separately because
funding or trading in another pool legitimately changes shared wallet balances.

The actual v4 PoolManager and settlement router ran on an isolated in-process
Hardhat chain31337 with a32M transaction/block cap. Model and hook constructors
reject other chain IDs. All386 data runtimes were installed locally after exact
byte/hash checks; their deployment cost is excluded. The runtime's514-byte
sigmoid table also matches the exported table exactly. No above-cap control was
used by this prototype.

The raw EVM report is `initial-prototype-local.json`; it is preserved with status
`EVM_PASS_AWAITING_INDEPENDENT_REFERENCE`. The separate completed reference report
is `initial-prototype-reference.json`. Their hashes and combined pass status are
recorded in `initial-prototype-summary.json`.

This confirms a feasible per-swap computation path, not high-quality sustained
language. The old weights were trained only100updates with partial vocabulary
coverage. New vocabulary/training must receive fresh quality, quantization,
parity and gas checks before any release decision.
