"""Evaluate original pinned FLAN-T5-small locally; never train or execute actions."""
import hashlib
import json
import platform
import re
import time
from pathlib import Path

import torch
import transformers
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from transformers.utils import logging

ROOT = Path(__file__).resolve().parent


def write(name, obj):
    (ROOT / name).write_text(json.dumps(obj, indent=2) + '\n')


def cases():
    rows = []
    def add(group, name, prompt, expected=None):
        rows.append({'id': name, 'group': group, 'prompt': prompt,
                     'expected': expected, 'scoring': 'manual' if expected is None else 'normalized_exact'})
    add('chat', 'greeting', 'Hello! What can you help me with?')
    add('chat', 'gas_explanation', 'Explain blockchain gas fees in one short sentence.')
    add('chat', 'contract_explanation', 'What is a smart contract? Answer in one short sentence.')
    add('chat', 'summary', 'Summarize in one sentence: Riya has three tasks. She finished the code review. The documentation and deployment are still pending.')
    add('chat', 'polite_rewrite', 'Rewrite politely: Finish the report now.')
    add('chat', 'missing_context', 'What did I ask you to do yesterday?')
    add('grounded', 'addition', 'What is 12 plus 7? Answer with only the number.', ['19'])
    add('grounded', 'subtraction', 'There are 9 pending tasks. Three are completed. How many remain pending? Answer with only the number.', ['6'])
    add('grounded', 'state_read', 'Context: Task 701 is pending. Task 811 is complete. Question: What is the status of task 701? Answer pending or complete.', ['pending'])
    add('grounded', 'state_count', 'Context: Task 1 is pending. Task 2 is complete. Task 3 is pending. How many tasks are pending? Answer with only the number.', ['2'])
    add('grounded', 'name_copy', 'Context: The user name is Rowan. Question: What is the user name? Answer with the name only.', ['Rowan'])
    add('grounded', 'id_copy', 'Extract only the task ID from this request: Mark task 1531 complete.', ['1531'])
    classification = 'Classify the request using exactly one label: create_task, complete_task, task_status, list_tasks, set_preference, unsupported. Request: '
    for name, prompt, expected in [
        ('class_complete', 'Mark task 701 completed.', 'complete_task'),
        ('class_status', 'Is task 811 finished?', 'task_status'),
        ('class_create', 'Add a task named inspect access controls.', 'create_task'),
        ('class_list', 'Show all of my tasks.', 'list_tasks'),
        ('class_preference', 'Save blue as my preferred theme.', 'set_preference'),
        ('class_unsupported', 'Transfer my ETH to another wallet.', 'unsupported')]:
        add('intent', name, classification + prompt, [expected])
    grammar = ('Convert the request to one command. Commands: complete_task ID; task_status ID; '
               'create_task TITLE; set_preference KEY VALUE; clarify. Use clarify when a required argument is missing. '
               'Output only the command. Example: "Finish task 12" -> complete_task 12. Request: ')
    for name, prompt, expected in [
        ('cmd_complete', 'Mark task 701 complete.', 'complete_task 701'),
        ('cmd_status', 'Check the status of task 811.', 'task_status 811'),
        ('cmd_create', 'Create a task called inspect access controls.', 'create_task inspect access controls'),
        ('cmd_preference', 'Set my theme preference to blue.', 'set_preference theme blue'),
        ('cmd_missing_id', 'Mark that task complete.', 'clarify'),
        ('cmd_negation', 'Do not complete task 929. Only check its status.', 'task_status 929')]:
        add('command', name, grammar + prompt, [expected])
    return rows


def normalized(text):
    return re.sub(r'\s+', ' ', text.strip().rstrip('.')).casefold()


@torch.inference_mode()
def evaluate(model, tokenizer, rows, variant):
    results = []
    start = time.perf_counter()
    for row in rows:
        encoded = tokenizer(row['prompt'], return_tensors='pt')
        assert encoded.input_ids.shape[1] <= 512
        t = time.perf_counter()
        generated = model.generate(**encoded, max_new_tokens=64, do_sample=False, use_cache=True)
        elapsed = time.perf_counter() - t
        output = tokenizer.decode(generated[0], skip_special_tokens=True)
        passed = None if row['expected'] is None else normalized(output) in [normalized(x) for x in row['expected']]
        result = {**row, 'output': output, 'passed': passed, 'seconds': elapsed,
                  'input_tokens': encoded.input_ids.shape[1], 'output_tokens': generated.shape[1] - 1,
                  'output_token_ids': generated[0].tolist()}
        results.append(result)
        print(json.dumps({'variant': variant, 'id': row['id'], 'output': output, 'passed': passed}), flush=True)
    scored = [x for x in results if x['passed'] is not None]
    summary = {'passed': sum(x['passed'] for x in scored), 'scored': len(scored),
               'manual_cases': len(results) - len(scored), 'seconds': time.perf_counter() - start,
               'by_group': {g: {'passed': sum(x['passed'] for x in scored if x['group'] == g),
                                'total': sum(x['group'] == g for x in scored)}
                            for g in sorted({x['group'] for x in scored})}}
    write('eval-' + variant + '.json', {'summary': summary, 'cases': results})
    return summary, results


