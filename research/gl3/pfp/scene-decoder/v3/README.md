# GH0ST Scene Decoder · Native 64 × 64

![Eight outputs from the trained 64 × 64 model](evidence/model-samples.png)

[500 KB trained pack](evidence/pack500.bin) · [Exact image fixtures](evidence/vectors.json) · [Training results](evidence/training.json)

The 32 × 32 model lost detail when it selected an entire image patch at a time. This revision learns a 16-value representation of each tile and predicts the shade of every pixel. It generates two transparent subject layers and a background, then composes them on Robinhood Chain in the requested layout.

Prompts select from 24 subjects, eight backgrounds, seven visual styles, eight subject tints, and 16 backdrop palettes. The layouts are single, left/right, and above/below. Twelve subjects have a second learned form selected by seed. The training set adds four detailed native subject designs and eight layered backdrops, with shaded versions of the remaining original subjects.

Two learned five-bit decoder heads score eight shades per pixel. Both use exactly the same integer weights on the reference and on-chain paths. The classifier uses the first class in a tied score. The EVM composes 4,096 palette indices, applies the requested shade ramps, and returns 2,560 bytes of packed pixels and 128 palette bytes. The transaction function emits a hash of those exact bytes.

## Fixed model format

The pack is **500,000 bytes**, partitioned into seven 69,632-byte style shards and one 12,576-byte shared shard. All lengths exclude the one-byte STOP prefix used by the immutable storage contracts. Each style stores 24 base subject layers and 12 alternatives at 1,024 bytes per layer, followed by eight backgrounds at 4,096 bytes each. The shared shard contains the two packed classifier heads, palettes, the `GH0ST64B` format marker, and metadata. The constructor verifies the shard bytecode hashes and sizes.

Training fits the subject and background encodings independently on the source layers. The frozen export matched 99.39% of pixels across 252 source subject layers and 100% across 56 source background layers. The sample scenes are fresh compositions of those trained layers. The measured percentages describe reconstruction of the source artwork.

## Robinhood estimates

All eight images, covering seven styles and all three layouts, matched the reference pixel and palette bytes exactly. Each was a complete `generateAndRecord` simulation in a single transaction. The model pack and contract code were supplied through state overrides at Robinhood block **121624746**. The sampled gas price was **21,692,000 wei per gas**.

| Operation | Estimated gas | Estimated ETH |
| --- | ---: | ---: |
| One-subject image | 9,970,672–10,076,646 | 0.00021628–0.00021858 |
| Two-subject image | 11,827,156–11,976,482 | 0.00025655–0.00025979 |
| Deploy all eight weight shards and the inference contract | 109,543,852 | 0.00237623 |

Deployment is nine transactions. The largest creation estimate is 15,155,575 gas, within Robinhood's 32-million-gas transaction limit. The inference contract creation alone is 776,658 gas. The [full benchmark](evidence/robinhood.json) includes each image and creation estimate with bytecode hashes and the block anchor. Fees depend on the gas price at execution.

## Reproduce

Run with Python, PyTorch, NumPy, and Pillow. The model uses an Apple GPU by default. The same command accepts `--device cpu`.

```sh
python train.py --output evidence
node bench-rh.cjs evidence/pack500.bin evidence/vectors.json evidence/robinhood.json
```

The benchmark uses Robinhood's read-only RPC and compares every pixel and palette byte against the frozen model reference. It tests the transaction entry point with the image-hash event. The benchmark uses temporary accounts for simulation.

## Robinhood mainnet release

The inference contract is `0x6a075d8FA663CeEC054C21E322F8A653E00167d7` on chain 4663. Its eight weights contracts and inference contract used **108,670,880 gas** across nine confirmed creation transactions. The total fee paid was **0.002352387731564 ETH**. The deployed model reproduced the exact pixels and palettes for all eight reference images at block 121630860. [Deployment receipts and live read-back](evidence/deployment.json).

The [live Image Studio](https://gh0st.fyi/image-studio/) is bound to the deployed address and runtime code hash. Studio previews call the contract directly and render its packed pixels. The optional recording sends a transaction and verifies its image-hash event. The [Studio source](../../site/) and [release verifier](release/verify.cjs) are included here.
