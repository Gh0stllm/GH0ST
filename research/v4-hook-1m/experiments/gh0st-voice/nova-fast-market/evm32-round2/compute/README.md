# Further exact Solidity compute optimization

Selected source: `signed-combined-initial.sol`, SHA-256 `71c9919762e24881912ac3ea18e9bfe612f92a8c7fcd3d12f71738d00176f06c`.

This keeps the same 8,175,493 parameters, exact Q10 values, all input guards, neural sampling, and complete checked return values. It combines the sibling profile work's exact signed packing and aligned core shards with feature reuse, reusable head shard memory, unrolled head packing, and a strictly checked initial zero-state shortcut. Use the sibling `../profile/signed` export, not the previous unsigned data encoding.

All 18 complete batch returns matched the baseline byte for byte: zero, extreme, mixed, continuing, first-layer-only-zero and second-layer-only-zero states at one, two, and three word caps. Eleven invalid-input categories also matched reverts. The report compares every hidden state and every score as well as the displayed words. The selected source is 13,799 runtime bytes and 16,216 initcode bytes under the tested Solidity 0.8.30 optimizer settings.

| Direct local model call | Previous gas | Candidate gas |
| --- | ---: | ---: |
| Continuing three-word batch | 25,247,142 | 23,174,767 |
| Initial zero-state three-word batch | 25,110,841 | 19,253,498 |

These are direct-model transactions in a local 32M-gas environment. The initial-state result benefits from recurrent products that are mathematically zero and is not representative of continuing traffic. PoolManager, hook, token transfers, persistent storage and settlement must be measured separately. Nothing was deployed or sent to a public chain.

From this folder, regenerate with `python3 build.py` and `python3 build-signed.py` after preparing the sibling signed export. Run `node benchmark.mjs signed-combined-initial.sol --data=../profile/signed` from the research project environment. `RESULTS.json`, the detailed `signed-combined-initial-results.json`, and `NUMERIC-AND-MEMORY-PROOF.md` document the result.

Earlier source candidates remain for reproduction of the search. The selected file and report above are the tested combination; individual component reports are not interchangeable with complete-swap gas figures.
