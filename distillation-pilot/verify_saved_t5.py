"""Verify persisted checkpoint integrity and replay three saved generations."""
import hashlib
import json
from pathlib import Path

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from transformers.utils import logging

from t5_pilot import ROOT, source


def main():
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    logging.disable_progress_bar()
    report = json.loads((ROOT / 'run.json').read_text())
    assert report['status'] == 'complete'
    checkpoint = ROOT / 'checkpoint'
    for name, expected in report['checkpoint_sha256'].items():
        assert hashlib.sha256((checkpoint / name).read_bytes()).hexdigest() == expected, name
    tokenizer = AutoTokenizer.from_pretrained(checkpoint, local_files_only=True, trust_remote_code=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        checkpoint, local_files_only=True, trust_remote_code=False,
        dtype=torch.float32, attn_implementation='eager').eval()
    assert sum(p.numel() for p in model.parameters()) == report['student_parameters']
    cases = json.loads((ROOT / 'eval-test.json').read_text())['cases']
    replay = []
    with torch.inference_mode():
        for group in ['create_task', 'complete_task', 'reply']:
            row = next(r for r in cases if r['group'] == group)
            batch = tokenizer(source(row), return_tensors='pt')
            out = model.generate(**batch, max_new_tokens=96, do_sample=False, use_cache=True)
            actual = tokenizer.decode(out[0], skip_special_tokens=True)
            assert actual == row['output'], (row['id'], actual, row['output'])
            replay.append({'id': row['id'], 'group': group, 'identical_saved_output': True})
    result = {'status': 'passed', 'checkpoint_files_verified': len(report['checkpoint_sha256']),
              'parameters': report['student_parameters'], 'replayed': replay,
              'scope': 'Persistence/reload verification only; no new quality benchmark.'}
    (ROOT / 'reload-verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
