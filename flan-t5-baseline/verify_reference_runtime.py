"""Optional reproduction of the recorded independent Transformers 4.57.1 check."""
import argparse
import hashlib
import json
from pathlib import Path

import torch
import transformers
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

from benchmark import ROOT, cases, evaluate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True,
                        help='Local original checkpoint folder at the selected pinned revision.')
    args = parser.parse_args()
    assert transformers.__version__ == '4.57.1'
    for name, info in json.loads((ROOT / 'upstream-integrity.json').read_text())['files'].items():
        assert hashlib.sha256((args.checkpoint / name).read_bytes()).hexdigest() == info['sha256'], name
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    tokenizer = AutoTokenizer.from_pretrained(args.checkpoint, local_files_only=True, trust_remote_code=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.checkpoint, local_files_only=True, trust_remote_code=False,
                                               dtype=torch.float32, attn_implementation='eager').eval()
    _, actual = evaluate(model, tokenizer, cases(), 'reference-replay')
    expected = json.loads((ROOT / 'eval-float32.json').read_text())['cases']
    assert len(actual) == len(expected) == 24
    for left, right in zip(actual, expected):
        assert left['output_token_ids'] == right['output_token_ids'], left['id']
    print('All 24 generated token sequences match the recorded primary runtime.')


if __name__ == '__main__':
    main()
