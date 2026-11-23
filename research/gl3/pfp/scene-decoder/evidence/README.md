# GH0ST Scene Decoder · 32 × 32 research baseline

Visual review found coarse or incomplete subject shapes in this candidate. It remains in the research branch for comparison alongside the [native 64 × 64 layered model](../v3/).

- [Quantized model pack](pack500.bin) · 500,000 bytes · SHA-256 `46d823ec0ad9585c4496ff75e22606a78041f724dd218d209083ad28de9658cd`
- [Sample gallery](model-samples.png) · 14 selected held-out model outputs at 32 × 32, enlarged for viewing
- [Packed images and prompts](vectors.json) · one single-subject and one two-subject example from each of seven styles
- [Supported prompt fields](vocabulary.json) · 24 subjects, eight tints, eight backgrounds, three layouts, seven styles and 16 palettes

![Selected outputs of the trained GH0ST Scene Decoder](model-samples.png)

## Training and image quality

The model trained on 28,672 original programmatically drawn scenes. The held-out set contains 896 prompts, including two-subject combinations excluded from training. These scenes share the original subject designs used in training. The frozen five-bit export matched **80.4% of all source palette indices** and **71.5% of source foreground indices** exactly. Background pixels contribute to the first figure. The gallery selects outputs by foreground-pixel agreement. These are pixel agreement measures and no human preference study was run. Some two-subject prompts still produce coarse or incomplete shapes.

The initial training pass reached about 3% exact foreground-pixel agreement. The final run used a larger training set, separate shade roles for each subject, and more emphasis on foreground patches. The on-chain renderer applies the requested tints to those roles. [Per-style metrics](training.json) and [training implementation](../train/).

## Robinhood gas

All 14 images and palettes matched the integer reference byte for byte in read-only Robinhood simulations at block 121618862. Each `generateAndRecord` call ran complete inference within one transaction at **23,614,877–23,634,926 gas**. At the sampled rate of 21,676,000 wei per gas, the highest estimate was **0.00051231 ETH**. The estimate includes the image-hash event. This run used temporary state overrides for the exact model pack and contract. [Complete gas evidence](robinhood-full.json).
