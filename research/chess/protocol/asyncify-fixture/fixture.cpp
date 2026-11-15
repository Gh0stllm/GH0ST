// SPDX-License-Identifier: GPL-3.0-or-later
// Independent exact-stack mechanism fixture; not Stockfish and not a canister/paid-game build.
#include <stdint.h>
#include <stddef.h>

struct AsyncData { uint32_t pointer, end; };
extern "C" void async_start_unwind(AsyncData*) __attribute__((import_module("asyncify"), import_name("start_unwind")));
extern "C" void async_stop_unwind() __attribute__((import_module("asyncify"), import_name("stop_unwind")));
extern "C" void async_start_rewind(AsyncData*) __attribute__((import_module("asyncify"), import_name("start_rewind")));
extern "C" void async_stop_rewind() __attribute__((import_module("asyncify"), import_name("stop_rewind")));
extern "C" void gh0st_call_on_engine_stack(uint32_t top);
extern "C" uint32_t gh0st_current_stack_pointer();

alignas(16) static uint8_t engine_stack[128 * 1024 + 32];
alignas(16) static uint8_t spill_stack[128 * 1024 + 32];
static AsyncData spill;
static uint32_t mode, quantum, ticks, engine_top, dedicated, starts, constructors, destructors, callback_checks, steps;
static uint32_t suspended_engine_sp;
static uint64_t result, seed_value;
static volatile uint64_t host_sink;

static void check(bool ok) { if (!ok) __builtin_trap(); }
static uint32_t pointer(void* value) { return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(value)); }
static void set_guards(uint8_t* p, size_t n) {
    for (size_t i = 0; i < 16; ++i) { p[i] = uint8_t(0xa0+i); p[n-16+i] = uint8_t(0xb0+i); }
}
static void check_guards(uint8_t* p, size_t n) {
    for (size_t i = 0; i < 16; ++i) { check(p[i] == uint8_t(0xa0+i)); check(p[n-16+i] == uint8_t(0xb0+i)); }
}
struct Life {
    Life() { ++constructors; }
    ~Life() { ++destructors; }
};
struct Capture { volatile uint64_t* address; uint64_t expected; };
__attribute__((noinline)) static void callback(void* context) {
    auto* capture = static_cast<Capture*>(context);
    check(*capture->address == capture->expected);
    ++callback_checks;
}

extern "C" __attribute__((noinline)) void gh0st_yield() {
    if (mode == 2) { async_stop_rewind(); mode = 0; return; }
    if (quantum && ++ticks % quantum == 0) {
        mode = 1;
        suspended_engine_sp = gh0st_current_stack_pointer();
        spill.pointer = pointer(spill_stack + 16);
        spill.end = pointer(spill_stack + sizeof(spill_stack) - 16);
        async_start_unwind(&spill);
    }
}

__attribute__((noinline)) static uint64_t recurse(uint32_t depth, uint64_t seed) {
    Life life;
    volatile uint64_t local[64];
    for (uint32_t i = 0; i < 64; ++i) local[i] = seed ^ (uint64_t(depth + 1) << 32) ^ (i * 0x9e37u);
    Capture capture{&local[37], seed ^ (uint64_t(depth + 1) << 32) ^ (37 * 0x9e37u)};
    void (*volatile indirect)(void*) = callback;
    uint64_t sum = seed;
    for (uint32_t k = 0; k < 3; ++k) {
        gh0st_yield();
        indirect(&capture);
        for (uint32_t i = 0; i < 64; ++i) {
            check(local[i] == (seed ^ (uint64_t(depth + 1) << 32) ^ (i * 0x9e37u)));
            sum ^= local[i] + k;
        }
        if (depth) sum += recurse(depth - 1, seed + k + 17);
    }
    return sum;
}

extern "C" __attribute__((noinline)) void gh0st_engine_thunk() {
    ++starts;
    result = recurse(5, seed_value);
}

// Direct Asyncify runtime calls exclude this boundary from transformation.
extern "C" uint32_t begin(uint32_t seed, uint32_t every, uint32_t use_dedicated_stack) {
    check(mode == 0 || mode == 3);
    mode = 0; quantum = every; ticks = 0; starts = 0; constructors = 0;
    destructors = 0; callback_checks = 0; steps = 1; result = 0; seed_value = seed;
    dedicated = use_dedicated_stack;
    set_guards(engine_stack, sizeof(engine_stack)); set_guards(spill_stack, sizeof(spill_stack));
    engine_top = dedicated ? pointer(engine_stack + sizeof(engine_stack) - 16) : gh0st_current_stack_pointer();
    gh0st_call_on_engine_stack(engine_top);
    if (mode == 1) { async_stop_unwind(); return 1; }
    check_guards(engine_stack, sizeof(engine_stack)); check_guards(spill_stack, sizeof(spill_stack));
    mode = 3; return 0;
}

extern "C" uint32_t advance() {
    check(mode == 1);
    ++steps; mode = 2;
    async_start_rewind(&spill);
    gh0st_call_on_engine_stack(suspended_engine_sp);
    if (mode == 1) { async_stop_unwind(); return 1; }
    check(mode == 0);
    check_guards(engine_stack, sizeof(engine_stack)); check_guards(spill_stack, sizeof(spill_stack));
    mode = 3; return 0;
}

// Emulates ordinary native Candid-entry decode/encode stack use between separate messages.
extern "C" __attribute__((noinline)) uint64_t host_churn(uint32_t salt) {
    volatile uint64_t buffer[2048];
    for (uint32_t i = 0; i < 2048; ++i) buffer[i] = uint64_t(salt) * 65537 + i;
    uint64_t sum = 0;
    for (uint32_t i = 0; i < 2048; ++i) sum += buffer[i];
    host_sink = sum;
    check_guards(engine_stack, sizeof(engine_stack)); check_guards(spill_stack, sizeof(spill_stack));
    return sum;
}
extern "C" uint64_t get_result() { return result; }
extern "C" uint32_t get_starts() { return starts; }
extern "C" uint32_t get_constructors() { return constructors; }
extern "C" uint32_t get_destructors() { return destructors; }
extern "C" uint32_t get_callbacks() { return callback_checks; }
extern "C" uint32_t get_steps() { return steps; }
extern "C" uint32_t get_mode() { return mode; }
