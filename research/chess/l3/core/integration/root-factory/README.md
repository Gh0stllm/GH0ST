# Actual Ethereum root → Nitro parent bootstrap

This new helper supports the native integration sequence **actual Geth Ethereum 1337 → Nitro 4663 → Nitro 4663007**. An isolated `--dev` Nitro parent reports zero L1 block numbers, so it cannot supply the real parent-chain header data required by the child sequencer. This helper creates the ETH-native Nitro 4663 rollup on an actual local Geth Ethereum root; it does not bypass the sequencer, genesis or machine-root checks.

**Verified:** 29 actual local Geth transactions created the ETH-native rollup at root block **482**, using **81,136,102 Ethereum execution gas**. The native connected Nitro parent then booted with exact generated genesis validation enabled and reported real root-L1 block number **623** at the recorded snapshot. Reader4844 executed real EIP-4844 opcodes and returned blob base fee **1** and empty data hashes for its ordinary call. [validation.json](validation.json) and [deployment-packet.json](deployment-packet.json) preserve the scoped evidence. Root dev-chain fees were `0.000000000649088816` fake ETH; real spend was zero. This is local development pricing, not a public Ethereum/RH cost estimate. The L3's creation, native-token mint, ordinary transaction and parent-batch verification belong to the separate native integration result.

[local-ethereum-factory.cjs](local-ethereum-factory.cjs) exports `deployLocalEthereumRootFactoryAndRollup`. The orchestrator supplies an ephemeral signer and provider connected to its loopback-only Geth root. Importing the library performs no chain operations. Actual provider URL, chain ID 1337, native Geth client identity and the absence of synthetic ArbSys code are checked. Every transaction rechecks the loopback endpoint and chain identity. Only Nitro parent chain 4663 can be created by this helper.

```js
const { deployLocalEthereumRootFactoryAndRollup } = require('./local-ethereum-factory.cjs');
const result = await deployLocalEthereumRootFactoryAndRollup({
  provider: isolatedGethProvider,
  signer: ephemeralLocalSigner,
  rootRpcUrl: isolatedGethLoopbackUrl,
  expectedRootChainId: 1337,
  parentChainId: 4663,
  chainConfigJSON: exactConnectedParentConfigFromGenesisGenerator,
  genesisAssertionState: exactConnectedParentGenesisAssertion,
  genesisInboxCount: 0,
  dataCostEstimate: 1n,
  onProgress: event => { /* no private key is included */ },
});
const packet = result.jsonPacket();
```

The root variant uses the pinned upstream Ethereum-parent branch: `maxDataSize=117964`, real Reader4844, native token zero and fee-token pricer zero. The 25 factory/template contracts remain in the upstream deployment order, with Reader4844 inserted after Bridge exactly where upstream inserts it. An additional local TestWETH9 mock supplies only the stake-token address; it is not real collateral. Child keyless-factory retryables remain disabled. Ethereum execution estimates plus explicit margin must fit the helper's 16,777,216 gas guard; ordinary Geth code, initcode and gas limits remain unchanged.

The genuine Arachnid CREATE2 proxy uses the exact creation code embedded in pinned DeployHelper. Its signed deployment uses the orchestrator's ephemeral signer and chain-1337 replay protection, exercising upstream's supported `CREATE2_FACTORY` override. Its deployed 69-byte runtime is checked. No code is installed directly, no synthetic precompile is created, and no unprotected-transaction RPC switch is enabled. The actual prerequisite address is recorded in the packet.

[compile-reader.cjs](compile-reader.cjs) compiles the actual pinned `yul/Reader4844.yul` source, with source bytes matched against the SHA256-verified Nitro-contracts archive. It loads SHA512-verified solc **0.8.17**, with its `soljson.js` bytes compared to the verified compiler archive, and uses the pinned foundry Yul profile's inherited London target and 2,000 optimizer runs. [Reader4844.json](Reader4844.json) contains the genuine **103-byte creation code and 91-byte runtime**. Both match the published package's Reader artifact byte for byte. Verbatim opcodes `0x49` and `0x4a` retain their real EIP-4844 behavior. After deployment the helper calls actual `getDataHashes()` and `getBlobBaseFee()` on Geth; it requires empty hashes for the ordinary call and a positive real blob base fee.

The exact serialized ArbOS 61 configuration, normal 24,576-byte code and 49,152-byte initcode limits, debug-off setting, supplied nonzero genesis block hash, send root and initial fee are preserved. The helper checks that the rollup's initialized confirmed assertion binds the supplied genesis state. The orchestrator must then boot Nitro 4663 against the actual Ethereum root with genesis validation and standard machine-root compatibility checks enabled, before recreating and booting the L3 through the finalized sibling factory helper.

All keys and balances are newly generated local test material. The connected parent genesis may explicitly allocate fake local ETH for its ephemeral operator; that allocation carries no real funding or custody claim. No public Ethereum/RH RPC, existing wallet, real token movement or server purchase is supported here. Earlier spending ceilings are historical context, not current limits. Actual running parent/child behavior belongs to the separate integration result, not the presence of these contracts alone.
