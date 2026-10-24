# Compact fusion image — prepared, not EVM tested

This optional image removes the original input matrix, input embeddings and
hidden bias from on-chain runtime data. Their effect is already represented by
the exact precomputed input rows. It retains the recurrent matrix, six-feature
matrix, decoder nodes/biases, vocabulary and derived rows. Source checkpoint
artifacts and hashes remain in the preceding export and in the new manifest.

It is **compiled from a4,492,256-parameter model**. The image stores2,250,621
original scalar parameters directly and2,171,145 derived input values. The latter
are not independently learned parameters. Resident binary data falls from the
equivalence prototype's20,102,381bytes to15,619,111bytes, excluding the embedded
sigmoid table. This image has not been deployed or gas tested.

Use `export_compact.py --fused-dir PATH --out NEW_PATH` after a full exact-fusion
export. `evm/run-local.mjs` is ready for the same local swap checks. The independent
Q10 reference must read the corresponding **original full model export**, whose
hashes are recorded by this image, because reference inference deliberately
recomputes the unfused dot product.
