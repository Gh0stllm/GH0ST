# Robinhood Chain and Uniswap v4 gas support

Read-only public configuration check at block 96,465,174, 2026-10-24T03:42:57.403Z. No transactions were submitted.

- ArbGasInfo `getMaxTxGasLimit()` returned **32,000,000 execution gas**.
- ArbGasInfo `getMaxBlockGasLimit()` returned **32,000,000 execution gas**.
- The full swap, settlement and hook share the transaction allowance.
- Uniswap v4 has no separate 450-million-gas hook allowance; its core forwards available gas to the hook. The 450M value is our original test hook configuration.
- The public Uniswap v4 PoolManager address `0x8366a39cc670b4001a1121b8f6a443a643e40951` has 24,009 bytes of runtime code at this block.
- The block header's 1125899906842624 value is not the execution limit; use the explicit ArbGasInfo values.
- A high-gas simulation or local test does not establish support for an equally large real transaction.

The smallest fresh SimpleStories V2 v4 measurement was **179,978,646 local EVM gas**, approximately **5.62 times** the verified transaction execution limit. Raising our hook's internal limit alone therefore does not make the current port fit. The local measurements use Cancun/Anvil; Nitro-specific estimation is needed for exact transaction fees.

Evidence: [raw read-only snapshot](robinhood-limits.json), [fresh gas report](gas-benchmark.json).

Primary sources:

- https://developers.uniswap.org/docs/protocols/v4/deployments
- https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol
- https://docs.robinhood.com/chain/protocol-contracts/
- https://raw.githubusercontent.com/OffchainLabs/nitro-precompile-interfaces/main/ArbGasInfo.sol
- https://docs.robinhood.com/chain/gas-and-fees/
- https://github.com/OffchainLabs/nitro/blob/v3.11.3/arbos/tx_processor.go
