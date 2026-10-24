#!/usr/bin/env python3
"""Retokenize the complete V9 snapshot and independently audit split/window counts."""
import collections
import hashlib
import importlib.util
import json
import os
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
from transformers import AutoTokenizer

HERE = Path(__file__).resolve().parent
CORE = HERE.parent/'pretrained-continuity/core.py'
PREPARED = HERE.parent/'pretrained-continuity/prepared'
spec = importlib.util.spec_from_file_location('v9_data_core', CORE)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest_path = PREPARED/'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    initial_hashes = {name: sha(PREPARED/name) for name in ['train.jsonl', 'validation.jsonl', 'test.jsonl']}
    assert all(initial_hashes[n] == manifest['artifacts'][n]['sha256'] for n in initial_hashes)
    tokenizer = AutoTokenizer.from_pretrained(core.BASE, local_files_only=True, trust_remote_code=False)
    assert len(tokenizer) == 4019 and tokenizer.unk_token_id == 0
    assert sha(core.BASE/'tokenizer.json') == manifest['tokenizer_sha256']
    assert sha(core.BASE/'model.safetensors') == manifest['base_sha256']
    for path, expected in manifest['source_files_sha256'].items():
        assert sha(Path(path)) == expected
    split_groups = {}
    split_texts = {}
    statistics = {}
    for split in ['train', 'validation', 'test']:
        split_groups[split] = set()
        split_texts[split] = set()
        stats = collections.defaultdict(collections.Counter)
        for line in (PREPARED/f'{split}.jsonl').open():
            row = json.loads(line)
            assert row['split'] == split and row['group_id']
            ids = tokenizer.encode(row['text'], add_special_tokens=False)
            assert ids == row['token_ids'], ('Retokenization mismatch', row['id'])
            assert all(0 <= token < 4019 for token in ids)
            split_groups[split].add(row['group_id'])
            normalized = ' '.join(row['text'].lower().split())
            assert normalized not in split_texts[split]
            split_texts[split].add(normalized)
            expected_positions = {i for i in range(1, len(ids)) if ids[i] != 0}
            found = []
            windows = list(core.windows(ids, width=128, warmup=64))
            for window in windows:
                start = window['start']
                assert window['ids'] == ids[start:start+128]
                found.extend(start+i for i in range(1, len(window['labels'])) if window['labels'][i] != -100)
                if start:
                    assert all(token == -100 for token in window['labels'][:64])
            assert set(found) == expected_positions and len(found) == len(expected_positions)
            stats[row['kind']].update(documents=1, tokens=len(ids), unknown_tokens=ids.count(0),
                                      known_targets=len(expected_positions), windows=len(windows))
        for kind in ['grammar', 'voice']:
            for key in ['documents', 'tokens', 'unknown_tokens', 'known_targets']:
                assert stats[kind][key] == manifest['statistics'][split][kind][key]
        statistics[split] = dict(stats)
    overlap = {}
    for a, b in [('train', 'validation'), ('train', 'test'), ('validation', 'test')]:
        overlap[f'{a}/{b}'] = {'groups': len(split_groups[a] & split_groups[b]),
                              'normalized_texts': len(split_texts[a] & split_texts[b])}
        assert overlap[f'{a}/{b}'] == {'groups': 0, 'normalized_texts': 0}
    assert initial_hashes == {name: sha(PREPARED/name) for name in initial_hashes}
    report = {'status': 'PASS_COMPLETE_RETOKENIZATION_SPLIT_AND_WINDOW_AUDIT',
              'manifest_sha256': sha(manifest_path), 'prepared_sha256': initial_hashes,
              'tokenizer_sha256': manifest['tokenizer_sha256'], 'core_sha256': sha(CORE),
              'statistics': statistics, 'cross_split_overlap': overlap,
              'source_files_all_match_manifest': True, 'all_token_ids_exact': True,
              'every_known_position_scored_once': True, 'document_concatenation': False,
              'warmup_positions': 64, 'window_width': 128,
              'independent_unknown_masking_checked': True,
              'caveats': ['No exact-text or group overlap is not a semantic deduplication proof.',
                          'The vocabulary is unchanged pretrained WordPiece; no held-out data was used to fit a new vocabulary.',
                          'Crops preserve coherent document order but are not full running-cache state equivalence.'],
              'gpu_actions': 0, 'network_actions': 0}
    (HERE/'data-audit.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'status': report['status'], 'statistics': statistics}))


if __name__ == '__main__':
    main()
