# Experimental voice research snapshot

These are local research artifacts, not a mainnet release. The included weights
are the initial8M run's gas-tested checkpoint001000 and the corrected teacher4M
run's final checkpoint003126. Both remain below the required writing quality:
repetition, malformed phrasing, and semantic drift are visible in the saved
samples. Lower validation loss is not proof of a useful autonomous voice.

The large-corpus checkpoint001000 has an existing local128-swap gas/parity test.
At this snapshot, the corrected teacher4M checkpoint has completed training;
its subsequent EVM result is intentionally not claimed here. The old teacher4M
run is explicitly superseded because it used an earlier dataset snapshot.

Large immutable JSONL corpora are stored losslessly as `.jsonl.gz`. Smaller
completed JSON reports are in `completed-reports.tar.gz` with their canonical
paths and individual hashes listed in `REPORTS-INDEX.json`. Run
`python restore_corpora.py --check` to verify them, or run the script without
`--check` to restore missing canonical JSONL paths. Existing files are never
overwritten unless `--overwrite` is supplied. Raw and compressed SHA256 hashes
are recorded in `compressed-corpora.json`.

Bulk generated tile binaries, duplicate checkpoint snapshots, runtime caches,
raw upstream downloads, and in-progress experiments are excluded. The included
exporter regenerates the exact packed weights and executable tiles from the
selected checkpoints; its outputs still require the separately recorded local
parity and gas checks. Earlier small-pilot checkpoint binaries are excluded;
their reports preserve the measured hashes and outcomes. To reproduce a fresh
included checkpoint, run the exporter with its included checkpoint path and a
new output directory, then run the local adapter against that output. No
public-chain transactions were performed by staging.
