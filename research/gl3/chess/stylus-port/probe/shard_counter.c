// SPDX-License-Identifier: GPL-3.0-or-later
// Single-threaded ELF test fixture. Counts entries between generated units.
#define _GNU_SOURCE
#include <link.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum { SHARDS = 12 };
static uintptr_t start[SHARDS], end[SHARDS];
static uint64_t calls[SHARDS][SHARDS];
static int recording;

static int map_shard(struct dl_phdr_info *info, size_t size, void *argument) {
    (void)size;
    (void)argument;
    const char *slash = strrchr(info->dlpi_name, '/');
    const char *file = slash ? slash + 1 : info->dlpi_name;
    const char prefix[] = "libgl3vm_";
    if (strncmp(file, prefix, sizeof(prefix) - 1) != 0) return 0;
    const char *index = file + sizeof(prefix) - 1;
    char *suffix;
    if (*index < '0' || *index > '9') return 0;
    const unsigned long shard = strtoul(index, &suffix, 10);
    if (shard >= SHARDS || strcmp(suffix, ".so") != 0) return 0;
    for (size_t i = 0; i < info->dlpi_phnum; ++i) {
        const ElfW(Phdr) *segment = &info->dlpi_phdr[i];
        if (segment->p_type != PT_LOAD || !(segment->p_flags & PF_X)) continue;
        start[shard] = info->dlpi_addr + segment->p_vaddr;
        end[shard] = start[shard] + segment->p_memsz;
    }
    return 0;
}

int gl3shards_begin(void) {
    if (recording) return 0;
    dl_iterate_phdr(map_shard, NULL);
    for (unsigned i = 0; i < SHARDS; ++i) {
        if (end[i] <= start[i]) return 0;
    }
    memset(calls, 0, sizeof(calls));
    recording = 1;
    return 1;
}

void gl3shards_end(void) { recording = 0; }

uint64_t gl3shards_count(unsigned from, unsigned to) {
    return from < SHARDS && to < SHARDS ? calls[from][to] : 0;
}

static unsigned owner(uintptr_t address) {
    for (unsigned i = 0; i < SHARDS; ++i) {
        if (address >= start[i] && address < end[i]) return i;
    }
    return SHARDS;
}

void gl3shards_enter(void *function, void *return_address) {
    if (!recording) return;
    const unsigned to = owner((uintptr_t)function);
    if (to == SHARDS) return;
    const unsigned from = owner((uintptr_t)return_address);
    if (from != SHARDS && from != to) ++calls[from][to];
}

void gl3shards_exit(void *function, void *return_address) {
    (void)function;
    (void)return_address;
}
