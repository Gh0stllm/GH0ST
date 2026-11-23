# Mini Pixel Art M-P1 compact weight evaluation

This export starts from the publisher’s row-wise INT8 browser asset at [mini-pixel-art revision b0ba29f](https://github.com/AnticPan/mini-pixel-art/tree/b0ba29f8994082ab1af89351bcce9f2d86919269). The source asset contains 4,522,988 weight bytes. The exported packs retain all 110 tensors, all 10,944 vocabulary entries, and the original palette. Bias, normalization and position tensors retain their exact Float32 bytes. The packed matrices use signed integer codes and a Float16 scale for each group. Code assignment uses a local search around the group’s maximum coefficient to minimize mean-square weight error.

| Weight pack | Group width | Model blob | Runtime assets |
| --- | ---: | ---: | ---: |
| 5-bit | 192 | 2,858,456 bytes | 2,976,901 bytes |
| 4-bit | 32 | 2,528,044 bytes | 2,646,480 bytes |

Runtime assets include the model blob, tensor metadata, binary vocabulary and palette. The executable inference engine and its deployment are separate. The byte counts are decimal.

## Format and replay

The tensor metadata records shapes, byte offsets and group widths. Matrix elements are row-major. Eight successive signed codes are shifted by `2^(bits-1)` and packed little-endian into four or five bytes. Final groups pad to eight codes. Every tensor’s scale table is row-major with one little-endian IEEE Float16 value per column group. For vocabulary, consecutive UTF-8 words end in a NUL byte, with token IDs starting from three in file order.

```sh
python3 pack_mp1.py --source upstream --output q5 --bits 5 --group 192
python3 pack_mp1.py --source upstream --output q4 --bits 4 --group 32
python3 pack_mp1.py --source q5 --output eval-q5 --rebuild
python3 pack_mp1.py --source q4 --output eval-q4 --rebuild
```

The upstream input files are `docs/models/m-p1.bin`, `docs/models/m-p1.json`, `docs/models/vocab.json` and `docs/models/palette.bin` at the pinned source revision. Every packed tensor round-trips through the Python reader. `decode_qpack.mjs` decodes the same packed files directly in JavaScript, recovering Float32 weights. Its output matched the Python-rebuilt bytes for every tensor in both variants, and the vocabulary mappings matched the upstream JSON exactly.

The `eval-q4` and `eval-q5` folders run the publisher’s browser inference on reconstructed weights. Their temporary Float32 model files support compatibility with the unchanged predictor. Image execution in that demo is browser inference.
