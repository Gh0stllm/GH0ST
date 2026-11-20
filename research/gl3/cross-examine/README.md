# GH0ST Cross-Examine

A GL3 application that rewards a reproducible counterexample and makes it a permanent test for model upgrades.

The public demo uses a synthetic grant application with fixed quality and completion values. Its operator claims that wallet age does not affect the verdict. Model 1 scores the 365-day wallet at **102, Approved**. Changing only its age to seven days scores **90, Rejected**. The approval threshold is 100.

1. A sponsor deploys the Solidity contract with a native GH0ST reward in escrow.
2. A challenger commits a hash, then reveals the edited age in a later GL3 block. A valid counterexample earns reward credit. It also records the age and the baseline approval as the required regression case.
3. The winner withdraws the exact reward. The contract clears the credit before transferring native GH0ST.
4. The curator submits candidate model parameters. A candidate that repeats the failure emits `ModelUpgradeBlocked` and leaves the prior model active. A candidate that approves both inputs can take over the policy. The saved case applies to every future candidate.

This first version accepts one funded counterexample. The commitment is scoped to the chain, contract, claim and challenger. Both the original and the edited input use the same pinned model version. Scores, upgrade checks and payment all execute in Solidity. The demo requires ordinary transactions to the existing GL3 RPC, with no chain upgrade.

## Verified local demo

The test ran on a fresh Anvil chain with distinct synthetic sponsor, challenger and payout wallets. The challenger received an exact 1-unit increase in the recipient balance. The failing candidate left version 1 active. A corrected candidate approved both inputs, activated version 2, and preserved the regression for the next candidate. [Local receipts and test cases](./local-evidence.json)

Run `npm install` and `npm run build` with Node.js. Run `npm test` with Foundry's Anvil on your path, or set `ANVIL_BIN` to its executable. The build uses Solidity 0.8.30, Paris EVM output and 200 optimizer runs.

## GL3 demo

The five reviewed transactions deploy and fund a 1 GH0ST prize, commit the challenge, record the verdict flip, pay the reward and record the rejected upgrade. The project wallet sponsors and receives the demonstration reward. The release reads both public RPCs, validates the exact signed transaction sequence and verifies each receipt before advancing. The final proof checks the escrow's balance decrease and that version 1 stayed active.

Mainnet activation awaits the wallet signature. Deployment runs through the existing GL3 RPCs using standard Solidity.
