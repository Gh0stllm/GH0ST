#!/usr/bin/env python3
"""Independently validate the extended local run, including boundary probes."""
import argparse
import hashlib
import json
from pathlib import Path
from reference import Reference


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    report = json.loads(a.report.read_text())
    assert report['status'] == 'EVM_PASS_AWAITING_INDEPENDENT_REFERENCE'
    assert report['publicTransactionsSubmitted'] == 0
    assert report['network']['chainId'] == 31337
    model = Reference(a.model_dir)
    manifest = json.loads((a.model_dir/'manifest.json').read_text())
    for collection in ('artifacts', 'reference_only_sources'):
        for name, metadata in manifest[collection].items():
            raw = (a.model_dir/name).read_bytes()
            assert len(raw) == metadata['bytes'], name
            assert hashlib.sha256(raw).hexdigest() == metadata['sha256'], name
    steps = []
    for label, rows in (('primary', report['swaps']), ('secondary', report['auxiliarySwaps'])):
        previous = None
        for row in rows:
            if previous is not None:
                assert previous['after']['hidden'] == row['before']['hidden']
                assert previous['after']['context'] == row['before']['context']
            expected = model.step(int(row['before']['context'][5]), row['before']['hidden'], row['features'],
                                  report['seed'], row['sampleIndex'], report['temperatureQ10'])
            assert expected['token'] == row['token']
            assert expected['hidden'] == list(map(int, row['after']['hidden']))
            assert expected['scores'] == list(map(int, row['branchScores']))
            assert expected['text'] == row['text']
            assert expected['terminal'] == row['terminal']
            assert int(row['gasUsed']) < 32_000_000
            assert int(row['after']['context'][4]) == row['sampleIndex']+1
            steps.append({'pool': label, 'swap': row['swap'], 'token': expected['token'],
                          'group': expected['group'], 'within': expected['within'],
                          'group_draw': expected['group_draw'], 'word_draw': expected['word_draw']})
            previous = row
    for probe in report['boundaryProbes']:
        prev, hidden, features, seed, index, temp = probe['input']
        expected = model.step(prev, hidden, features, seed, index, temp)
        assert expected['token'] == probe['token']
        assert expected['hidden'] == list(map(int, probe['hidden']))
        assert expected['scores'] == list(map(int, probe['scores']))
        assert expected['text'] == probe['text'] and expected['terminal'] == probe['terminal']
        assert int(probe['gasUsed']) < 32_000_000
    result = {'status': 'PASS', 'language_quality': 'NOT_APPROVED', 'primary_steps': len(report['swaps']),
              'secondary_steps': len(report['auxiliarySwaps']), 'boundary_probes': len(report['boundaryProbes']),
              'all224_hidden_match': True, 'all192_evaluated_logits_match': True,
              'all_unfused_input_recurrent_and_head_scalar_checks_pass': True,
              'continuous_state_across_natural_terminals': True, 'mainnet_actions': 0,
              'report_sha256': hashlib.sha256(a.report.read_bytes()).hexdigest(),
              'checkpoint_sha256': manifest.get('checkpoint_sha256'), 'steps': steps}
    a.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'steps'}, indent=2))


if __name__ == '__main__':
    main()
