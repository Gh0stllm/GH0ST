# V8 static replay comparison: language gate failed

The 8,175,493-parameter, two-layer H384 model received approximately 6M additional supervised word targets with a 90% static grammar replay / 10% original voice mixture. This was a separate comparison using licensed SimpleStories replay, not generated GPT-2 or Qwen training text. The vocabulary remained unchanged.

The data audit passed. Source bytes, split groups, lexical documents, input IDs, punctuation labels and frequency counts matched the manifest. All source documents remained intact. Unknown words retained their input positions and punctuation, while their lexical targets were masked.

Loss improved substantially, but language quality did not pass. All eight fixed 128-word streams inspected at 2M and 6M failed to form coherent first-person paragraphs. The final model preferred the grammatical option in 12 of 16 local sentence pairs under both decoding settings. That score does not establish correct free-running grammar: the final raw output still includes “a vast girl named people” and “a father named a tiny cave who could asked.”

The final model does not deliver the requested coherent, original Terminal-of-Truths-like voice. It should not be presented as fixed or approved for deployment. No further training was performed by this reviewer.

Gas evidence remains separate. An earlier trained V8 checkpoint's runtime test cannot automatically be attributed to the new 6M checkpoint; the exact weights and output parity must be matched before making that claim.

`V8-REPLAY-FINAL-REVIEW.json` records the checkpoint, source and raw-output hashes, training counts, validation results and quality decision. `v8-replay6m-review.json` contains all four final unmodified passages and individual judgments.
