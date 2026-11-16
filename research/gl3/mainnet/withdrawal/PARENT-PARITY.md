# Actual Nitro-parent follow-up

**Plan only.** The adapted Ganache-parent result must not be labelled a test of actual Robinhood/ArbOS-parent semantics.

The earlier three-layer test exercised a genuine Nitro parent with GHMOCK. The new withdrawal fixture exercises the real GH0ST contract state in a private fork with a genuine native Nitro child. An additional test can join the parent implementation and token bytecode, but must expose any synthetic state setup.

1. Pin a Robinhood block, state root and the GH0ST account code hash. Capture the exact token storage slots touched by the tested transfer/approval/deposit/withdrawal sequence.
2. Obtain EIP-1186 account and storage proofs for every initial slot and cryptographically verify them against the pinned state root. Prove absent slots as absent, rather than assuming they are zero.
3. Initialize a private, actual Nitro parent with the exact token runtime and the authenticated relevant storage values. Preserve metadata, supply, ownership and configuration fields. Do not install synthetic ArbSys/ArbGasInfo code or clear their native implementations.
4. An ephemeral test holder would need an explicit test-only token allocation, since the real public holder's private key is neither available nor requested. Record that balance mutation separately. This creates a scoped fixture, not a clone of the entire live token ledger.
5. Trace initial reads and writes during the native-parent sequence. Fail if a storage dependency is not covered by the authenticated snapshot or an explicit recorded test mutation. Verify all actor/receiver/escrow deltas and supply effects.
6. Repeat the real child credit/spend/burn, actual rollup confirmation and proof withdrawal. Check actual ArbOS parent block numbering and the Arbitrum-specific constructor branch, plus invalid and repeated withdrawals.

This would provide stronger parent/token parity evidence for the tested operations. A partial authenticated snapshot still cannot prove every live account, future administrative change, token branch or production finality behavior. Public mainnet execution and custody remain separate reviewed steps.
