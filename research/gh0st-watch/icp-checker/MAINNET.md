# GH0ST Watch on ICP mainnet

Verified on 3 November 2026. The [dedicated checker](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=ggcey-baaaa-aaaao-bbsgq-cai) runs six EVM checks and calls a dedicated Qwen3.5-2B Q4_K_M backend for controller-requested interpretations. The checker is `ggcey-baaaa-aaaao-bbsgq-cai`. The model is `myit3-yyaaa-aaaap-qu75a-cai`. Open **demo → Query** to try the public mint pair.

The public checker reproduced 12 intended behaviors and returned no reproduction on 13 controls. The 25 cases were authored for these six specific rules. [Mainnet query results](mainnet-suite-results.json).

All 641 upload acknowledgements matched the expected prefix hash. The complete 1,280,835,840-byte GGUF matched SHA-256 `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` on mainnet. The backend loaded the model, and the checker called it twice. Both test runs retained their EVM evidence. The controller restriction rejected an anonymous request before inference. [Activation and billing records](mainnet-activation.json).

| Case | Ordinary mint | Observed balance | Qwen | Time | Both canisters, observed cycle delta |
|---|---|---|---|---:|---:|
| Open mint | Succeeded | 0 to 7 | yes | 102.3 s | 0.4351T |
| Protected mint | Reverted | 0 to 0 | no | 102.2 s | 0.4274T |

Initial funding debited 4.4741 ICP including the fee. The checker received a 1T creation allocation and the model received 7T. The mainnet model upload consumed an observed 3.0616T. Operational cycle deltas include the small amount of idle consumption during measurement windows.

Immediately after verification the model held 2.5116T with reported idle burn of 0.0762T per day. Its configured 30-day freezing threshold left approximately 0.2253T above reserve. Another interpretation like either measured test would need more headroom. The checker held 0.4943T and serves the six public checks independently. These are dated balances, not a live estimate of remaining capacity. No recurring refill was configured.
