# S0UL learned observation-report capability pilot

This is a **new finite task**, adapted from the deployed S0UL baseline. It tests
whether the existing 984,192-parameter transformer can generate short English
observations from fourteen defined contract-state features. It does not establish
general address research, financial intelligence, security-audit competence,
identity attribution, trading performance or parity with Aixbt.

The original deployed model, tokenizer, checkpoint and training files remain
unchanged. The original float checkpoint is unavailable locally. Initialization
dequantizes its verified INT8/Q24 export and Q14 normalization gains, verifies an
exact integer-array round trip, preserves the transformer layers, and explicitly
remaps feature/word embeddings from the old literal-description embeddings. This
is not the original floating-point training state. Both original provenance and
new checkpoint hashes are recorded.

## What is learned

The model consumes BOS, fourteen categorical feature tokens and SEP: exactly
sixteen prompt tokens. Greedy transformer inference emits at most thirty-one
English word tokens and EOS. The decoder joins those emitted words with spaces;
it never chooses report sentences, computes labels, repairs bad output or falls
back to the authored label generator. An invalid result remains a visible failure.

The labels are offline authored rules describing reported state and selected
combinations of opcode patterns, with explicit uncertainty. They prioritize a few
observations rather than enumerate every field. Reproducing those labels is a
bounded supervised task, not discovering new facts. The deterministic label
policy is therefore a necessary comparator and is expected to score 100% against
its own labels at vastly lower cost. Neural reproduction alone is not a reason
to prefer transformer inference.

`schema.json` freezes feature order, value ranges, offsets and the distinction
between unavailable and zero. `vocabulary.json` freezes all 87 English words at
IDs 64–150. IDs 4–51 encode features, 52–63 and 151–511 are reserved. PAD/BOS/EOS/SEP
are 0/1/2/3. Output rejects every token outside the word range except one final
EOS. The vocabulary and feature-schema hashes are separate identities.

Interface bits are self-reported ERC165/721/1155/2981 claims, gated by the existing
ERC165 validity probes. Getter values may be deceptive. An owner getter does not
prove authority. A delegate-call bytecode pattern does not prove a proxy or an
exploitable path. Positive raw reserves do not establish liquidity value. No-code
observations do not establish identity, historical activity or account safety.

The model receives no raw address, history, external prices or private data.
The surrounding capture/executor must bind address, chain, block, full-facts
hash, schema, model, codec and user authorization separately. These scripts do
not broadcast transactions or access an RPC.

## Reproduce locally

Use the exact recovered S0UL Python package as `SOURCE_ROOT`; it must contain
`s0ul/model.py`, `s0ul/integer.py`, `s0ul/tokenizer.py` and
`s0ul/solidity_export.py`. Python dependencies are the existing PyTorch and NumPy
requirements. Run from this directory:

```bash
python analysis_codec.py
python dataset.py --output regenerated-data-v2
python -m unittest test_analysis.py -v
python train_analysis.py --source-root "$SOURCE_ROOT" \
  --baseline-bundle baseline-integer \
  --data regenerated-data-v2 --output reproduced-run --steps 4000 --seconds 600 --threads 4 \
  --edge-examples-per-batch 8
python evaluate_analysis.py --source-root "$SOURCE_ROOT" \
  --checkpoint run-v2/frozen-checkpoint.pt --data regenerated-data-v2 --output reproduced-evaluation
python predict_analysis.py --source-root "$SOURCE_ROOT" \
  --integer-bundle evaluation-v2/integer \
  --features '[1,1,9,2,0,2,0,0,0,1,1,0,1,1]'
```

Dataset/output destinations must be fresh. Duration is an upper training cap,
not a promised training duration; selection/evaluation adds overhead. Training
uses at most four CPU threads, records real optimizer steps and elapsed time,
and selects using validation plus clearly identified known training regressions.
Test outputs are produced only after the
checkpoint is selected. A fresh optimizer is used on explicit `--resume`;
optimizer-state continuation is not claimed. After training exits, copy the
selected checkpoint to `frozen-checkpoint.pt` before evaluation; never evaluate
or hash a checkpoint file while another process may overwrite it.

The preserved `run-v1` is a failed development candidate, not the final model.
Its two no-code training vectors were underweighted and generated invalid
reports in a development probe. The failure text, checkpoint hash, original
trainer and original dataset generator are retained. Corrected `data-v2`
uses separate opcode-pattern descriptions without implying reachable execution
or relationships. The explicit v2 sampler assigns eight of sixty-four batch
slots to the two known no-code states; those two in-sample regressions are
also identified separately from the 128 validation-selection examples. The
short continuation records the exact frozen v1 initialization and a fresh
optimizer. No sealed test is used to choose this correction or checkpoint.

## Evaluation and limits

The frozen dataset has 24,002 training records, 512 validation records,
512 independent full-vector held-out records and 256 held-out combinations.
The triple `owner=nonzero, pause=true, origin=present` is excluded from training
and validation. Exact-vector SHA256 partitioning prevents split overlap. The
two exhaustive no-code feature vectors are training/regression cases and are
explicitly not counted as independent test generalization. Some synthesized
getter combinations can be adversarial or inconsistent; the labels describe
reports, not verified real-world contract behavior.

Evaluation records every generated token sequence, exact-label agreement,
word/EOS validity, recognized-clause factual consistency, missing uncertainty,
the majority comparator, authored-policy comparator, and shuffled-feature
ablation. It evaluates the full test and combination splits using both the
floating model and converted integer model by default. `--integer-limit` is
only a diagnostic subset and cannot pass the full-evaluation gate.

The cached integer evaluator checks every decision of two examples per split
against the unchanged full-prefix reference, with 512 logits per decision.
It also writes complete raw-logit golden vectors for independent EVM tests.
This Python parity is distinct from EVM verification, which must be performed
separately before claiming deployed arithmetic parity.

`evaluation-report.json` contains an explicit pilot quality gate. Failure means
the model is not demonstrated even for this finite pilot. Passing synthetic
tests never establishes a production analyst. There is no runtime policy
fallback, no test-guided checkpoint selection and no mainnet deployment here.

Exports use the existing integer-v1 numerical rules and original 984,192-parameter
architecture, with a new model identity and codec. The integer manifest keeps
the original byte-tokenizer field unset because that reader pins the old codec;
`analysis-codec.json` supplies the new identity. The Solidity export separately
binds the new word-domain and feature-schema hashes into its manifest hash.

The curated research publication omits raw training JSONL and derived shard
binaries. `dataset.py` deterministically regenerates the v2 dataset; its manifest
must match the published manifest byte for byte. The retained final checkpoint
and integer payload reproduce published inference. Training walltime schedules
depend on hardware; a fresh training run is a new candidate and is not promised
to recreate identical weight bytes. A lean published Solidity manifest omits
`initCodeHex`, which the original manifest hash explicitly excludes. Recreate
all derived shards and full initcode locally without retraining:

```bash
python export_analysis.py --source-root "$SOURCE_ROOT" \
  --checkpoint run-v2/frozen-checkpoint.pt --output reproduced-export
```

The retained baseline manifest/payload are the original immutable export with
checkpoint provenance `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`.
The original integer payload SHA256 is
`1f392feffdf57059ca3969c3fb8087b831ee4a9261764f9bbb1680192da60501`.
