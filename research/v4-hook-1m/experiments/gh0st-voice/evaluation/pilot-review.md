# First voice pilot: technically valid, language quality not accepted

Reviewed 2026-10-24. This review concerns checkpoint SHA-256 `261c45b1813f3a49c2cbaf0f09c1e710e97e53b4cdd06d0e74975a29b0941df3`, model source SHA-256 `d005518f280e001abe549891a0829bf4d31ab339f9d0d029a684c5ab5e97d695`, and the first selected export. Later checkpoints require a separate review.

## Measured local execution

The tuned model completed 80 of 80 real swaps through an unforked local Uniswap v4 PoolManager, producing 93 tokens without a context reset. All 80 token arrays, terminal flags, and complete final 4,019-logit hashes matched the independently implemented Q12 reference. Swap gas ranged from **13,321,714 to 28,427,411**, leaving **3,572,589 gas** below the 32M transaction cap at the worst observed swap. The 64-position window was reached on swap 51; 30 swaps with a full window used 28,194,939–28,427,411 gas.

Hash checks, invalid/stale hook data, insufficient gas, forced post-inference rollback, model and history tampering, caller isolation, and pool isolation passed. The 544 model-data runtimes were injected into the local chain after hash verification. Their deployment costs are excluded. No public transactions were sent, and the local Anvil node was stopped afterward.

Evidence: `../evm/gh0st-voice-smoke-local.json`, `../evm/independent-report-check.json`, and `../evm/gh0st-voice-smoke-transcript.txt`. Main report SHA-256: `eae71a484cfa1b875b6f91e78b5264f252b8f0f4747df6af8c7686cfca5866ba`.

## Language result

The pilot changes the subject matter and early first-person wording, but it does not yet maintain the intended GH0ST voice or reliable English. The exact on-chain-parity stream begins:

> i wanted to find a way to use a real mission to a world of chaos. this is a place where people need a machine.

It soon returns to a pond, an old man, and a named child, with unclear referents:

> a small pond, a small pond, a wise old man, sat by the pond.

Other independently generated seeds show the same weaknesses. Examples include “a small town was a young girl,” a machine/robot loop, and a door repeated without developing the thought. These are category errors and continuity problems, not desirable surrealism. Some passages sound more like a machine speaker, but the shift does not persist.

Across ten fixed-seed 150-token Q12 samples, a descriptive parser counted 120 completed tuned sentences, all different after word normalization, and found no exact 12-word run shared with the new fine-tuning corpus used for the check. The same parser counted 168 base-model sentences with ten duplicate occurrences. These small-sample automatic numbers are **not evidence of improved meaning, 10,000 good variants, or absence of memorization from original pretraining**. `selected-free-generation-metrics.json` records them; these were free-generation samples, not the held-out prompt suite.

## Decision

**Pass execution and exact integer parity; fail the language-quality acceptance gate.** Retain this as an experimental checkpoint. Do not release it as having matched Truth Terminal's voice or capabilities. A second training pass should emphasize connected first-person streams, correct referents, clear grammar, and natural transitions after sentence boundaries. Its complete transcript should be assessed before repeating gas testing.
