# V6 publication snapshot

This package preserves one explicitly selected experimental checkpoint and its
matching Q10 export, the original and expanded training corpus, training methods,
evaluation controls, raw evaluation outputs, and local runtime evidence.
Selection for reproducibility does not imply that the language-quality gate passed.
Failed, stopped and developmental runs retain their original labels and reports.
Read the current RESULTS/README and evidence summaries for the actual conclusion.

Data JSONL files are deterministically gzip-compressed. From this directory run:

    python3 restore-corpus.py

Restoration checks SHA-256 and refuses to overwrite different content. The
original v2 corpus and later expansion are separate sources; the expansion is
training-only. Training/encoded-expanded preserves the exact prepared data and
vocabulary used for the adaptation experiment. Evaluation controls are not data.

Only training/selected/model.safetensors and exports/selected contain selected
model weights. Other checkpoint directories retain reports, metadata and probes
for traceability, not weights or optimizer state. No raw downloaded works, fixture
weight blobs, caches or credentials are included. Primary source URLs, license
excerpts and corpus-source hashes remain available in data/.

This snapshot is staged locally. The packaging script performs no GitHub action,
blockchain call, training, or edit to any source report. Its delta manifest compares
repository paths and Git blob hashes against the published 96-file corpus snapshot.
Previously published paths omitted here are reported for human review, not deleted.
