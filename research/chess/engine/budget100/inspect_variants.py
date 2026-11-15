"""Inspect test modules and verify the canonical NNUE in initialized Wasm memory."""
from pathlib import Path
import datetime
import gc
import hashlib
import json
import wasmtime

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
names = ['budget100-profile64', 'budget100-profile-threat64', 'budget100-prefix32',
         'budget100-prefix64-unroll', 'budget100-prefix-threat32']
net = (ENGINE / '.cache/Stockfish/src/nn-1a298aa575a0.nnue').read_bytes()
assert len(net) == 98_511_183
assert hashlib.sha256(net).hexdigest() == '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2'
results = []
for name in names:
    cache = ENGINE / '.cache' / name
    blob = (cache / 'engine.asyncify.wasm').read_bytes()
    assert len(blob) < 104_857_600
    engine = wasmtime.Engine()
    module = wasmtime.Module(engine, blob)
    store = wasmtime.Store(engine)
    functions = []
    for imp in module.imports:
        assert imp.module == 'ic0'
        count = len(imp.type.results)
        functions.append(wasmtime.Func(store, imp.type, lambda *args, n=count:
                                      None if n == 0 else (0 if n == 1 else [0] * n)))
    instance = wasmtime.Instance(store, module, functions)
    memory = instance.exports(store)['memory']
    data = memory.read(store, 0, memory.data_len(store))
    assert data.find(net) >= 0, name
    results.append({'name': name, 'wasmSHA256': hashlib.sha256(blob).hexdigest(),
                    'bytes': len(blob), 'onlyIc0Imports': True,
                    'fullPinnedNetworkInInitialMemory': True,
                    'testOnly': True,
                    'buildOptions': json.loads((cache / 'build-options.json').read_text())})
    print('Verified model in', name, flush=True)
    del data, memory, instance, functions, store, module, engine, blob
    gc.collect()
report = {'scope': 'Five test-only prefix/profile modules; full canonical NNUE independently '
                   'verified in each initialized linear memory. No full-search or release claim.',
          'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'networkBytes': len(net), 'networkSHA256': hashlib.sha256(net).hexdigest(),
          'variants': results}
(HERE / 'evidence/artifacts.json').write_text(json.dumps(report, indent=2) + '\n')
