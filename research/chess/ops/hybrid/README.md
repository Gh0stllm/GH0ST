# Hybrid launch review

The full engine, coordinator and disabled relay are installed on the same certified13-node ICP application subnet. The native Robinhood game is deployed and paused; its actual runtime, owner, signer and fixed terms are verified. Creation converted13ICP and paid0.0003ICP ledger fees; RH deployment cost0.000064114367868ETH. No GH0ST prize or pilot entry has been funded. See [mainnet progress](mainnet-progress.json).

**Current hard cap:100ICP total, including the13 already converted and paid fees.** The1,250ICP proposal was rejected. ETH remains capped at0.003 total; actual relay lifetime authority is0.0025ETH. Token limits remain1M prize plus25k pilot. No automatic top-ups. [100ICP feasibility and tested optimizations](BUDGET_100.md).

## Fixed terms

25,000 GH0ST entry; 1,000,000 GH0ST total legal-checkmate payout. Human plays White. One retained game at a time. A human win automatically pauses new entries until explicit owner reopening after review. Draw/loss/resignation/player timeout retains entry; bot timeout refunds entry. Full prize reserve exists before accepting a fee. Funding is manual.

## Source and custody

- Robinhood chain 4663; canonical GH0ST `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`, runtime hash checked by read-only preflight.
- Candidate pool owner/funding wallet: `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`. This is the existing project wallet; no signature or transfer has been requested yet.
- New game contract, three dedicated ICP canisters (coordinator, retained Stockfish engine and autonomous bot relay). Existing Watcher/Qwen/Memory/Forge services and balances are not repurposed.
- Candidate ICP controller: existing `gh0st-deployer`, principal `uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe`. Browser must pin the final certified controller sets and module hashes.
- ICP canister-specific threshold key `key_1`, derivation path `GH0ST_HYBRID_CHESS_V1`. Its public signer is derived after creating the coordinator, then used in the immutable RH constructor. It is not the deployment wallet key.
- Coordinator starts unreviewed/unbound. One-time controller sealing must verify the paused RH deployment, runtime, canonical token, engine policy, threshold signer and engine reserves before any brain admission. No policy/key/engine mutation endpoint.

Controller upgrades remain a disclosed trust boundary. The engine faults an active retained game after upgrade; it never silently rebuilds that game's cache. RH can refund a missed bot deadline independently of ICP.

## Cost evidence and approved initial caps

`prepare-deploy.mjs` accepts verified real ICP bindings and prepares an unsigned, capped Robinhood deployment transaction for review. It never signs or broadcasts.

`preflight.mjs` only reads RH chain identity, token identity, wallet balances, current gas and constructor estimate. The constructor signer/config are explicit nonzero **pricing stand-ins** until actual ICP derivation. Refresh the exact real constructor estimate before broadcast.

`costs.mjs` combines the actual optimized 24m engine/coordinator debit with the separately tested autonomous relay. At the saved certified rate, the representative turn is about **0.636 ICP**; a 40-bot-decision scenario is about **25.44 ICP** plus deployment, idle hosting/reserves, RH gas and position/retry variation. This is not a measured full-game or mainnet bill.

The same-strength paired engine/coordinator test reduced cycles by 21.32% and engine updates from 240 to 35. The full model, 24m nodes, Hash128 and retained state remain unchanged. Exact native comparisons, arithmetic checks and source review support equivalence; mainnet timing still needs the paid pilot.

The [pre-approval optimized release plan](optimized-release-plan.json) records exact module hashes, verification scopes, measured costs and activation gates. The [published preview proof](site-preview.json) records the preserved site manifest and deployment.

The latest user-approved limits are:

- Up to **100 ICP** converted for dedicated canister creation, uploads, installation and operating cycles; no automatic top-ups. Funding a balance does not mean all cycles are immediately spent.
- Up to **0.003 ETH** for deployment, exact token approvals, manual prize funding, one bounded pilot and entry activation. This includes a 0.0025 ETH reserve for the dedicated autonomous relay; unused gas remains in that canister-controlled wallet.
- **1,000,000 GH0ST** placed in prize escrow, plus at most **25,000 GH0ST** for the project's pilot entry. Pilot proceeds after one genuine full-budget Black reply, then the original wallet resigns; entry remains in the project-owned pool. A real human checkmate is not fabricated for a public pilot.

The deployment account started with15.13196820ICP. After three reconciled creations it holds2.13166820ICP;13ICP was converted and0.0003ICP paid in fees. This is within the14.5ICP paused-pilot allocation and the new100ICP overall hard cap. No existing service balance was used. The ICP funding account is `44b41592844fd20127283d0ac8382ae5df0f9536f944e4519fdc19bebbc695fe`.

The requested20fullgames do not yet fit the verified100ICP budget. Five additional exact engine variants produced only a1.97% best partial-prefix saving; none was promoted. Exact retained-state reuse is being tested, with cache hits dependent on repeated histories. The [older twenty-game allocation proposal](TWENTY_GAMES.md) is superseded, not a spending instruction. Search on a hosted CPU is an explicit alternative requiring the user's architecture choice and separate hosting approval; it is not deployed.

## Deployment sequence after approval

1. Freeze exact source, final engine/coordinator raw and compressed hashes, source pins, local tests and complete native match records. Archive incomplete games explicitly.
2. Reconcile approved balances/fees and create three dedicated canisters with explicit controller sets. Journal every ledger/cycles operation; an uncertain conversion/transfer is reconciled before another intent.
3. Install the coordinator unbound, derive threshold public signer, install the large engine through verified chunk upload, and bind the retained 24m policy hash.
4. Deploy the native RH game with canonical token, reviewed owner, derived signer and exact policy hash. Verify receipt, constructor and complete runtime including immutables.
5. Seal the coordinator once against the actual paused deployment; verify certified hashes/controllers and exact signing address.
6. Fund the exact 1M reserve manually using a bounded approval, derive/fund the dedicated relay gas wallet, verify browser-independent bot progress, run the approved real pilot, reconcile native moves/transfers, and verify independent timeout path remains callable. Keep new entry paused on any inconsistency.
7. Publish the receipt-backed config into the existing full Netlify manifest. Check all prior routes/functions/security rules. Open entries only after dependencies, cycles and full reserve verify.

Canister installation and the paused native-game deployment are established by linked mainnet records. Prize funding, fresh mainnet inference, payout and public game completion still require their own receipts.
