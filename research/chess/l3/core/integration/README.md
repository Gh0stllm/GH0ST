# Private L3 integration rehearsal

The **base L3 works in an actual local three-layer test**:

```text
Ethereum Geth, chain1337
    → clean Nitro parent, chain4663
        → clean Nitro child, chain4663007, GHMOCK native gas
```

All three execute their real VM implementations. Both Nitro layers use unchanged standard source, ArbOS61, debug precompiles off and the official machine root. No synthetic ArbSys/ArbGasInfo code, RPC header rewriting or experimental LLM precompile was used. Every owned node was stopped after the test.

This is a local rehearsal. Chain4663 here is a private RH-like fixture, **not Robinhood mainnet**. GHMOCK is a local mock, not `$GH0ST`. No existing wallet, real ETH/ICP/GH0ST, server order or public deployment was involved. No LLM, Stockfish change or prover challenge forms part of this milestone.

## Verified path

1. Exact factory/templates and the real Reader4844 contract deployed to the local Ethereum root. The Reader's bytecode matches its pinned artifact and its real methods were called.
2. A clean Nitro4663 parent booted against that actual root rollup. Its generated genesis hash and on-chain assertion matched; genesis validation stayed enabled.
3. The exact native-token rollup factory deployed on that real Nitro parent. A local GHMOCK token and unit-rate mock pricer configured the child rollup.
4. One GHMOCK (`1,000,000,000,000,000,000` base units) moved into the parent's bridge and appeared as the same child native balance.
5. A signed ordinary child transaction transferred one base unit. The recipient changed from0 to1; its21000gas cost `2,100,000,000,000` GHMOCK base units. These local settings are not a live fee or token-price quote.
6. The child batch poster posted the signed transaction back to the actual Nitro parent. Standard Nitro Brotli, segment and L2 transaction parsers recovered its exact transaction hash, sender, chain ID and value from parent calldata.

The decisive inclusion record is:

| Item | Actual local evidence |
| --- | --- |
| Child transaction | `0xff96433326732c6aeb83d7d5f65a759266b6a5ad8a419662977195f736177d38` |
| Parent batch sequence | **2** |
| Parent transaction | `0x285a449204a1a9a0e32f9fb46fa2081766407b033687ed25e64590df32c52f89` |
| Parent receipt | Block43, status1 |
| Final parent batch count | **3** |

Sequence1 contained delayed-message metadata. The early count1→2 observation only confirmed that first batch; it is not used as proof of the ordinary transaction. The final sequence2 payload was independently decoded and matched. [Functional evidence](evidence/functional-evidence.json), [parent calldata/receipts](evidence/parent-batches.json) and [decoded inclusion](evidence/decoded-batch-inclusion.json) preserve the distinction.

Parent genesis `0xe8b0c571b68b277fd138245f9460270acb4c99e6ea304639a865abbd79721ece` and child genesis `0x72dcd5980b7b2e4d8cf2c2250f19f7ea402c8efd6a8dc572aea1dae843d5282a` came from the unchanged Nitro genesis generator, using the exact serialized chain config. The local parent's1000fakeETH allocation is explicit test data; it makes no claim about production bridge backing. The child receives no prefunded native allocation: its spendable native gas came through the actual GHMOCK deposit.

## Private-node footprint

The deployable child was small in this measured fresh-chain workload:

| Measurement | Child only |
| --- | --- |
| OS peak resident memory, including genesis and test activity | **179.25MiB** |
| Ten-second idle RSS window | **176.67–178.23MiB** |
| Allocated chain-data directory after shutdown | **2132KiB**, about2.08MiB |

The Ethereum root and RH-like Nitro parent are extra **test fixtures**, not additional production L3 hosting requirements. Their observed peaks were about164.89MiB and285.72MiB respectively. Production connects the child to the existing Robinhood parent RPC.

[Resource evidence](evidence/resource-footprint.json) separates each role, sampled RSS, OS lifetime peak, idle window and disk size. Measurements used an AppleM5/24GiB host and a fresh, small chain. The Nitro staker and block validator were disabled for this functional rehearsal. These measurements exclude their enabled-service overhead, LLM weights/KV/checkpoints, model execution, sustained growth and prover execution. Build caches are also separate from chain data. The measured179MiB must not be presented as a large-model memory requirement.

The16GB-class/256GB-class and32GB-class/512GB-class capacity profiles remain provisional and unselected. A warm spare is unselected, and no zero-downtime guarantee is made. There were no model/search/precision changes to obtain these figures.

## Reproduce

With the clean [core node](../node/README.md), pinned contract compilation/native prerequisites and existing pinned Node dependencies prepared:

```sh
node run.mjs
```

The driver creates fresh ephemeral keys and fake funds, computes both exact genesis assertions, starts the real Ethereum root, deploys the root rollup, starts the connected Nitro parent, deploys the native-gas child, deposits GHMOCK, runs the ordinary transfer, captures/decodes parent batches and shuts down all owned nodes. All RPC listeners bind to loopback. Private keys, contexts, node configs, logs and data stay in ignored `.cache/` directories; private files use restrictive permissions. No real endpoint, key or token is accepted by these local-only helpers.

The functional stages were actually executed end-to-end in this session. `run.mjs` composes those same stages; its syntax and interrupt lifecycle were checked, and a fresh whole-stack single-invocation rerun was deliberately not added. [Lifecycle evidence](evidence/orchestrator-lifecycle.json) records SIGINT and SIGTERM delivered only to the driver: both stopped all three recorded owned test PIDs in under0.4seconds. That check used a harmless process tree, with no chain or network started.

The lower-level adapters remain available for review: `deploy-root.cjs`, `connected-parent.mjs`, `deploy-parent.cjs`, `child.mjs`, `read-batches.cjs`, `decode-batch/main.go`, `metrics.py` and `export-evidence.py`. The legacy `parent.mjs` is a negative diagnostic only: a standalone Nitro dev parent has L1BlockNumber0, so a nested child correctly refuses to initialize. The working route uses the real local Ethereum root rather than bypassing that guard.

`export-evidence.py` rejects a failed functional path, requires the decoded child hash in a successful parent receipt, verifies the owned native PIDs are absent, strips private contexts/paths and scans the public bundle against the generated private key before export. [Cleanup evidence](evidence/cleanup.json) records the completed real-node run.

## Remaining production work

The Nitro staker and block validator were disabled; enabling validator/staking and exercising fraud-proof execution remain separate production and resource gates. The rehearsal uses zero-distance delayed-message finality and an accelerated batch interval, a fake genesis allocation, mock token/pricer and local development consensus. Ethereum-root blob reading is disabled for this calldata-only local test. It does not establish production finality, fraud-proof challenges, live GH0ST compatibility, market pricing, server reliability or LLM capacity.

Initial live deployment still needs its reviewed Robinhood contracts, real GH0ST/pricer configuration, custody, validator/bond choices and a private host. The standard canonical machine root is `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`; the experimental LLM machine remains separate and deferred. No old spending cap is carried into this bundle, and no automatic funding was selected.
