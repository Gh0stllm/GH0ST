from pathlib import Path
from collections import Counter, defaultdict
import hashlib
import json
import unicodedata

from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT / 'prepared-wordlevel'
OUT = ROOT / 'evaluation'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def norm(text):
    text = unicodedata.normalize('NFKC', text).lower()
    for a, b in [('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"'), ('—', '-'), ('–', '-')]:
        text = text.replace(a, b)
    return ' '.join(text.strip().strip('"').split())


def read(path):
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def main():
    metadata = json.loads((PREP / 'preparation-report.json').read_text())
    tokenizer = Tokenizer.from_file(str(PREP / 'initial-wordlevel/tokenizer.json'))
    sources, input_groups = {}, defaultdict(list)
    for source in metadata['sources']:
        path = Path(source['path'])
        assert sha(path) == source['sha256']
        for row in read(path):
            row['text'] = norm(row['text'])
            if path.resolve().parent == ROOT / 'data':
                row['source_kind'] = 'authored'
            assert row['id'] not in sources
            sources[row['id']] = row
            input_groups[(row['split'], row['source_kind'])].append(row)
    output, errors, identities = [], [], set()
    groups, texts, parents = defaultdict(set), defaultdict(set), defaultdict(set)
    split_counts = {}
    for split in ['train', 'validation', 'test']:
        path = PREP / 'corpus' / (split + '.jsonl')
        assert sha(path) == metadata['corpus_files'][split]['sha256']
        rows = read(path)
        counts = Counter()
        for start in range(0, len(rows), 256):
            batch = rows[start:start + 256]
            encoded = tokenizer.encode_batch([r['text'] for r in batch], add_special_tokens=False)
            for row, tokens in zip(batch, encoded):
                parent = row['id'].rsplit(':wordlevel:', 1)[0]
                original = sources[parent]
                if row['id'] in identities:
                    errors.append([row['id'], 'duplicate id'])
                identities.add(row['id'])
                if row['split'] != split or original['split'] != split:
                    errors.append([row['id'], 'split changed'])
                if 0 in tokens.ids or 1 in tokens.ids:
                    errors.append([row['id'], 'UNK or EOS present'])
                if len(tokens.ids) != row['tokens'] or len(tokens.ids) != row['token_count']:
                    errors.append([row['id'], 'token count mismatch'])
                if hashlib.sha256(row['text'].encode()).hexdigest() != row['text_sha256']:
                    errors.append([row['id'], 'text hash mismatch'])
                group = row.get('group_id', row.get('family_id'))
                if group != original.get('group_id', original.get('family_id')):
                    errors.append([row['id'], 'group changed'])
                if group:
                    groups[(row['source_kind'], group)].add(split)
                texts[norm(row['text'])].add(split)
                parents[(split, row['source_kind'])].add(parent)
                counts[row['source_kind']] += 1
                output.append(row)
        split_counts[split] = dict(counts)
    attrition = []
    for (split, kind), original in input_groups.items():
        kept = len(parents[(split, kind)])
        attrition.append({'split': split, 'source_kind': kind, 'input_parents': len(original),
                         'retained_parents': kept, 'parents_completely_dropped': len(original)-kept,
                         'parent_drop_percent': round(100*(len(original)-kept)/len(original), 2),
                         'output_rows': split_counts[split].get(kind, 0)})
    new_summary, missing = [], []
    vocabulary = tokenizer.get_vocab()
    for split in ['train', 'validation', 'test']:
        original = [r for r in input_groups[(split, 'authored')] if r['id'].startswith('recovery-')]
        kept = {r['id'].rsplit(':wordlevel:', 1)[0] for r in output if r['split'] == split and r['id'].startswith('recovery-')}
        new_summary.append({'split': split, 'input': len(original), 'retained': len(kept), 'dropped': len(original)-len(kept)})
        for row in original:
            if row['id'] not in kept:
                missing.append({'id': row['id'], 'split': split, 'text': row['text'],
                                'unknown_words': [s for s, _ in tokenizer.pre_tokenizer.pre_tokenize_str(row['text']) if s not in vocabulary]})
    result = {'scope': 'Independent prepared word-level corpus audit; no mutation or model calls',
              'preparation_report_sha256': sha(PREP / 'preparation-report.json'),
              'tokenizer_sha256': sha(PREP / 'initial-wordlevel/tokenizer.json'),
              'tokenizer_type': json.loads(tokenizer.to_str())['model']['type'],
              'vocabulary_size': len(vocabulary), 'errors': errors,
              'groups_crossing_splits': {str(k): sorted(v) for k, v in groups.items() if len(v)>1},
              'cross_split_exact_duplicates': sum(len(v)>1 for v in texts.values()),
              'output_rows': len(output), 'output_tokens': sum(r['tokens'] for r in output),
              'source_attrition': attrition, 'new_recovery_vignette_retention': new_summary,
              'dropped_recovery_vignettes': missing,
              'notes': ['Parent retention differs from row counts because teacher/historical paragraphs are split into sentences.',
                        'Training-only vocabulary excludes some held-out vocabulary, narrowing the accepted validation/test sets.']}
    (OUT / 'prepared-wordlevel-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='dropped_recovery_vignettes'}, indent=2))


if __name__ == '__main__':
    main()
