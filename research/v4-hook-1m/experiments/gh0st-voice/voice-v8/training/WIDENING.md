# Offline float widening

`widen.py` converts the existing two-layer V7 GRU checkpoint to an integer
multiple of its hidden width. It does not train, load an optimizer, refit a
vocabulary, generate training text, or send transactions.

For example, from the research directory:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v8/training/widen.py \
  --source CHECKPOINT_DIRECTORY \
  --output NEW_CHECKPOINT_DIRECTORY \
  --target-width 512 \
  --vocabulary experiments/gh0st-voice/voice-v7/training/encoded-base/vocabulary.json
```

Each source hidden channel becomes adjacent replicas: target index `j` refers
to source index `j // factor`. The r/z/n gate blocks retain their order.
Embedding channels are repeated. Input and recurrent matrices repeat output
channels and repeat input columns divided by the factor. Feature projection
rows repeat without dividing its six input columns. Hidden biases and domain
channels repeat inside their gate blocks. Group, lexical, and punctuation
output columns repeat divided by the factor; scalar and word/punctuation
biases remain unchanged. Output vocabulary rows never move. A supplied
vocabulary file is copied byte for byte.

The converter validates all shapes and finite values, checks every converted
tensor against an independent indexed mapping, and runs a deterministic float
forward check with nonzero initial states and features. The latter covers all
group and lexical logits plus all punctuation classes at16 steps. Mathematically
the replicated channels preserve the function. FP32 matrix accumulation order
changes, so observed differences and the exact tolerance are saved rather than
claimed to be bit-identical. This is not an integer/export or EVM parity check.

Output includes `model.safetensors`, `config.json`, `widen-manifest.json`, and an
optional unchanged `vocabulary.json`. The manifest binds source/output hashes,
dimensions, source and output value counts, mapping checks, and float errors.
The output directory must not already exist. A later trainer must explicitly
create a new optimizer.

The optional `--jitter-std` adds seeded absolute FP32 Gaussian noise to neural
weight channels **after** the clone checks. Its manifest clearly labels this as
non-function-preserving. Scalar priors, domain bias, and feature projection are
left intact. The default is zero noise.

`test_widen.py` checks factors1/2/3/4, long float state propagation, gate order,
feature-row scaling, source immutability, and explicitly labeled jitter.

The initial converter smoke used the existing V7 base2M checkpoint and widened
H128 to H512. It saved11,670,661 float values (46,684,244-byte safetensors file),
passed full tensor mapping, and observed maximum absolute float errors of
9.84e-7 in layer1,4.77e-6 in layer2,3.72e-5 in group logits,2.96e-5 in lexical
logits, and9.54e-7 in punctuation logits. These are conversion results, not
language-quality or gas claims.
