# GL3 · standard chain launch lane

**The clean base chain runs on Runpod. Mainnet deployment remains pending.** This lane uses official Nitro 3.12.2 and its standard machine, with no custom chess state transition, engine or model.

| Fresh cloud check | Actual result |
|---|---|
| Official native client | `v3.12.2+5f02f3f-20261014T220458Z` · ELF SHA `d9e778d3…14c4ed` |
| Selected standard machine | `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97` |
| ArbOS / custom handlers | ArbOS 61; debug disabled; A11–A15 absent |
| Ordinary EVM execution | Contract deployed and returned exactly **42** |
| Standard Stylus | Program deployed and activated as Stylus 3; signed dot returned **−31** |
| Measured transactions | **16 / 16 succeeded**, plus three setup transactions |
| Loopback receipt latency | **97.71 ms p50 · 105.65 ms p95** |
| Run / cleanup | Actual exit **0**, **2.609 s**, node exit **0** and stopped |
| Sampled owned memory | **252,051,456 bytes** for the bounded run |

The configured minimum block spacing is 100 ms with a 5 ms queue poll. These observations are a small sequential fixture, not sustained throughput, parent confirmation time, public latency or an LLM benchmark. The fixture uses fake ETH genesis balances and no parent connection; it does not prove live GH0ST gas or Robinhood settlement. Those are separate bridge/dispute and deployment gates.

[The complete result](evidence/runs/base-functional-03/result.json) contains all nineteen actual private receipts. [The controller exit](evidence/runs/base-functional-03/controller-exit.json) records resource guards. [The launch profile](evidence/runs/base-functional-03/launch-profile.json) and [frozen harness](evidence/runs/base-functional-03/functional.mjs) identify the tested configuration. No private signing key or database is exported.

The first cloud-worker attempt was stopped at its disk floor before a transaction result. The second attempt passed the EVM checks, then hit an insufficient fixed test gas allowance for Stylus deployment. Both remain failures. The fresh third attempt used actual ordinary-transaction gas estimates with a 30% margin; protocol gas limits were unchanged. [Attempt two](evidence/runs/base-functional-02/result.json) is preserved separately.

[The artifact lock](evidence/artifact-lock.json) binds the pinned official OCI image/layer and pristine Nitro/geth source archives. [The receiver check](evidence/runtime-receiver.json) independently rehashed the actual official node and three standard machine files after transfer. The base execution fixture ran entirely on Runpod; local work was limited to editing, inspection and transfers.

The existing [core launch proposal](../../../chess/l3/core/deployment/intent.json) remains an unsigned reference: Robinhood parent chain 4663, GH0ST native-gas token, standard ArbOS 61 and no public privileged RPC. Its unset factory, pricer, validator/security, custody and license decisions are not filled by this functional test. No public transaction, token transfer, hosting purchase or license acceptance is performed by this lane.
