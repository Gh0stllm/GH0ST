#!/usr/bin/env python3
"""Measure native retained-state mutations for short TEST-ONLY searches.

These are not 24m decisions and cannot be substituted into the production bot.
They omit the live recursive/Asyncify continuation state of a true search chunk.
"""
from pathlib import Path
import shutil, subprocess

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
SOURCE = ENGINE / '.cache/prefix-cache-native/src'
CACHE = HERE / '.cache/delta'
TARGET = CACHE / 'src'
TARGET.mkdir(parents=True, exist_ok=True)
shutil.copytree(SOURCE, TARGET, dirs_exist_ok=True,
    ignore=shutil.ignore_patterns('*.nnue', 'stockfish', '*.profdata', '*.profraw'))
shutil.copytree(SOURCE.parent / 'scripts', CACHE / 'scripts', dirs_exist_ok=True)
for model in SOURCE.glob('*.nnue'):
    dest = TARGET / model.name
    if not dest.exists(): dest.symlink_to(model)
original = (TARGET / 'prefix_probe.cpp').read_text()
main = original.index('int main(')
original = original[:main] + r'''
static void save(const std::string& name, const CheckpointAccess::Bytes& b) {
    std::ofstream f(name, std::ios::binary); f.write(reinterpret_cast<const char*>(b.data()), b.size());
    if (!f) throw std::runtime_error("write failed");
}
int main(int argc, char** argv) { try {
    if (argc != 2) throw std::runtime_error("output prefix required");
    Attacks::init(); Position::init(); Engine a; init(a);
    auto before = CheckpointAccess::retained(a); save(std::string(argv[1])+"-initial.bin", before);
    for (std::uint64_t requested : {100000ULL, 200000ULL}) {
        a.search_clear();
        auto r = search(a, {"e2e4"}, requested);
        auto after = CheckpointAccess::retained(a);
        save(std::string(argv[1])+"-"+std::to_string(requested)+".bin", after);
        std::cout << "{\"requested_test_nodes\":" << requested
                  << ",\"nodes\":" << r.nodes << ",\"depth\":" << r.depth
                  << ",\"bestmove\":\"" << r.best << "\",\"retained_bytes\":"
                  << after.size() << "}" << std::endl;
    }
} catch (const std::exception& e) { std::cerr << e.what() << std::endl; return 1; } }
'''
(TARGET / 'prefix_probe.cpp').write_text(original)
subprocess.run(['make', '-j2', 'build', 'ARCH=apple-silicon', 'COMP=clang',
                'EXTRACXXFLAGS=-fexceptions'], cwd=TARGET, check=True,
                stdout=subprocess.DEVNULL)
out = CACHE / 'retained'
p = subprocess.run([str(TARGET / 'stockfish'), str(out)], check=True,
                   capture_output=True, text=True, timeout=40)
(HERE / 'evidence/retained-delta-run.jsonl').write_text(p.stdout)
print(p.stdout)
