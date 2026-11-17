# GL3 base mainnet first

The user prioritizes the base L3, public RPC, chain ID, explorer and native `$GH0ST` bridging from Robinhood. Full LLM validity proofs follow afterward. The confirmed explorer hostname is **scan.gh0st.fyi**.

[Proposed network](network.proposed.json) defines the intended public interfaces, not a running chain. Proposed chain ID **4,663,001** continues the earlier GL3 plan. A fresh public registry screen found no matching entry on 17 November 2026; this is not a global reservation or proof of uniqueness. DNS targets, contract addresses, guest key and genesis remain unactivated until receipt-backed deployment and verification.

RH remains the parent chain, ID **4663**, with ETH for parent transaction fees. Its existing GH0ST ERC20 backs GL3's native GH0ST gas currency. Native child allocations must be escrow-backed. The initial public feature set is ordinary EVM transfers/contracts plus a genuine validity-proof settlement and a bridge with working withdrawal claims. The earlier EVM-only benchmark cannot authenticate this canonical chain.

## Current launch work

- Execute and prove a complete ordinary base-chain transition using authenticated canonical machine, state, preimages and public inbox data.
- Finish actual fresh factory/seal integration and exact production genesis/configuration validation. A skipped stock BoLD check is insufficient.
- Restrict parent posting to data formats supported by the selected proof/availability profile. Rejecting a format only at the registry can stall the chain after posting.
- Complete real GH0ST escrow → canonical native credit → native burn → verified send root → one parent release, then reject replay and malformed claims with unchanged balances.
- Bind the actual service, persistent data, recovery/monitoring, RPC and explorer to the final contracts/genesis. Public RPC must expose standard wallet methods without administrative APIs; the indexer's trace API remains internal.

The network is **not mainnet-live**, and the public bridge is not accepting deposits. No contract or endpoint address is invented to fill the deployment manifest. The ordinary base proof and proof-backed withdrawal remain the critical path; LLM gas/throughput changes do not block this initial scope.

## Measured integration constraints

The canonical interpreter executes in SP1, but loading the official complete machine image is a different workload. Both the first software-hash and first accelerated-loader probes reached their one-billion-instruction limit before an accepted complete image root; those execute-only attempts are preserved and phase profiling is underway. Neither is a generated proof or proof-time estimate.

The frozen atomic factory fits EIP-170 by only 59 runtime bytes. Its first actual `createChain` integration returned `InvalidGraph`; exact canonical getter behavior is being investigated before any source change. The original scoped unit passes remain valid, but do not close factory or bridge end-to-end acceptance.

[Current integration](../README.md) · [Coordinator results](../contracts/README.md) · [Native bridge](../bridge/NATIVE-INTERFACE.md).
