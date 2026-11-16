"""Experimental proof backend: compile the SAME portable VM through wasm2c.

Does not change the installed node profile, policy, model or recorded proofs.
Generated sources, weights, toolchain and binaries stay under .cache.
"""
from pathlib import Path
import concurrent.futures, hashlib, json, os, platform, re, shutil, subprocess, sys, tarfile, time, urllib.request

HERE = Path(__file__).resolve().parent
CACHE = HERE / '.cache'
SLICED = HERE.parent
REPO = HERE.parents[4]
SOURCE_SHA = 'a76cda3c174a43097863a07fc0b0c202f770f53e21806ea2636f167d1ffb1e30'
VM_SHA = '1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc'

def run(args, **kw):
    subprocess.run([str(a) for a in args], check=True, **kw)

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def toolchain():
    CACHE.mkdir(parents=True, exist_ok=True)
    src = CACHE / 'source/wabt-1.0.42'
    if not src.exists():
        url = 'https://github.com/WebAssembly/wabt/releases/download/1.0.42/wabt-1.0.42.tar.xz'
        archive = CACHE / 'source.tar.xz'
        if not archive.exists(): archive.write_bytes(urllib.request.urlopen(url).read())
        assert digest(archive) == SOURCE_SHA
        with tarfile.open(archive) as tar:
            for m in tar.getmembers():
                assert not m.name.startswith('/') and '..' not in Path(m.name).parts
                assert not m.issym() and not m.islnk(), 'archive links require review'
            tar.extractall(CACHE / 'source')
    cmake = CACHE / 'venv/bin/cmake'
    if not cmake.exists():
        run([sys.executable, '-m', 'venv', CACHE / 'venv'])
        run([CACHE / 'venv/bin/pip', 'install', 'cmake==4.1.3'])
    build = CACHE / 'build-wabt'
    tool = build / 'wasm2c'
    if not tool.exists():
        run([cmake, '-S', src, '-B', build, '-DBUILD_TESTS=OFF', '-DBUILD_LIBWASM=OFF', '-DUSE_INTERNAL_SHA256=ON', '-DCMAKE_BUILD_TYPE=Release'])
        run([cmake, '--build', build, '--target', 'wasm2c', '-j', '4'])
    return src, tool

def data_segments(raw):
    # This pinned module has two active memory-0 segments. Reject new layouts.
    pos = 8
    def leb():
        nonlocal pos
        n = shift = 0
        while True:
            x = raw[pos]; pos += 1; n |= (x & 127) << shift
            if x < 128: return n
            shift += 7
            assert shift < 70
    while pos < len(raw):
        tag = raw[pos]; pos += 1; size = leb(); end = pos + size
        if tag == 11:
            parts = []
            for _ in range(leb()):
                assert leb() == 0 and raw[pos] == 0x41
                pos += 1; leb(); assert raw[pos] == 0x0b; pos += 1
                n = leb(); parts.append(raw[pos:pos+n]); pos += n
            assert pos == end and list(map(len, parts)) == [98643411, 5468]
            return parts
        pos = end
    raise ValueError('data section absent')

def externalize(generated, vm):
    parts = data_segments(vm.read_bytes())
    asm = []
    for i, data in enumerate(parts):
        name = 'data_segment_data_w2c_gl3vm_d' + str(i)
        p = CACHE / ('segment-' + str(i) + '.bin'); p.write_bytes(data)
        symbol = '_' + name if platform.system() == 'Darwin' else name
        section = '.section __TEXT,__const' if platform.system() == 'Darwin' else '.section .rodata'
        asm += [section, '.balign 16', '.globl ' + symbol, symbol + ':', '.incbin "' + str(p) + '"']
    (CACHE / 'segments.S').write_text('\n'.join(asm) + '\n')
    p = generated / 'gl3vm_0.c'; tmp = generated / 'gl3vm_0.tmp'
    found = []; dropping = False
    with p.open() as src, tmp.open('w') as out:
        for line in src:
            if dropping:
                if line.strip() == '};': dropping = False
                continue
            match = re.fullmatch(r'const u8 (data_segment_data_w2c_gl3vm_d(\d+))\[\] = \{\n', line)
            if match:
                i = int(match[2]); found.append(i); dropping = True
                out.write('extern const u8 ' + match[1] + '[' + str(len(parts[i])) + '];\n')
            else: out.write(line)
    assert found == [0, 1] and not dropping
    tmp.replace(p)

def main():
    began = time.monotonic(); src, tool = toolchain()
    vm = SLICED / 'runtime/.cache/sliced.wasm'
    assert digest(vm) == VM_SHA, 'unreviewed VM program'
    generated = CACHE / 'generated'; generated.mkdir(exist_ok=True)
    run([tool, vm, '-n', 'gl3vm', '--num-outputs', '8', '-o', generated / 'gl3vm.c'])
    externalize(generated, vm)
    # Native artifact is only a translator-parity experiment. The production
    # backend remains Wazero. All imported engine host operations still trap.
    cc = shutil.which('clang') or shutil.which('cc'); assert cc
    flags = ['-O2', '-fPIC', '-fno-strict-aliasing', '-DWASM_RT_USE_MMAP=0', '-DWASM_RT_MEMCHECK_BOUNDS_CHECK=1', '-DWASM_RT_STACK_DEPTH_COUNT=1', '-DWASM_RT_MAX_CALL_STACK_DEPTH=10000', '-DSIMDE_NO_NATIVE', '-fno-vectorize', '-fno-slp-vectorize', '-I'+str(generated), '-I'+str(src/'wasm2c'), '-I'+str(src/'third_party/simde')]
    files = sorted(generated.glob('gl3vm_*.c')) + [src/'wasm2c/wasm-rt-impl.c', src/'wasm2c/wasm-rt-mem-impl.c', src/'wasm2c/wasm-rt-exceptions-impl.c', HERE/'adapter.c']
    objects = CACHE / 'objects'; objects.mkdir(exist_ok=True)
    def compile(p):
        obj = objects / (p.stem+'.o'); run([cc, *flags, '-c', p, '-o', obj]); return obj
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: objs = list(pool.map(compile, files))
    asm = objects/'segments.o'; run([cc, '-c', CACHE/'segments.S', '-o', asm]); objs.append(asm)
    output = CACHE / ('libgl3aot.dylib' if platform.system() == 'Darwin' else 'libgl3aot.so')
    run([cc, '-dynamiclib' if platform.system() == 'Darwin' else '-shared', *objs, '-lm', '-o', output])
    report = {'scope':'Experimental scalar C translation of the unchanged SIMD portable VM; build only, no onchain/proof acceptance', 'moduleSHA256':VM_SHA, 'translatorSourceSHA256':SOURCE_SHA, 'translatorVersion':'1.0.42', 'artifactSHA256':digest(output), 'artifactBytes':output.stat().st_size, 'flags':flags, 'seconds':time.monotonic()-began, 'publicDeployment':False, 'realSpend':0}
    (CACHE/'build.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))

if __name__ == '__main__': main()
