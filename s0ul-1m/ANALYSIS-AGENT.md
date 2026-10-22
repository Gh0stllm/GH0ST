# S0UL analysis capability pilot

This is a separate research implementation of a user-funded analysis job. It is
not a mainnet release, an AIXBT-equivalent model, or a replacement for the existing
S0UL deployments. No public transactions were submitted for this pilot.

The original 984,192-parameter model was trained to generate a small action
language for balances, memory and tasks. That checkpoint cannot be presented as
an arbitrary-address analyst. Its successful EVM arithmetic and action execution
do not establish financial, security or general research competence.

## Intended user flow

1. Connect a Robinhood Chain wallet.
2. Enter an address.
3. Calculate the complete inference and execution estimate, including the
   separately identified job funding and opening-transaction fee.
4. Approve a maximum ETH job budget and open the job in one wallet transaction.
5. A transaction submitter advances the bound model in bounded transactions.
   It supplies neither model states, input metrics nor analysis.
6. Read the actual generated analysis and its model, address, snapshot, prompt,
   token and report hashes. Unused job funding is refundable to its owner.

An estimate is not an exact promise about future gas prices. The executor
enforces approved ceilings and never increases them implicitly. A running
transaction submitter is still necessary; contracts do not initiate their own
continuation transactions. This pilot does not deploy or operate that service.

## Implemented components

- `contracts/analysis/S0ULAnalysisFacts.sol` captures a pinned universal reader's
  current-chain profile plus bounded supply and pool-compatible getter results.
  It derives fourteen categorical fields and the entire sixteen-token prompt
  on-chain. The caller supplies only the target address.
- `contracts/analysis/S0ULAnalysisCodec.sol` decodes generated word IDs 64–150
  with terminal EOS. It supplies vocabulary, never report-selection logic.
- `contracts/analysis/S0ULAnalysisExecutor.sol` binds the owner, target code hash,
  captured evidence, prompt, immutable model and engine request. It escrows a
  capped budget, credits verified continuation work and stores the actual
  generated tokens and strictly decoded report. It has no template fallback.
- The existing `S0ULInference` arithmetic is reused with a new model instance and
  `tokenizer = address(0)`. The analysis adapter supplies authenticated numeric
  tokens; the original byte-tokenizer/action-controller domain is not reused or
  silently changed.

Paid continuation uses exactly 128 rows and one to four engine steps. Lower-row
paid fragmentation is rejected. Direct permissionless engine advancement remains
an unpaid contribution. Worker reimbursement is the documented, capped
`gasleft`-based policy, not a claim to measure exact receipt or parent-chain fees.
Quotes must reserve overhead per logical step rather than assume every caller
chooses the cheapest four-step grouping. Credits use guarded pull withdrawals;
unused budget can be recovered even when a dependency fails.

## Model experiment and limits

`analysis-model/` adapts the recovered quantized baseline to a finite reporting
task. The original floating checkpoint was unavailable: initialization
dequantizes the saved integer arrays, verifies their exact re-quantization, and
explicitly remaps embeddings for the separate feature/word domain.

Inputs contain only code presence, native-funding presence, reported interfaces,
owner/pause/implementation/asset getter classes, supply/reserve classes, selected
opcode-pattern presence and scan completeness. They do not include transaction
history, token-holder inventories, USD valuations, social information, hidden
storage, verified source logic or forecasts.

The vocabulary contains 87 output words and the output budget is at most 32
tokens including EOS. Targets are authored factual phrases. Test accuracy on
this task measures learned reproduction of that finite policy, not new research
insight or AIXBT-level intelligence. The authored policy itself is an explicit
comparison baseline and does not run as an inference fallback.

Training/validation/test vectors are disjoint. A reserved three-field combination
is held out separately. The two exhaustive no-code states are training and
development regressions; they are not mislabeled as unseen generalization.
An initial candidate failed these regressions despite strong contract-only
validation. That failure and the subsequent sampler/wording corrections remain
part of the experiment record.

Model usefulness, Python integer parity, real-EVM parity, and executor accounting
are separate acceptance checks. Passing one cannot substitute for another.
Until the complete frozen evidence is available and its limited capability is
acceptable, this model must not be offered as a paid general analyst.

## Validation files

- `reports/analysis-executor-evm-validation.json` describes infrastructure tests
  using explicit model/adapter mocks and the real strict codec.
- `reports/analysis-facts-evm-validation.json` describes real-reader capture,
  hostile getter, provenance, bounds and codec tests.
- `reports/analysis-real-model-validation.json`, when present with a passing
  result, describes the separate local full-model integration. A prepared runner
  or absent report is not a passing result.
- `analysis-model/` records training provenance, split manifests and held-out
  model evaluation independently of those contract tests.

All original deployed contracts, checkpoints and existing website behavior remain
unchanged by this research branch.
