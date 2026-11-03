# GH0ST Watch dedicated ICP deployment

3 November 2026. Checker `ggcey-baaaa-aaaao-bbsgq-cai`, Qwen backend `myit3-yyaaa-aaaap-qu75a-cai`.

The dedicated checker completed all 25 public query cases on ICP. It reproduced the 12 intended positive examples and returned no reproduction on the 13 controls. [Recorded observations](mainnet-suite-results.json).

The deployer initially allocated 1T cycles to the checker and 7T to the backend. The backend has the pinned llama_cpp_canister Wasm installed, matching SHA-256 `964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5`. The deployer and dedicated checker control this new backend. The Qwen3.5-2B Q4_K_M file upload has started. End-to-end activation requires verification of the complete weight hash, successful loading and inference through the checker.
