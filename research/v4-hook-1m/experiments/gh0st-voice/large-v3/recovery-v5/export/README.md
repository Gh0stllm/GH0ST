# Recovery-v5: replacement vocabulary export

This adapter allows a new **4019-entry WordLevel vocabulary** while retaining the
1,235,968-parameter architecture, tied output embeddings, tensor layout, Q12
arithmetic, and Relative64 attention. It imports the original exporter as a
library and does not change it.

```sh
experiments/gpt2/.venv/bin/python \
  experiments/gh0st-voice/large-v3/recovery-v5/export/export_recovery.py \
  --checkpoint PATH_TO_FROZEN_CHECKPOINT \
  --out experiments/gh0st-voice/large-v3/recovery-v5/export/selected
```

`--tokenizer` may point to an explicitly selected tokenizer JSON or directory;
otherwise the tokenizer stored with the checkpoint is used. Training and corpus
preparation must use those exact bytes. The adapter accepts no network or chain
configuration and performs no training or broadcast.

`--prompt-token N` selects a single nonterminal token already present in the
vocabulary (default3, the quotation token). For a first-person experiment, read
the ID of `i` from this exact vocabulary and supply it explicitly. This changes
the initial conditioning token without inserting a generated word or adding a
forward step. Reports label `PROMPT`, `GENERATED`, and `COMBINED` separately.
The optional legacy comparison is supported only for shared quotation token3.

## Required invariants

- Preserve every ID from 0 through 31, including unknown0, EOS1, exclamation2,
  quotation3, apostrophe8, comma13, hyphen14, period15, digits17–26, and question30.
  The existing native terminal set remains `{1,2,15,30}`.
- Keep exactly4019 unique IDs with no gaps and no WordPiece `##` continuations.
- Keep dimensions128/341/four layers/four query heads/two KV heads and tied
  embeddings. Every matrix must quantize into signed12 for the SWAR8 fast path.
- A transferred embedding initialization is only an initialization. It does not
  establish that new words are understood or that grammar improved. Preserve
  and evaluate complete free-generation runs across multiple seeds.

## Token bytes and model identity

`vocabulary/vocabulary.bin` has four magic bytes `G0V5`, uint16 version1,
uint16 count4019, 4020 uint32 offsets, then concatenated UTF8 strings. Offsets
are relative to the string section. This format gives an unambiguous ID→text
mapping and includes the reserved tokens. It is also written as readable JSON.

The exporter splits this blob into at-most24000-byte chunks, prefixes each with
STOP, and writes deployment-ready runtime files plus SHA256/Keccak hashes. These
vocabulary shards are **not read during transformer inference**. A deployment
can store them beside the weights and let the frontend fetch and verify them.
No shard is deployed by this exporter.

The generated local-only Solidity model embeds constants for the tokenizer
SHA256, vocabulary-blob SHA256, and vocabulary-runtime commitment. All three
enter a new model-hash domain. Thus equal numeric weights under different token
meanings cannot silently retain the same model identity. The constructor still
takes the original weight/table/tile arrays; its vocabulary commitment advertises
the expected shards rather than receiving and checking their addresses. The
deployment verifier must check those runtime hashes separately.

## Legacy assumptions that must be updated before an EVM/UI integration

1. The old exporter rejects any different vocabulary. This adapter validates the
   new mapping instead; the original exporter remains unchanged.
2. The old v4 runner asserts `tokenizer_vocab_unchanged`. Replace that assertion
   with checks of this export's reserved-ID and tokenizer/vocabulary hashes.
3. The old runner and website read the original `model-cache/tokenizer.json` and
   join WordPiece fragments. They must use this checkpoint's vocabulary and
   decoder. Reading old strings for new IDs would display incorrect sentences.
4. Tokenization is still off-chain when preparing a prompt. On-chain inference
   accepts numeric IDs. The complete tokenizer JSON records normalization and
   token boundaries; the compact blob records token meanings.
5. The default independent comparison includes only the tuned WordLevel model.
   `--include-legacy-baseline` decodes the optional baseline with its **own** old
   tokenizer. Shared numeric IDs are not semantically comparable after remapping.
6. New weights change packed constants, tile partitions, and commitments. The
   generated model source is fresh, but it still requires local compilation,
   whole-swap gas measurement, rollback tests, and full-logit parity.

WordLevel may shorten domain language and avoid malformed subword concatenation.
It also makes out-of-vocabulary words become unknown instead of composing them,
and it redistributes a very small embedding budget. Neither quality nor gas fit
is established until a real trained checkpoint is tested.
