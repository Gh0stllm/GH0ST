// SPDX-License-Identifier: GPL-3.0-or-later
// Native parity host for the checked guest paging ABI.
#include "wasm-rt.h"
#include <string.h>

extern const uint8_t data_segment_data_w2c_gl3vm_d0[98643411];
extern const uint8_t data_segment_data_w2c_gl3vm_d1[5468];

bool gh0st_vm_open(wasm_rt_memory_t *memory) {
    wasm_rt_allocate_memory(memory, memory->pages, memory->max_pages,
                           memory->is64, memory->page_size);
    return memory->data != NULL;
}

bool gh0st_vm_extend(wasm_rt_memory_t *memory, uint64_t pages) {
    return wasm_rt_grow_memory(memory, pages) != UINT64_MAX;
}

void gh0st_vm_close(wasm_rt_memory_t *memory) {
    wasm_rt_free_memory(memory);
}

bool gh0st_vm_read(const wasm_rt_memory_t *memory, uint64_t address,
                   void *dst, uint64_t length) {
    memcpy(dst, memory->data + address, length);
    return true;
}

bool gh0st_vm_write(wasm_rt_memory_t *memory, uint64_t address,
                    const void *src, uint64_t length) {
    memcpy(memory->data + address, src, length);
    return true;
}

bool gh0st_vm_fill(wasm_rt_memory_t *memory, uint64_t address, uint8_t value,
                   uint64_t length) {
    memset(memory->data + address, value, length);
    return true;
}

bool gh0st_vm_move(wasm_rt_memory_t *dst, uint64_t dst_address,
                   const wasm_rt_memory_t *src, uint64_t src_address,
                   uint64_t length) {
    memmove(dst->data + dst_address, src->data + src_address, length);
    return true;
}

bool gh0st_vm_seed(wasm_rt_memory_t *memory, uint64_t address, uint64_t length) {
    if (address == 1024 && length == sizeof(data_segment_data_w2c_gl3vm_d0)) {
        return gh0st_vm_write(memory, address, data_segment_data_w2c_gl3vm_d0, length);
    }
    if (address == 98644440 && length == sizeof(data_segment_data_w2c_gl3vm_d1)) {
        return gh0st_vm_write(memory, address, data_segment_data_w2c_gl3vm_d1, length);
    }
    return false;
}
