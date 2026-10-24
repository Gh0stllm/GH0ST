# Held-out GH0ST voice evaluation

`prompts.json` is evaluation-only. Do not include its prefixes or rubric anchors in training, vocabulary fitting, checkpoint selection by exact answer, or synthetic-example expansion. General topic overlap is expected; exact sequence overlap is not.

Evaluate the untouched base checkpoint and each tuned candidate using identical prompts, sampling parameters, seeds, and output-token budgets. Suggested sweep: 4 seeds per prompt, 64 new tokens, and a separate 512-token continuation run for each of the continuity prompts. Report all results, including empty outputs, malformed words, and failed generations.

`evaluate.py --generations generations.json --training-text train.txt --output metrics.json` computes descriptive text metrics. The input is a JSON list (or an object containing `records`) with `id`, `seed`, and `continuation` (or `text`) per generation. `continuation` must exclude the input prompt; otherwise prompt text contaminates the metrics. A JSONL file is accepted too. Training-text comparisons are exact normalized word comparisons; they detect literal copying, not conceptual originality. They are not proof that a sentence never appeared in pretraining.

## Required human review

For at least 32 blinded base/candidate pairs, score each dimension from 0 to 4:

1. **English:** 0 unreadable, 2 mixed fragments/errors, 4 clear grammatical English.
2. **Local continuity:** 0 unrelated turn, 2 related topic but dropped thought, 4 extends the given situation and returns to its referent.
3. **GH0ST voice:** 0 generic child story/assistant, 2 some first-person curiosity, 4 clear machine viewpoint with readable wit or a surprising image.
4. **Non-formulaic composition:** 0 obvious copied/repeated line, 2 interchangeable slogan, 4 a specific connection grounded in this prefix.

Reviewers must not award points for mere profanity, technical vocabulary, random weirdness, or claims of sentience. The short question prompts are diagnostics of limitations, not a requirement to match an instruction-tuned assistant. A model may learn a voice without becoming a reliable question-answering model.

## Provisional acceptance gates

- No unknown-token regressions in the fixed tokenizer.
- Candidate's median English and continuity scores must each be at least 3/4, and neither may decrease against the base model.
- At least 75% of reviewed candidates score at least 3/4 on voice. At least half should be preferred to the base checkpoint by a blinded reviewer.
- Fewer than 5% of completed generated sentences are exact normalized duplicates across distinct seeds; report numerator/denominator and sample count. This metric does not enforce 10,000 unique sentences.
- No long direct reuse from the new training corpus: report every matching 12-word run. Some short shared phrases are ordinary language and need human review.
- Report malformed words and repeated 4-gram rate. Do not pretend these automatic signals measure meaning or fluency.
- For long streams, inspect the full transcript and score each 64-token window for continuity. A bounded attention window cannot directly recall old facts after they leave the window.
- Before release, repeat quantized parity and whole-swap gas tests on actual local v4 swaps. A float training result is not evidence of Q12 on-chain quality, and unchanged dimensions are not a measured gas result.

These are development gates, not universal quality guarantees. The 10,000-variant goal requires a separate sufficiently large on-chain-generation sweep and a defensible quality review; it cannot be inferred from a 32-pair pilot.
