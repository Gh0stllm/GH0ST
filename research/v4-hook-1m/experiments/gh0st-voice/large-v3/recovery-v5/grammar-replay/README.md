# Bounded SimpleStories grammar replay

This folder contains25,000 distinct complete short stories sampled from one upstream **training** shard of [SimpleStories/SimpleStories](https://huggingface.co/datasets/SimpleStories/SimpleStories). The [commit-pinned dataset card](https://huggingface.co/datasets/SimpleStories/SimpleStories/blob/e63b8adc3b1a1bdc7cac5b500d150b71346b0628/README.md) declares MIT licensing and describes the data as model-generated. These are grammar-replay examples, not newly human-authored GH0ST voice passages.

- Source commit: `e63b8adc3b1a1bdc7cac5b500d150b71346b0628`
- Only downloaded shard: `data/train-00000-of-00007.parquet`,238,015,938 bytes.
- Raw shard SHA256 matches upstream LFS: `ca33531b99f3bebb4125e82f56017c223a4900331b55bcf7cde1b0f750d88fd4`.
- Local splits:20,045 train /2,427 validation /2,528 test stories.
- Train-only lexical words:3,252,149. `train-word-frequencies.json` excludes validation/test.
- Each story has35–260 lexical words and a completed punctuation ending. Exact normalized story duplicates are excluded.

Upstream generation IDs have terminal story-number suffixes. The splitter removes that suffix and hashes the base completion ID, keeping sibling stories in the same local split. Independent verification found zero source-group overlap and zero exact story overlap across splits. Each output row retains the upstream row number, original generation ID, base completion ID, generator model, source commit and license.

The sample is the first25,000 qualifying rows among37,693 inspected rows of one302,243-row shard, not a random sample of the whole dataset. The existing pretrained model was trained on this dataset family, so these local held-out splits must not be represented as unseen relative to original pretraining. They are separated for this new replay stage only; independent authored evaluation remains necessary.

`manifest.json` pins the frozen split files. `raw/README-pinned.md` preserves the exact upstream card; its bytes match the initially fetched card. `raw/dataset-info.json` and `raw/tree.json` preserve upstream metadata. No separate LICENSE file was present in the dataset tree; the license assertion comes from the pinned card's metadata. `extract_replay.py` reproduces filtering/splitting with PyArrow26.0.0. The locally installed reader in `vendor/` and raw Parquet are not needed in a publication bundle if the pinned upstream download and hashes are retained.

No model was trained and no chain operation was performed during this data extraction.
