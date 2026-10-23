# Three-label control experiment

This local 163-parameter MLP classifies synthetic future tick-movement regimes into `CALM`, `WATCH` or `DEFEND`. It exports a complete integer reference and fixtures. It has not been connected to a hook.

The requested sentence-forming design is now developed separately in [SwapSpeaker](../swap-speaker/README.md). This three-label experiment is retained as a small control; it cannot form sentences.

[Training implementation](python/train_word_model.py) · [Training results](reports/model-training.json) · [Integer export](model/integer-model.json)

Training uses local CPU only. GitHub stores completed source, artifacts and reports; do not use GitHub-hosted training jobs.
