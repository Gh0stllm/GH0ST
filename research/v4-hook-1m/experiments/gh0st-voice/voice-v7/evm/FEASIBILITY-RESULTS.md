# V7 two-layer GRU128 + learned punctuation: feasibility

**Local numerical/gas feasibility passed. The weights are random; no language-quality claim is made.**

Four primary swaps completed through a real local Uniswap v4 PoolManager, plus a separate-pool isolation swap. Every primary swap emitted a nonempty lexical word with optional punctuation. The independent reference matched all256 hidden-state values and all197 evaluated logits on each primary swap, including scalar checks of both GRU layers and all three heads.

| Measurement | Gas |
|---|---:|
| Maximum primary swap |25,632,658|
| Mean primary swap |25,512,063|
| Minimum primary swap |25,465,858|
| Direct model step |24,707,011|
| Model constructor |5,758,341|
| Margin below32M |6,367,342|

The model runtime is14,557 bytes. All calls ran on isolated chain31337 with a32M transaction/block gas cap. Data-shard and catalog runtimes were injected locally; their deployment gas is excluded. No public-chain actions occurred.

Learned punctuation classes included comma, period and exclamation. State persisted across sentence endings. The fixture output was `w. nursery, creates, dragoman!`; this is explicitly an arithmetic test, not a sample of trained language.

Post-inference rollback, low-gas rejection, malformed/stale inputs, modified-model rejection, unauthorized callback rejection and separate-pool isolation passed. The4-swap feasibility run does not replace the later trained-checkpoint long-run, caller, boundary and quality tests.

The model has2,364,805 source parameters. Only first-layer word/punctuation projections are precomputed; second-layer input remains a real dense multiply on the newly generated first-layer state. Punctuation is selected by a third neural head, not added by a word-count rule or sentence bank. `LAYOUT.md` defines the exact export contract.
