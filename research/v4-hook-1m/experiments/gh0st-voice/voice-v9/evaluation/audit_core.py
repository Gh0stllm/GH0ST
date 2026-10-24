#!/usr/bin/env python3
"""Independent CPU checks for V9 windows, masks, accounting and frozen weights."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = Path(__file__).resolve().parent
CORE = HERE.parent/'pretrained-continuity/core.py'
SOURCE_SHA = hashlib.sha256(CORE.read_bytes()).hexdigest()
spec = importlib.util.spec_from_file_location('v9_core_under_review', CORE)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
torch.set_num_threads(2)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    checked = 0
    for warmup in [32, 64]:
        for length in [2, 31, 64, 127, 128, 129, 191, 192, 193, 255, 256, 511]:
            ids = [0 if i % 31 == 0 else 5+i%100 for i in range(length)]
            expected = {i for i in range(1, length) if ids[i] != 0}
            found = []
            for row in core.windows(ids, 128, warmup):
                found.extend(row['start']+i for i in range(1, len(row['labels'])) if row['labels'][i] != -100)
                assert row['targets'] == sum(x != -100 for x in row['labels'][1:])
            assert set(found) == expected and len(found) == len(expected)
            checked += 1
    # Counter limits depend on supervised targets, not padding or window length.
    class FakeCorpus:
        def sample(self, split, kind, rng):
            return {'ids': [5]*128, 'labels': [-100]*32+[5]*96, 'targets': 96,
                    'document_id': kind, 'group_id': kind, 'start': 0}
    counts = {'voice': 0, 'grammar': 0}
    rng = np.random.default_rng(10)
    stages = []
    for boundary in [50000, 100000]:
        while counts['voice'] < boundary:
            batch, updated = core.make_batch(FakeCorpus(), rng, counts, 64, 128, 400000, 100000, boundary)
            assert batch and sum(x['targets'] for x in batch) == sum(updated.values())-sum(counts.values())
            for row in batch:
                assert row['targets'] == sum(x != -100 for x in row['labels'][1:])
            counts = updated
        assert counts['voice'] == boundary and sum(counts.values()) <= 400000
        stages.append(dict(counts))
    no_batch, final_counts = core.make_batch(FakeCorpus(), rng, counts, 64, 128, 400000, 100000, 100000)
    assert not no_batch and final_counts == counts
    short = {'ids': [3, 4, 5], 'labels': [-100, 4, 5], 'targets': 2}
    long = {'ids': [3]*128, 'labels': [-100]+[3]*127, 'targets': 127}
    ids, labels, mask = core.tensors([short, long], 128, 'cpu')
    for row, length in [(0, 3), (1, 128)]:
        for query in range(length):
            observed = set(torch.where(mask[row, 0, query] == 0)[0].tolist())
            expected = set(range(max(0, query-63), query+1))
            assert observed == expected
    assert torch.isfinite(mask).all()
    assert bool((labels[0, 3:] == -100).all())
    tokenizer = AutoTokenizer.from_pretrained(core.BASE, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(core.BASE, local_files_only=True, trust_remote_code=False,
                                               use_safetensors=True, attn_implementation='eager', dtype=torch.float32)
    model.eval()
    trainable_count = core.freeze_top2(model)
    trainable_names = [n for n, p in model.named_parameters() if p.requires_grad]
    assert trainable_names and all(n.startswith(('model.layers.2.', 'model.layers.3.')) for n in trainable_names)
    assert not model.model.embed_tokens.weight.requires_grad and not model.model.norm.weight.requires_grad
    assert model.model.embed_tokens.weight.data_ptr() == model.lm_head.weight.data_ptr()
    frozen_before = core.frozen_hashes(model)
    train_before = {n: core.tensor_sha(p) for n, p in model.named_parameters() if p.requires_grad}
    with torch.no_grad():
        logits = model(input_ids=ids, attention_mask=mask, use_cache=False).logits
        assert torch.isfinite(logits).all()
        changed = ids.clone()
        changed[1, 70:] = 8
        altered = model(input_ids=changed, attention_mask=mask, use_cache=False).logits
        assert torch.equal(logits[1, :70], altered[1, :70])
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-6)
    loss = model(input_ids=ids, attention_mask=mask, labels=labels, use_cache=False).loss
    assert torch.isfinite(loss)
    loss.backward()
    assert all(p.grad is None for p in model.parameters() if not p.requires_grad)
    opt.step()
    assert core.frozen_hashes(model) == frozen_before
    changed_count = sum(core.tensor_sha(p) != train_before[n] for n, p in model.named_parameters() if p.requires_grad)
    assert changed_count > 0
    assert sha(CORE) == SOURCE_SHA, 'Source changed during audit; rerun against stable source'
    report = {
        'status': 'PASS_CORE_CPU_DATA_AND_TRAINER_PENDING', 'gpu_actions': 0, 'network_actions': 0,
        'core_sha256': SOURCE_SHA, 'base_sha256': sha(core.BASE/'model.safetensors'),
        'window_cases': checked, 'exact_once_known_targets': True,
        'counter_boundary_results': stages, 'counter_caps_and_masks_pass': True,
        'valid_query_mask_last64_including_current': True, 'padded_model_logits_finite': True,
        'future_token_causality_exact': True,
        'trainable_parameter_count': trainable_count, 'trainable_names': trainable_names,
        'frozen_parameters_unchanged_after_step': True, 'tied_head_and_embedding_frozen': True,
        'trainable_tensors_changed_after_step': changed_count,
        'step_is_in_memory_only': True,
        'caveats': [
            'Default64-token overlap supplies64 input positions before the first newly scored mid-document target.',
            'Independent128-token windows do not exactly equal a long-running four-layer KV cache even with64 overlap.',
            'Padded queries may attend the first valid key solely to make their softmax finite; their targets are ignored and real-query masks are unchanged.',
            'This does not approve a prepared data snapshot or a trainer/resume implementation that is not yet present.'
        ]
    }
    (HERE/'core-audit.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['trainable_names', 'caveats']}))


if __name__ == '__main__':
    main()
