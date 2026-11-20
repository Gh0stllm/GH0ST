# GH0ST Cross-Examine

A GL3 application that rewards a reproducible counterexample and makes it a permanent test for model upgrades.

The public demo uses a synthetic grant application with fixed quality and completion values. Its operator claims that wallet age does not affect the verdict. Model 1 scores the 365-day wallet at **102, Approved**. Changing only its age to seven days scores **90, Rejected**. The approval threshold is 100.

1. A sponsor deploys the Solidity contract with a native GH0ST reward in escrow.
2. A challenger commits a hash, then reveals the edited age in a later GL3 block. A valid counterexample earns reward credit. It also records the age and the baseline approval as the required regression case.
3. The winner withdraws the exact reward. The contract clears the credit before transferring native GH0ST.
4. The curator submits candidate model parameters. A candidate that repeats the failure emits `ModelUpgradeBlocked` and leaves the prior model active. A candidate that approves both inputs can take over the policy. The saved case applies to every future candidate.

This first version accepts one funded counterexample. The commitment is scoped to the chain, contract, claim and challenger. Both the original and the edited input use the same pinned model version. Scores, upgrade checks and payment all execute in Solidity. The demo requires ordinary transactions to the existing GL3 RPC, with no chain upgrade.

Production receipts will be recorded here after the deployment review is signed and the transactions are confirmed on both public GL3 RPCs.
