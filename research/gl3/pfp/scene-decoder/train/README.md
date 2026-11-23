# Training the 500 KB Scene Decoder

The training sources make original 32 × 32 scenes from 24 subject designs and eight backgrounds. Each prompt selects one of seven learned styles, two subject and tint slots, a spatial relation, a background, and a palette. A seed sets small changes in the training scene. The on-chain inference path uses the learned weights and patch dictionaries.

Training fits a 128-patch dictionary for each style using training scenes only. The first pass produced almost no correct foreground. The revised training uses canonical shade slots for each subject and emphasizes foreground patches in the loss. The on-chain renderer maps those slots to the requested tints, freeing the dictionaries to represent shapes across colors. The training jointly fits the scene projections, shared spatial layers and patch classifier, with simulated five-bit layer weights late in training.

The independent integer decoder in `quant.py` evaluates the serialized export. The full validation set includes unseen two-subject layout combinations formed from the same source subject designs. Example images are selected from that set by foreground-pixel agreement, with aggregate metrics available separately.

Install PyTorch, NumPy and Pillow, then run from this directory:

```sh
python train.py --device mps --dataset /tmp/gh0st-scene-v2-dataset.npz --output ../evidence
python render_samples.py --evidence ../evidence
```

Use a fresh dataset path when changing the seed or dataset settings. On machines without a Metal GPU, the training command also accepts `--device cpu`. Exact contract parity is checked against the saved export and vectors.

The pack is 500,000 bytes. It contains seven 67,584-byte expert sections and one 26,912-byte shared section. Layer weights are signed five-bit codes stored little-endian within bytes, with 16 added to each signed value before packing. Per-output scales use little-endian unsigned Q0.16. Biases and intermediate activations use signed Q10. A Q5 dictionary code from 8 to 10 selects a shade of the first subject. A code from 11 to 13 selects a shade of the second subject. Each checked vector records the final packed pixels, RGBA palette, canonical prompt ID, and seed.
