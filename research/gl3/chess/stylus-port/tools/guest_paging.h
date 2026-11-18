#ifndef GH0ST_GUEST_PAGING_H
#define GH0ST_GUEST_PAGING_H

#include "wasm-rt.h"

/* Raw guest bytes are little-endian. The backend must support ranges crossing
 * virtual pages. Copy has memmove semantics even when source and destination
 * are the same memory. Backend failure traps and must roll back the slice. */
bool gh0st_vm_open(wasm_rt_memory_t* memory);
bool gh0st_vm_extend(wasm_rt_memory_t* memory, uint64_t pages);
void gh0st_vm_close(wasm_rt_memory_t* memory);
bool gh0st_vm_read(const wasm_rt_memory_t* memory, uint64_t address, void* dst, uint64_t length);
bool gh0st_vm_write(wasm_rt_memory_t* memory, uint64_t address, const void* src, uint64_t length);
bool gh0st_vm_fill(wasm_rt_memory_t* memory, uint64_t address, uint8_t value, uint64_t length);
bool gh0st_vm_move(wasm_rt_memory_t* dst, uint64_t dst_address,
                   const wasm_rt_memory_t* src, uint64_t src_address, uint64_t length);
/* Resolve exactly these read-only, hash-checked seed ranges using the portable
 * guest manifest. Do not materialize the seed as a contiguous host array. */
bool gh0st_vm_seed(wasm_rt_memory_t* memory, uint64_t address, uint64_t length);

static inline void gh0st_memory_trap(void) {
  wasm_rt_trap(WASM_RT_TRAP_OOB);
  __builtin_trap();
}

static inline void gh0st_check_guest_range(const wasm_rt_memory_t* memory,
                                          uint64_t address, uint64_t length) {
  if (address > memory->size || length > memory->size - address) {
    gh0st_memory_trap();
  }
}

static inline void gh0st_guest_read(const wasm_rt_memory_t* memory,
                                    uint64_t address, void* dst, uint64_t length) {
  gh0st_check_guest_range(memory, address, length);
  if (length && !gh0st_vm_read(memory, address, dst, length)) gh0st_memory_trap();
}

static inline void gh0st_guest_write(wasm_rt_memory_t* memory,
                                     uint64_t address, const void* src, uint64_t length) {
  gh0st_check_guest_range(memory, address, length);
  if (length && !gh0st_vm_write(memory, address, src, length)) gh0st_memory_trap();
}

static inline void gh0st_guest_fill(wasm_rt_memory_t* memory,
                                    uint64_t address, uint8_t value, uint64_t length) {
  gh0st_check_guest_range(memory, address, length);
  if (length && !gh0st_vm_fill(memory, address, value, length)) gh0st_memory_trap();
}

static inline void gh0st_guest_move(wasm_rt_memory_t* dst, uint64_t dst_address,
                                    const wasm_rt_memory_t* src, uint64_t src_address,
                                    uint64_t length) {
  gh0st_check_guest_range(dst, dst_address, length);
  gh0st_check_guest_range(src, src_address, length);
  if (length && !gh0st_vm_move(dst, dst_address, src, src_address, length)) gh0st_memory_trap();
}

static inline void gh0st_guest_seed(wasm_rt_memory_t* memory,
                                    uint64_t address, uint64_t length) {
  gh0st_check_guest_range(memory, address, length);
  const bool pinned = (address == 1024 && length == 98643411) ||
                      (address == 98644440 && length == 5468);
  if (!pinned || !gh0st_vm_seed(memory, address, length)) gh0st_memory_trap();
}

static inline void gh0st_guest_allocate(wasm_rt_memory_t* memory,
                                        uint64_t initial_pages, uint64_t max_pages,
                                        bool is64, uint32_t page_size) {
  if (initial_pages != 2048 || max_pages != 32768 || is64 || page_size != 65536) {
    gh0st_memory_trap();
  }
  *memory = (wasm_rt_memory_t){
    .data = NULL, .data_end = NULL, .page_size = page_size, .pages = initial_pages,
    .max_pages = max_pages, .size = initial_pages * page_size, .is64 = false,
  };
  if (!gh0st_vm_open(memory)) gh0st_memory_trap();
}

static inline uint64_t gh0st_guest_grow(wasm_rt_memory_t* memory, uint64_t pages) {
  const uint64_t old = memory->pages;
  if (pages > memory->max_pages - old) return UINT64_MAX;
  if (!pages) return old;
  /* The backend exposes new bytes as zero, or rejects without changing memory. */
  if (!gh0st_vm_extend(memory, pages)) return UINT64_MAX;
  memory->pages = old + pages;
  memory->size = memory->pages * memory->page_size;
  return old;
}

static inline void gh0st_guest_free(wasm_rt_memory_t* memory) {
  gh0st_vm_close(memory);
  *memory = (wasm_rt_memory_t){0};
}

#endif
