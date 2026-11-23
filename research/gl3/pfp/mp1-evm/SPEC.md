# M-P1 Q5 inference on Robinhood

The target is the tested 2,976,901-byte M-P1 package, with all weights and all image inference on Robinhood. The published browser predictor is the quality reference. The existing 31-shard quote covers storage.

The implementation uses signed little-endian Q16.16 activations, original packed five-bit coefficients and exact Float16 group scales represented as integers. Golden outputs will test the full deterministic sampler and independently check each contract operation. The target sampler has 16 steps with the published guidance and timestep schedule.

A full image contains 37,590,663,168 multiply-accumulates in dense and attention operations, based on the published architecture and sampler. The initial Robinhood measurements will distinguish measured contract calls, projected image workload, and the eventual full replay. No production transaction is part of this test phase.

[Q5 storage and browser samples](../bench/mp1-packed.md) · [Publisher model source](https://github.com/AnticPan/mini-pixel-art/tree/b0ba29f8994082ab1af89351bcce9f2d86919269)
