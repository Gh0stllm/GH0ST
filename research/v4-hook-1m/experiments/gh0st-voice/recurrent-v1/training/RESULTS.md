# Recurrent ReLU training results

All work was local. No candidate is approved as a coherent GH0ST voice. The architecture remains 4,492,256 parameters; all 8,192 vocabulary entries come from training text and have real target examples.

| Phase | Added supervised words | Recorded seconds | Final balanced CE |
|---|---:|---:|---:|
| initial-4m-gate1m | 1,005,744 | 8.78 | 5.8621 |
| initial-4m-completion | 4,001,776 | 25.59 | 5.5165 |
| grammar-20m | 16,001,744 | 160.88 | 5.5222 |
| voice-finish-1m | 1,006,720 | 15.13 | 5.5809 |

The first million-word review gate was followed by a continuation to 4M with optimizer state preserved. The 20M extension reheated the global cosine learning rate; this is recorded explicitly. Its best balanced validation point was 8,002,128 words, rather than the final checkpoint. Grammar loss improved with further training while authored and teacher losses worsened. All parameter projection counts were zero. The final 20M validation saturation fraction was 0.000674, i.e. 0.0674%.

The one-million-word voice finish resumed the best 8M checkpoint and changed sampling to 60% authored / 25% grammar / 15% teacher. It added 1,006,720 words, not another 20M. All three final held-out source losses worsened versus its starting point; raw sampled text still contained broken clauses and third-person story drift. Further training of this ReLU route was not started.

The data audit records exact source-span continuity, no cross-split text/group overlap, and no unused output leaves in the data. These guarantees do not establish memorization resistance or coherent generated text. Fixed-seed free-running and training-overlap checks are maintained independently in `../evaluation/`.

Q10 exports for the 1M gate, 4M checkpoint, best 8M checkpoint and final 20M checkpoint are saved locally. These files preserve the existing binary layout, but export alone is not a gas/parity test. The final voice-finish checkpoint is preserved for evaluation and was not deployed.
