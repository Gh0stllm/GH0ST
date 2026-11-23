# GH0ST Image Studio

The generator runs a quantized 32×32 pixel-art decoder in a GL3 contract. The model covers twelve subjects, eight independently switchable modifiers, and seed-driven variation. Each subject can be an avatar or a standalone image.

## Prompt and inputs

The client takes the first supported subject in a phrase, applies explicit modifier words, and hashes the complete phrase into a 16-byte seed. Subjects and modifiers can also be picked directly. The contract receives the subject, modifier byte and seed. Together with the immutable model, those three values reproduce the image.

| ID | Subject |
| --- | --- |
| 0 | Ghost |
| 1 | Cat |
| 2 | Robot |
| 3 | Alien |
| 4 | Skull |
| 5 | Owl |
| 6 | Fox |
| 7 | Rocket |
| 8 | Planet |
| 9 | Mountain |
| 10 | Castle |
| 11 | Flower |

Modifier bits 0 through 7 are Glow, Stars, Sparks, Frame, Halo, Emblem, Scanlines and Ivory accents. The subject vocabulary defines what the model can draw. Additional words influence the seed.

## Contract format

`generate(bytes16 seed, uint8 subject, uint8 style) returns (bytes)` returns 256 bytes. Pixel index `32 * y + x` is encoded as two bits, beginning with the least significant pair in each byte. Palette indices 0, 1 and 2 represent black, amber and ivory.

The decoder takes seed byte values minus 128, followed by eight style bits encoded as −127 or +127. A shared 24 → 16 integer projection shifts each positive activation by seven bits and clamps to 127. Each subject has a supervised decoder head with two logits per pixel, one for foreground and one for ivory. The ROM stores each trained head's constant pixels and its exact sparse output thresholds as immutable contract data.

Read-only previews execute the contract through GL3 RPC. A transaction can execute the same inference and emit the output hash.
