# Trained V8 local result: execution passes, language fails

The trained two-layer H384 model completed **256 primary and 4 secondary actual local Uniswap v4 swaps**, plus 3 direct boundary probes. Each primary swap emitted one newly sampled word with its learned punctuation. The independent scalar Q10 reference matched every word/punctuation choice, all 768 recurrent state values and all 197 evaluated logits. State continued across 20 naturally emitted terminal words.

**Language quality: FAIL, not approved.** The complete unedited 256-word output is in [actual-transcript.txt](actual-transcript.txt). It contains broken grammar, repeated phrases and weak continuity. Passing execution, gas and arithmetic checks does not establish a coherent first-person model or a release candidate.

| Measurement | Result |
| --- | ---: |
| Source model parameters | 8,175,493 |
| Whole primary swap gas, minimum | 22,845,892 |
| Whole primary swap gas, maximum | 23,712,321 |
| Whole primary swap gas, mean | 22,861,459.61 |
| Maximum headroom under 32M | 8,287,679 |
| Secondary swap maximum | 23,712,321 |
| Direct boundary-model maximum | 21,144,613 |
| Model constructor after injected data | 13,121,298 |

Run: unforked local chain 31337, Cancun, 32M transaction/block limits; seed 42; temperature 512/1024. No public transactions, runtime grammar masks, forced punctuation or off-chain token selection were used. There were no clipped export weights.

All recorded guard checks passed: data-code commitments, input-only UNK rejection, hidden/feature/punctuation/temperature bounds, initial state, malformed/stale/forged input, low-gas rollback, post-inference rollback, changed-model rollback, unauthorized callback, monotonic sample index, sequence-overflow rollback, feature clamping, multiple callers, independent pools and complete swap settlement. The full check map and gas values remain in [trained-summary.json](trained-summary.json).

## Storage and deployment limitation

The runtime references **66,319,680 static data bytes across 2,766 shards** (24,000 payload bytes per full shard), plus code catalogs. These runtimes were installed with `hardhat_setCode`; they were not deployed through transactions. Thus these are local inference/constructor measurements, **not a measured public deployment cost or proof that publishing this data footprint is practical**. Original trained parameters and derived fused/packed runtime data are distinct quantities.

## Evidence bindings

- Source checkpoint SHA256: `904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3`
- Export manifest SHA256: `20cf84ea9f4406d61e6f143c3c28b477e9ec3f829b96e1fd9ae0569a2437c54a`
- Model source SHA256: `51362f0f199407cdb15c48bbfca4ae06795154e0db554279e6ef41a8433bad94`
- Hook source SHA256: `a1b789e8ca4374690a483a8e9f86bfa81894103f32b952f3345c8983b426d64a`
- Model runtime Keccak256: `0xf229772efea19a05d854d0034fc03967c5cfbef2eef199b5a63d287fae08a405`
- Local raw report SHA256: `47c395437f9f65958cc5d8a4274451881d645634274fd5bb7e31a82be14c4280`
- Independent scalar report SHA256: `b484184eb16c9682b6959978340672321292ed174ba62f224a9c53866f4893f0`
- Full transcript SHA256: `5ebe8093588691406c98982af7b21c04c4e28a438ea8ce12a9e0aeae7d979286`

Raw evidence: [local report](grammar4m-final256-local.json), [scalar reference report](grammar4m-final256-reference.json), [export manifest](../exports/grammar4m/manifest.json). This summary was prepared from existing frozen outputs; no test or GPU workload was rerun.
