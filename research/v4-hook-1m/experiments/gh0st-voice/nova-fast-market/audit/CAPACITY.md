# N0VA ten-swaps-per-second capacity analysis

Local analysis only. No RPC, signing or deployment.

The saved Robinhood snapshot at block 96658901, collected 2026-10-24T09:23:02.910Z, reports a 7,000,000 gas/second speed target and 32,000,000 block limit. This analysis does not refresh that snapshot. The speed parameter is a congestion/pricing target, not proof of a hard transaction rejection threshold.

The 44 historical one-word swaps average 14,333,315 gas (14,295,948–15,174,932). Ten swaps/second would demand 143,333,151 gas/second, 20.476 times the saved target, before other activity. The current user requirement is a complete neural sentence on every swap, which these historical one-word receipts do not measure. Staying within that entire target at ten/second requires 700,000 gas per full swap, a 95.12% reduction from the measured average. The all-network average budget corresponds to 0.488 swaps/second. These are budget ratios, not a mainnet throughput measurement.

## Historical baseline kernel arithmetic floor

The previous exact SIMD11 kernel computes 3,653 dot rows and 127,855 packed products per word. Counting only MUL(5), SHR(3) and AND(3), the current multiply/extract method already needs 1,406,405 gas. This excludes memory loads, sums, copies, activations, model validation, hidden-state storage, event data, token transfers and pool settlement. It is 2.009 times the entire 700,000-gas target. This bound is specific to that previous kernel. It does not apply to the new accumulated-product candidate and is not a proof that every equivalent algorithm or native implementation is impossible.

The new accumulated kernel has 39 packed multiplications per dot row, or 142,467 per word. At 5 gas per MUL, those instructions alone cost 712,335 gas per word, before every other opcode. This is a restricted bound on the present implementation, not a proof against all exact algorithms. A multiword sentence repeats that work.

The 2M callback reserve and 1.5M decoder cap must remain but are allowances, not automatically consumed gas, so neither is counted as a gas lower bound.

## Local workload design

Submit arrivals at virtual timestamps 0.0, 0.1, …, 9.9 seconds to one canonical recurrent state. Read each actual receipt's gas, status, sequence, text and hidden-state hash. Verify every successful trade advances exactly once, no failed trade advances, every block stays under 32M, and both buy/sell balances settle. A measured block-packing run may establish bursts of two or more; it must not be called sustained ten/second.

The accompanying JSON includes illustrative queues assuming a single idealized server processes exactly 7M gas/second with no background load or startup credit, using minimum/average/maximum measured costs. At the average cost, only 4 of 100 arrivals finish during the 10-second arrival window; last waiting time is 192.814 seconds. It also shows a 32M startup-credit token-budget illustration. Neither is the Nitro scheduler or a wall-clock benchmark.

## Security gate

Keep the exact learned weights and all pool/model/output checks, 2M reserve, bounded decoding, fail-closed rollback, router protections and LP lock. Removing these cannot recover the required order of magnitude. An honest outcome is the fastest tested exact implementation plus its measured gap to ten/second.
