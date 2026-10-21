"""Build a report from actual saved runs, with no extrapolated gas claims."""
import json
from pathlib import Path
from dataset import ROOT

def read(name):return json.loads((ROOT/name).read_text())

def main():
    run=read('run.json');assert run['status']=='complete'
    q=read('quantization.json');assert len(q['variants'])==2
    challenges=read('qualitative-challenges.json')
    versions=[('Unadapted teacher',run['teacher_test']),('Distilled student',run['student_test'])]
    versions.extend((f'Int{v["bits"]} weights, float arithmetic',v['summary']) for v in q['variants'])
    lines=['# Custom distilled model: first pilot results','',
        '**This is a complete small-model CPU training/evaluation pilot. It is not on-chain inference and does not establish gas savings.**','',
        f'The complete student has **{run["student_parameters"]:,} parameters across eight decoder layers**. The teacher has {run["teacher_parameters"]:,}. The student was initialized from selected pretrained layers and trained for {run["completed_steps"]} optimizer steps in {run["training_seconds"]:.1f} seconds on local CPU. No public transactions, model API calls, GPU rental or funds were used.','',
        '## Held-out results','',
        'The 62 test prompts were excluded from gradients and checkpoint selection. They use held-out wording and argument values, but share a small task domain and FAQ topics with training.','',
        '| Variant | Valid JSON/schema | Correct intent | Exact action / keyword check |',
        '|---|---:|---:|---:|']
    for name,s in versions:lines.append(f'| {name} | {s["schema_valid"]}/{s["total"]} | {s["intent_correct"]}/{s["total"]} | {s["case_pass"]}/{s["total"]} |')
    lines+=['','The teacher is unadapted to this custom JSON interface. This comparison measures interface/task adaptation, not general intelligence. There is no SFT-only ablation, so improvement cannot be attributed specifically to the teacher-loss term.','',
        '## Student by task','', '| Task | Passed |','|---|---:|']
    for name,s in run['student_test']['by_group'].items():lines.append(f'| {name} | {s["passed"]}/{s["total"]} |')
    lines+=['','Reply/clarify/refuse checks require the correct schema/action and selected words. They are not a semantic judge. The raw generations are provided for inspection. Every output is text only; no model-generated action was executed.','',
        '## Weight sensitivity and size','',
        '| Variant | Packed matrix bytes | Scale bytes | Other float bytes |','|---|---:|---:|---:|']
    for v in q['variants']:lines.append(f'| Int{v["bits"]} | {v["matrix_payload_bytes"]:,} | {v["float32_scale_bytes"]:,} | {v["other_float32_bytes"]:,} |')
    lines+=['','These are ideal tensor payloads. Tokenizer data, contracts, deployed code, attention caches and other overhead are additional. Weight sensitivity was tested by quantizing/dequantizing weights and executing in float32; it is **not** an EVM integer implementation.','',
        'Half the matrix parameters are in the tied embedding/output matrix. `architecture-inventory.json` records analytic operation/cache counts. Neither parameter ratios nor CPU speed can be used as measured gas reductions.','',
        '## Unseen qualitative challenges','',
        'These examples were not trained on and have no automated accuracy score. Valid schema alone does not make an action correct.','']
    for c in challenges['cases']:
        lines += [f'### {c["case"]}', '',c['prompt'],'','```text',c['output'],'```','']
    lines+=['## What is delivered','',
        '- `distillation-pilot/checkpoint/`: actual trained BF16 checkpoint and tokenizer, loadable with Transformers; evaluated in float32 after BF16 rounding.',
        '- `distillation-pilot/pilot.py`: reproducible depth pruning, teacher KL and supervised training.',
        '- `distillation-pilot/{train,validation,test}.json`: all examples and expected responses, with hashes in the manifest.',
        '- `distillation-pilot/eval-*.json`: full generated responses, arguments, timing and per-case checks.',
        '- `distillation-pilot/quantization.json` and `qualitative-challenges.json`: sensitivity and challenge results.',
        '- `distillation-pilot/README.md`: method, scope, reproduction and implementation gates.','',
        '## Decision boundary','',
        'This experiment establishes a reproducible compact student and measures narrow task behavior. It does not establish a reliable general chatbot or an autonomous agent. The next quality work must expand training and use a fresh, independently authored evaluation set before an expensive full on-chain port. The existing held-out test must not be repeatedly used to tune the model.','',
        'The previous LFM contracts and measurements are preserved. **144 million gas and 17.9 billion deployment gas describe the earlier LFM single-block experiment, not this complete student.** No full-model gas figure is claimed.','',
        'Training, pruning and quantization remain offline build steps. The intended deployment keeps runtime inference, memory and action validation on-chain; transaction submission still requires a caller.','',
        '## Sources and licence','',
        '- Upstream model: https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
        '- Pinned revision: `'+run['teacher']['revision']+'`',
        '- Apache-2.0 licence and upstream model card are bundled; this is a modified derivative.',
        '- Pruning/distillation background: https://arxiv.org/abs/2408.11796 . Its reported larger-model performance is not transferred to this pilot.','']
    (ROOT.parent/'SMOL-PILOT-RESULTS.md').write_text('\n'.join(lines))
    print(json.dumps({'student_test':run['student_test'],'quantized':[v['summary'] for v in q['variants']]}))

if __name__=='__main__':main()
