# GH0ST Robinhood ↔ BNB bridge and payments

**Implementation; not yet deployed.** This extends the existing BNB access layer. It uses Chainlink CCIP 2.0 arbitrary messaging to carry bridge instructions between a Robinhood escrow and a BNB token contract. It is a custom bridge application over CCIP, not a listed or audited Chainlink token pool.

## Asset mechanics

- Original asset: `0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`, Robinhood chain 4663, symbol GH0ST, 18 decimals. Its current code hash and supply are checked by the preparation script.
- RH → BNB: `GH0STRobinhoodEscrow.bridge` transfers exact original GH0ST into escrow and sends a finalized CCIP message. The BNB contract mints the same amount to the chosen recipient only after a valid message from the fixed escrow peer.
- BNB → RH: `GH0STBridgedToken.bridge` burns the caller's BNB representation. A finalized message releases the same original amount from RH escrow.
- Paying for a thought transfers BNB GH0ST into the Access escrow. On delivery it becomes treasury withdrawal credit; on expiry it becomes the requester's withdrawal credit. Both operations preserve the GH0ST denomination.
- The original token supply is unchanged. BNB circulating supply is backed by locked originals, including outstanding cross-chain transfers. An administrator cannot directly mint the BNB token or withdraw the RH backing.

The original token's `owner()` call reverts. This design does not require changing that token or obtaining token-administration privileges for CCIP's token registry. CCIP transports application messages; GH0ST backing is held by the custom escrow.

## On-chain controls

Both contracts use the upstream CCIP receiver, pin their router, chain selectors, original token and owner, and allow the remote peer to be assigned exactly once. The receiver requires finalized messages and rejects the wrong source, peer, action, token, length, recipient, amount, duplicate message ID or duplicate source nonce. Outgoing transfers can be paused without blocking incoming redemptions. The operator can tune destination gas while paused, but cannot lower the finalized-message requirement.

The initial configuration caps a single transfer at 1 million GH0ST and BNB supply at the observed original supply. These are reviewable deployment parameters, not permission to transfer funds. The transfer cap is not a daily rate limit. Validate the final cap and operational monitoring before enabling public transfers.

Fee-on-transfer deposits and releases revert instead of creating undercollateralized balances. Direct token donations to escrow do not create mint entitlement. There is no administrative rescue of the backing asset. Never transfer GH0ST directly to escrow; use the bridge method.

## GH0ST payment integration

`GH0STAccess.bindPaymentToken` binds the verified BNB token once. Native quotes remain supported. GH0ST quotes use a separate EIP-712 `TokenQuote` which commits to the payment-token address as well as requester, Passport, prompt, token limit, amount, deadline and nonce.

The web interface requests an exact GH0ST allowance, then asks for a separate confirmation for payment. It never requests unlimited allowance. Token escrow/credits and native escrow/credits have separate accounting. `withdrawToken()` collects GH0ST; `withdraw()` collects native BNB.

Set these runtime fields only after binding the verified token:

```json
{
  "paymentToken": "CONFIRMED_BNB_GH0ST_ADDRESS",
  "paymentTokenDecimals": 18,
  "tokenPricing": {
    "baseUnits": "OPERATOR_PRICE_IN_RAW_GH0ST_UNITS",
    "inputByteUnits": "OPERATOR_PRICE_IN_RAW_GH0ST_UNITS",
    "outputTokenUnits": "OPERATOR_PRICE_IN_RAW_GH0ST_UNITS",
    "deliveryUnits": "OPERATOR_PRICE_IN_RAW_GH0ST_UNITS"
  }
}
```

Every value must be an explicit positive integer. The service does not invent a GH0ST/BNB conversion or use an easily manipulated spot price. The operator sets the token price and needs a native-gas/ICP-cycle buffer. GH0ST revenue is not automatically sold or bridged back.

## Deployment

Use the existing single operator wallet. All following scripts are **read-only transaction preparation**; they do not broadcast or handle private keys.

1. Review `bridge.config.example.json`, native token, router addresses, transfer cap and supply cap. Run `node scripts/bridge-preflight.mjs CONFIG` to confirm both CCIP lanes and native-token metadata/code.
2. Prepare `node scripts/prepare-bridge.mjs escrow CONFIG` on RH and `... token CONFIG` on BNB. Review and sign each transaction in the wallet.
3. Record the confirmed addresses, set `deployed=true` in the private bridge configuration, and rerun preflight. Verify deployed bytecode and immutables.
4. Prepare `bind-rh` and `bind-bnb`; review the two peer addresses carefully. They cannot be replaced after binding.
5. Prepare `activate-rh` and `activate-bnb` only after both peers verify correctly. Run a small bidirectional live canary and reconcile locked backing, issued supply and all CCIP receipts.
6. Add the confirmed Access contract as `access` in the bridge configuration. Prepare `bind-payment`. Configure measured, explicit GH0ST pricing in the service.
7. Publish the verified addresses in `website/bridge/config.json` and `website/agents/config.json`, then enable public access after the live tests pass.

For an offline wallet review of initial deployments, append `--calldata-only` to the `escrow` or `token` command. That mode validates the local configuration and emits constructor data but **skips live preflight and omits nonce/gas**. It is deliberately unavailable for peer binding or activation. Run the normal live preparation before signing.

[Validation report](BRIDGE-VALIDATION.md) distinguishes local tests, RPC observations and pending activation. Unsigned snapshots in `evidence/` are review artifacts; never reuse their nonce or fees without refreshing them.

For restricted environments, `GH0ST_RPC_CURL=1` selects the curl-backed **read-only** RPC transport. It rejects transaction-broadcast methods. Ordinary installations use ethers' standard transport.

## Fees, delivery and recovery

Bridging uses native ETH on Robinhood and native BNB on BNB for CCIP fees and network gas. GH0ST pays for application requests after arrival, not for the networks' native gas. Quotes have an explicit maximum fee; fee increases above it revert. Any native overpayment is credited to the sender and can be withdrawn separately.

A sent bridge message has **no unilateral source refund**: the destination may still execute. If destination execution fails, use CCIP retry/manual execution with the retained message ID. Do not mint manually or release collateral as a shortcut. The bridge interface distinguishes source submission from destination delivery.

## Verification and trust

The pinned routers and direct lanes come from the official [Robinhood CCIP directory](https://docs.chain.link/ccip/directory/mainnet/chain/robinhood-mainnet) and [BNB CCIP directory](https://docs.chain.link/ccip/directory/mainnet/chain/bsc-mainnet). `evidence/bridge-readiness-20261029.json` records the live router code hashes, supported lanes and original token metadata.

The MIT-licensed CCIP client/receiver files are vendored unchanged from `@chainlink/contracts-ccip@2.0.0`; `contracts/ccip/PROVENANCE.json` records each file hash and the ERC-165 import remapping. These files enforce the default committee verifier and finalized finality. This does not eliminate CCIP/router governance or custom-contract risks.

Local tests exercise supply conservation, round-trip redemptions, replay/forgery rejection, fee failures, failed-transfer rollback, pause behavior, native overpayments, token-denominated payments/refunds and a complete bridge → pay → redeem flow. The coordinator in the payment integration test is represented by a test signature; no new live inference or mainnet bridge transfer is claimed. Public activation still requires signed deployments, funding, an isolated live canary and independent review.
