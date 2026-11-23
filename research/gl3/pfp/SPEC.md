# GH0ST PFP generator

The generator accepts a 16-byte seed and eight user-controlled traits. It runs a small quantized neural decoder in a GL3 contract and returns 1,024 pixels using a black, amber, and ivory palette. A web client can hash a phrase to a seed, call the contract, and draw the returned bitmap at any display size. A seed and trait byte reproduce the same PFP under the same immutable model.

## Input controls

| Bit | Trait | 0 | 1 |
| --- | --- | --- | --- |
| 0 | Eyes | Calm | Glowing |
| 1 | Mouth | Still | Grin |
| 2 | Headpiece | Halo | Horns |
| 3 | Frame | Brackets | Visor |
| 4 | Signal | Quiet | Glitch |
| 5 | Emblem | Dot | Diamond |
| 6 | Background | Clean | Stars |
| 7 | Accent | Amber | Ivory |

The phrase is a reproducible seed. The trait controls supply the semantic inputs. The API accepts a raw seed with leading zeroes preserved. The seed and trait byte define 2^136 possible input pairs. Output diversity is measured from samples because multiple inputs can yield the same pixels.

## Contract format

`generate(bytes16 seed, uint8 style) returns (bytes)` returns 256 bytes. Pixel index `32 * y + x` is encoded as two bits, beginning with the least significant pair in each byte. Palette indices are `0` for black, `1` for amber, and `2` for ivory.

The decoder consumes seed byte values minus 128, followed by eight style bits encoded as −127 or +127, with the lowest bit first. It computes a 24 → 16 → 2,048 dense network. The model blob contains 384 signed int8 input weights, 16 little-endian signed int32 hidden biases, 32,768 signed int8 output weights, and 2,048 little-endian signed int32 output biases. Matrices are stored by output row. The hidden layer shifts right by seven and clamps to [0, 127]. Two output logits per pixel control foreground and ivory, with zero treated as the lower class.

Read-only previews execute the contract through GL3 RPC. A transaction can execute the same inference and emit the output hash. The immutable weights and fixed-point decoder make both paths reproducible from the same inputs.
