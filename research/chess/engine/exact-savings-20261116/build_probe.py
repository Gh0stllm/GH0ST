#!/usr/bin/env python3
"""Build a native measurement-only exact affine-input reuse probe.

The probe still computes every NNUE output; it never changes search decisions.
All derived sources, objects and executables stay in this lane's ignored cache.
"""
from pathlib import Path
import hashlib, json, shutil, subprocess

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
SOURCE = ENGINE / '.cache/Stockfish/src'
CACHE = HERE / '.cache'
TARGET = CACHE / 'src'
assert subprocess.check_output(['git', '-C', str(SOURCE.parent), 'rev-parse', 'HEAD'], text=True).strip() == 'edb0d9db6731067ec50ce619ff372b463bc4dd5d'
assert hashlib.sha256((SOURCE / 'nn-1a298aa575a0.nnue').read_bytes()).hexdigest() == '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2'
TARGET.mkdir(parents=True, exist_ok=True)
shutil.copytree(SOURCE, TARGET, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('*.nnue', 'stockfish', '*.profdata', '*.profraw'))
shutil.copytree(SOURCE.parent / 'scripts', CACHE / 'scripts', dirs_exist_ok=True)
for model in SOURCE.glob('*.nnue'):
    dest = TARGET / model.name
    if not dest.exists():
        dest.symlink_to(model)
source = (TARGET / 'nnue/network.cpp').read_text()
anchor = 'namespace Stockfish::Eval::NNUE {'
assert source.count(anchor) == 1
probe = r'''
static_assert(FeatureTransformer::BufferSize == 1024);
// Measurement only: exact comparison of all 1024 transformed feature bytes.
// No cache result is returned and every affine evaluation still executes.
struct ExactAffineReuseProbe {
    static constexpr unsigned capacity = 16384;
    struct Entry {
        bool valid = false;
        int bucket = 0;
        std::array<unsigned char, 1024> input{};
        Value positional = VALUE_ZERO;
    };
    std::array<Entry, capacity> entries{};
    unsigned long long evaluations = 0, hits = 0, mismatches = 0;
    void observe(const unsigned char* input, int bucket, Value positional) {
        unsigned long long h = 1469598103934665603ULL;
        for (unsigned i = 0; i < 1024; ++i) { h ^= input[i]; h *= 1099511628211ULL; }
        h ^= static_cast<unsigned long long>(bucket);
        auto& e = entries[h & (capacity - 1)];
        ++evaluations;
        if (e.valid && e.bucket == bucket && std::memcmp(e.input.data(), input, 1024) == 0) {
            ++hits;
            if (e.positional != positional) ++mismatches;
        } else {
            e.valid = true;
            e.bucket = bucket;
            std::memcpy(e.input.data(), input, 1024);
            e.positional = positional;
        }
    }
    ~ExactAffineReuseProbe() {
        std::cerr << "GH0ST_EXACT_REUSE {\"capacity\":" << capacity
                  << ",\"entry_bytes\":" << sizeof(Entry)
                  << ",\"evaluations\":" << evaluations
                  << ",\"hits\":" << hits
                  << ",\"mismatches\":" << mismatches << "}\n";
    }
};
static ExactAffineReuseProbe exactAffineReuseProbe;
'''
source = '#include <array>\n#include <cstring>\n' + source.replace(anchor, anchor + '\n' + probe)
anchor = '    return {static_cast<Value>(psqt / OutputScale), static_cast<Value>(positional / OutputScale)};'
assert source.count(anchor) == 1
source = source.replace(anchor,
    '    exactAffineReuseProbe.observe(reinterpret_cast<const unsigned char*>(transformedFeatures), bucket, static_cast<Value>(positional));\n' + anchor)
(TARGET / 'nnue/network.cpp').write_text(source)
subprocess.run(['make', '-j2', 'build', 'ARCH=apple-silicon', 'COMP=clang'],
               cwd=TARGET, check=True, stdout=subprocess.DEVNULL)
(HERE / 'evidence').mkdir(exist_ok=True)
record = {
    'scope': 'Native measurement-only affine-input reuse, no skipped evaluation or changed result',
    'binarySHA256': hashlib.sha256((TARGET / 'stockfish').read_bytes()).hexdigest(),
    'sourceSHA256': hashlib.sha256((TARGET / 'nnue/network.cpp').read_bytes()).hexdigest(),
    'modelSHA256': hashlib.sha256((SOURCE / 'nn-1a298aa575a0.nnue').read_bytes()).hexdigest(),
}
(HERE / 'evidence/build.json').write_text(json.dumps(record, indent=2) + '\n')
print(TARGET / 'stockfish')
