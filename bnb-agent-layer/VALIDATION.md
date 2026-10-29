# Validation — 29 October 2026

**17 tests passed, 0 failed.** This is a locally tested implementation, not an activated BNB deployment.

## Executed

- Solidity 0.8.30, optimizer 200, via-IR, Paris EVM. Access runtime: 9,546 bytes. Passport runtime: 6,182 bytes. Both are below the standard EIP-170 limit.
- Eleven EVM tests cover passport ownership and transfer restrictions, upstream-ID transfer, quote/payment/prompt binding, response signatures, replay protection, deadlines, refunds, reward solvency/caps, pause behavior and bounds.
- The local two-chain integration uses the **unchanged existing RH gateway source**, a BNB Access deployment and a mock coordinator that signs with a test key. It completes BNB payment → RH request → signed result → RH settlement → BNB settlement. Exactly two RH relay transactions and one BNB callback are emitted. A restart after signing does not create another request.
- The worker holds ambiguous ICP updates without replaying them. Expired work can abort only its own idle origin job; it cannot abort an unrelated prompt or an in-flight job.
- The HTTP smoke test checks the page, AI guide, SVG, invalid request handling, traversal rejection and refusal to issue quotes while undeployed.
- Browser inspection confirmed the GH0ST navigation link, rendered Passport/request/history page, prompt byte counter, explanatory controls and disabled deployment-dependent actions.
- `git diff --check` and Node syntax checks passed.

## Read-only mainnet observations

[Live reads](evidence/live-readiness-20261029.json) confirm BNB chain 56, RH chain 4663 and the existing GH0ST gateway's signer, model ID, artifact hash and owner. The candidate upstream identity contract returns `SPACE ID Agent ID`, advertises ERC-721 and has its observed bytecode hash recorded. This is not an endorsement or proof of personhood.

[The unsigned Passport deployment](evidence/passport-unsigned-20261029.json) records an estimate of 1,466,107 gas and 0.00007330535 BNB at the observed gas price. The observed operator balance was below this first deployment estimate. These are snapshots; recompute nonce, fee and balance before signing. The Access contract, service operation, reward funding and registration require separate transactions and budgets.

## Not performed

- No BNB mainnet deployment, token mint/migration, reward funding or paid user request.
- No mutation, upgrade or replacement of the existing GH0ST RH contracts, ICP model, coordinator, worker permissions or running server.
- No production service activation, ERC-8004 registration or public website deployment.
- No new mainnet model-quality evaluation, economic stress test or independent audit. The mock coordinator proves transport and settlement behavior, not model fluency or live ICP execution.

Activation requires a funded operator wallet, the existing private worker identity on its server, scoped relay/quote credentials, an isolated live route test and verified site/service configuration. The checked-in configuration remains explicitly inactive.
