# GH0ST Shrink

First experiment: specialize the first neural mask layer of the [deployed 100-animal renderer](../gl3/pfp/noun-sprite/deployment-verified.json). The reference contract is `0x00C2dC9E8402f14616C14b4d046362CAdE1914B7` on Robinhood Chain (4663).

Compare the original and candidate at the same address, block, inputs and compiler settings using read-only calls. Verify the arithmetic identity across the full reachable layer input domain, compare complete 48 × 48 RGBA outputs and report end-to-end transaction gas estimates. Record proposal provenance separately from proof and measurements. This branch starts an experiment. No production contracts or routing have been changed.
