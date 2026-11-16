# Actual local Nitro factory integration

[local-nitro-factory.cjs](local-nitro-factory.cjs) is a reusable library for the native Nitro parent/child orchestrator. It deploys the exact pinned factory/templates and a GHMOCK custom-gas rollup on an actual isolated Nitro parent. Importing the library performs no chain operations.

**Validated creation phase:** actual native Nitro parent chain 4663 created the rollup at RPC block 29 and confirmed the mock native-token deposit at block 32 (delayed message index 1). The exact generated nonzero genesis assertion is initialized and checked. [validation.json](validation.json) records this phase; [deployment-packet.json](deployment-packet.json) preserves the sanitized deployment packet. Including the genuine prerequisite factory and the reused bridge from the initial attempt, 32 actual local transactions consumed 1,391,241,945 total gas, of which 81,433,945 was actual L2 compute. The 0.1391241945 ETH fee was entirely fake local ETH; real spend was zero. Child boot, its native-token mint and an ordinary child transfer require the separate integration result and are not claimed by this creation-phase snapshot.

The orchestrator must inject its ephemeral `ethers.JsonRpcProvider` and signer. The provider must connect directly to `127.0.0.1`, `localhost` or `::1`; its actual configured URL must equal the declared URL. Every mutation rechecks the chain ID. Parent and child are restricted to the dedicated local IDs `4663` and `4663007`. The real ArbSys precompile must report raw version 116 (ArbOS 61) and the expected chain ID. No code installation, synthetic precompile override, fork, environment-file loading, existing wallet lookup, public RPC or public transaction path is implemented.

## Interface

```js
const {
  deployLocalNitroFactoryAndRollup,
  sendLocalChildTransfer,
} = require('./local-nitro-factory.cjs');

const result = await deployLocalNitroFactoryAndRollup({
  provider: localParentProvider,
  signer: ephemeralLocalSigner,
  parentRpcUrl: localParentRpcUrl,
  expectedParentChainId: 4663,
  childChainId: 4663007,
  chainConfigJSON: exactSerializedConfigUsedByGenesisGenerator,
  genesisAssertionState: actualGenesisGeneratorAssertionState,
  genesisInboxCount: 0,
  dataCostEstimate: 1n,
  // Optional: resume after a partial local template deployment using its
  // explicitly supplied genuine proxy; runtime and reused code are rechecked.
  // existingCreate2FactoryAddress: priorLocalProxyAddress,
  onProgress: event => { /* no signer/key is included */ },
});

// JSON-safe deployment packet; never serialize the signer/provider themselves.
const packet = result.jsonPacket();

// Fake parent ETH mints mock token, approves exactly this amount, then
// depositERC20 credits the same EOA on the child when the delayed message runs.
const parentDeposit = await result.fundAndDepositNativeGas({
  amount: 10n ** 18n,
  expectedRecipient: ephemeralLocalSigner.address,
});

// Independently wait for and verify the child's native balance before sending.
const transfer = await sendLocalChildTransfer({
  provider: localChildProvider,
  signer: sameEphemeralKeyConnectedToChild,
  childRpcUrl: localChildRpcUrl,
  expectedChildChainId: 4663007,
  to: distinctLocalRecipient,
  value: 1n,
});
```

The returned packet includes the actual RPC receipt's `creationBlockNumber`, creation hash, all `RollupCreated` addresses, factory address, actual CREATE2 prerequisite address/route, local unit-rate fee-token pricer, exact serialized chain-config bytes, the supplied genesis state, verified confirmed assertion hash, Nitro `rollup` address keys, `chainInfo`, contract/runtime hashes and transaction gas components. `validator-utils` is explicitly zero because the current upstream deployment sequence creates no such contract; no placeholder address or code is supplied.

## Exact genesis and gas behavior

The caller must generate a real nonzero genesis block hash from the clean native `genesis-generator` using the exact serialized child config. The helper requires ArbOS 61, debug precompiles disabled, AnyTrust disabled, normal `MaxCodeSize=24576` and `MaxInitCodeSize=49152`, and the ephemeral owner. The generator's global state maps to `bytes32Vals=[BlockHash,SendRoot]`, `u64Vals=[1,0]`, machine status FINISHED and zero end-history root.

`dataCostEstimate` must be nonzero and must match the generator's `arbOSInit.initialL1BaseFee`. The integration uses the explicit local value `1`. This avoids the deployment block's fluctuating base fee changing the init message and invalidating the precomputed genesis. The helper preserves the exact `chainConfigJSON` string rather than reserializing it. After creation it computes the actual genesis assertion hash and checks that the rollup's confirmed assertion equals it. The child must still boot with genesis validation enabled; contract registration alone is not proof that the child boots.

Native Nitro's total transaction gas includes both L2 compute and the parent-data poster charge converted into L2 gas units. Each send first obtains ordinary `eth_estimateGas`, then actual `NodeInterface.gasEstimateComponents`. The native NodeInterface forwards the outer RPC `eth_call` gas allowance into nested estimation; its ordinary 50-million RPC cap can be smaller than a valid transaction's poster-inclusive gas estimate. If that call fails, the helper uses actual `NodeInterface.gasEstimateL1Component` paired with `eth_estimateGas`, recording the fallback and error explicitly. It does not change the RPC cap or node limits. Compute estimate (total minus the returned poster component) plus a margin is checked against an additional local 16,777,216 compute guard. Total gas is allowed to exceed that compute value. The raw Nitro receipt's `gasUsedForL1` and actual L2 compute are independently checked and recorded. No unlimited-code, unlimited-initcode, higher node compute cap or fee-config change is performed.

The default canonical Arachnid factory is used if its runtime is present and matches. Otherwise the helper checks whether the exact upstream keyless transaction's fixed 100,000 total gas can cover the real local Nitro fee components. If it cannot, the helper uses upstream `deploymentUtils.ts`'s supported `CREATE2_FACTORY` override: it genuinely deploys the identical proxy creation code using the ephemeral local signer and verifies its exact 69-byte runtime. This different prerequisite address is reported explicitly. The same upstream 25-contract deployment order, constructor settings, zero CREATE2 salt, `maxDataSize=104857` and parentLayer=2 branch are then used.

Main artifacts are hash-matched against the exact-source compilation evidence for Nitro contracts commit `4341b132cfbdcc980ead03765ca5224ff6cb5d97`. UpgradeExecutor's archive integrity and artifact bytes are reverified. The standard Nitro machine root is `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`; the experimental LLM root is not used. GHMOCK is explicitly **GH0ST LOCAL MOCK NOT REAL GH**, and its fixed unit-rate pricer is not market data.

The parent deposit result proves the local parent receipt and reports the delayed-message index and event data. It deliberately remains `CHILD_MINT_NOT_YET_VERIFIED` until the orchestrator independently observes the child balance. The ordinary child transfer helper then requires an actual child receipt and the distinct recipient's exact native balance increase. Child keyless-factory retryables, real token transfers, public settlement and fraud-proof execution remain outside this helper's claims.

All funding and token movement here are local test funds. No active real-spend ceiling is asserted; the user's earlier ETH/ICP ceilings were removed, while historical spend remains historical evidence.
