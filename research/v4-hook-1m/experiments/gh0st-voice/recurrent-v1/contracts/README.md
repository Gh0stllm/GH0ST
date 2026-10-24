# Recurrent word-per-swap prototype

Local-only research. The model and hook constructors reject chain IDs other than
31337. These files do not modify the earlier capacity experiment or live code.

## One successful swap, one generated word

`RecurrentWordModel.stepSampled` consumes the previous token, all 265 recurrent
hidden values, six bounded swap features, a seed, a monotonic word index and a
Q10 temperature. It runs both dense matrices and one 13-node learned vocabulary
tree path, then returns exactly one nonempty vocabulary word. It does not add a
period. A naturally punctuated vocabulary item keeps its own punctuation.

`RecurrentWordHook` carries the new token and all hidden values into the next
swap. Neither punctuation nor an unfinished sentence resets memory. The initial
input is the start-token embedding at ID8192 with zero hidden state; this is not
an emitted word. No prompt, phrase bank or intermediate silent swap is used.

Each successful swap emits one `WordSpoken` event. If gas is insufficient, model
runtime changes, inference fails, or a request uses stale state, the entire swap
reverts. There is no skip-speech path. A fixed deployment seed is combined with
the per-pool word index, which starts at0 and advances by1 per successful swap.
Failed transactions cannot consume the index or hidden state.

Hook data is `abi.encode(uint64 expectedSequence, bytes32 expectedStateHash)`.
The initial values are0 and the zero hash. This binds a swap to the context the
caller reviewed. The event carries the selected token, literal word, natural
terminal flag, sample index, six features, all13 branch scores and state hashes.

The Q10 temperature can be configured between64 and4096 when creating a hook.
The original default is256. This is Bernoulli traversal of learned tree-node
probabilities, not a top-k softmax across8192 output rows.

## Exact export requirements

The architecture has4,492,256 parameters: vocabulary8192; recurrent width265;
embedding width265; six input features; tree depth13. All weights are signed
big-endian int16 with scale1024. Export rounds nearest-even and must reject
overflow rather than silently clip.

| File | Array layout | Bytes |
|---|---|---:|
| core.bin | wx[265,265], wh[265,265], wf[265,6], bh[265] | 284610 |
| embeddings.bin | embedding.weight[8193,265] | 4342290 |
| nodes.bin | 8191 rows of nodes.weight[265] followed by bias.weight[1] | 4357612 |
| vocabulary.bin | 8192 fixed32-byte null-padded ASCII slots | 262144 |
| vocabulary.json | JSON list of8192 exact word strings | variable |
| sigmoid-delta.bin | 257 big-endian uint16 values | 514 |

The immutable sigmoid table is embedded in the contract. Exported table bytes
must equal that table. Words contain1–32 ASCII bytes: letters, interior
apostrophe, and optionally a final `.`, `!` or `?`. No padding/EOS/silent token is
part of the output vocabulary. State values are ReLU-clamped to0..8192 after
division toward zero by1024. This activation clamp is part of the architecture,
not export-time weight clipping.

The prototype reuses the frozen100-update capacity weights only to establish
the new continuation protocol and gas cost. Those weights have not established
adequate language quality. Any new vocabulary or trained checkpoint requires
fresh hashes, exact reference parity and local gas measurement.

## Local runner

From the research directory:

```sh
node experiments/gh0st-voice/recurrent-v1/evm/run-local.mjs \
  --model-dir=experiments/four-point-five-million/model \
  --turns=30 --temperature=256 --label=initial-prototype

experiments/gpt2/.venv/bin/python \
  experiments/gh0st-voice/recurrent-v1/evm/reference.py \
  --model-dir experiments/four-point-five-million/model \
  --report experiments/gh0st-voice/recurrent-v1/evm/initial-prototype-local.json \
  --out experiments/gh0st-voice/recurrent-v1/evm/initial-prototype-reference.json
```

The runner uses only an in-process Hardhat chain with real local v4 swaps and
settlement. Every mutation checks chain31337; no public RPC, private key or
fork mode is accepted. Weight runtimes are installed locally after exact hash
checks, excluding deployment cost from per-swap gas. Normal transactions never
exceed32M gas. The independent reference verifies all265 hidden values and
all13 visited branch scores for every emitted word; its first two steps also
compare NumPy arithmetic to independent scalar Python sums.
