# Complete integer inference reference — candidate v1

The v1 arithmetic now also has a complete Solidity implementation on the separate runtime research branch. [Runtime design and reproduction](FULL-SOLIDITY.md) describes immutable model storage, tokenizer, causal cache and bounded continuation. This document remains the original host-reference arithmetic specification; the port uses those same rules.

`s0ul/integer.py` implements the complete causal forward pass and greedy token
generation for S0UL's architecture. It is a **Python/NumPy reference**, not a
Solidity runtime, gas benchmark or Robinhood Chain deployment. No accuracy or
affordability result follows from the existence of this implementation.

## Arithmetic boundary

Checkpoint conversion is offline and uses floating point. It writes fixed
integer weights, scales, normalization gains, RoPE tables and an exponential
lookup table. `IntegerModel.load`, `forward` and `generate` perform model
computation using integer arrays and Python integer arithmetic only. Runtime
timing and JSON formatting are outside model computation.

The separate first exporter in `s0ul/export.py` retains floating-point scales
and normalization gains. Its files are **not** this integer bundle. The
integer candidate has format `gh0st-s0ul-integer-v1` and its own manifest.

## Numeric rules

| Item | Candidate v1 rule |
| --- | --- |
| Activations and logits | Signed Q14, held in int64 arrays |
| Activation saturation | Every linear output, norm output, RoPE result and residual sum clamps to ±1,048,575 (approximately ±64) |
| Matrix weights | Symmetric signed INT8, range −127…127, per output row |
| Matrix scales | Positive Q24 integer; supported effective scale at most 1 |
| Norm gains | Q14 integers |
| Rounding | Nearest integer; exact ties away from zero |
| Overflow | Check conservative dot/multiply bounds before NumPy int64 operations; raise rather than silently wrap |
| Token selection | Greedy argmax; lowest token ID wins a tie |
| Context handling | Reject overflow; never silently truncate |

For each matrix row, conversion rounds `max(abs(row))/127` to a Q24 scale
(minimum 1), quantizes against that effective scale, and clamps to INT8.
Matmul computes integer dot products, multiplies by that row's Q24 scale,
rounds/divides by 2²⁴ and saturates to the activation range. The shared embedding
matrix is quantized once and reused for the output projection.

RMS normalization computes `isqrt(sum(x*x)//dimension + epsilon_q28)`, divides
`x*2¹⁴` by that integer root, then applies the Q14 learned gain. Each division
uses the stated rounding rule. The default 10⁻⁵ epsilon is converted offline
to Q28. Flooring the squared mean/root is a deliberate approximation.

RoPE uses adjacent channel pairs and precomputed Q14 sine/cosine tables for all
configured positions. Offline frequencies use base 10,000. Attention scales
the Q28 query/key dot product using a precomputed Q14 inverse square root of
head width. Causal rows include only current and earlier positions.

Softmax subtracts the row maximum, clips distances to [0,16], and linearly
interpolates an offline Q24 `exp(-i/256)` table with 4,097 entries. Weighted
value sums divide directly by the sum of these integer weights, avoiding an
additional probability quantization. The clipped exponential tail is nonzero.
This approximation, fixed-point rounding and saturation can change decisions.

## Bundle and reproduction

```bash
python -m s0ul.integer --checkpoint runs/pilot/checkpoint.pt --output exports/integer-pilot
python -m s0ul.integer --bundle exports/integer-pilot --prompt 'Check my ETH balance.' --max-new-tokens 16
python -m s0ul.integer --bundle exports/integer-pilot --evaluate-data data/test.jsonl --evaluation-output reports/integer-evaluation.json --compare-checkpoint runs/pilot/checkpoint.pt --max-new-tokens 32
python -m unittest discover -s tests -p 'test_integer.py' -v
```

`integer-weights.bin` contains contiguous little-endian integer arrays. The
manifest pins its length/hash and each array's name, shape, type, offset,
length and SHA-256. Loading rejects unknown numeric formats, invalid layouts,
corrupt hashes and shape/range mismatches. Files use no pickled array objects.
Checkpoint loading is offline via PyTorch `weights_only=True`.
Checkpoint conversion requires the training format and exact pinned tokenizer
specification. Text generation requires that same specification in the integer
bundle; raw-ID numeric fixtures may omit it.

Generation currently recomputes full causal prefixes. `full_forward_calls`,
elapsed wall time and saturated value counts are reported; these are CPU
diagnostics, not EVM gas. There is no KV cache or numerical claim that this
candidate reproduces the float training model exactly.

Before an EVM port, measure held-out task quality with this exact arithmetic,
review saturated values, publish independent cross-implementation test
vectors and benchmark the complete transaction/checkpoint workload. The
current tests check deterministic execution, causal behavior, zero norms,
tie selection, corruption rejection, overflow rejection and a random seeded
full-size numerical smoke case. They do not establish agent safety.

The optional evaluation command processes every record in its supplied frozen
JSONL split. It reports exact action/argument matches, schema validity,
unexpected control tokens, EOS completion and per-action results. The optional
float comparison must use the exact source checkpoint. Raw generated token IDs
are retained, and token-position agreement includes EOS and penalizes unequal
lengths. These are separate from correctness against expected actions.
