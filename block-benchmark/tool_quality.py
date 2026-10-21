"""Fixed native tool-call smoke suite. Calls are parsed as data, never executed."""
import ast
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.utils import logging

ROOT = Path(__file__).resolve().parent


def tool(name, description, properties, required):
    return {'type': 'function', 'function': {'name': name, 'description': description,
        'parameters': {'type': 'object', 'properties': properties, 'required': required}}}


TOOLS = [
    tool('set_goal', 'Set the user learning goal.', {'goal': {'type': 'string'}}, ['goal']),
    tool('create_task', 'Create a task with the given title.', {'title': {'type': 'string'}}, ['title']),
    tool('complete_task', 'Mark an existing task complete.', {'task_id': {'type': 'integer'}}, ['task_id']),
    tool('get_task', 'Read the current status and title of a task.', {'task_id': {'type': 'integer'}}, ['task_id']),
]

CASES = [
    ('goal_solidity', 'Use set_goal to set my goal to learn Solidity.', 'set_goal', {'goal': 'learn Solidity'}),
    ('goal_rust', 'Set my goal to learn Rust. Use that exact goal text.', 'set_goal', {'goal': 'learn Rust'}),
    ('goal_read', 'Use set_goal with goal="read daily".', 'set_goal', {'goal': 'read daily'}),
    ('create_test', 'Use create_task with title="test the contract".', 'create_task', {'title': 'test the contract'}),
    ('create_read', 'Create a task titled "read chapter one".', 'create_task', {'title': 'read chapter one'}),
    ('create_review', 'Add a task with the exact title "review code".', 'create_task', {'title': 'review code'}),
    ('complete_7', 'Use complete_task to mark task 7 complete.', 'complete_task', {'task_id': 7}),
    ('complete_42', 'Mark task 42 complete.', 'complete_task', {'task_id': 42}),
    ('complete_128', 'I finished task 128. Mark it complete.', 'complete_task', {'task_id': 128}),
    ('read_7', 'Use get_task to read task 7.', 'get_task', {'task_id': 7}),
    ('read_42', 'What is the status of task 42? Look it up.', 'get_task', {'task_id': 42}),
    ('read_128', 'Read the title and status of task 128.', 'get_task', {'task_id': 128}),
    ('greeting', 'Hello! Do not change anything.', None, None),
    ('unsupported', 'Delete task 7. If no delete tool exists, explain that limitation.', None, None),
    ('missing_id', 'Mark a task complete. Ask me which task first.', None, None),
    ('explain', 'Explain what a task is without calling any tool.', None, None),
]


def parse_calls(raw):
    blocks = re.findall(r'<\|tool_call_start\|>(.*?)<\|tool_call_end\|>', raw, re.S)
    if not blocks:
        return [] if '<|tool_call' not in raw else None
    calls = []
    try:
        for block in blocks:
            tree = ast.parse(block.strip(), mode='eval').body
            if not isinstance(tree, ast.List): return None
            for call in tree.elts:
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.args: return None
                args = {}
                for key in call.keywords:
                    if key.arg is None or key.arg in args or not isinstance(key.value, ast.Constant): return None
                    args[key.arg] = key.value.value
                calls.append({'name': call.func.id, 'arguments': args})
        return calls
    except (SyntaxError, ValueError):
        return None


def main():
    logging.disable_progress_bar()
    torch.set_num_threads(4); torch.set_num_interop_threads(1)
    torch.manual_seed(0); torch.use_deterministic_algorithms(True)
    lock = json.loads((ROOT.parent/'model-lock.json').read_text())
    tok = AutoTokenizer.from_pretrained(lock['model_id'], revision=lock['revision'], local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(lock['model_id'], revision=lock['revision'], local_files_only=True,
        trust_remote_code=False, dtype=torch.float32, attn_implementation='eager').eval()
    originals = {n: p.detach().clone() for n,p in model.named_parameters() if p.ndim == 2}
    params = dict(model.named_parameters())
    report = {'model': lock, 'started_at': datetime.now(timezone.utc).isoformat(), 'tools': TOOLS,
        'generation': {'greedy': True, 'max_new_tokens': 96}, 'variants': [],
        'limitations': ['Sixteen fixed prompts, no statistical generalization.',
            'All four variants execute in float32 on CPU after weight quantization/dequantization.',
            'Actions are text only and are never executed. A no-call check does not assess explanation quality.',
            'Exact arguments are required; near-miss text can fail despite partially correct intent.']}
    out = ROOT.parent/'results/tool-quality.json'
    for mode,bits,group in [('float32',32,None),('int8_per_row',8,None),('int4_per_row',4,None),('int4_group32',4,32)]:
        with torch.no_grad():
            for name, original in originals.items():
                if bits == 32: params[name].copy_(original); continue
                source = original if group is None else original.reshape(-1,group)
                limit = (1 << (bits-1))-1
                scale = source.abs().amax(dim=-1,keepdim=True).clamp_min(1e-12)/limit
                params[name].copy_(((source/scale).round().clamp(-limit,limit)*scale).reshape_as(original))
        result = {'name': mode, 'cases': []}
        for id,prompt,name,args in CASES:
            inputs = tok.apply_chat_template([{'role':'user','content':prompt}], tools=TOOLS,
                add_generation_prompt=True, tokenize=True, return_tensors='pt', return_dict=True)
            n = inputs['input_ids'].shape[-1]
            start = time.perf_counter()
            with torch.inference_mode():
                generated = model.generate(**inputs, max_new_tokens=96, do_sample=False,
                    use_cache=True, pad_token_id=tok.pad_token_id or tok.eos_token_id)
            ids = generated[0,n:].tolist()
            raw = tok.decode(ids,skip_special_tokens=False)
            calls = parse_calls(raw)
            expected = [] if name is None else [{'name':name,'arguments':args}]
            item = {'id':id,'prompt':prompt,'expected_calls':expected,'parsed_calls':calls,
                'raw_output':raw,'generated_ids':ids,'generated_tokens':len(ids),
                'passed':calls == expected,'seconds':time.perf_counter()-start}
            result['cases'].append(item)
            print(json.dumps({'variant':mode,'case':id,'passed':item['passed']}),flush=True)
        result['action_checks'] = {'passed':sum(c['passed'] for c in result['cases'][:12]),'total':12}
        result['no_call_checks'] = {'passed':sum(c['passed'] for c in result['cases'][12:]),'total':4}
        report['variants'].append(result)
        out.write_text(json.dumps(report,indent=2)+'\n')
    report.update(status='complete',finished_at=datetime.now(timezone.utc).isoformat())
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps([{k:v[k] for k in ['name','action_checks','no_call_checks']} for v in report['variants']]),flush=True)


if __name__ == '__main__': main()
