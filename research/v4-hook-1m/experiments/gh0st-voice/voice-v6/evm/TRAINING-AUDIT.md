# Voice V6 training audit

Independent audit completed before a final trained candidate was selected. No model training or EVM transaction was performed by this audit.

## Verified

`training_audit.py` compares the block-packed adaptive head with a separate direct per-group cross-entropy implementation. It checks both scalar loss and every parameter gradient in CPU float64. Cases include padding, more than 64 examples from one target group, nonbinary loss weights, masked burn-in, two domains, a mid-sequence reset, and an unknown input followed by supervised known words.

Both cases passed. The largest absolute gradient difference was 2.67e-15. The input-only UNK embedding receives a nonzero future-context gradient, while the output head remains exactly 8,192 rows. Duplicate group weight gathers accumulate the correct gradient. Zero-weight targets introduce no direct output loss.

The fixed runtime domain uses the same additive bias semantics as the trainer: separately quantized `bh` and `domain[0]` are summed before their Q20 contribution is folded into each input row. The final extra embedding row is training-only. The exporter excludes it and reports the distinction.

## Findings addressed by the training owner

The first version saved NumPy randomness but omitted CPU/MPS Torch RNG state. That caused resumed dropout draws to diverge from uninterrupted training. The audit includes a reproducer. The owner added both RNG states to checkpoint save/restore.

The first version did not verify the loaded corpus files against their manifest. The owner added checks for the vocabulary and the three corpus split files. The raw report includes the exact source hashes inspected when its tests ran; later owner changes are separate from those historical hashes.

## Remaining performance opportunities

- `int(over)` and `int(n)` synchronize MPS on every iteration. `word_counts` already provides the known target count on CPU. Clipping counters can accumulate on the device and be copied only for a log/checkpoint. Keep the nonfinite safety check.
- Group packing currently includes masked warm-up and unknown targets. Packing only positive-weight target positions preserves this objective and avoids unnecessary head work. It does not remove recurrence through those input positions.
- A block uses up to 64 positions and is padded independently for each group. At 8,192 positions spread over 128 groups, padding and repeated group gathers can be substantial. Measure batch sizes and block widths on this MPS device before changing the default.

These are optimization suggestions, not demonstrated speedups. No training-owned code was changed by the auditor.

Language quality remains unapproved; correct loss and gradients do not establish coherent generation.
