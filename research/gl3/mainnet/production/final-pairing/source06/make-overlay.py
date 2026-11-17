"""Create a verified host-only Go overlay; never modify the frozen SDK.

Run this helper on Runpod before any build or test. Extra test files are optional.
"""
from pathlib import Path
import argparse, hashlib, json


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-base', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--with-tests', action='store_true')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    base = Path(args.source_base).resolve()
    lock = json.loads((here / 'manifest.json').read_text())
    replacements = {}
    for name, expected in lock['hostSourceFiles'].items():
        frozen = here / 'frozen' / name
        if sha(frozen) != expected['SHA256'] or frozen.stat().st_size != expected['bytes']:
            raise SystemExit('Frozen source mismatch: ' + name)
        parent = lock['baseSourceFiles'][name]
        original = base / name
        if parent is None:
            if original.exists():
                raise SystemExit('Unexpected existing parent source: ' + name)
        elif not original.is_file() or sha(original) != parent['SHA256']:
            raise SystemExit('Source05 base mismatch: ' + name)
        replacements[str(original)] = str(frozen)
    if args.with_tests:
        destinations = {
            'experimental_execution_cache_test.go': 'staker',
            'rpc_request_limit_test.go': 'validator/valnode',
            'validation_upload_admission_test.go': 'validator/client',
            'production_transport_config_test.go': 'cmd/nitro',
            'standalone_transport_config_test.go': 'cmd/nitro-val',
        }
        for name, expected in lock['testSourceFiles'].items():
            frozen = here / 'frozen/tests' / name
            if sha(frozen) != expected['SHA256']:
                raise SystemExit('Frozen test mismatch: ' + name)
            replacements[str(base / destinations[name] / name)] = str(frozen)
    output = Path(args.output).resolve()
    if output == base or base in output.parents:
        raise SystemExit('Overlay output must be outside the frozen SDK')
    output.write_text(json.dumps({'Replace': replacements}, indent=2) + '\n')
    print('Verified host overlay entries:', len(replacements))


if __name__ == '__main__':
    main()
