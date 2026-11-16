"""Compare every portable memory byte/global with the unchanged source Wasm.

Early/middle/late fresh resumptions plus a complete 24m decision. No EVM or
WAVM claim: this is an acceptance gate for an experimental proof backend.
"""
from pathlib import Path
import ctypes, hashlib, json, platform, time
import wasmtime

HERE = Path(__file__).resolve().parent
CACHE = HERE / '.cache'
SOURCE = HERE.parent / 'runtime/.cache/sliced.wasm'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == '1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc'
lib = ctypes.CDLL(str(CACHE / ('libgl3aot.dylib' if platform.system() == 'Darwin' else 'libgl3aot.so')))
V = ctypes.c_void_p; U = ctypes.c_uint32
for name, args, result in [
    ('create', [], V), ('destroy', [V], None), ('memory', [V], V),
    ('memory_size', [V], U), ('grow', [V, U], None),
    ('global_get', [V, U], U), ('global_set', [V, U, U], None),
    ('call', [V, U, U, U], ctypes.c_uint64),
]:
    f = getattr(lib, 'gl3aot_'+name); f.argtypes = args; f.restype = result
memcmp = ctypes.CDLL(None).memcmp
memcmp.argtypes = [V, V, ctypes.c_size_t]; memcmp.restype = ctypes.c_int

def call(v, op, a=0, b=0): return lib.gl3aot_call(v, op, a, b)
def globals(v): return {i:lib.gl3aot_global_get(v, i) for i in [0, 98, 99]}
def source_globals(s, x): return {i:x['gl3_global_'+str(i)].value(s) for i in [0, 98, 99]}
def source_pointer(s, x): return ctypes.cast(x['memory'].data_ptr(s), V).value
def restore(s, x):
    v = lib.gl3aot_create(); n = x['memory'].data_len(s)
    lib.gl3aot_grow(v, n)
    ctypes.memmove(lib.gl3aot_memory(v), source_pointer(s, x), n)
    for i, val in source_globals(s, x).items(): lib.gl3aot_global_set(v, i, val)
    return v
def compare(s, x, v):
    n = x['memory'].data_len(s)
    assert lib.gl3aot_memory_size(v) == n
    assert source_globals(s, x) == globals(v)
    assert memcmp(source_pointer(s, x), lib.gl3aot_memory(v), n) == 0, 'complete portable image differs'
    return hashlib.sha256((ctypes.c_ubyte*n).from_address(lib.gl3aot_memory(v))).hexdigest()
def progress(v):
    return {'steps':call(v, 8), 'observed':call(v, 6), 'nodes':call(v, 7), 'depth':call(v, 9)}

started = time.monotonic(); engine = wasmtime.Engine(); module = wasmtime.Module.from_file(engine, str(SOURCE))
s = wasmtime.Store(engine); s.set_limits(memory_size=768*1024*1024); linker = wasmtime.Linker(engine)
def deny(*args): raise RuntimeError('external host call forbidden')
for imp in module.imports: linker.define_func(imp.module, imp.name, imp.type, deny)
x = linker.instantiate(s, module).exports(s); x['_initialize'](s); assert x['gl3_slice_init'](s) == 1
v = lib.gl3aot_create(); call(v, 0); assert call(v, 1) == 1
compare(s, x, v); lib.gl3aot_destroy(v)
p = x['gl3_alloc'](s, 4); x['memory'].write(s, b'e2e4', p)
pending = x['gl3_slice_begin'](s, p, 4); x['gl3_free'](s, p)
rows = []
for target in [4, 4000, 9850]:
    while pending and x['gl3_slice_steps'](s) < target: pending = x['gl3_slice_advance'](s)
    assert x['gl3_slice_steps'](s) == target
    v = restore(s, x); at = time.monotonic(); count = 0
    while pending and count < 4:
        pending = x['gl3_slice_advance'](s); assert call(v, 5) == pending; count += 1
        assert call(v, 8) == x['gl3_slice_steps'](s)
    sha = compare(s, x, v)
    rows.append({'startingStep':target, 'steps':count, 'memoryBytes':lib.gl3aot_memory_size(v), 'allBytesAndGlobalsMatch':True, 'memorySHA256':sha, 'seconds':time.monotonic()-at, 'progress':progress(v)})
    lib.gl3aot_destroy(v); print(json.dumps(rows[-1]), flush=True)
assert not pending
s.close()

# Independent complete translated decision from genesis, no imported answer.
v = lib.gl3aot_create(); call(v, 0); assert call(v, 1) == 1
p = call(v, 2, 4); ctypes.memmove(lib.gl3aot_memory(v)+p, b'e2e4', 4)
at = time.monotonic(); pending = call(v, 4, p, 4); call(v, 3, p)
while pending:
    pending = call(v, 5)
    if call(v, 8) % 1000 == 0: print(json.dumps({'fullAOT':progress(v), 'elapsed':time.monotonic()-at}), flush=True)
    assert call(v, 8) < 13000
seconds = time.monotonic()-at
best = ctypes.string_at(lib.gl3aot_memory(v)+call(v, 10), 8).split(b'\0')[0].decode()
result = progress(v)
assert (best, result['nodes'], result['depth']) == ('e7e5', 24000033, 38)
p = call(v, 11); n = call(v, 12); canonical = hashlib.sha256((ctypes.c_ubyte*n).from_address(lib.gl3aot_memory(v)+p)).hexdigest()
assert n == 163085439 and canonical == '5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6'
lib.gl3aot_destroy(v)
report = {'scope':'unchanged portable VM translated to scalar C; all-byte/global cross-backend checkpoints and one complete native24m decision; not an EVM/WAVM proof', 'passed':True, 'policyNodes':24000000, 'moduleSHA256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'checkpoints':rows, 'fullDecision':dict(result, move=best, seconds=seconds, canonicalCheckpointSHA256=canonical), 'publicDeployment':False, 'realSpend':0, 'seconds':time.monotonic()-started}
(CACHE/'parity.json').write_text(json.dumps(report, indent=2)+'\n'); print(json.dumps(report, indent=2), flush=True)
