#!/usr/bin/env python3
"""Read-only independent count/split/recomposition/token audit of large-v3."""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

from tokenizers import Tokenizer

HERE = Path(__file__).resolve().parent
V3 = HERE.parent
VOICE = V3.parent
CORPUS = V3 / 'data/corpus'
TOKENIZER = VOICE.parent / 'simplestories-v2/model-cache/tokenizer.json'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def normalize(text):
    for left, right in [('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"')]:
        text = text.replace(left, right)
    return ' '.join(text.lower().split())


def word_norm(text):
    return ' '.join(re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower()))


def main():
    manifest = json.loads((CORPUS / 'manifest.json').read_text())
    tokenizer = Tokenizer.from_file(str(TOKENIZER))
    sources, families = {}, {}
    for path in sorted((V3 / 'data').glob('composition-families-*.json')):
        sources[path.name] = sha(path.read_bytes())
        data = json.loads(path.read_text())
        for family in (data['families'] if isinstance(data, dict) else data):
            slots = family.get('sentences') or [family['sentence' + str(i)] for i in range(1, 10) if 'sentence' + str(i) in family]
            families[path.stem + '-' + family['id']] = [[normalize(s) for s in slot] for slot in slots]
    report = {'scope': 'Read-only independent corpus audit; no training or chain calls',
              'manifest_sha256': sha((CORPUS / 'manifest.json').read_bytes()),
              'tokenizer_sha256': sha(TOKENIZER.read_bytes()),
              'family_source_sha256': sources,
              'split_files': {}, 'split_counts': {}, 'errors': []}
    by_id, by_text, by_words = {}, {}, defaultdict(list)
    family_splits, family_counts = defaultdict(set), Counter()
    authored_by_split, composition_by_family = defaultdict(list), defaultdict(list)
    all_rows = []
    for split in ('train', 'validation', 'test'):
        path = CORPUS / (split + '.jsonl')
        report['split_files'][split] = {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
        stats = Counter()
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        for offset in range(0, len(rows), 500):
            batch = rows[offset:offset + 500]
            encodings = tokenizer.encode_batch([r['text'] for r in batch], add_special_tokens=False)
            for row, encoding in zip(batch, encodings):
                ident, text, kind = row['id'], row['text'], row['source_kind']
                if row['split'] != split:
                    report['errors'].append([ident, 'row split differs from containing file'])
                if ident in by_id:
                    report['errors'].append([ident, 'duplicate id', by_id[ident]])
                by_id[ident] = split
                key = normalize(text)
                if key in by_text:
                    report['errors'].append([ident, 'duplicate normalized text', by_text[key]])
                by_text[key] = [split, ident]
                by_words[word_norm(text)].append((split, ident, kind))
                if sha(text.encode()) != row['text_sha256']:
                    report['errors'].append([ident, 'text sha mismatch'])
                if len(encoding.ids) != row['tokens']:
                    report['errors'].append([ident, 'token count mismatch', len(encoding.ids), row['tokens']])
                if 0 in encoding.ids:
                    report['errors'].append([ident, 'unknown tokenizer token'])
                words = len(re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower()))
                if words != row['words']:
                    report['errors'].append([ident, 'word count mismatch', words, row['words']])
                stats['documents'] += 1
                stats['tokens'] += len(encoding.ids)
                stats['words'] += words
                stats[kind + '_documents'] += 1
                stats[kind + '_tokens'] += len(encoding.ids)
                family_splits[row['family_id']].add(split)
                family_counts[row['family_id']] += 1
                if kind == 'authored':
                    authored_by_split[split].append(row)
                if kind == 'compositional':
                    composition_by_family[row['family_id']].append(row)
                    slots = families[row['family_id']]
                    rebuilt = ' '.join(slot[choice] for slot, choice in zip(slots, row['choices']))
                    if len(slots) != len(row['choices']) or rebuilt != text:
                        report['errors'].append([ident, 'composition does not match source choices'])
                all_rows.append(row)
        report['split_counts'][split] = dict(stats)
        if dict(stats) != manifest['stats'][split]:
            report['errors'].append([split, 'independent counts differ from manifest'])
    leaking = {name: sorted(splits) for name, splits in family_splits.items() if len(splits) > 1}
    report['cross_split_family_collisions'] = leaking
    report['cross_split_word_normalized_duplicates'] = [items for items in by_words.values() if len({x[0] for x in items}) > 1]
    report['total_documents'] = len(all_rows)
    report['total_tokens'] = sum(r['tokens'] for r in all_rows)
    report['composition_families'] = len(composition_by_family)
    report['composition_documents_per_family'] = dict(sorted(Counter(len(v) for v in composition_by_family.values()).items()))
    report['authored_documents'] = sum(len(v) for v in authored_by_split.values())
    report['public_domain_groups'] = len({r['family_id'] for r in all_rows if r['source_kind'] == 'public_domain'})
    # Twelve-word matching across independent authored documents only. Composition
    # rows intentionally reuse sentence variants and are assessed separately.
    grams = {}
    for split, rows in authored_by_split.items():
        values = set()
        for row in rows:
            ws = word_norm(row['text']).split()
            values.update(tuple(ws[i:i+12]) for i in range(max(0, len(ws)-11)))
        grams[split] = values
    report['authored_cross_split_12gram_overlap'] = {
        a + '_' + b: len(grams[a] & grams[b])
        for a, b in [('train', 'validation'), ('train', 'test'), ('validation', 'test')]}
    # Fixed sample: fifteen families from each source, ranked by a seeded hash;
    # choose one example from each family by another seeded hash.
    selected = []
    for source in sorted(sources):
        names = [name for name, rows in composition_by_family.items() if rows[0]['source_file'] == source]
        names.sort(key=lambda s: sha(('GH0ST_V3_QA_FAMILY_20261024:' + s).encode()))
        for name in names[:15]:
            rows = composition_by_family[name]
            selected.append(min(rows, key=lambda row: sha(('GH0ST_V3_QA_ROW_20261024:' + row['id']).encode())))
    report['sample_rule'] = '15 families per source ranked by SHA256 seed GH0ST_V3_QA_FAMILY_20261024; minimum seeded row hash within each family'
    report['sample_ids'] = [row['id'] for row in selected]
    report['status'] = 'PASS' if not report['errors'] and not leaking and not report['cross_split_word_normalized_duplicates'] else 'FAIL'
    (HERE / 'corpus-audit-independent.json').write_text(json.dumps(report, indent=2) + '\n')
    (HERE / 'corpus-review-sample.json').write_text(json.dumps(selected, indent=2) + '\n')
    (HERE / 'corpus-review-sample.txt').write_text('\n\n'.join(f"[{i}] {row['id']} / {row['split']}\n{row['text']}" for i, row in enumerate(selected, 1)) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in {'sample_ids', 'split_files', 'family_source_sha256'}}, indent=2))


if __name__ == '__main__':
    main()
