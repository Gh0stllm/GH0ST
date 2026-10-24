"""Append the lossless packed API to a verified same-model batch evaluator."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', type=Path, default=HERE/'../compute/signed-combined-initial.sol')
args = parser.parse_args()
source = args.base.resolve().read_text()
assert 'SOURCE_MODEL_PARAMETERS=8175493' in source
assert 'function stepBatchChecked(' in source and 'function stepBatchPacked(' not in source
assert source.rstrip().endswith('}')
methods = (HERE/'packed-methods.inc').read_text()
if 'function _prepareFeatures(' in source:
    assert methods.count('Scratch memory scratch=_scratch();') == 1
    methods = methods.replace('Scratch memory scratch=_scratch();',
        'Scratch memory scratch=_scratch();_prepareFeatures(p.features,scratch);scratch.zeroMask=_initialZeros(p.state);')
result = source.rstrip()[:-1] + methods + '}\n'
(HERE/'GRU2PackedModel.sol').write_text(result)
manifest = {'base': str(args.base.resolve()), 'base_sha256': hashlib.sha256(source.encode()).hexdigest(),
            'source_sha256': hashlib.sha256(result.encode()).hexdigest(),
            'payload_bytes':7089, 'maximum_abi_return_bytes':7168,
            'model_parameters':8175493, 'lossy_encoding':False}
(HERE/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
