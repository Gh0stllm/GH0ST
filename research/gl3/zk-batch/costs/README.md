# GL3 · measured ZK and Nitro costs

**The complete sixteen-transfer EVM proof passed SDK and actual Solidity verification on Runpod. The measured workload favors Nitro on latency and proving resources.** This is a private component benchmark, not a launched ZK rollup.

| Measured component | Result |
| :--- | ---: |
| Complete CPU Groth16 call | **591.230 seconds** |
| Cold proof-call compute allocation at $1.12/hour | **$0.18394** |
| Whole proof runner, including initial client/key/guest work | 596.384 seconds / $0.18554 compute |
| Sampled owned proof RAM peak | **41.34 GB / 38.50 GiB** |
| Final proof / public output | **260 / 160 bytes** |
| Actual Solidity proof verification | **227,263 parent gas** |
| Separate publication of all16 raw transactions | **59,152 parent gas** |
| Sum of those two parent transactions | **286,415 gas** |
| One-time verifier deployment | 1,404,856 gas |
| Matched Nitro sequencing,16 calls | **266.52 milliseconds** |
| Nitro post trigger → observed independent replay | 2,322.69 milliseconds |
| Nitro actual parent batch posting | **179,241 gas** |

The cold proof call includes the SDK's official **3.026GB circuit download/install**, recursion and final Groth16 wrapping. A warm proof was not measured. The $0.184 allocation excludes prior downloads/builds, storage, tax, RPC, backups and chain fees. It charges the full existing32-vCPU/64GB worker for the named interval; parallel jobs share that rental and must not be added as independent bills. This is a measured resource-cost allocation, not a separately metered invoice.

Nitro's whole private job, including setup and teardown, was52.233 seconds, equivalent to$0.01625 of full-pod compute at that same rate. Its routine sequencing and posting/replay windows separately allocate approximately$0.000083 and$0.000723; those windows are observations with a controlled batch-release restart, not a measured combined production latency. Sequencer/follower CPU deltas were0.04/0.09 CPU-seconds. Cold initialization and a whole proof are different work from native execution; the table preserves those phase boundaries.

## Parent gas: actual components and price assumptions

The Nitro receipt splits into **175,613 compute +3,628 posting gas**. Both ZK receipts charge **zero posting gas** in their private parent fixture, so their286,415 total is all compute. Private pricer initialization differs; these figures are not an all-in Robinhood fee quote.

Nitro publishes its actual compressed1,542-byte batch. The separate ZK data-only transaction publishes2,864 raw transaction bytes inside a2,905-byte lossless RLP payload. It has an extra21,000-gas transaction base cost. Compression was not equalized, and a combined state/data/proof coordinator was not built. The measured two-transaction total is about1.60× Nitro's observed parent receipt, with these differences retained.

For illustration only, multiplying by the **historical same-day R44 observation of20,000,000 wei/gas** gives:

| Component | Illustrative ETH |
| :--- | ---: |
| Nitro observed parent posting gas | 0.00000358482 |
| ZK verification | 0.00000454526 |
| Separate raw-data transaction | 0.00000118304 |
| ZK verification + separate data | 0.00000572830 |

These are arithmetic scenarios, not fresh public estimates or paid fees. Additional live-parent posting charges and rollup-coordinator costs are not inferred from them. The public Robinhood RPC returned403 from the worker, so no current fee quote is claimed.

## What this result establishes

One genuine EVM batch of sixteen signed ERC20 transfers reaches a real CPU Groth16 proof, native verification, successful Solidity verification, and three meaningful mined rejections after changing its proof, public values or program key. The altered proof preserves curve membership, so out-of-gas precompile failure is not counted as rejection evidence. Independent audits bind the exact160 public bytes and all16 published transactions to the original workload.

This guest covers Ethereum EVM calls. **Stylus/WASM and LLM inference were not proved.** A production GL3 ZK path still needs proof-bound state/data acceptance, sequencer and prover operations, bridge/withdrawals, final configuration and security review. No public chain was launched. The preserved Nitro build and chess research are unchanged.

[Reproducible calculations](comparison.json) · [Calculation source, run on Runpod](calculate-comparison.py) · [Dated compute quote](compute-quote.json) · [Complete proof](../source-evaluation/complete16/README.md) · [Actual Solidity receipts](../nitro-baseline/verifier/README.md) · [Matched Nitro evidence](../nitro-baseline/README.md)
