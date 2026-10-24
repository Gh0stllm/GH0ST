# Reproduce the derived layout from the published model

The optimization does not need a training environment or a new checkpoint.
`restore_baseline.py` restores the 13 selected baseline export files from the
compressed artifacts already listed in the project's `final-model.json`.
It verifies both compressed and decompressed SHA-256 values before use. It
refuses to overwrite a file containing different bytes.

From `research/v4-hook-1m`, using a Python environment with NumPy installed:

```sh
python experiments/gh0st-voice/nova-optimization/layout/restore_baseline.py
python experiments/gh0st-voice/nova-optimization/layout/export_layout.py \
  --source experiments/gh0st-voice/nova-optimization/layout/baseline-restored \
  --out experiments/gh0st-voice/nova-optimization/layout/simd11
```

If source publication files are staged outside the checkout, pass that staged
`research/v4-hook-1m` directory as `--source-root` to the restoration command.
The selection manifest remains the project's original `final-model.json`.

The source checkpoint must be:

```
904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3
```

The exact accepted Q10 reference archive must hash to:

```
9e7cfa1b40330a69fbc1b5278fafa51a151d9fcd94e8f12273f385a50b578c0d
```

The restoration verifies 8,175,493 parameter values across all tensors. The
subsequent export checks the mathematical carry bound and all 94,248 selected
packed/scalar dot comparisons again.

`reproducibility.json` records a separate completed test: first restoring only
the compressed publication artifacts, then deriving the layout into a second
directory. All 13 derived files were byte-for-byte identical to the original
SIMD11 baseline export. This includes all model data, tables, vocabulary,
reference archive, source and manifest. The final optimized runtime can add
reviewed loop/core changes to this baseline without changing these data files;
its own source hash must be recorded separately.

No step in these scripts accesses a network, RPC, wallet, or chain.
