# Conservative pretrained-continuity comparison

This is a local experiment using the untouched 1,235,968-parameter SimpleStories
checkpoint and its original 4,019-entry WordPiece tokenizer. Only transformer
layers 2 and 3 train (360,704 values). Embeddings, tied output head, lower layers
and final norm remain exactly frozen. No Qwen-generated text is included.

`prepare.py` freezes the 749 original voice training paragraphs and the new
24 long continuity passages with their existing group splits, plus the pinned
SimpleStories replay. Source and tokenized-file hashes are recorded. The
prepared training voice set contains 767 documents, 65,303 known next-token
targets and zero unknown tokens; replay contains 20,045 documents and 4,109,784
known targets. Validation and test remain separate.

Every block stays inside one source document. Blocks contain at most 128 tokens
and advance by 64. At a document start the first token is context; on subsequent
blocks the first 64 targets are masked as warmup. Thus each known document target
is represented once across its windows. Each attention layer uses a causal
64-position window. Cropped blocks are not claimed to reproduce the whole
multi-layer state of an arbitrarily long running KV cache. No document-to-document
transition is invented and no EOS is appended.

The sampler balances actual known targets at approximately 75% grammar replay
and 25% voice, with hard caps. Defaults use LR 0.000002, stop at 50,000 voice
targets for review, and save at 25,000-voice-target intervals. The absolute limits
are 100,000 voice targets and 400,000 total targets. The first review stop is about
0.77 effective voice passes. There is no automatic quality approval or selected
release checkpoint. Validation reports voice and grammar separately; raw samples
use both `i` and a quote, fixed seeds 0/42, top-k 8 and temperature 0.8.

From this directory, using the existing research Python runtime:

```sh
python -m unittest -v test_core.py test_model.py
python train.py --data prepared --out runs/first-50k --device mps
```

After review, a separate output directory can resume the saved optimizer and
sampler state with `--resume PATH --stop-voice-targets 100000`. Frozen-tensor
hashes and corpus hashes must still match. All export-bound checks reject
overflow; this trainer performs no weight clipping. A future selected checkpoint
still needs independent exact Q12 evaluation and local v4 gas tests. This code
does not make a public-chain call or deploy anything.
