# N0VA voice repair: evidence and limitations

This is local research, not a replacement release. The existing selected model,
pool contracts, and public deployments have not been changed.

## Completed comparisons

| Candidate | What changed | Language finding |
| --- | --- | --- |
| Authored-only fine-tuning | New first-person episodes, output priors | Training loss fell while held-out loss worsened; stopped after checkpoint 500 review. |
| Short causal curriculum | Symmetry-breaking initialization, short connected clauses | Readable short passages largely reproduce training clauses; continuation drifts. Higher temperatures damage grammar. |
| Voice consolidation | Increased original-episode replay | Repeated scenes remain; no selected replacement. |
| Broad language replay | Licensed grammar stories and original voice, separate training domains | All four distinct 128-word exact-Q10 streams fail the language gate. |
| First-person narrative replay | Attributed book passages plus grammar and original voice | All four distinct 128-word exact-Q10 streams fail. Six of eight configured streams contain long training matches; the two feature modes duplicate four seeds. The longest match is 79 words. |
| Fresh full-width H384 | Original architecture initialized independently | All four distinct 128-word exact-Q10 streams fail; short control stopped after step 1,030. |

The narrative run stopped after step 1,340, with checkpoints 500 and 1,000
reviewed. Its held-out narrative joint loss barely changed from 5.751 to 5.742,
while original-voice joint loss worsened from 7.056 to 7.176. These metrics do
not substitute for reading the output. Training overlap is measured against
the supplied corpus only; absence of a match does not prove novelty.

The fresh control reviewed checkpoint 1,000 after 4,096,777 training word targets.
The fresh control had no exact full-sentence matches in this audit, and its
longest contiguous training match was seven words. Its novel output was still
ungrammatical. This short run is not evidence that longer training from scratch cannot improve
the model. It provides no passing replacement for this requested fast comparison.

The full raw streams, unfinished tails, scoring rubric, hashes, and overlap
measurements are retained under `evaluation/`. No text is repaired for display.

## Local Solidity integration

The `broad-language-1000` checkpoint was exported with the unchanged signed
layout and bounded packed decoder. This is an integration smoke test of newly
trained weights, **not a passing language candidate**.

| Measure | Result |
| --- | ---: |
| Local chain ID | 31337, unforked |
| Transaction and block gas limit | 32,000,000 |
| PoolManager buys and sells | 8 |
| New neural words in the eight measured swaps | 22 |
| Words per measured swap | 2–3 |
| Maximum measured transaction gas | 23,844,631 |
| Mean measured transaction gas | 21,578,119 |
| Minimum measured transaction gas | 16,459,115 |
| Integration checks passed | 29 |
| Independent word/state/hash replay | All measured swaps match |

The checks include fixed supply, immutable pool binding, permanently locked LP,
direct-callback rejection, slippage rollback, insufficient-gas rollback, changed
model-code rejection, ordered state advancement, and payout reentrancy rejection.
They are finite tests, not a security audit. The gas result does not establish a
network throughput or 10-swaps-per-second claim. The local harness injects model
data code, so it is not a measurement of deployment cost.

The complete report and independent replay are in `evaluation/exporter-smoke/`.
The maximum gas is for the measured swaps, not a proof over all future states.

## What has not changed

- 8,175,493 parameters and the same 8,192-word vocabulary.
- Every emitted word and punctuation mark comes from the neural model.
- Continuous recurrent state across successful swaps; no sentence-boundary reset.
- Solidity inference and the existing strict rollback/security behavior.
- No runtime sentence bank, grammar engine, forced punctuation, or external model.
- No mainnet transactions, deployment, signing, or public-chain calls.

The authored data and the training-only compositional curriculum are explicitly
distinguished in their manifests. Public-domain narrative source texts retain
their attribution and license notices. New failed checkpoint weights are kept
locally rather than replacing the published selected model.
