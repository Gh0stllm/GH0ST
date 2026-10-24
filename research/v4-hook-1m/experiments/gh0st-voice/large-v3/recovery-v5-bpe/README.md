# Original-tokenizer recovery adapter

This separate local experiment keeps SimpleStories V2's original **WordPiece**
tokenizer and the reviewed Relative64 Q12 kernel. The directory uses “bpe” as a
short experiment label; it does not imply the tokenizer algorithm changed. The
replacement WordLevel experiment is left intact.

The exporter imports `gh0st-voice/export/quantize_eval.py` unchanged. It corrects
the helper's hardcoded quotation-token metadata, verifies complete tokenizer
semantics, and writes the original tokenizer with the export. The model already
accepts a single constructor prompt and includes it in its identity. No kernel
change or extra forward step is required: token 3 is `"`, and token 40 is `i`.
The input prefix is displayed separately and is never counted as generated text.
The original tokenizer disables the optional Hugging Face space cleanup. The
exact decoder therefore preserves outputs such as `i can ' t`; this adapter does
not silently repair punctuation or grammar. Its JavaScript decoder is checked
against Python for all 4019 individual tokens and representative longer inputs.

From the research directory, after selecting a frozen trained checkpoint:

```sh
experiments/gpt2/.venv/bin/python \
  experiments/gh0st-voice/large-v3/recovery-v5-bpe/export/export_bpe.py \
  --checkpoint PATH_TO_FROZEN_CHECKPOINT \
  --out experiments/gh0st-voice/large-v3/recovery-v5-bpe/export/selected-i \
  --prompt i --seeds 42,0,1,2,3,4,5,6,7,8 --tokens 160

node experiments/gh0st-voice/large-v3/recovery-v5-bpe/evm/run-local.mjs \
  --export-dir=../export/selected-i --prompt-token=40 \
  --turns=128 --port=18660 --label=recovery-bpe-i
```

Defaults remain quotation token 3, top-k 8, and temperature 800. Export and runner
also accept matching `--top-k` and `--temperature-milli` settings. The runner uses
`--key=value` arguments; the Python exporter uses the usual space-separated
arguments. A text prompt must tokenize to exactly one nonterminal token.

The local runner uses a fresh unforked Anvil on chain 31337, an actual Uniswap v4
PoolManager, and token settlement. It checks each swap's token IDs, full 4019-logit
hash, terminal flags, and state against the independent integer reference. It
also checks stale input, caller/pool isolation, and rollback after inference.
Every swap must stay below 32 million gas, including after the 64-position
attention window fills. Weight and executable tile installation costs are
excluded from per-swap gas. There is no public RPC, key, fork, or broadcast option.

`export/test_bpe.py` is an offline compatibility check. It does not establish
that a new tuned model has good grammar or meets the gas cap.
