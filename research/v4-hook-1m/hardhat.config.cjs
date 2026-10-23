// The real v4 PoolManager uses transient storage (EIP-1153), so it requires Cancun.
module.exports = {
  networks: {
    hardhat: {
      hardfork: 'cancun',
      blockGasLimit: 30_000_000,
      allowUnlimitedContractSize: false,
      initialBaseFeePerGas: 0,
      mining: { auto: true },
    },
  },
};
