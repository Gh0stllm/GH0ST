#!/usr/bin/env python3
"""Read-only verification of frozen checkpoint tensors after local tuning."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file
from device_support import is_trainable_name


def weights_path(path):
    return path / 'model.safetensors' if path.is_dir() else path


def verify(source, candidate, mode='body'):
    source, candidate = weights_path(Path(source)), weights_path(Path(candidate))
    before, after = load_file(source), load_file(candidate)
    missing = sorted(before.keys() - after.keys())
    unexpected = sorted(after.keys() - before.keys())
    incompatible, frozen_changed, allowed_changed, frozen_unchanged = [], [], [], []
    for name in sorted(before.keys() & after.keys()):
        x, y = before[name], after[name]
        if x.shape != y.shape or x.dtype != y.dtype:
            incompatible.append(name)
        equal = x.shape == y.shape and x.dtype == y.dtype and np.array_equal(x, y)
        if is_trainable_name(name, mode):
            if not equal:
                allowed_changed.append(name)
        elif equal:
            frozen_unchanged.append(name)
        else:
            frozen_changed.append(name)
    return {
        'status': 'PASS' if not (missing or unexpected or incompatible or frozen_changed) else 'FAIL',
        'mode': mode,
        'source': str(source.resolve()),
        'candidate': str(candidate.resolve()),
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'candidate_sha256': hashlib.sha256(candidate.read_bytes()).hexdigest(),
        'missing_tensors': missing, 'unexpected_tensors': unexpected,
        'shape_or_dtype_mismatches': incompatible,
        'frozen_changed': frozen_changed,
        'frozen_unchanged': frozen_unchanged,
        'allowed_changed': allowed_changed,
        'all_candidate_tensors_fp32': all(v.dtype == np.float32 for v in after.values()),
        'scope': 'Read-only tensor equality; does not establish generation quality or gas cost.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--trainable', choices=['all', 'top2', 'body'], default='body')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = verify(args.source, args.candidate, args.trainable)
    text = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text, end='')
    raise SystemExit(0 if result['status'] == 'PASS' else 1)


if __name__ == '__main__':
    main()
