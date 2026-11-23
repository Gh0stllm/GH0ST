# Stronger Image Studio model candidates

The twelve-subject, three-color decoder remains a small on-chain feasibility baseline. Its Robinhood review was left unsigned while we evaluate a stronger model.

## Mini Pixel Art M-P1

We generated 16 distinct native 16×16 RGBA images in the author's WebGPU demo using the int8 M-P1 model, seed 24680, 16 steps, guidance 1.5, and four variations each for “side-view knight with sword”, “wooden treasure chest”, “pink flower”, and “blue crystal”. Every output was captured as the model's native PNG. All four prompt categories were visually recognizable in this batch. It is a small-sprite comparison, with no benchmark for larger scenes.

The author reports 4.35 million parameters, 4.5 MB int8 weights, 16 denoising steps, and a learned vocabulary. At 22,170,000 wei per gas, storing approximately 4.5 MB as EVM bytecode at 200 gas per byte alone would cost approximately 0.01995 ETH. That is a storage-only calculation, before deployment overhead, data posting, and inference. The actual model ran in the browser for this evaluation. Robinhood fixed-point inference and per-image gas are still open.

[Model and evaluation](https://github.com/AnticPan/mini-pixel-art#models) · [Public demo](https://anticpan.github.io/mini-pixel-art/) · [EVM initcode and code-deposit costs](https://eips.ethereum.org/EIPS/eip-3860)

## PXG-Tiny

We ran the published NumPy pipeline at model revision eb8f5394da5bf343eb01e9a0a19f0ab624a7f8d2 with seed 7 on four prompts. Each 16×16 result repeated pixel for pixel. The wizard and songbird read clearly. The potion and cottage were ambiguous. The downloaded weight archive is 1,808,077 bytes and contains FP32 arrays. The measurements include the model's built-in retries.

[Released model](https://huggingface.co/Tarul/pxg-tiny/tree/eb8f5394da5bf343eb01e9a0a19f0ab624a7f8d2)

## Direction for Robinhood

Use M-P1 as a visual benchmark. A quantized, single-pass decoder trained for a broader set of subjects, colors and scene layouts is a candidate for keeping inference on Robinhood. Evaluate the identical quantized artifact on held-out prompts, compare it against the M-P1 gallery, and measure the full Robinhood deployment and per-image fees before preparing a fresh review.
