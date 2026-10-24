# V8 language review: not approved

The two-layer, 384-unit GRU has 8,175,493 parameters. It generates words and punctuation through learned heads; this experiment uses no runtime grammar rules, templates, sentence bank or repair step.

Neither training phase produced coherent free-running paragraphs. All 16 inspected 128-word streams failed the language gate: two fixed seeds, native and calibrated sampling, at mixed-data 2M/4M and original-only 1M/2M checkpoints. The unmodified outputs and hashes are listed in `V8-FINAL-REVIEW.json`.

The mixed-data phase stopped at its review gate after 4,014,786 target words. Held-out curriculum loss worsened while adult loss improved, and grammar/continuity remained poor. The subsequent original-only phase completed 2,002,242 additional target words. It improved the original-domain validation score from 5.7952 to 5.5095, but free text still included forms such as “i would unplugged” and “the room has needs.” Its best macro validation score occurred at 1M, not the final checkpoint.

The final original-only checkpoint preferred the grammatical member of 11/16 fixed local pairs under both decoders. That modest teacher-forced result does not override failed full passages.

This evaluation does **not** claim an EVM gas/parity result for a final trained V8 checkpoint. Architecture and arithmetic microbenchmarks are separate evidence; a trained-model swap benchmark has not been completed here. V8 should not be deployed or described as a coherent first-person writer.

The V9 pretrained-transformer control is a separate experiment and must earn its own quality and gas results.
