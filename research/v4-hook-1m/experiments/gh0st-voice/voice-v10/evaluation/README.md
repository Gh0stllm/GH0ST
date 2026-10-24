# Frozen exact-Q10 voice audit

`audit.py` compares a candidate export with the selected N0VA-8M using the same
integer recurrent reference and Keccak sampler. By default it generates eight
unprompted 128-word streams: four fixed seeds with both fixed and changing swap
features. State persists through every sentence boundary. Every word and
punctuation mark comes directly from the trained neural heads. Nothing repairs,
substitutes or curates the generated text.

The sampler checks scalar dot products at positions 0 and 64 of every stream.
State hashes verify continuity between steps. This is not an EVM test or a gas
measurement; the candidate still requires local hook parity and gas tests.

Run with the existing research Python environment, providing a directory with
`manifest.json`, `reference.npz`, vocabulary and activation lookup tables:

```sh
python audit.py --model-dir ../../nova-fast-market/selected --out baseline
python audit.py --model-dir ../exports/candidate --out candidate
```

Keep the entire raw output. The counters identify obvious repetition, personal
pronouns and a few narrow grammar patterns; they cannot establish coherence.
Read every complete stream and fill a copy of `review-template.json`. The
predeclared development gate requires at least six of eight streams to score
3/4 or better in grammar, continuity, first-person voice and repetition, with no
severe contradiction or semantic loop. A pass is a finite development result,
not a claim of general reliability. Fixed audit streams must not enter training.

`grammar_probe.py` is a separate 16-case diagnostic of basic auxiliary,
agreement and verb-form choices. It compares exact rational probabilities from
the quantized hierarchical sampler, after supplying a short diagnostic prefix.
Those supplied words are not presented as generated output. It has no runtime
role and is never part of a swap.

```sh
python grammar_probe.py --model-dir ../../nova-fast-market/selected --out baseline/grammar-probe.json
```

## Frozen baseline

`baseline-q10-verified/` contains the selected 8,175,493-parameter model's audit.
Its 1,024 emitted words took about 4.2 seconds. All eight configured streams fail
the recorded human language review. There are four distinct texts: both feature
regimes produce identical text for each seed because all 6,912 input-feature
weights are zero. The eight runs are consequently not eight independent
language samples. The baseline prefers the grammatical choice in 12/16 minimal
pairs; its poor free-running output shows why this score alone is insufficient.

The seed-42 audit's first 90 token IDs, punctuation IDs and strings, plus its
768-value state at word 90, match the already measured 32-swap local EVM run.
`existing-evm-parity.json` records hashes and the exact comparison. This is a
reader/reference check using existing evidence; it is not a new gas benchmark.

`baseline-q10/` preserves the initial audit before artifact-hash validation was
added. Use `baseline-q10-verified/` for comparison with candidates.

## Training overlap

`training_overlap.py` compares each unchanged raw output with a specified
encoded training file. It reports the longest contiguous word match, naturally
completed sentences with exactly matching words and punctuation, and the
fraction of output eight-word windows found in training. It flags spans of at
least 20 words for review. Matching common phrases is not a finding of
plagiarism, and no match proves neither novelty nor absence of memorization.
Training-document boundaries cannot create matches, unknown word IDs cannot
match output words, and repeated training rows do not inflate the fraction.

```sh
python training_overlap.py --train ../encoded/train.jsonl \
  --raw-output candidate/raw-outputs.json --vocabulary ../encoded/vocabulary.json \
  --out candidate/training-overlap.json
python -m unittest -v test_training_overlap.py
```

The audit hashes its input files and verifies their common vocabulary. If a
training manifest declares a training-file hash, that hash must also match. For
multiple training corpora, run a separate report for each to keep attribution
and denominators clear. The baseline report named `v10-training-overlap.json`
compares the old model's output with the new fine-tuning corpus; it does not
claim to audit every document used to train the original model.
