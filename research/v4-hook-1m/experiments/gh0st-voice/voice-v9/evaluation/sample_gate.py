#!/usr/bin/env python3
"""CPU-only native FP32 sliding64 continuations on the frozen eight-prefix gate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = Path(__file__).resolve().parent
GATE = HERE.parents[1]/'voice-v7/evaluation/teacher-review/teacher-validation-gate.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@torch.inference_mode()
def generate(model, tokenizer, prefix, seed, count):
    prefix_ids = tokenizer.encode(prefix, add_special_tokens=False)
    assert prefix_ids and 0 not in prefix_ids
    ids, cache = [], None
    generator = torch.Generator().manual_seed(seed)
    for step in range(count):
        current = prefix_ids if step == 0 else [ids[-1]]
        end = len(prefix_ids) + step
        start = end-len(current)
        query = torch.arange(start, end)[:, None]
        key = torch.arange(end)[None, :]
        allowed = (key <= query) & (key > query-64)
        mask = torch.zeros((1, 1, len(current), end))
        mask.masked_fill_(~allowed[None, None], torch.finfo(torch.float32).min)
        result = model(input_ids=torch.tensor([current]), attention_mask=mask,
                       position_ids=torch.arange(start, end)[None, :],
                       past_key_values=cache, use_cache=True)
        cache = result.past_key_values
        logits = result.logits[0, -1].float()
        assert torch.isfinite(logits).all()
        logits[0] = -torch.inf
        scores, candidates = torch.topk(logits, 8)
        choice = torch.multinomial(torch.softmax(scores/.8, 0), 1, generator=generator)
        ids.append(int(candidates[choice]))
    return {'prefix': prefix, 'prefix_token_ids': prefix_ids, 'seed': seed,
            'generated_token_ids': ids,
            'continuation': tokenizer.decode(ids, skip_special_tokens=True),
            'text': tokenizer.decode(prefix_ids+ids, skip_special_tokens=True),
            'eos_positions': [i for i, token in enumerate(ids) if token == 1],
            'forced_punctuation': False, 'state_resets': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    assert not a.output.exists()
    torch.set_num_threads(2)
    tokenizer = AutoTokenizer.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False,
                                               attn_implementation='eager', dtype=torch.float32).eval()
    gate = json.loads(GATE.read_text())
    rows = []
    for prompt in gate['prompts']:
        for seed in [0, 42]:
            rows.append(generate(model, tokenizer, prompt['prompt'], seed, 128) |
                        {'prompt_id': prompt['id'], 'student_training_allowed': False})
    report = {'status': 'RAW_NATIVE_FP32_GATE_REQUIRES_HUMAN_REVIEW',
              'checkpoint': str(a.checkpoint), 'weights_sha256': sha(a.checkpoint/'model.safetensors'),
              'tokenizer_sha256': sha(a.checkpoint/'tokenizer.json'), 'gate_sha256': sha(GATE),
              'script_sha256': sha(Path(__file__)),
              'decoder': 'Native FP32 absolute RoPE; exact supplied prefix followed by cached sliding64 attention; topK8/T0.8; local per-stream Torch generator. Not Q12 Keccak parity.',
              'new_tokens': 128, 'gpu_actions': 0, 'network_actions': 0,
              'outputs': rows}
    a.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'path': str(a.output), 'streams': len(rows), 'weights_sha256': report['weights_sha256']}))


if __name__ == '__main__':
    main()
