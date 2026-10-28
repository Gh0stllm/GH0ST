# Local GH0ST voice evaluation · 26 October 2026

This is **actual local CPU generation** from Qwen3-1.7B Q4_K_M. It adjusts prompting, swap conditioning, grammar and decoding. No weights were trained or fine-tuned. No canister, chain transaction, account or X post was used.

The final candidate consistently produced short, finished single-line text in these tests, but its humour and sentence variety remain uneven. A freshness gate deliberately rejects some otherwise well-formed outputs. This is an experimental voice profile, not a guarantee of Terminal of Truths-level writing.

## Pinned inputs and execution

| Item | Value |
| --- | --- |
| Model repository | `unsloth/Qwen3-1.7B-GGUF` |
| Model revision | `d7f544eead698dbd1f15126ef60b45a1e1933222` |
| File | `Qwen3-1.7B-Q4_K_M.gguf`, 1,107,409,472 bytes |
| Model SHA-256 | `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897` |
| Frozen final profile Keccak | `0x7d8b042bc894a151efe57c804508b0431dba483df17aa9f39140c18d95a3f610` |
| Native runner | `llama-cpp-python==0.3.36`, CPU, six threads, context 4,096, batch/microbatch 8 |
| Final KV cache | Q8 K/V, native flash attention enabled; this native build rejects Q8 V without flash attention |
| Generation | Temperature 0.85, top-p 0.9, top-k 40, min-p 0, repeat penalty 1.12, repeat history 64, at most 80 output tokens |
| Prompt and seed source | Exact Rust-exported Qwen wire prompts and source/profile/attempt/token-offset seed schedule |
| Chunk handling | Fresh sampler every four generated tokens; retained KV; penalty history restored; output-only ASCII grammar reset per chunk |

The native library/build, attention kernel and chunk boundaries differ from ICP Wasm execution. These results are not numerical parity, onchain output, gas, cycle-cost or ICP latency evidence. Native output token counts in the reports exclude the EOG token; the coordinator's exact token accounting may include it.

Exploratory rounds 1, 2a and 2b used the native default F16 KV cache. The final candidate and its final baseline comparison both use Q8 KV with native flash attention. Every JSONL file records its settings and model/prompt provenance.

## Results

Eight synthetic swap scenarios cover buy, sell, reversal, pause and new source identities, with the exporter's confirmed-memory fixtures. The old baseline sees only two distinct raw-delta prompt forms across these eight scenarios; it does not receive the new source/memory cues. Its repetition count should be read in that context.

| Run | Cases | Common structural checks passed | Natural endings | Exact distinct outputs |
| --- | ---: | ---: | ---: | ---: |
| Original baseline on 1.7B, F16 KV | 8 | 0 | 0 | 2 |
| First persona, F16 KV | 8 | 5 | 8 | 8 |
| Shorter voice + ASCII grammar, old motifs, F16 KV | 8 | 8 | 8 | 8 |
| Shorter voice + mundane motifs, F16 KV | 8 | 8 | 8 | 8 |
| Frozen final persona, Q8 KV | 8 | 8 | 8 | 8 |
| Original baseline on same final 1.7B/Q8 runner | 8 | 0 | 0 | 2 |

The final candidate used 66–99 characters, a mean 233.5 prompt tokens and a mean 19.1 non-EOG output tokens. All eight passed the exact Rust gate against their individual case references. The original baseline's 50-token cap, greedy decoding and prompt are compared with the candidate's 80-token cap, sampled decoding, grammar and richer prompt as a **package change**; this does not isolate a single parameter or compare 0.6B weights with 1.7B weights.

The final native mean elapsed time was 4.33 seconds per candidate versus 3.15 seconds per old-baseline completion. These are local CPU observations and must not be used as ICP latency or billing estimates. The larger prompt also invalidates a direct assumption of the earlier 100-input-token cost workload.

### Chronological freshness and bounded repair

The final outputs also went through the latest Rust gate as a chronological recent-output stress test. Their original confirmed-memory fixtures stayed fixed; this is not a full chain/canister simulation.

