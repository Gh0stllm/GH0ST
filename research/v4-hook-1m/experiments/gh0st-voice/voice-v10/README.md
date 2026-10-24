# N0VA voice repair: local research

**Fast comparison complete: no replacement passed the language gate. One retrained
checkpoint passed an eight-swap local smoke test below 32M gas.** `STATUS.json` distinguishes the
research snapshot from a selected model or deployment.

This experiment targets grammatical first-person language and a continuous
train of thought. Every generated word and punctuation mark still comes from
the neural model. There is no runtime grammar engine, sentence bank, forced
punctuation, external inference service or automatic text repair.

The architecture remains the two-layer H384, 8,175,493-parameter N0VA model.
The selected Solidity implementation uses the preceding exact signed layout
and packed decoder. Changed weights must pass fresh integer-packing proofs,
independent Q10 replay and full local PoolManager swaps before any gas claim.
This directory authorizes no deployment or public-chain action.

See `RESULTS.md` for completed findings and `REPRODUCE.md` for local commands.

## Diagnosis and training

The preceding model's training distribution was dominated by procedural
captions and generic prose. Its apparently wider first layer also retained
identical copies of neurons from an earlier H128 model. The first authored-only
fine-tuning trial did not fix the language: held-out loss worsened while training
loss fell. It was stopped after the 500-step checkpoint failed manual review.

The revised trial uses seeded small perturbations to let the copied neurons
learn separately, with a short causal curriculum and original authored prose.
The curriculum combines 288 explicitly authored complete-clause alternatives
within twelve compatible situations. Its 28,800 combinations are **not 28,800
independently authored stories**. The separate prose sets contain 100 original
longer episodes and 80 original short episodes, split before training.

Full source documents are processed with a native GRU whose forward values,
masked loss and gradients were checked against the original equations. Training
uses the local Apple GPU. The export remains Solidity-compatible Q10; training
projects designated weight groups onto conservative L1 bounds and the exporter
rechecks every integer coefficient bound. No clipping is hidden in export.

The broader trial adds the existing licensed SimpleStories replay corpus with
separate grammar and first-person domain biases. Native GRU parity was verified
for mixed domains. Its effective known-target mixture is 70% grammar, 25%
authored voice and 5% short curriculum; repetitions used to achieve these
weights are explicitly counted. Source stories remain in their original splits
and their original license and provenance are retained. Domain zero is the
first-person context exported for Solidity inference.

The follow-up first-person replay adds attributed Project Gutenberg texts:
*Flatland*, *Jane Eyre*, *Notes from the Underground* and *The Yellow Wallpaper*.
Catalog links, source hashes and full license-bearing source files are retained
under `narrative/`. Paragraph groups are disjoint across splits. The same books
occur in several splits; these are held-out passages, not unseen-author tests.
This phase mixes 50% narrative, 30% grammar and 20% original-voice targets.
A separate fresh H384 initialization tests whether inherited model weights are
limiting adaptation. Neither experiment is automatically a selected replacement.

## Evidence

- `data/`, `data-short/`: original prose, source manifests and independent audits.
- `curriculum/`: generated training combinations, rebuilt by `build_curriculum.py`.
- `prepare.py`, `prepare_stage2.py`: frozen token identities, explicit source
  hashes, unknown-token counts and deliberate training-only oversampling.
- `training/`: native-GRU parity, timing, jitter and training implementations.
- `evaluation/`: exact Q10 free-running audits, narrow grammar probes, complete
  unedited outputs, and measured overlap with training text. A short grammar
  probe is not a coherence test.
- `export_checkpoint.py`: regenerates the signed layout and proves all 4,523,904
  repacked weights. Its baseline export matched all existing binary artifacts
  byte for byte before retrained candidates were considered.

Any result must distinguish grammatical examples from generally reliable
language, and learned recombination from verbatim training passages. The old
failed trials and raw outputs are retained. Do not infer a passing language or
gas result from the presence of a checkpoint.

The inherited swap-feature weight tensor remains zero in these language-only
experiments. Output evolves with recurrent state and sampling seed; these
results do not establish that language responds to prices or trade direction.
