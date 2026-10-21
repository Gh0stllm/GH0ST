"""Summarize two completed local pilots without implying a controlled comparison."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(path):
    return json.loads((ROOT / path).read_text())


def main():
    first = read('run.json')
    second = read('t5-pilot/run.json')
    assert first['status'] == second['status'] == 'complete'
    assert read('t5-pilot/reload-verification.json')['status'] == 'passed'
    q_first = read('quantization.json')['variants']
    lines = [
        '# Sub-100M agent model: completed local pilots', '',
        '**Neither checkpoint is ready to deploy.** Both are actual trained complete models below 100M parameters. The second copies several held-out action arguments successfully, but conversation, preference handling and missing arguments remain unreliable. These are CPU training/evaluation results; neither complete student runs in smart contracts and no full-model gas saving is measured.', '',
        '## Measured results', '',
        '| Student | Parameters | Steps | Training seconds |',
        '|---|---:|---:|---:|',
        f'| Depth-pruned SmolLM2 | {first["student_parameters"]:,} | {first["completed_steps"]} | {first["training_seconds"]:.1f} |',
        f'| Complete pretrained T5-small | {second["student_parameters"]:,} | {second["completed_steps"]} | {second["training_seconds"]:.1f} |', '',
        'Both use checked synthetic targets plus a frozen local teacher KL loss. The first teacher is SmolLM2-135M-Instruct; the second is FLAN-T5-small. **No GPT-OSS or DeepSeek teacher was run.** No API inference, GPU rental, public transactions or funds were used.', '',
        '| Variant | Valid parsed schema | Correct action intent | Exact action / keyword checks passed |',
        '|---|---:|---:|---:|',
    ]
    variants = [('SmolLM2 student', first['student_test'])]
    variants += [(f'SmolLM2 int{v["bits"]} weight sensitivity', v['summary']) for v in q_first]
    variants += [('T5-small student', second['test'])]
    variants += [(f'T5-small int{v["bits"]} weight sensitivity', v['summary']) for v in second['quantization']]
    for name, score in variants:
        lines.append(f'| {name} | {score["schema_valid"]}/{score["total"]} | {score["intent_correct"]}/{score["total"]} | {score["case_pass"]}/{score["total"]} |')
    lines += ['',
        '**The rows are not a controlled architecture comparison.** The second pilot uses fresh final prompts/argument values, an expanded training corpus, a different initialization and teacher, more steps, and trains all student weights. The first final test was retired after review. Each checkpoint was fixed before its final test; these tests must now be retired for further tuning.', '',
        'The datasets share a small action domain and FAQ topics across splits. Action cases require the correct arguments. Reply/clarify/refuse cases use word checks, which can miss acceptable paraphrases and do not establish semantic accuracy. The Python scorer parses JSON before checking the object schema and accepts the final value of duplicate keys. It is not an execution parser or a security guarantee.', '',
        '## Second student by task', '',
        '| Task | Passed / cases |', '|---|---:|']
    for name, score in second['test']['by_group'].items():
        lines.append(f'| {name} | {score["passed"]}/{score["total"]} |')
    lines += ['',
        'Concrete success: the second student emitted `complete_task` with task ID 701 correctly for a held-out request. Concrete failures: it refused a greeting; refused to store a supported name preference; invented the title “make a new task” when a title was missing; and emitted duplicate task ID fields for another missing-ID request. Formatting alone is insufficient.', '',
        'The first student passed only one of 62 checks and often substituted task ID 2 or a generic task title. Its complete original report is `SMOL-PILOT-RESULTS.md`.', '',
        '## Exploratory challenges for the second student', '',
        'These reuse challenge categories from the first pilot and are qualitative diagnostics, not an independent accuracy benchmark. No output was executed.', '']
    for case in read('t5-pilot/qualitative-challenges.json')['cases']:
        lines += [f'### {case["case"]}', '', case['prompt'], '', '```text', case['output'], '```', '']
    lines += ['## Precision and on-chain implications', '',
        'Both checkpoints are saved in BF16 and evaluated in float32 after BF16 rounding. Int8/int4 results use per-row quantize/dequantize of matrix weights with floating-point arithmetic. They do not test quantized activations, integer attention/norms, accumulated fixed-point error, smart-contract execution or gas.', '',
        '| Second student matrix precision | Ideal packed matrix bytes | Float32 scale bytes | Other float32 bytes |',
        '|---|---:|---:|---:|']
    for variant in second['quantization']:
        lines.append(f'| Int{variant["bits"]} | {variant["matrix_payload_bytes"]:,} | {variant["scale_bytes"]:,} | {variant["other_float32_bytes"]:,} |')
    lines += ['',
        'Tokenizer data, contract overhead, padding, runtime caches and state are additional. The second model has both encoder and decoder computation; parameter count alone does not establish execution cost. Its three JSON punctuation tokens use previously padded vocabulary rows; arbitrary quoted/escaped strings remain a tokenizer limitation.', '',
        '**The historical 144M execution gas and 17.9B deployment gas apply to one block of the earlier LFM experiment. They do not apply to either complete student.** All historical LFM contracts, benchmarks and reports remain bundled.', '',
        '## Delivered and next decision', '',
        '- Two actual trained checkpoints, tokenizers, exact model revisions, license attribution, dataset manifests, full generations, training logs and reproducible scripts.',
        '- Weight sensitivity results and qualitative failures for both models. The saved T5 checkpoint hashes and three reloaded generations were verified.',
        '- `TEACHER-OPTIONS.md`: sourced GPT-OSS/DeepSeek comparison and a fair teacher evaluation design. Neither is yet a measured winner below 100M.', '',
        'The next quality experiment needs a broader checked instruction corpus, independent evaluation, an SFT-only control and matched student runs with candidate teachers. We should meet a concrete chat/action quality target before investing in a full integer smart-contract port. These brief, synthetic pilots do not establish the limit of sub-100M models, nor do they establish that a famous teacher solves the observed failures.', '',
        'The intended runtime remains fully on-chain tokenization, inference, memory and validated actions. Training/export happen offline. A user or keeper must submit transactions.', '',
        '## Reproduction and provenance', '',
        'Use the project root dependency lock and the model revisions in `distillation-pilot/teacher-lock.json` and `distillation-pilot/t5-pilot/model-locks.json`. The two pilot READMEs explain data, training, saved formats and known limitations. All three upstream model cards and Apache-2.0 attribution are bundled.', '',
        'Rebuild these reports after completed runs with `python distillation-pilot/summarize.py` and `python distillation-pilot/summarize_combined.py`. No training is performed by those commands.', '',
        'Primary model sources:', '',
        '- https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
        '- https://huggingface.co/google-t5/t5-small',
        '- https://huggingface.co/google/flan-t5-small', '']
    (ROOT.parent / 'DISTILLATION-RESULTS.md').write_text('\n'.join(lines))
    print(json.dumps({'smol_pass': first['student_test']['case_pass'],
                      't5_pass': second['test']['case_pass'], 'cases_each': 62,
                      'controlled_comparison': False, 'onchain_measured': False}))


if __name__ == '__main__':
    main()
