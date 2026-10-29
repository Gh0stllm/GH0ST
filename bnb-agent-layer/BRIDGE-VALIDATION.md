# Bridge validation — 29 October 2026

**36 tests passed; 0 failed, skipped or cancelled.** No live bridge or payment deployment is claimed.

## Measured checks

- `npm run compile`: Solidity 0.8.30, optimizer 200, via-IR, Paris EVM. Runtime sizes: Access 12,052 bytes; BNB GH0ST 8,776; RH escrow 6,301; Passport 6,182. All below the 24,576-byte EIP-170 limit.
- `npm test`: 36 tests in 102.63 seconds. [Complete output](evidence/bridge-tests-20261029.txt).
- Eleven bridge tests: identical-address peers on different chains, lock/mint/transfer/burn/release, source and router authentication, message-ID and nonce replay rejection, malformed payload rejection, fee/send rollback, independent reordered delivery, one-time peer binding, absence of administrative mint, pause/receive behavior, native fee credits, taxed deposit rejection and bridge → pay → redeem.
- Seven token payment tests: one-time asset binding, exact token escrow, signed denomination, refund denomination, taxed transfer rejection, separate native/token accounting and preservation of withdrawal credit when a token develops a transfer tax.
- The 17 previous native payment, relay and HTTP checks still pass. One additional backend quote test checks explicit GH0ST pricing and signed token identity.
- The end-to-end payment test uses a real instance of the new BNB token and a **test-signed model result**. It does not prove live ICP execution or model quality.
- Node syntax checks and `git diff --check` pass. Vendored CCIP hashes match `contracts/ccip/PROVENANCE.json`.
- Browser inspection confirms both transfer directions, pending-deployment controls, the bridge navigation link and the GH0ST payment option disabled until configured. No wallet was connected and no transaction was submitted.

## Read-only mainnet observations

[Preflight evidence](evidence/bridge-readiness-20261029.json) checks both network IDs, deployed CCIP routers, supported opposite-chain lanes, and original GH0ST metadata/code hash. These are observations at the recorded time, not future availability guarantees.

[Unsigned BNB deployment](evidence/bridge-bnb-unsigned-20261029.json): 2,116,013 gas estimated, with a 20% gas-limit cushion of 2,539,216. At the observed 0.05 gwei gas price the maximum transaction cost is 0.0001269608 BNB. Observed operator balance: 0.000003170999999999 BNB, insufficient. This excludes Passport, Access, peer binding, activation, service operations and user transfers. Refresh nonce, fees and balances before signing.

[Unsigned RH deployment](evidence/bridge-rh-unsigned-20261029.json): 1,507,695 gas estimated; maximum transaction cost 0.000036289615572 ETH with the gas cushion at the observed gas price. The observed RH balance was sufficient for this estimate. No funds were used.

[BNB calldata](evidence/bridge-bnb-calldata-20261029.json) and [RH calldata](evidence/bridge-rh-calldata-20261029.json) were checked against the final compiled creation bytecode and constructor parameters. Preparation rejects a zero owner, invalid caps and wrong chain IDs.

Calldata-only artifacts omit nonce and gas on purpose. They are not ready-to-broadcast signed transactions. The standard preparation command performs live preflight and estimates current fees.

## Activation not performed

Both bridge directions are initially paused. No original GH0ST was locked, no BNB GH0ST was minted, no mainnet inference payment was sent, and no production website/service was changed. Deployments, irreversible peer binding, live canaries and operational token pricing remain pending. This custom bridge application has not had an independent audit. Follow [BRIDGE.md](BRIDGE.md) before public activation.