- Five thoughts passed on the first attempt.
- Three were rejected for repeating the recently used phrase `hums with`.
- The original repair instruction echoed the rejected phrase. One actual second-attempt generation passed, and two repeated the phrase again: **six accepted, two held back**.
- The final repair instruction uses positive framing (a fresh first-person administrative action and absurd consequence), keeping the exact rejection reason in metadata without repeating it to the model. Replaying the same frozen first-pass set initially produced **two accepted repairs and one rejection: seven accepted, one held back**.
- That remaining output was a finished sentence ending in quoted dialogue. The structural gate incorrectly rejected a closing apostrophe after a period. The Rust validator was corrected to allow one terminal apostrophe or parenthesis only immediately after sentence punctuation, with unfinished-closing regressions checked separately.
- **Re-gating the exact same generated bytes, without any new inference, accepted the third repair. Final observed result: five first-pass acceptances, three repair acceptances, zero rejections in these eight cases.** No canned or templated fallback replaced any output.

The original raw retry results are in [sequential-quality-repair.json](sequential-quality-repair.json); the final positive-repair run is in [positive-repair/sequence.json](positive-repair/sequence.json). The pre-fix classification is preserved in [sequence-before-quoted-ending-fix.json](positive-repair/sequence-before-quoted-ending-fix.json). They retain accepted and rejected text, references, exact repair prompts and generated token records. These changes did not alter the initial profile, prompts, seed schedule or already-generated outputs. The observed eight-case acceptance is a small local result; it does not prove that every future swap will yield an acceptable reply within its compute allowance, or that all accepted text has the target humour.

### Qualitative review

A single independent AI assessor reviewed randomized, variant-label-blind text/cue fixtures. Some round-1 examples had already been seen. Each output received 0–2 points for coherent surprise, distinctive worldview/deadpan humour, cue grounding, freshness and finished compact form. This is a qualitative rubric, not a population preference benchmark.

The frozen final first-pass set averaged **6.125/10**, with **3/8** scoring at least 7. These scores concern the initial candidates, not the later repaired stream. Four final candidates used the `hums with` construction. The strongest two were:

> i've swapped my laundry tokens for a new kind of hunger; the machine refuses to return the change.

> the warranty form is my only companion, and it's wearing a bowtie.

These are unedited model outputs from the final native four-token run. Other outputs remained generic or atmospheric; all eight are available in the raw report. Full scores and now-revealed blind mappings are in [editorial-review.json](editorial-review.json).

### Reproducibility probes

A replay of the captured first exploratory prompt/seed schedule reproduced its text. This is a single local determinism observation.

Two final prompts were also generated in a one-shot native sampler. Both differed from the four-token results, and one naturally ended without sentence punctuation. See [local-one-shot-probe-20261026.jsonl](local-one-shot-probe-20261026.jsonl). This demonstrates why a one-shot local sample must not be represented as the future ICP chunked output.

## Reproduce locally

Install the CPU runner in an isolated environment and obtain the pinned GGUF outside Git. The harness verifies its size/hash before loading it.

```bash
python -m venv /absolute/scratch/path/voice-env
/absolute/scratch/path/voice-env/bin/python -m pip install --only-binary=:all: \
  --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu \
  llama-cpp-python==0.3.36

# From rh-icp-inference, export the exact currently compiled prompt/seed fixtures:
cargo run --quiet --manifest-path coordinator/Cargo.toml \
  --example export_voice_cases > /absolute/scratch/path/cases.json

/absolute/scratch/path/voice-env/bin/python evaluation/evaluate_voice.py \
  --model /absolute/scratch/path/Qwen3-1.7B-Q4_K_M.gguf \
  --cases evaluation/prompts-final.json --kv-q8 \
  --output /absolute/scratch/path/final-results.jsonl
```

Use `--compare-baseline --variant baseline` for the old baseline on the same final runner. `check_sequence.py` applies the Rust gate, exports an exact repair prompt for each rejected output and invokes the real local model once more. Its `--regate-only` mode requires matching cached repair outputs and never generates text. It currently records the prepared scratch Rust toolchain paths used in this environment; adapt those paths when reproducing elsewhere.

The committed prompt snapshots preserve each tested stage. Raw JSONL contains the wire text, seeds, token IDs, timing and output; weights and local virtual environments are excluded.
