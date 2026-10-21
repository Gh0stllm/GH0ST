# S0UL compositional curriculum v2

This is a larger supervised research curriculum for the unchanged 984,192-parameter
model, action grammar and fixed 512-slot v1 tokenizer. Its labels come from
explicit rules and hand-authored phrase families. No teacher model or teacher
API generated the labels. It does not establish general language competence or
safe autonomous execution.

Generate the default 28,800 training and 900 validation examples:

```bash
python -m s0ul.data_v2 --output data-v2 --seed 2026 \
  --train-per-action 3200 --validation-per-action 100
```

The producer never creates a final test file and refuses an output directory
that already contains `test.jsonl`. Independent final challenges must remain
outside training and checkpoint selection.

## What changed

- The generator samples from many request families and word orders for every
  supported operation. It records both the undecorated core request and the
  complete request without its optional state prefix.
- Every complete unprefixed request is unique across both splits. Changing a
  block number cannot create an additional example. The manifest reports core
  request counts separately so polite wording and context do not inflate that
  measure.
- Plain requests are mixed with four caller/state prefix styles. Block numbers
  come from the same distribution in both splits; block ranges no longer reveal
  the split. The target plain-request proportion is 35% before length filtering.
- All six supported operation types occur in explicit negations that select WAIT.
  Composed examples also distinguish a negated alternative from an actual
  supported request. Quoted untrusted instructions do not replace the user's
  explicit actual instruction.
- Refusal examples cover unknown assets, unknown memory keys, transfers, swaps,
  approvals, staking, bridging, price prediction, another owner's state,
  private credentials and attempted rule/owner overrides.
- Clarification examples cover missing assets, keys, values, task titles,
  identifiers and requests. Because this grammar encodes one action, requests
  for two supported actions select `CLARIFY|request`.
- Copy targets include familiar atomic words and newly generated safe slugs of
  1–24 characters. Digits and underscores occur in copied values. Common atomic
  values are included in the training pool; the manifest reports their actual
  positive-target counts rather than assuming the pool guarantees exposure.

## Split boundaries and measurement

Training and validation have different core phrase families, copied slugs,
task-ID ranges, unsupported asset/key names and other-owner names. Their
supported actions, ETH/GH0ST asset names, theme/language/mode keys and optional
context styles are shared. Validation is a synthetic compositional check, not
a statistically representative real-user sample.

All examples fit the complete sequence
`BOS + prompt + SEP + response + EOS` within 128 tokens. Overlength candidates
are rejected, never truncated; this biases the retained distribution toward
shorter wording and is reported by action and split. Optional long compositions
can therefore appear less often than their sampling probabilities suggest.

`manifest.json` records file hashes and byte sizes, action/scenario counts and
entropies, actual prefix/composition counts, unique core and unprefixed request
counts, full token-length distributions, copied-value coverage and the unchanged
tokenizer specification. These metrics describe the dataset, not model quality.

V2 training includes familiar word values that appeared in earlier v1 held-out
data. The earlier v1 test and hand-authored challenge results are therefore
historical evidence for the frozen v1 checkpoint; they are not blind final tests
for a model trained on v2. Fresh independently authored final challenges are
needed after checkpoint selection is complete.

Text such as `caller=SELF` is an observation presented to the model. It is never
proof of authentication, ownership or permission. Validly formatted model output
still needs independent contract checks and can still select the wrong action.
