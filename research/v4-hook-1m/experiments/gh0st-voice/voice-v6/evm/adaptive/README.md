# Two-stage output head: local feasibility result

**4/4 real local v4 swaps passed below32M gas.** Maximum whole-swap gas was
27,919,182; mean27,714,320; minimum27,638,895. The model's direct-call probe used
26,959,924gas. The model constructor used6,771,028gas and its runtime is10706bytes.
All224 hidden values and all192 evaluated logits matched the independent
reference, including scalar checks of the unfused input, recurrent and output
matrix products. This fixture has random output-head weights: it proves no
language-quality improvement. Its text was `brook shimmer. internet suggested.`

The initial29M model-budget/1.3M reserve configuration rejected the call at its
gas guard before inference because of nested v4 EIP-150 forwarding. That attempt
is preserved in `adaptive-first-guard-failure.json`. The passing configuration
uses28.5M model gas and a750k callback reserve, while retaining the strict32M
transaction/block cap. No above-cap transaction or public network was used.

## Output math

The proven fused GRU H224 recurrence is unchanged. For a Q10 hidden state `h`,
the head evaluates128 group logits and64 word logits in the selected group:

```text
group_logit[g] = trunc((group_weight[g] dot h + group_bias[g]*1024)/1024)
g = weighted_sample(group_logits, stage=0)
word_logit[j] = trunc((word_weight[g*64+j] dot h + word_bias[g*64+j]*1024)/1024)
j = weighted_sample(word_logits, stage=1)
token = g*64+j
```

For each stage, subtract the largest logit. For nonnegative difference `d`, use
`scaled=floor(d*1024/temperatureQ10)` and `index=min(256,(scaled+32)//64)`.
The257-entry table stores `round(exp(-index/16)*2^32)` in unsigned64-bit slots.
The value at zero is2^32, so uint32 storage would be insufficient. Index256
provides a positive tail floor; this is a documented fixed-point approximation
to softmax, not exact real-number exponentiation. A maximum-logit entry always
has positive weight, so total weight is nonzero.

Each stage uses
`uint256(keccak256(abi.encode(bytes32(seed),uint256(wordIndex),uint256(stage))))`
modulo that stage's weight sum. Walk the weights in ascending index order.
Stages0 and1 use distinct hashes. This is deterministic generation entropy,
not a security-grade randomness promise.

The output matrix work is43,008 MACs instead of the binary tree's2,912. The
head contains1,872,000 learned parameters,29,025 more than the old head. The
complete voice-v6 training model has4,014,560 parameters when its224 training-only
UNK values and1344 domain values are included.

## Files and export contract

- `groups.bin`:128 rows, each224 signed-int16 Q10 weights followed by one bias;
  57600bytes.
- `words.bin`:8192 rows of the same225 values;3686400bytes.
- `core.bin`:unchanged GRU recurrent and six-feature weights;309120bytes.
- `fused.bin`:8193×672 signed40 input-projection values before division;
  27528480bytes.
- `vocabulary.bin`:8192 fixed32-byte word slots. IDs must follow the chosen
  group/slot order; no runtime remapping or stored sentences are used.
- `exp-q32.bin` and `sigmoid-delta.bin`:exact table copies for reference checks.

`export_checkpoint.py` accepts `embedding.weight` with8193 or8194 rows and the
heads `groups.weight`, `group_bias.weight`, `words.weight`, `word_bias.weight`.
Optional `domain.weight[2,672]` is supported. Runtime input embedding contains
only rows0..8192;8193 is training-only UNK and cannot be emitted or consumed by
the runtime. Voice domain0 is fixed and folded exactly as
`WxQ10@embeddingQ10 + (bhQ10+domain0Q10)*1024`. Input tensors and the domain
matrix remain off-chain reference files. Export clips no weights and rejects
overflow. The generated source records the actual source parameter count.

The exporter adapter test verifies all5,505,696 derived values with nonzero
domain offsets and confirms exclusion of the training-only UNK row.

## Validation scope

The four swaps included two natural terminal words. State persisted after them;
there is no forced punctuation or silent successful swap. Post-inference
rollback, low gas, malformed/stale inputs, changed model runtime, unauthorized
callbacks and independent pool state checks passed. All192 logits are emitted
for audit, so their event/return overhead is included in the measured gas.

Data shards and packed-address catalogs were installed locally after hash
checks; their deployment cost is excluded. The model and hook accept only
chain31337. `adaptive-smoke-summary.json` binds the passing raw result and
reference. A trained candidate still needs256+ swaps, matched fixed-point
quality evaluation, multiple callers and arithmetic/data-boundary tests.
