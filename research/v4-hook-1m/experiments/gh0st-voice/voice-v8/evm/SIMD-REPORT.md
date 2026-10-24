# SIMD8 arithmetic, measured gas and storage limits

The optimization changes integer dot-product execution, not the learned model's probability distribution. It introduces no grammar masks, sentence templates or off-chain text generation.

For eight hidden values `h` in[-1024,1024] and signed int16 weights `w`, pack `h+1024` into32-bit lanes and pack `w+32768` in reverse lane order. The coefficient at bit224 of their256-bit product contains the eight unsigned products. Every coefficient is at most8×2048×65535 =1,073,725,440, below2^32, so no coefficient carries into an adjacent lane. EVM multiplication discards only higher coefficients. Recover the signed dot product by subtracting `32768*sum(h+1024) +1024*sum(w)`.

Each complete row is accumulated before its bias and Q10 truncation. Splitting a row into separately rounded partial dots would change the model and is not done. Hidden-state bounds are checked before packing. Weight bounds are checked during export. Row sums are exact signed integers, not new trained parameters.

## Actual local microbenchmarks

These figures include vector packing, cold code reads, one reused row buffer, result hashing and a result event. They are not full-model or swap costs. Failed scalar cases exhausted the same32M cap.

| Width / dot terms | Scalar |4×64-bit lanes|8×32-bit lanes|
|---|---:|---:|---:|
|128 /147,456|19,060,141|3,692,347|2,518,741|
|256 /589,824|exceeds32M|12,107,576|7,385,075|
|512 /1,179,648|exceeds32M|21,901,122|12,440,573|
|512 /2,359,296|exceeds32M|exceeds32M|24,250,370|

Every successful result hash matched independently computed signed CPU dot products, including uniform±1024 hidden vectors and full-int16 weight endpoints. Separate exhaustive/random arithmetic proofs are saved under `voice-v7/evaluation/simd-proof`.

## Full models are a stricter test

The complete two-layer H512 model exceeded32M in its direct inference call. The dot microbenchmark excludes GRU gate lookups, four hidden-vector preparations, feature processing, output heads and large result encoding; its pass did not establish full-model feasibility.

The complete H384 model passed four actual v4 swaps at at most23,239,218 gas, with all768 state values and197 logits matching the independent uncompiled reference. Its26M inference budget leaves a2M callback reserve inside a32M transaction cap. This is the selected feasible width for subsequent training; it remains a random-weight technical result until a trained export is validated.

## Static-data cost

The optimization is not compression. Each packed weight occupies four bytes rather than two, and each row also stores a32-byte sum. Exactly folded input tables also trade storage for arithmetic.

| Export | Source parameters |Data-runtime payload bytes|Data shards|
|---|---:|---:|---:|
|H384|8,175,493|66,319,680|2,766|
|H512|11,670,661|90,493,248|3,773|

The H384 fused word-input table alone is47,191,680 bytes. It contains derived combinations of embeddings and input weights, not47M independent parameters. Unused original tensors stay in the off-chain reference archive.

The local runner injects these shard and catalog runtimes. It deploys the model and v4 components through local transactions, but does not deploy thousands of data contracts or measure their total deployment cost. The13,121,298-gas H384 model-constructor figure excludes all those data deployments. Neither the swap result nor this constructor figure establishes practical mainnet deployment cost.

Two-level catalogs keep each catalog contract within code-size limits: up to1024 data addresses per leaf page and a small root containing page addresses. The exported model binds the ordered shard code hashes in its constructor. All supplied runtime contracts reject chain IDs other than31337.
