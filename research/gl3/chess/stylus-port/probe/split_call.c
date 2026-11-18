// Two disposable Stylus canaries. Build once with SPLIT_COORDINATOR=0 and once with 1.
#include <stdint.h>

#define HOST(name) __attribute__((import_module("vm_hooks"), import_name(#name)))
HOST(read_args) void read_args(uint8_t *dest);
HOST(write_result) void write_result(const uint8_t *source, uint32_t bytes);
HOST(storage_load_bytes32) void storage_load_bytes32(const uint8_t *slot, uint8_t *dest);
HOST(storage_cache_bytes32) void storage_cache_bytes32(const uint8_t *slot, const uint8_t *value);
HOST(storage_flush_cache) void storage_flush_cache(uint32_t clear);
HOST(delegate_call_contract) uint32_t delegate_call_contract(const uint8_t *address,
    const uint8_t *calldata, uint32_t bytes, uint64_t gas, uint32_t *return_bytes);
HOST(read_return_data) uint32_t read_return_data(uint8_t *dest, uint32_t offset, uint32_t bytes);
HOST(evm_gas_left) uint64_t evm_gas_left(void);
HOST(pay_for_memory_grow) void pay_for_memory_grow(uint32_t pages);

static const uint8_t SLOT[32] = {0x71};
static volatile uint8_t *const PROBE_MEMORY = (volatile uint8_t *)0x8000;

#if SPLIT_COORDINATOR
static const uint8_t SENTINEL[32] = {0x4c};

static int delegate(const uint8_t *address, uint8_t mode, uint8_t *result, uint32_t length) {
    uint32_t found = 0;
    uint32_t status = delegate_call_contract(address, &mode, 1, evm_gas_left(), &found);
    return status == 0 && found == length && read_return_data(result, 0, length) == length;
}

uint32_t user_entrypoint(uint32_t bytes) {
    pay_for_memory_grow(0);
    if (bytes != 22) return 1;
    uint8_t request[22];
    read_args(request);
    uint32_t count = ((uint32_t)request[20] << 8) | request[21];
    if (count > 1024) return 1;

    *PROBE_MEMORY = 0xa7;
    storage_cache_bytes32(SLOT, SENTINEL);
    storage_flush_cache(1);
    uint8_t response[11];
    if (!delegate(request, 1, response, 2)
            || response[0] != SENTINEL[0] || response[1] != 0 || *PROBE_MEMORY != 0xa7) return 1;
    response[2] = *PROBE_MEMORY;

    uint64_t before = evm_gas_left();
    for (uint32_t i = 0; i < count; ++i) {
        uint8_t ack;
        if (!delegate(request, 0, &ack, 1) || ack != 0x51) return 1;
    }
    uint64_t cost = before - evm_gas_left();
    for (unsigned i = 0; i < 8; ++i) response[3 + i] = (uint8_t)(cost >> (56 - i * 8));
    write_result(response, sizeof(response));
    return 0;
}
#else
uint32_t user_entrypoint(uint32_t bytes) {
    pay_for_memory_grow(0);
    if (bytes != 1) return 1;
    uint8_t mode;
    read_args(&mode);
    if (mode == 0) {
        uint8_t ack = 0x51;
        write_result(&ack, 1);
        return 0;
    }
    if (mode != 1) return 1;
    uint8_t state[32];
    storage_load_bytes32(SLOT, state);
    uint8_t result[2] = {state[0], *PROBE_MEMORY};
    *PROBE_MEMORY = 0x39;
    write_result(result, sizeof(result));
    return 0;
}
#endif
