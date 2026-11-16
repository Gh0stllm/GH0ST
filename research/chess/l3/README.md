# GH0ST custom L3 server preparation

The selected direction is a custom L3 settling on Robinhood, with GH0ST gas and the unchanged Stockfish bot. **The server configuration and local rehearsal checks are prepared; the custom chess execution and matching fraud prover are not built.** No server is rented and this is not a twenty-game deployment within 100 ICP.

The working assumption is a capped pilot while the requested choice between a scheduled tournament and an always-on service remains open. A short pilot does not make a monthly server charge prorated.

## Selected server candidate

OVH/Kimsufi SYS-3: Xeon E-2288G, eight cores and sixteen threads, 128 GB DDR4 ECC RAM, two 960 GB enterprise NVMe drives, and advertised 1 Gbps unmetered public networking. Configure RAID1 and verify it on the actual host: usable mirrored capacity is about 960 GB before formatting, not 1.92 TB. The SYS range advertises Anti-DDoS, root access, provider support and remote console access. Region-specific SLA and the account's final upgraded quote have not been checked.

| Item | Price excluding VAT |
|---|---:|
| Server each month | €71.99 |
| Advertised base setup | €41.99 |
| First month, server and setup only | €113.98 |
| Optional separate 1 TB Hetzner BX11 off-site backup | €3.20/month |

Sources: [server configuration](https://www.kimsufi.com/en-ie/sys/sys-3/), [SYS range features](https://www.kimsufi.com/en-gb/sys/), [backup candidate](https://www.hetzner.com/storage/storage-box/). Prices are advertised candidates, not a placed order. DDR4 is below Nitro's published DDR5 baseline, so actual chain and engine capacity must be measured before selecting the host for funded games.

A single host can hold the sequencer, batch poster and local validator during rehearsal. Those roles share the host's failure domain. ECC RAM and mirrored drives do not provide an independent validator or high availability. Public-service availability, monitoring, off-site restoration and dispute recovery need a reviewed operating plan; an independently operated validator in a separate failure domain is recommended.

## Prepared artifacts

- `plan.json`: server quote, topology, scope, preserved spending caps and unresolved capital costs.
- `parent-read.mjs`: anonymous read-only Robinhood chain and canonical-token checks. It never prints an endpoint containing credentials and has no transaction method.
- `parent-snapshot.json`: actual parent snapshot; verified chain4663 and the expected GH0ST runtime/18 decimals. This does not establish a supported factory or complete fee-token audit.
- `architecture/manifest.json`: pinned full model and strength policy, required custom execution/proving work and release evidence.
- `server/host_preflight.py`: read-only Linux/CPU/RAM/storage/mirroring checks for the actual target host.
- `server/compose.rehearsal.yaml`: ordinary Nitro rehearsal template, pinned to a verified linux/amd64 digest. It contains no signing key and binds RPC only to loopback.
- `server/plan_guard.py`: plan checks that cannot launch mainnet. Filling approval/evidence fields does not turn this template into a custom engine.

The full bot remains Stockfish19, its pinned 98,511,183-byte NNUE, 24 million nodes per Black decision, Hash128, Threads1, maximum skill and complete per-game retained state. No hosted inference API substitutes for deterministic chain execution.

## Work required before a server lease

The next engineering step is a local custom deterministic state transition with matching replay and fraud-proof support, including a real test in which an incorrect result loses a challenge. Then port the complete Stockfish continuation and retained state and compare complete searches and games against the reference. A standard Nitro image or a Stockfish process alongside it does not satisfy this requirement. [Custom execution requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).

The 100 ICP total cap includes the previously converted 13 ICP and fees. The existing ETH cap remains 0.003 ETH. Server rental, Robinhood settlement, installation, operating reserves, finality/dispute retention and validator funding must fit a reviewable budget. The quote above covers hardware rental only.

Current SDKv3.2 defaults to a **1 WETH validator base stake**. That is configurable, not a universal minimum, but it exceeds existing ETH authority. GH0ST gas does not automatically change the bond asset, and prize funds are not available for an unapproved bond. A smaller/custom bond or permissioned validator configuration needs explicit economic/trust review; none has been selected. [SDK configuration](https://github.com/OffchainLabs/arbitrum-chain-sdk/blob/main/src/createRollupPrepareDeploymentParamsConfig/v3.2.ts), [BoLD recommendations](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/validation/bold).

Robinhood remains absent from the current canonical-factory table. Its deployment path and the applicable license therefore remain unresolved. No license has been accepted. [Factories](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts), [license](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license).

Only after exact engine/prover tests, measured twenty-game capacity/costs, custody/finality checks and an approved concrete total budget should paid hosting and a closed pilot begin. Public fee admission stays disabled.

## Local checks

```sh
python3 -m unittest discover -s research/chess/l3/server -p 'test_*.py' -v
python3 research/chess/l3/server/plan_guard.py research/chess/l3/server/plan.example.json
node research/chess/l3/parent-read.mjs --write
```

The parent command is a read-only network probe. The guard and tests start no containers, rent no machines and move no funds. The Docker template still needs a reviewed local node configuration; none of these checks constitutes a custom-chain boot or chess game.
