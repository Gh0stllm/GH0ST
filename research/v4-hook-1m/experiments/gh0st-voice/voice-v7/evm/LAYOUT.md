# Two-layer GRU128 + lexical/punctuation runtime

This is a local arithmetic/gas prototype, not a language-quality result. The first fixture uses deterministic random weights. No grammar engine, forced period, sentence bank or external inference is involved.

## Frozen tensor contract

All dimensions match the agreed training model. There are2,364,805 source parameters, including128 input-only UNK parameters and768 domain parameters.

| Source key | Shape |
|---|---|
| `embedding.weight` |8194×128|
| `punct_embedding.weight` |5×128|
| `wx1`, `wh1` |384×128 each|
| `wf` |384×6|
| `bh1` |384|
| `wx2`, `wh2` |384×128 each|
| `bh2` |384|
| `domain.weight` |2×384|
| `groups.weight`, `group_bias.weight` |128×128,128×1|
| `words.weight`, `word_bias.weight` |8192×128,8192×1|
| `punct_head.weight`, `punct_bias` |5×128,5|
| `word_punct_bias.weight` |8192×5|

Source weights are independently rounded to nearest-even Q10. Out-of-range int16 values are rejected, not clipped. Runtime input words0–8191 and BOS8192 are valid. UNK8193 is training-only and is excluded. Runtime domain is fixed to0.

Both layers use reset-after GRU equations with gate order `r,z,n` and no separate recurrent bias. Layer1's input is the sum of the word and previous-punctuation projections, features, `bh1` and domain0. Layer2 consumes the **new** layer1 state and the **previous** layer2 state. Its `wx2` multiply remains dynamic.

Every divide truncates toward zero. Sigmoid uses the prior Q10/Q16 table convention; the candidate is `2*sigmoid(2*x)-1024`. Hidden storage order is layer1[0:128],layer2[128:256].

## Runtime files

All direct weights are signed int16 big-endian. Derived input rows are signed40 big-endian Q20.

- `core.bin`: `wh1`, `wx2`, `wh2`, `wf`, `bh2` in that order;300,288 bytes. Element offsets0,49,152,98,304,147,456,149,760.
- `groups.bin`:128 rows of128 weights then bias;33,024 bytes.
- `words.bin`:8192 rows of128 weights then bias;2,113,536 bytes.
- `fused.bin`:8193 rows of384 values: `Wx1@word_embedding + (bh1+domain0)*1024`;15,730,560 bytes.
- `punctuation.bin`: first5 rows of128 punctuation weights+bias (1,290 bytes), then8192×5 word-conditioned biases (81,920 bytes), then5×384 derived previous-punctuation input values `Wx1@punct_embedding` (9,600 bytes). Total92,810 bytes; the derived rows begin at byte83,210.
- `vocabulary.bin`:8192 bare lowercase lexical words,32-byte padded rows;262,144 bytes. Punctuation is not part of these entries.

Files are segmented into24,000-byte runtime payloads. The local prototype injects these data runtimes; it does not measure deploying the complete data set. Constructor commitments bind every payload hash.

## Sampling and output

The second-layer hidden state predicts128 group logits,64 conditional word logits, then5 punctuation logits. Punctuation logits add a bias conditioned on the chosen word. All197 logits are returned for independent checking.

Classes:0 none,1 comma,2 period,3 exclamation,4 question mark. Stage0/1/2 draws use `keccak256(abi.encode(seed,wordIndex,stage))` and the same integer exponential lookup as V6. The fixture uses temperature512/1024 for every stage. A different punctuation temperature would require an explicit interface/manifest change.

Every successful swap emits a lexical word with its sampled optional suffix. `terminal` is true only for classes2–4. Previous word, previous punctuation, both hidden layers and sequence persist across every swap; punctuation never resets the state. The hook writes16 packed hidden-state slots, bounds the returned bytes and requires inference success for swap success.

`reference.py` calculates input projections from the original source tensors, without using the compiled folded rows, and separately verifies scalar dot products. `export_checkpoint.py` accepts frozen training checkpoints with these exact keys. All contracts reject nonlocal chain IDs.
