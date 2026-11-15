#!/usr/bin/env python3
"""Create an isolated SF19 single-worker port; search/evaluation stay upstream.

All replacements are exact and fail when upstream drifts. The resulting unified
patch is published alongside this script, with GPL copyright notices retained.
"""
import difflib
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".cache/Stockfish"
PORT = ROOT / ".cache/Stockfish-icp"
PIN = "edb0d9db6731067ec50ce619ff372b463bc4dd5d"
assert subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip() == PIN
if PORT.exists():
    shutil.rmtree(PORT)
shutil.copytree(SOURCE, PORT, ignore=shutil.ignore_patterns(".git", "*.o", "stockfish", "*.log"))

def change(name, old, new):
    path = PORT / "src" / name
    text = path.read_text()
    assert text.count(old) == 1, (name, old[:80])
    path.write_text(text.replace(old, new))

path = PORT / "src/thread.cpp"
text = path.read_text()
start = text.index("    nthreads(sharedState.options")
end = text.index("\n\n// Destructor", start)
text = text[:start] + '''    nthreads(sharedState.options["Threads"]) {
    // GH0ST: ICP serial execution; run the unchanged Stockfish Worker inline.
    if (nthreads != 1 || n != 0) std::abort();
    searching = false;
    numaAccessToken = binder();
    worker = make_unique_large_page<Search::Worker>(
      sharedState, std::move(sm), n, idxInNuma, totalNuma, numaAccessToken);
}''' + text[end:]
start = text.index("Thread::~Thread()")
end = text.index("\n\n// Wakes up", start)
text = text[:start] + "Thread::~Thread() { assert(!searching); }" + text[end:]
start = text.index("void Thread::wait_for_search_finished()")
end = text.index("\nSearch::SearchManager* ThreadPool::main_manager()", start)
text = text[:start] + '''void Thread::wait_for_search_finished() { assert(!searching); }

void Thread::run_custom_job(std::function<void()> f) {
    assert(!searching);
    searching = true;
    if (f) f();
    searching = false;
}

void Thread::ensure_network_replicated() { worker->ensure_network_replicated(); }
void Thread::idle_loop() { std::abort(); }
''' + text[end:]
path.write_text(text)
change("thread.h", "#include <condition_variable>\n", "")
change("thread.h", "#include <mutex>\n", "")
change("thread.h", "    std::mutex                mutex;\n    std::condition_variable   cv;\n", "")
change("thread.h", "    NativeThread              stdThread;\n", "")

path = PORT / "src/thread_native.h"
copyright_header = path.read_text().split("#ifndef THREAD_NATIVE_H_INCLUDED")[0]
path.write_text(copyright_header + '''// GH0ST synchronous-only runtime. There is no native/OS thread creation.
#pragma once
#include <functional>
#include <utility>
namespace Stockfish {
struct NativeThreadOptions {
    NativeThreadOptions& setLargeStack(bool) { return *this; }
};
class NativeThread {
public:
    bool joinable() const { return true; }
    void join() {}
};
template<class Function, class... Args>
NativeThread create_native_thread(NativeThreadOptions, Function&& f, Args&&... args) {
    std::invoke(std::forward<Function>(f), std::forward<Args>(args)...);
    return {};
}
struct Gh0stMutex {};
template<class Mutex> struct Gh0stUniqueLock {
    explicit Gh0stUniqueLock(Mutex&) {}
};
}
''')
change("numa.h", "#include <thread>\n", "")
change("numa.h", "#include <mutex>\n", "")
change("numa.h", "CpuIndex concurrency = std::thread::hardware_concurrency();", "CpuIndex concurrency = 1;  // GH0ST: fixed serial worker")
path = PORT / "src/numa.h"
text = path.read_text().replace("std::unique_lock<std::mutex>", "Gh0stUniqueLock<Gh0stMutex>").replace("std::mutex", "Gh0stMutex")
path.write_text(text)
change("misc.cpp", "#include <mutex>\n", "")
change("misc.cpp", "    static std::mutex m;", "    struct SerialLock { void lock() {} void unlock() {} };\n    static SerialLock m;")
change("misc.h", '''    return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();''', "    return 0;  // GH0ST: fixed-node search never consumes a wall clock")

# Stockfish's GNU incbin section spelling does not support plain LLVM WASI.
# This changes the embedding container only; the 98,511,183 NNUE bytes are intact.
change("nnue/network.cpp", "INCBIN(EmbeddedNNUE, EvalFileDefaultName);", '''#if defined(GH0ST_ICP) && defined(__wasm__)
extern "C" const unsigned char gEmbeddedNNUEData[];
const unsigned int gEmbeddedNNUESize = 98511183;
#else
INCBIN(EmbeddedNNUE, EvalFileDefaultName);
#endif''')
change("syzygy/tbprobe.cpp", "#ifndef _WIN32\n    #include <fcntl.h>", "#if !defined(_WIN32) && !defined(NO_TABLEBASES)\n    #include <fcntl.h>")
# Avoid pulling windows.h into a no-tablebase build after guarding mmap.
change("syzygy/tbprobe.cpp", "#else\n    #define WIN32_LEAN_AND_MEAN", "#elif defined(_WIN32)\n    #define WIN32_LEAN_AND_MEAN")

generated = ROOT / ".cache/generated"
generated.mkdir(exist_ok=True)
(generated / "nnue_embed.s").write_text(
    '.section .rodata.gEmbeddedNNUEData,"",@\n'
    '.globl gEmbeddedNNUEData\n'
    '.type gEmbeddedNNUEData,@object\n'
    '.p2align 6\n'
    'gEmbeddedNNUEData:\n'
    '.incbin "' + str(PORT / "src/nn-1a298aa575a0.nnue") + '"\n'
    '.size gEmbeddedNNUEData, .-gEmbeddedNNUEData\n')

# Patch shmem system guards for native-equivalence testing of the actual port.
change("shm.h", "#if (defined(__linux__) && !defined(__ANDROID__)) || defined(__APPLE__) || defined(__FreeBSD__) \\\n  || defined(__OpenBSD__) || defined(__NetBSD__) || defined(__DragonFly__)", "#if !defined(GH0ST_ICP) && ((defined(__linux__) && !defined(__ANDROID__)) || defined(__APPLE__) || defined(__FreeBSD__) \\\n  || defined(__OpenBSD__) || defined(__NetBSD__) || defined(__DragonFly__))")

patch = []
for path in sorted((PORT / "src").rglob("*")):
    original = SOURCE / path.relative_to(PORT)
    if path.is_file() and path.suffix in (".cpp", ".h") and path.read_bytes() != original.read_bytes():
        name = path.relative_to(PORT).as_posix()
        patch.extend(difflib.unified_diff(original.read_text().splitlines(True), path.read_text().splitlines(True), fromfile="a/"+name, tofile="b/"+name))
(ROOT / "patches").mkdir(exist_ok=True)
(ROOT / "patches/single-worker.patch").write_text("".join(patch))
shutil.copyfile(SOURCE / "Copying.txt", ROOT / "LICENSE-STOCKFISH-GPL3.txt")
shutil.copyfile(SOURCE / "AUTHORS", ROOT / "STOCKFISH-AUTHORS.txt")
print(PORT)
