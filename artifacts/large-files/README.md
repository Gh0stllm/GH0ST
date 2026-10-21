# Large checkpoint parts

Two historical distillation checkpoints exceed GitHub's regular 100 MiB file limit. Their exact bytes are preserved here as eight parts of at most 32 MiB, with per-part and complete-file SHA-256 hashes. The original paths and byte counts remain in each model's `manifest.json`.

From the repository root:

```bash
python scripts/restore-large-files.py --verify-only
python scripts/restore-large-files.py
```

The second command reconstructs both original `model.safetensors` paths atomically after every hash matches. A different existing file is rejected; an identical file is verified and retained. `--output-root DIRECTORY` reconstructs elsewhere. Python's standard library is sufficient; Git LFS is not needed.

The two raw checkpoint files should remain outside regular Git commits. The bounded parts and manifests are the Git-compatible copies. Reassembly of both real checkpoints was tested in a separate temporary directory and independently checked against the recovered originals; test outputs were then removed. This changes packaging only, not model values.
