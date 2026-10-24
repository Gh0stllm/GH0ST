# N0VA local candidate security review

Scope: source review of `NovaToken`, `NovaLiquidityVault`, `NovaSwapRouter`, and
`NovaPoolHook` on 2026-10-24, with the completed local integration report checked
against the reviewed source hashes. This is an internal engineering review, not
an independent audit or approval to deploy. No public-chain transaction was
submitted as part of this review.

## Result

No unresolved direct token-mint, privileged withdrawal, arbitrary-call, or
third-party fund-redirection path was found in the reviewed source. The principal
remaining risk is deliberate: an inference failure prevents trading through the
bound pool, including selling. The user explicitly selected **require a word;
revert the trade if AI fails**. There is no administrator, bypass, emergency
withdrawal, or upgrade path to change that policy after deployment.

## Corrected issues

- The new hook removes caller-provided expected sequence/state hashes. Every
  swap reads canonical storage; empty or unrelated hook data does not create an
  avoidable stale-context revert.
- The hook authorizes only the configured PoolManager and exact pool ID,
  including native ETH, N0VA, fee, tick spacing, and its own address. Only the
  configured vault can initialize it, at the pinned initial price.
- Model identity is checked against explicit expected model and runtime-code
  hashes. The inference call is static and gas bounded. Return copying is capped
  before allocating the result; decoding occurs in a bounded self-call.
- The decoder rejects invalid token/punctuation IDs, noncanonical ABI, empty or
  oversized text, hidden values outside [-1024, 1024], logits outside int32,
  inconsistent terminal flags, and text inconsistent with the model's token and
  punctuation. Vocabulary lookup has an independent gas and return-size cap.
- Model errors happen before context writes. EVM transaction rollback also
  restores pool balances, token balances, neural state, sequence, and events if
  settlement, slippage checks, or later router logic fails.
- Native settlement explicitly clears a previously synced ERC20 currency by
  syncing address zero. This avoids a same-transaction composability denial of
  service when another caller previously synced a token.
- Vault-to-hook binding checks run before funding is committed or the pool is
  initialized. They are intentionally delayed until launch: the vault creates
  N0VA first, then the predetermined hook is deployed against that token address.
- The router constructor independently checks its manager, N0VA, fee, spacing,
  and complete pool ID against the already deployed hook. A mismatched routing
  configuration cannot be deployed successfully.

## Reviewed custody and callback boundaries

- N0VA inherits the pinned OpenZeppelin 5.0.2 ERC20 implementation. Exactly
  1,000,000 tokens are minted to the vault in its construction; no external mint,
  burn, owner, tax, blacklist, pause, or upgrade method is added.
- The vault adds only its fixed positive liquidity amount at its fixed ticks and
  verifies the exact resulting debts. It consumes callback authorization before
  making external calls. Its permanent position has no remove-liquidity,
  fee-collection, approval, transfer, generic-call, or rescue method.
- The router accepts exact input, requires positive minimum output and a live
  deadline, checks the full input was consumed, and rejects partial fills. A
  callback requires the immutable PoolManager and an active nonreentrant trade.
  Outputs go to the caller recorded by the router, not an arbitrary callback
  recipient. A receiving contract cannot reenter `buy` or `sell` while paid.
- Direct PoolManager use is possible for other routers. v4 accounts their
  currency deltas per caller and requires settlement before the unlock ends.
  The custom router is a convenience and execution guard, not exclusive access
  to the public pool.

## Remaining limitations that must remain visible

1. **Selling depends on successful inference.** A model fault, unexpectedly
   expensive execution, future gas repricing, or inadequate transaction gas can
   block sells. Immutability prevents an operator from repairing or bypassing
   the hook in place. This is the accepted fail-closed policy, not a solved risk.
2. **The 32M budget requires transaction-level evidence.** A 26M model-call cap
   and callback reserve do not prove arbitrary third-party routers or batches
   stay under 32M. Measure the complete buy and sell transactions; keep a margin.
3. **The LP lock is permanent, including fees and dust.** No administrator can
   recover accidental transfers or change the price range. At a range boundary,
   this position stops providing active liquidity. The router rejects partial
   fills instead of silently accepting a smaller trade.
4. **A fixed $25,000 starting valuation is a scenario, not dollar backing.** It
   uses the explicit ETH/USD input and marginal starting pool price. External
   holders initially own no N0VA, but the first buyer can immediately become a
   seller. Later buys add ETH; fixed supply and the lock do not promise a price.
5. **Only the bound pool invokes this model.** The standard unrestricted ERC20
   permits transfers and third-party pools, which do not automatically invoke
   this hook. No transfer restrictions were added to prevent that.
6. **Inference is public and influenceable.** A deterministic seed, sequence,
   and market features are not secure randomness. Traders can influence the
   sequence by trading. The model is a public text generator, not a price oracle
   or authorization mechanism.
7. **Deployment configuration remains security-critical.** Before a future
   deployment, verify the actual PoolManager, all model/data hashes, constructor
   values, hook permission bits, vault bindings, and router bindings. Constructor
   and launch-time binding checks reject mismatches but do not establish that the
   chosen external PoolManager and model are authentic. The local-only chain-ID
   guards remain in this candidate.

## Completed local test evidence

The final `integration-results.json` reports **PASS**: 32 primary real-model buys
and sells completed, with a maximum complete-swap cost of **23,581,932 gas** under
the 32,000,000 limit. Additional pending-order, recipient-reentrancy and token-sync
checks brought the real-model sequence to **37 successful words**. All 64
integration checks passed. Model code/data hashes,
real pool prices/outputs against independent AMM math, permanent LP ownership,
initial ownership, exact pool/initializer restrictions, atomic rollback,
pending orders without stale state, and native payout reentrancy were checked.
All 15 deliberately bad mock-model modes blocked both buys and sells atomically;
returning the fixture to its valid mode restored trading. The prior-token-sync
regression also passed.

This is a bounded local scenario, not exhaustive fuzzing or proof against future
protocol changes. Numerical neural parity is reported separately from these
transaction and custody checks; the AMM-math check does not establish model-math
parity.

## Reviewed source digests

| Source | SHA-256 |
| --- | --- |
| NovaToken.sol | `2b64b05d2460e54936246476c5db91846aff126bf3be0b2c9a10631662a8dd0e` |
| NovaLiquidityVault.sol | `cec732f107e05135d8c4f77a314c21d28a760c90a2e040db69b8c7a88ab2e6e8` |
| NovaSwapRouter.sol | `0b24a21feefddbf1ccecaee4e9f04d45b00af16693d1fc3f0a104d6320da8f5c` |
| NovaPoolHook.sol | `a5f45772b791a2cb93a069811f2b7944e18bf78a854cae524346ab1134ef44f7` |

The hook and adversarial mock compile with Solidity 0.8.30, optimizer 200,
via-IR, Cancun. The hook runtime is 9,618 bytes. All 51,220 saved logits from 260
earlier accepted-model swap records fit the new int32 guard (observed range
-16,614 to 8,645); that historical check does not replace fresh hook integration
tests. `NovaHookMockModel` is a mutable test fixture and must never be selected as
the production model.
