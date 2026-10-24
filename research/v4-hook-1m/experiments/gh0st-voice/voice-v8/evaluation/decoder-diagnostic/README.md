# Lower-temperature development diagnostic

Both tested temperatures still fail language quality. All four full128-word
outputs were read; none sustained grammatical, causally connected prose.

| All-head temperature | Seed | Distinct words | Natural sentence ends | Repeated4-grams | Review |
|---|---:|---:|---:|---:|---|
|0.25|0|72|10|0|Grammar and continuity fail|
|0.25|42|57|9|0|Grammar and continuity fail|
|0.35|0|85|9|0|Grammar and continuity fail|
|0.35|42|81|11|0|Grammar and continuity fail|

The lower-temperature samples still contain errors such as “the room had never
look” and “the missing readings had been follow.” The four-gram metric misses
repeated semantic motifs: questions, reasons, rooms, repairs, and results return
without a consistent object or event. Higher lexical variety at0.35 does not
solve that problem. Mean hidden saturation ranged from9.08% to11.91% using the
sampler's absolute-value threshold0.999.

This used the existing H384 checkpoint at4,014,786 words, whose weight SHA-256 is
`904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3`.
The existing independent `sample_wide_fp32.py` ran on CPU with seeds0 and42,
no prompt beyond BOS, and the same temperature on group, word, and punctuation
heads. There was no sentence reset or forced punctuation. Full text and IDs
remain in `t025/` and `t035/`; individual reviews and source hashes are in
`review.json`.

This is a small development decoder diagnostic, not a held-out result, an EVM
parity test, or a gas result. All final sentences hit the fixed128-word limit;
the failure assessment comes from errors throughout the streams, not merely
that truncation. No training files, sampler rules, or runtime contracts changed.
