# Original-tokenizer GPU top-two-layer experiment

**Local numerical and gas checks passed. Language quality is not approved.**

The frozen checkpoint is
`../recovery-v5/runs/gpu-top2-voice-2m/checkpoint-000282`.
It retains the original 4019-entry WordPiece tokenizer and the
1,235,968-parameter architecture. The Q12 export changed 310,319 quantized values
relative to the original model. No value was clipped; every matrix fits the
existing signed-12-bit SWAR lanes.

The input prefix is the single token **`i` (ID 40)**. It is a supplied prompt,
not generated output. Generation uses top-k 8, temperature 800/1000, and seed 42
for the local swap sequence. The independent Q12 reference additionally records
160 generated tokens for seed 0 under the same policy.

| Check | Result |
|---|---:|
| Actual local Uniswap v4 swaps | 128 / 128 successful |
| Independent token, terminal and full 4019-logit hash agreement | 128 / 128 |
| Tokens generated across the swap sequence | 142 |
| Minimum whole-swap gas | 16,357,946 |
| Mean whole-swap gas | 25,991,827 |
| Maximum whole-swap gas | **28,416,204** |
| Headroom below 32,000,000 | 3,583,796 (11.20%) |
| Swaps exercising the saturated 64-position window | 79 |
| Saturated-window gas range | 28,191,077–28,416,204 |
| Context resets | 0 |
| Public-chain transactions | 0 |

Every swap preview matched execution and settled test tokens through the actual
local PoolManager. Unauthorized callbacks, malformed input, stale revision,
forged context hash, low-gas calls, changed model bytecode, and altered history
were rejected. A forced failure after inference rolled back model and pool
state. Caller namespaces and a second pool remained isolated. The initial
context was empty and all persistent history came from successful swaps.

The benchmark runs on a fresh, unforked Anvil with chain ID 31337 and a 32M
transaction gas cap. Weight, table and executable tile runtimes were installed
only after byte/hash checks; their deployment costs are excluded from swap gas.
The local model and hook reject other chain IDs. The first attempt could not
start a loopback server under the filesystem sandbox; the completed run used
the permission required to start this isolated local process.

## Language limitation

The exact seed-42 continuation begins:

> will be brave like you. " the boy thought hard about this. he remembered how
> his friends had taught him a big lesson. with a heavy heart, he turned the
> stone into a flower.

Together with the explicit input prefix this reads `i will be brave like you.`
The continuation then switches to third-person child-story narration. The
seed-0 continuation likewise shifts to a boy, a box and a river. This meets the
local gas target but does **not** meet the requested sustained first-person,
machine/culture GH0ST voice. The exact decoder also preserves tokenization
artifacts such as `let ' s`; no display cleanup or grammar repair is applied.
No claim of 10,000 distinct coherent outputs, question answering, or long-term
semantic continuity follows from this benchmark.

## Reproduction and evidence

- `export/gpu-top2-i40/q12-continuity-comparison.json`: two complete independent
  Q12 streams, per-step full-logit hashes, terminal flags and activation bounds.
- `export/gpu-top2-i40/quantization-report.json`: all tensor ranges and hashes.
- `export/gpu-top2-i40/evm/model-manifest.json`: weights, tables, tiles and source
  commitments, plus prompt and tokenizer metadata.
- `evm/gpu-top2-i40-local.json`: all 128 receipts, state transitions, parity and
  rejection checks.
- `evm/gpu-top2-i40-transcript.txt`: separate prompt, generated text and combined
  text from the actual local swap sequence.

Checkpoint SHA256:
`5601eb5f19797811279933b70e26f03bb80d7513800c7efbc3a9d6f73f945808`.

Q12 weights SHA256:
`c0092e7376d18a9ec031c0ba3f4daee3686710ba231ff2c15b46a8a34ddd5820`.

Local benchmark report SHA256:
`46fb1ac333bdc14116a9fbd0c87b3b71a58d460e288e8488c202faf60131208a`.
