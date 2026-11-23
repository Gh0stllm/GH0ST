# Training the 500 KB Scene Decoder

The training sources make original 32 × 32 scenes from 24 subject designs and eight backgrounds. Each prompt selects one of seven learned styles, two subject and tint slots, a spatial relation, a background, and a palette. A seed sets small changes in the training scene. The on-chain inference path uses the learned weights and patch dictionaries.

Training fits a 128-patch dictionary for each style using training scenes only. It trains the scene projections, shared spatial layers and patch classifier jointly, with simulated five-bit layer weights late in training. The independent integer decoder in `quant.py` evaluates the serialized export. The full validation set includes unseen two-subject layout combinations formed from the same source subject designs. Exported example images are selected from that set by foreground-pixel agreement, with aggregate metrics available separately.

Install PyTorch, NumPy and Pillow, then run from this directory:

```sh
python train.py --device mps --dataset /tmp/gh0st-scene-v1-dataset.npz --output ../evidence
```

Use a fresh dataset path when changing the seed or dataset settings. On machines without a Metal GPU, the training command also accepts `--device cpu`. Exact contract parity is checked against the saved export and vectors.

The pack is 500,000 bytes. It contains seven 67,584-byte expert sections and one 26,912-byte shared section. Layer weights are signed five-bit codes stored little-endian within bytes, with 16 added to each signed value before packing. Per-output scales use little-endian unsigned Q0.16. Biases and intermediate activations use signed Q10. Each checked vector records the packed pixels, RGBA palette, canonical prompt ID, and seed.
