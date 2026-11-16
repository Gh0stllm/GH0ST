# Local factory rehearsal — exact Nitro contracts, no public deployment

**Result:** 140 checks passed across 33 synthetic transactions. The exact upstream core deployment sequence created 25 factory/template contracts, then `createRollup` created and initialized a local custom-token rollup. A supplemental exact Safe singleton, proxy factory and initialized 1-of-1 proxy also passed. Real ETH and ICP spent: **zero**.

Recorded: 2026-11-16T06:39:35.613Z. Evidence is [evidence.json](evidence.json); implementation is [rehearse.cjs](rehearse.cjs). The in-process chain is discarded when the script exits; its addresses and receipts do not exist on Robinhood.

## Reproduce locally

From the `gh0st-chess` repository root:

```sh
node research/chess/l3/core/deployment/local-factory/rehearse.cjs
```

No arguments are accepted. The script uses the existing `../bridge/node_modules` dependencies and exact-source artifacts under `nitro/.cache/contracts-provenance`; it installs nothing, loads no wallet or environment file, has no RPC configuration, and opens no network listener. Each run generates fresh ephemeral Ganache accounts containing fake ETH. Never import these test accounts into a funded wallet.

The existing Ganache package falls back to its JavaScript implementation on Node 24 because its optional native module does not match this Node build. The rehearsal completes with that fallback; no dependency rebuild or install is required.

## What was executed and checked

- Nitro contract source pin: `4341b132cfbdcc980ead03765ca5224ff6cb5d97`. Every main and Safe artifact used is hash-matched against the existing exact-source compilation evidence. UpgradeExecutor's package archive is reverified with SHA256 and npm SHA512 integrity, and its artifact bytes are compared to that verified archive.
- `deploymentUtils.ts::deployAllContracts` order and arguments are reproduced. Its Arbitrum-parent branch uses `maxDataSize=104857`, `reader4844=0`, and all four ETH/ERC20 and delay-bufferable SequencerInbox combinations. Explorer verification is disabled, matching upstream's omission of the unused verification-only RollupProxy.
- The canonical CREATE2 prerequisite is genuinely deployed at `0x4e59b44847b379578588920cA78FbF26c0B4956C` using the exact keyless signed payload embedded in pinned `DeployHelper.sol`. Only its Nitro `0x04` message-kind prefix is removed; the predetermined signer receives fake ETH locally. Core deployments use this factory with zero salt. Predicted CREATE2 addresses are checked against deployed code.
- Standard EIP-170 runtime limit (24,576 bytes) and EIP-3860 initcode limit (49,152 bytes) remain enabled. The script additionally caps every transaction's gas limit at 16,777,216; the synthetic block limit is 30,000,000. Neither unlimited-code nor unlimited-initcode mode is enabled. Largest recorded deployed runtime is 23,538 bytes; largest recorded initcode including constructor arguments is 24,549 bytes.
- Actual deployed runtime hashes, artifact hashes, constructor inputs, initcode sizes, transaction hashes and per-transaction gas are recorded. Runtime is compared byte for byte when possible. For immutable-bearing code, exact creation input is bound by CREATE2 and runtime length, metadata and public immutable getters are checked; the report does not claim byte-for-byte immutable normalization.
- RollupCreator owner and every template pointer, BridgeCreator template arrays, standard one-step prover addresses, immutable flags and maxDataSize are checked.
- `createRollup` uses the exact current 10-field tuple, including `feeTokenPricer` and `customOsp`. Its CREATE2 address is independently predicted from the ABI-encoded tuple and real RollupProxy bytecode. The native token is **GH0ST LOCAL MOCK NOT REAL GH (GHMOCK)**, deployed from the pinned TestWETH9 artifact. The local fee-token pricer returns a fixed `1e18` exchange rate; it is not market data.
- The child config requests standard ArbOS 61, debug precompiles off and standard Nitro machine root `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`. This root was supplied from the separately verified official core image; the experimental LLM root is not used.
- Created code and implementation/admin storage are checked. Rollup and ProxyAdmin ownership moves to UpgradeExecutor; the chosen ephemeral owner gets EXECUTOR_ROLE, the executor is self-administered, and the creator retains no executor role. Validator, batch poster, manager, custom native token, fee-token pricer, challenge manager and stake token are initialized and checked. Bridge permissions contain the expected delayed inbox plus rollup-event inbox and one outbox.
- Supplemental Safe deployment is separate from the official core sequence. The exact Safe and SafeProxyFactory artifacts are deployed and a fresh proxy's owner and threshold are checked. Its ephemeral 1-of-1 policy is a test fixture, not a proposed production custody policy.

