# V8: fully neural words, punctuation and persistent state

**Local research only. Language quality has not been approved.**

The user rejected a grammar engine. Every lexical word and punctuation mark in
this experiment is therefore selected by trained neural logits. There is no
runtime sentence bank, slot filler, grammar mask, forced period or text repair.
The model retains both recurrent layers across swaps and sentence endings.

## What changed

1. An exact eight-lane integer dot product makes a much wider recurrent model
   practical. It changes execution cost, not the quantized arithmetic result.
2. The model has two 384-wide GRU layers and 8,175,493 source parameters, compared
   with the 2,364,805-parameter H128 V7. A function-preserving float widening
   initializes it; only subsequent training can add learned capability.
3. Words and punctuation have separate neural heads. The vocabulary contains
   bare words so rare word-plus-period spellings cannot remove sentence endings
   from training targets. Punctuation remains supervised for unknown words.
4. Training carries state across chunks of the same source document. A small
   auxiliary loss contrasts correct gold continuations with prefix-invalid
   forms such as `I has` or an inflected verb directly after `I can`.

The auxiliary labels are **training-only**. Article and perfect-participle
alternatives that depended on seeing a future word were excluded. There are
25,228 accepted labels in the frozen training split. The loss compares actual
normalized hierarchical word probabilities; it does not add an inference rule.

## Data and limitations

The V7 curriculum contains 28,000 synthetic episodes (about three million words)
from 40 causal families and 320 paired-stage patterns. It is explicitly
compositional training material, not 28,000 independently authored essays.
Validation/test families and held-out combinations are separate. The active V8
trial also uses the previous adult-prose and original first-person splits.
None of the text-generation scaffolding is called by the hook.

The corpus aims at a first-person reflective voice. It is not a copy of another
agent's private training data, and no current result establishes a convincing
Truth Terminal-like voice or reliable long-range continuity.

## Technical evidence

The random-weight H384 feasibility test completed four primary local Uniswap v4
swaps and a separate-pool isolation swap. Maximum whole-swap gas was 23,239,218.
All 768 state values and 197 logits matched an independent scalar reference.
The H512 experiment exhausted its 32M direct-inference allowance and failed.
These are technical fixture results, not trained-model language results.

The H384 fixture uses approximately 66.32 MB of static model data in 2,766
24 KB shards. Those shard runtimes were injected into the local EVM. Their
deployment cost is excluded from the measured swap and constructor figures.
This research does not claim an inexpensive real-world deployment.

See `evm/RESULTS.md`, `evm/SIMD-REPORT.md`, the V7 independent mathematical
audits, and the frozen trained-checkpoint reports when available. GPU throughput
measurements are synthetic timing tests, not quality evidence. No public RPC,
wallet signing, or mainnet transaction is needed or authorized for this work.
