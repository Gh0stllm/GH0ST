# M-P1 in a 2–3 MB package

We packed the publisher's M-P1 int8 release at revision `b0ba29f8994082ab1af89351bcce9f2d86919269` into 4-bit and 5-bit models. Bias, normalization and position tensors retain their original Float32 bytes. The packages include the weights, scales, tensor metadata, a losslessly packed vocabulary, and the original palette.

| Model | Runtime assets | Matched silhouette IoU | Mean RGB error |
| --- | ---: | ---: | ---: |
| 5-bit | 2,976,901 bytes | 0.933896 | 15.30761 / 255 |
| 4-bit | 2,646,480 bytes | 0.931521 | 21.06654 / 255 |

Independent Python and JavaScript decoders recovered the same Float32 bytes for all 110 tensors and all 10,944 vocabulary mappings. We evaluated reconstructed weights in the same pinned WebGPU predictor with seed 24680, 16 denoising steps, guidance 1.5, and four variations each for six captions. The 5-bit version stayed closer to the original in color and is the selected package. This test measures reference agreement across six captions.

The 5-bit distribution ZIP is 2,996,104 bytes and includes the model, decoder, reproduction instructions, and upstream license and notice. Its SHA-256 is `a4d1b81bd1b4bb40332bbcbdccff6343f897a996901e6b1d6f4b2b7de363ee8a`.

## Robinhood Chain

All 31 exact shard deployment payloads were quoted with read-only RPC simulations at Robinhood block 121585744. The total was 650,976,415 gas, or 0.01449333890356 ETH at 22,264,000 wei per gas. This includes one ordinary deployment and its posting quote for each data shard. Executable inference, the manifest or registry contract, and per-image fees remain outside that estimate. The concatenated pack SHA-256 is `14b714ef8c016b1a321becfa5397d18d9011878e03d46a00eda1cdf68e6491a1`.

The WebGPU comparison tests visual quality. M-P1 still requires approximately 37.6 billion multiply-accumulates per image with the original sampler. A measured Robinhood inference port remains open. A known-good Stylus fixture reverted in a read-only activation simulation at Robinhood block 121582681, where the configured activation charge exceeded the live transaction gas limit.

[Upstream M-P1 architecture and model card](https://github.com/AnticPan/mini-pixel-art/tree/b0ba29f8994082ab1af89351bcce9f2d86919269) · [Robinhood contract limits](https://docs.robinhood.com/chain/differences-from-ethereum/#contract-size-limit)
