# GH0ST L3 core

Build the base chain first: standard Nitro, Solidity and Stylus, Robinhood as parent, and GH0ST as native gas. The user clarified that it is for GH0ST-operated inference with very few transactions, rather than a public RPC/transaction service. LLM and chess product integration follows after the base chain works. Existing custom-runtime experiments remain separately preserved under `../nitro/`, `../bridge/` and `../llm/`; the initial production profile does not register their debug precompiles.

Current sizing and costs: [private workload](hosting/README.md). Operator-only access does not make data published by a Rollup confidential.

The local end-to-end rollup now passes: actual Ethereum Geth1337 → connected Nitro4663 → Nitro4663007, with validated genesis, a GHMOCK parent deposit becoming child native gas, a mined child transaction and its exact bytes decoded from the posted parent batch. This uses local fake funds, not real GH0ST or a public deployment. [Functional evidence](integration/evidence/functional-evidence.json).

## Responsiveness

The initial tuning candidate is a **100 ms minimum sequencer block delay**, with bounded transactions and queues. This is a chosen configuration, not a guaranteed block interval, throughput or parent finality. Heavy execution can take longer. Measure receipt p50/p95, RPC latency, queue rejection, restart recovery, CPU, memory and disk on the real target host before advertising a service level.

Receipt responsiveness and parent batch posting are separate. Batch compressed transactions on a measured cost/latency schedule rather than posting every 100 ms. Do not shorten the challenge period, weaken validation or call a sequencer receipt final settlement to make the chain appear faster.

Future LLM jobs must advance in bounded, resumable on-chain transitions so inference cannot monopolize ordinary transaction processing. Keep immutable weights separate from code, preserve exact authenticated state, and reserve validation/memory capacity. Upgrading to a custom runtime requires matched node/replay/prover artifacts and its own verification; installing a native model process beside the sequencer does not establish on-chain inference.

## Components

- `node/`: clean pinned Nitro/Stylus build, performance profile and measured local RPC checks.
- `gas/`: GH0ST token compatibility and fee-token pricer configuration. Parent settlement still consumes parent ETH.
- `deployment/`: pinned Chain SDK and a reviewable deployment rehearsal/preview. No private key or automatic public deployment belongs in this bundle.

The proposed parent is Robinhood mainnet chain4663. The actual child chain ID, public RPC, bridge, genesis hash, server installation and production rollup addresses remain unassigned until verified deployment. Local development receipts are not Robinhood settlement receipts.

The user removed the old 100 ICP and 0.003 ETH spending ceilings. Active estimates have no replacement finite ceiling; no automatic top-ups were enabled. Hosting, validator bond, licensing and final public deployment require a concrete reviewed setup within the user's authority. No real funds or external hosting have been used by this core build.
