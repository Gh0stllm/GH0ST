# Local research recovery

This directory contains the subset of GH0ST needed to optimize and verify the
unpublished 534,751-parameter sentence model. It is not a complete Git checkout.

Original sentence-model source, reports, and integer payloads were recovered
from saved tool records in the earlier cloud chat. The core, embedding, and
decoder payloads match the SHA-256 digests in the recovered `model/manifest.json`.
The packed vocabulary was reconstructed from `vocabulary.json` and matches its
original digest. These hashes identify the baseline used for this optimization;
they do not establish that this is the latest filesystem version in the cloud.

The original full-precision `speaker.safetensors` checkpoint was not recovered.
Its historical manifest entry is preserved, but no file or new result claims
to verify it. New fine-tuning starts from the verified integer payloads. The
resulting NumPy checkpoint is a new artifact, not the missing original checkpoint.

Shared policy-hook source and validation helpers were fetched from
`Gh0stllm/GH0ST` at commit `0547fe098220f6715a4e3f9f1a655b23d31d3255`.

Training, model validation, and local EVM execution occur on this computer.
Nothing in this directory has been published to GitHub or a public chain by
this task. See the research directory's optimization report for the final
candidate, tests, and limitations.
