# Teacher-v4 final: execution passes, language fails

This benchmark tests the final corrected teacher run, `runs/teacher-v4-final-4m/checkpoint-003126`, after 4,001,124 target tokens of training. It is an experimental failure benchmark, not a selected model or release candidate.

Checkpoint SHA-256: `c24d7fe2c13b14a3bf49924723580578a27666668fd9f92638f1fc29a386fa57`.

## Exact-Q12 language review

Four complete 256-token continuations were generated using seeds 0, 42, 7, and 123, the quotation-mark prompt, top-k 8, temperature 800, and the 64-position attention window. All four were read in full. None maintains readable reasoning or the intended original machine voice.

| Seed | Observed failure | Complete generated sentence examples |
|---|---|---|
| 0 | Repeated person/man assertions and missing grammatical relationships. | “the man has a man.” “the man has to do not.” |
| 42 | Generic certainty/honesty language with incomplete predicates. | “it has to be honestly.” “i don't have to actually a good plan.” |
| 7 | Box/mirror/man substitutions with no coherent development. | “it is a man whose.” “the man is a man.” |
| 123 | Machine/door assertions and malformed noun phrases. | “i think that is a good develop.” “the machine's availing.” |

Punctuation and apostrophe spacing in the table are normalized for display; the token streams and original decoded text are preserved. Some isolated sentences are grammatical, but their surrounding context does not form a clear thought. The fixed token budget may leave each stream's last sentence unfinished; the examples above are internally terminated failures, not simply budget truncations.

The four streams contain 852 decoded words and 84 complete sentences under the descriptive parser. All 84 normalized sentences are distinct. Repeated word-four-gram fractions range from 0.47% to 2.44%. These apparently favorable uniqueness figures do not measure meaning: the model repeatedly recombines similar person, thing, answer, machine, and door assertions.

No exact twelve-word run in these four generated streams matches a paragraph in any train-split source kind: original writing, offline compositions, historical prose, or licensed teacher text. This is a limited copying check, not proof of novelty relative to original pretraining and not evidence of useful language.

All four Q12 runs stayed inside the checked activation bounds. Integer arithmetic stability does not establish sentence quality.

## Actual local v4 execution

The seed-42 trajectory was tested through 128 actual swaps on a new local Uniswap v4 PoolManager:

- **128/128 swaps passed**, generating 142 tokens with no reset.
- Every token array, terminal flag, and complete final 4,019-logit hash matched the independent Q12 reference.
- Whole-swap gas ranged from **16,337,108 to 28,406,679**.
- The worst observed swap had **3,593,321 gas** of headroom below the 32M cap.
- The full 64-position window was reached at swap 50. The 79 full-window swaps used **28,179,656–28,406,679** gas.
- Model/data hashes, invalid and stale hook data, unauthorized callbacks, insufficient gas, forced post-inference rollback, model/history tampering, and caller/pool isolation checks passed.

The export uses 282 executable tiles. All 544 data/table/tile runtimes were hash-checked and installed on the isolated node to save setup time. Those deployment costs are excluded; model, hook, PoolManager, router, stored context, and swap settlement execute normally. The local node used chain 31337 with loopback only and was stopped after the run. **No public-chain transaction was submitted.**

## Evidence

- Full four-seed decoded transcripts and exact reference: `../export/teacher-v4-final-4m/q12-transcripts.txt` and `q12-continuity-comparison.json`.
- Quantization bounds and export metadata: `../export/teacher-v4-final-4m/quantization-report.json`.
- Independent prose diagnostics: `teacher-v4-final-4m-q12-quality.json`.
- Actual swap evidence and assembled swap text: `../evm/teacher-v4-final-4m-local.json` and `teacher-v4-final-4m-transcript.txt`.
- Independent report check: `teacher-v4-final-4m-independent-check.json`.

Main swap report SHA-256: `0cf409e82d8ae255219c2bcebdd48d15cb72be4f06964017f3bc8aed143447ff`.

Independent Q12 reference SHA-256: `2dc879674fbec2030de36143bdceeb664fb5a1854aeb214e3612e0dba3e3dfbc`.

The practical finding is specific: new teacher-trained weights still execute within the local swap gas budget, but this training run has not produced acceptable English, meaningful continuity, or the requested voice. The gas result must not be presented as success on those language goals.