## Explicit synthetic fixtures and limits

The synthetic chain uses ID **4663 solely as a local number**. It is Ganache Shanghai, not an RH fork or a real Nitro parent. [LocalFixtures.sol](LocalFixtures.sol) is compiled locally with solc 0.8.30 targeting Shanghai. Two small fixtures are installed with Ganache's local `evm_setAccountCode`:

| Local address | Explicitly synthetic behavior |
| --- | --- |
| `0x64` | `arbOSVersion()` returns raw 116 (55 + ArbOS 61); `arbBlockNumber()` returns the local EVM block number. Other ArbSys behavior is unavailable. |
| `0x6c` | `getL1BaseFeeEstimate()` returns zero, allowing the actual rollup event inbox to initialize with the explicit mock pricer. No real parent data charge is modeled. |

No Nitro contracts or ABIs are replaced by fixtures. These two fixtures select the official parentLayer=2 path and satisfy the narrow precompile calls used by actual contract initialization. They do not prove RH Nitro execution, parent fees, transaction compression, data availability, or production deployment compatibility.

The genesis assertion state is the upstream zero-state rehearsal form. Contract creation does not prove that this is the correct genesis state for a running child. `deployFactoriesToL2=false` intentionally skips child keyless-factory retryables. No child node was booted, no sequencer batch was published publicly, no bridge transfer occurred, no challenge/fraud-proof replay was executed, and no license was accepted. These remain separate gates before any public launch.

## Measured synthetic gas

| Scope | Gas |
| --- | ---: |
| Canonical CREATE2 bootstrap and fake-ETH funding | 89,137 |
| 25 upstream core factory/template deployments | 72,894,496 |
| Mock token and unit-rate pricer | 925,820 |
| Actual `createRollup` with custom token | 7,338,187 |
| Supplemental exact Safe singleton/factory/proxy | 5,689,060 |
| **Total local rehearsal** | **86,936,700** |

Core factory plus `createRollup`: **80,232,683 gas**. Multiplying by the supplied **20,000,000 wei per gas assumption**, without refreshing current RH RPC data, gives **0.00160465366 ETH**. Including all synthetic bootstrap, mocks and Safe work gives **0.001738734 ETH** at that same assumption.

These are arithmetic conversions of synthetic gas, **not current verified Robinhood estimates or a cap guarantee**. They exclude real Nitro pricing differences, parent fee components, retries and running costs. The archived evidence preserves the historical `0.000064114367868 ETH` spend and the spending ceilings that applied when that snapshot was recorded. The user subsequently removed those ETH/ICP ceilings for the active L3 work; they are not current limits. This rehearsal spent zero real ETH and zero ICP.

### Core deployment detail

| Contract / constructor variant, in official deployment order | Measured gas |
| --- | ---: |
| ethBridge | 1,503,945 |
| ethSequencerInbox | 4,775,174 |
| ethSequencerInboxDelayBufferable | 4,775,186 |
| ethInbox | 2,425,266 |
| ethRollupEventInbox | 626,015 |
| ethOutbox | 1,493,926 |
| erc20Bridge | 1,938,165 |
| erc20SequencerInbox | 4,775,186 |
| erc20SequencerInboxDelayBufferable | 4,775,198 |
| erc20Inbox | 2,312,396 |
| erc20RollupEventInbox | 732,408 |
| erc20Outbox | 1,576,627 |
| bridgeCreator | 1,694,173 |
| prover0 | 2,937,213 |
| proverMem | 1,863,723 |
| proverMath | 2,256,816 |
| proverHostIo | 4,243,811 |
| osp | 3,040,824 |
| challengeManager | 5,166,821 |
| rollupAdmin | 4,894,080 |
| rollupUser | 3,775,465 |
| upgradeExecutor | 1,436,138 |
| validatorWalletCreator | 3,094,184 |
| deployHelper | 1,436,631 |
| rollupCreator | 5,345,125 |