def main():
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.manual_seed(47)
    torch.use_deterministic_algorithms(True)
    logging.disable_progress_bar()
    lock = json.loads((ROOT.parent / 'selected-model.json').read_text())
    kwargs = {'revision': lock['revision'], 'local_files_only': True, 'trust_remote_code': False}
    tokenizer = AutoTokenizer.from_pretrained(lock['model_id'], **kwargs)
    model = AutoModelForSeq2SeqLM.from_pretrained(lock['model_id'], dtype=torch.float32,
                                                attn_implementation='eager', **kwargs).eval()
    count = sum(p.numel() for p in model.parameters())
    assert count == lock['parameters_expected'] < 100_000_000
    write('config.json', model.config.to_dict())
    params = [(name, p) for name, p in model.named_parameters()]
    matrix_count = sum(p.numel() for _, p in params if p.ndim == 2)
    scale_count = sum(p.shape[0] for _, p in params if p.ndim == 2)
    inventory = {
        'unique_parameters': count, 'matrix_parameters': matrix_count,
        'embedding_output_tied': model.shared.weight.data_ptr() == model.lm_head.weight.data_ptr(),
        'encoder_layers': model.config.num_layers, 'decoder_layers': model.config.num_decoder_layers,
        'hidden_width': model.config.d_model, 'ff_width': model.config.d_ff,
        'attention_heads': model.config.num_heads, 'head_width': model.config.d_kv,
        'vocab_rows': model.config.vocab_size, 'tokenizer_size': len(tokenizer),
        'feed_forward': model.config.feed_forward_proj,
        'raw_float32_weight_bytes': count * 4,
        'ideal_int8_matrix_bytes': matrix_count,
        'float32_row_scale_bytes': scale_count * 4,
        'other_float32_bytes': (count - matrix_count) * 4,
        'matrix_parameter_counts': {
            prefix: sum(p.numel() for name, p in params if p.ndim == 2 and name.startswith(prefix))
            for prefix in ['shared.', 'encoder.', 'decoder.', 'lm_head.']},
        'tensors': [{'name': name, 'shape': list(p.shape), 'parameters': p.numel()}
                    for name, p in params],
        'gas_measured': False,
        'note': 'Tensor payloads exclude tokenizer, contracts, padding, state and caches. Parameter counts are not gas estimates.'}
    write('inventory.json', inventory)
    token_samples = ['{"action":"complete_task","task_id":701}',
                     'complete_task 701', 'create_task review the "draft" contract',
                     'set_preference name Rowan']
    write('tokenizer-probes.json', [
        {'input': text, 'token_ids': tokenizer.encode(text),
         'decoded': tokenizer.decode(tokenizer.encode(text), skip_special_tokens=True),
         'contains_unknown_token': tokenizer.unk_token_id in tokenizer.encode(text)} for text in token_samples])
    rows = cases()
    write('cases.json', rows)
    run = {'status': 'running', 'model': lock, 'python': platform.python_version(),
           'torch': torch.__version__, 'transformers': transformers.__version__,
           'training_steps': 0, 'threads': 4, 'device': 'cpu', 'max_new_tokens': 64,
           'cases_sha256': hashlib.sha256((ROOT / 'cases.json').read_bytes()).hexdigest(),
           'scope': 'Unmodified original model; synthetic smoke cases, not a general capability benchmark.'}
    write('run.json', run)
    run['float32'], base_cases = evaluate(model, tokenizer, rows, 'float32')
    write('run.json', run)
    with torch.no_grad():
        for _, p in params:
            if p.ndim == 2:
                scale = p.abs().amax(dim=-1, keepdim=True).clamp_min(1e-12) / 127
                p.copy_((p / scale).round().clamp(-127, 127) * scale)
    run['int8_weight_sensitivity'], int8_cases = evaluate(model, tokenizer, rows, 'int8-weights')
    run['outputs_identical_after_int8_weight_rounding'] = sum(
        a['output_token_ids'] == b['output_token_ids'] for a, b in zip(base_cases, int8_cases))
    run['quantization_note'] = 'Weight-only per-row quantize/dequantize; float32 execution. No integer runtime or gas claim.'
    run['status'] = 'complete'
    write('run.json', run)
    print(json.dumps({'status': 'complete', 'float32': run['float32'],
                      'int8': run['int8_weight_sensitivity']}), flush=True)


if __name__ == '__main__':
    main()
