# S0UL-1M numerical specification — first build

This document specifies the **INT8 weight-storage export**, its independent
NumPy float forward reference and small exact integer arithmetic helpers. This
export retains float32 scales and normalization gains; it is not itself a
complete integer transformer or an on-chain inference benchmark.

A **separate complete integer forward candidate** lives in
[`s0ul/integer.py`](s0ul/integer.py), with its own
[`INTEGER-SPEC.md`](INTEGER-SPEC.md), manifest and bundle format. That candidate
uses INT8 matrices, Q24 integer scales, Q14 activations/gains, integer RMSNorm
and pinned RoPE/softmax tables at inference time. Its Python reference is not
a Solidity runtime or a Robinhood Chain deployment. The two export formats
are deliberately separate and must not be treated as interchangeable.

## Model and floating-point reference

The proposed model has 984,192 parameters including its tied embedding/output
matrix. Training uses float32 RMSNorm, adjacent-channel RoPE with base 10,000,
scaled causal softmax attention and ReLU feed-forward blocks. NumPy
`reference.forward_float` independently implements those operations for
numerical comparison. Small floating-point differences are expected; its test
tolerance is not a specification of an EVM implementation.

## INT8 export format

Run from this directory:

```bash
python -m s0ul.export --checkpoint runs/pilot/checkpoint.pt --output exports/pilot
python -m s0ul.export --verify exports/pilot/manifest.json
```

The exporter loads a trusted local checkpoint using PyTorch's restricted
`weights_only=True` loader. The checkpoint contains `config`,
`model_state_dict` and the complete frozen `tokenizer` specification. The
exporter requires the checkpoint tokenizer to match the installed domain
pieces, byte/special-token layout and vocabulary hash, and retains it in the
manifest. It serializes state tensors sorted by name:

- Each matrix is row-major signed INT8 followed by one little-endian float32
  scale for each output row. The shared embedding is stored once.
- For a row with maximum absolute value `a > 0`, `scale = float32(a / 127)`.
  Each weight is rounded from `weight / scale` to the nearest integer, with
  exact ties away from zero, then clamped to `[-127, 127]`.
- An all-zero row uses scale 1 and all-zero integers. `-128` is never emitted.
- One-dimensional normalization gains remain little-endian float32.
- The manifest records every tensor's dimensions, count, byte offset, byte
  length, encoding and SHA-256, plus the complete payload and source-checkpoint
  hashes. Individual shard hashes pin their exact payload bytes.
- `weights.bin` contains contiguous tensor segments. Payload shards contain
  contiguous slices of this same file, at most 90,000 bytes each. They omit
  contract init code, STOP prefixes, address tables and deployment overhead.

`verify_export` checks hashes, exact byte coverage, dimensions, positive finite
scales, supported encodings and exact shard reconstruction. Editing a payload,
scale or layout requires regenerating its pin and separately validating the
result. Hashes provide integrity, not proof of model quality or provenance.

`load_exported_state` dequantizes weights into float32 for sensitivity checks.
Any evaluation using it still uses floating-point activations, RMSNorm,
attention, softmax and decoding. Weight quantization alone does not establish
fully integer inference or gas savings.

## Exact integer primitives

`reference.dot_int8_int16` multiplies symmetric signed INT8 weights by signed
INT16 activations. Its Python integer accumulation is checked against signed
256-bit range. `round_divide` uses nearest-integer rounding with ties away from
zero. `requantize` performs an explicitly supplied nonnegative integer
multiply, division by `2**shift`, the same rounding and output saturation.
Its product is also checked against signed 256 bits.

These primitives are reference groundwork for this export. The exporter stores
float32 scales and **does not derive activation scales, integer multipliers or
a whole-model fixed-point format**. The separate integer candidate specifies
its own RMSNorm, rotary tables, softmax, residual scales and bounds; a future
contract implementation still needs matching contract/reference checkpoints.
INT4 remains a separate unimplemented study.

## Validation boundary

The automated checks exercise quantization error bounds, signed rounding,
overflow/range rejection, a complete exported-model reload, independent
NumPy/PyTorch forward agreement and corruption detection. They do not prove
agent competence, robust permissions, affordable gas or deployed execution.
All public-chain deployment and inference costs remain unmeasured here.
