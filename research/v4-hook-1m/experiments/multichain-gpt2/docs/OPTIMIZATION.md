# Gas and placement optimization

The optimized candidate keeps Robinhood as the input/result home, assigns one transformer block to BNB and one to Arc, and puts the remaining ten blocks plus the full vocabulary head on Monad. This retains real computation on all four chains while minimizing the number of whole blocks assigned to the more expensive remote chains. It is a constrained placement choice, not proof that no other architecture could cost less.

The two engine contracts are deliberately separate. `GPT2Shard.sol` remains the baseline. `GPT2ShardOptimized.sol` uses the same ABI, phases, canonical model weights, INT8 row format, Q12 activations and signed arithmetic. A newly compiled and verified engine is required for the optimized runtime; its code must not be silently substituted for a previously verified deployment.

The chosen kernel aggregates repeated correction terms in the packed dot product, copies each required weight shard once per chunk and reuses its rows, retains the best output token in memory during a vocabulary chunk, and reuses residual values and freshly calculated phase vectors. The changes reduce repeated storage reads and copying without changing the model's precision or pruning parameters.

A whole-block comparison over two positions measured 644,084,036 baseline gas against 584,438,209 candidate gas: **9.26% lower**, with matching phase vectors, output and KV state. This microbenchmark injects independently verified embedding fixtures, so it proves the block comparison rather than complete on-chain inference. The separate full-route benchmark computes embeddings itself and checks the entire model. The final dollar comparison is in [COSTS.md](COSTS.md).

An additional loop-unrolling candidate passed arithmetic tests but increased whole-block gas. It was rejected. A prepacked weight format also increased deployment bytes/cost significantly and was not selected. Those experiments are not part of the optimized engine.

## Native Monad accounting

Monad uses a different opcode/storage schedule and charges against the declared transaction gas limit. The optimization benchmark starts Anvil's native `monad` profile and checks the reported `MonadTen` revision and storage-page behavior. It separately records receipt gas, declared gas, and the gas used in the fee scenario. A generic Ethereum execution with chain ID 143 is not treated as a native Monad measurement.

The worker estimates each Monad action against the current state, adds a 1% margin plus 1,000 gas within the reviewed cap, and performs a read-only preflight at that exact limit. This applies to model advances, activation imports, input starts and message dispatches. It avoids always submitting the maximum 30M limit for small operations. A changed state can invalidate an estimate; the normal transaction, deadline, fee and sequence checks remain in force.

Heavy matrix/head phases use direct `advance` calls and search for the largest fitting row count, up to 512 remaining rows. Small phases use `advanceMany` at 128 rows with up to 64 steps. Every selected call is rechecked before signing. Operator gas caps and margins can change chunk boundaries, so the benchmark estimate is not a guarantee that every worker configuration has identical transaction counts.

The other local profiles use generic Cancun rules and target chain IDs. Exact Robinhood posting, Arc/BSC client behavior and production LayerZero dispatch still require network-specific validation. Current price/source evidence is in [FEE-SOURCES.md](FEE-SOURCES.md).

## Reproduce and prepare

```sh
npm run plan:optimized
npm run benchmark:baseline-native -- --tokens=2
npm run benchmark:optimized -- --tokens=2 --out=reports/optimized-native-full
npm run costs -- --markdown=docs/COSTS.md
```

The model exporter and independent oracle are unchanged. Every full benchmark deploys all assigned weight bytes through CREATE, computes all 12 transformer blocks and all 50,257 logits, verifies every emitted phase commitment and the persistent KV vectors, then returns the selected token through four locally simulated message hops.

Use `config/runtime.optimized.example.json` as the disabled optimized deployment template. Offline preparation accepts explicit `--config=config/chains.optimized.json --engine=GPT2ShardOptimized` together with the existing admin, requester, session, deadline, nonce, data and output arguments. It pins the route-file hash and engine identity in the unsigned manifest. The verifier reconstructs the selected partition and exact creation/runtime bytecode before a worker may use it. Neither preparation nor these benchmarks deploys to public chains.

The original default plan and engine remain available for reproducibility. All four directed LayerZero paths still need real OApp security configuration and exact quotes before live deployment. The token remains GH0ST; this work introduces no second coin.
