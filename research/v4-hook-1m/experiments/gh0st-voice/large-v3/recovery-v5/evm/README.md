# Recovery-v5 local v4 runner

Prepared for a **trained and reviewed** WordLevel checkpoint. No benchmark result
is implied by the presence of this adapter. Do not use the initial embedding
transfer as evidence that the model can write well.

The adapter uses the same real local PoolManager, settlement router, rollback
checks, namespace isolation, and128-swap trajectory as the earlier large-v3
runner. Every state mutation requires an unforked Anvil reporting chain31337.
Both model and hook constructors are local-only. The transaction cap remains32M
gas and the inference budget29.25M. It accepts no public RPC, wallet key, fork,
or broadcast option.

## WordLevel changes

- The compiler's research root is five parent directories above this runner.
- Vocabulary IDs0–31 remain fixed. A changed vocabulary is accepted only with
  the exporter’s reserved-ID, full-tokenizer, and vocabulary-blob hash checks.
- The complete4019-entry UTF8 mapping is decoded from `vocabulary.bin`, compared
  with `vocabulary.json` and the checkpoint's tokenizer, then installed as
  STOP-prefixed local runtime shards. Their bytes and rolling commitment are
  independently checked before model deployment.
- The deployed model's tokenizer/vocabulary constants must match those checked
  artifacts. Vocabulary data is not fetched during transformer inference.
- Display uses complete words and the tokenizer's punctuation cleanup. It does
  not join legacy `##` fragments or read old checkpoint word meanings.

From the research directory, after final checkpoint selection and full export:

```sh
node experiments/gh0st-voice/large-v3/recovery-v5/evm/run-local.mjs \
  --export-dir=../export/selected --turns=128 --port=18650 \
  --label=gh0st-recovery-v5
```

`--prompt-token N` must match the export's selected single-token prefix; it
defaults to quotation token3. The model constructor, reference, and recorded
policy all use that same value. The transcript labels the input prefix separately
from generated text, and the prefix is not counted as a generated token.

The output records every actual swap, token IDs, exact full-logit parity,
terminal flags, processed positions, gas, settlement, and negative checks.
The full64-position attention window must be exercised. As before, local
installation of weight/tile/vocabulary runtimes excludes their deployment cost
from the measured swap gas.

`test_vocabulary.py` checks the JavaScript display against the actual Python
tokenizer for every token and additional multi-token cases. The corresponding
report is an offline decoder test, not an EVM gas measurement.
