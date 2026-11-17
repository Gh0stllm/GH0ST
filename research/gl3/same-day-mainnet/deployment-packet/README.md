# GL3 — standard Nitro launch proposal

This packet prepares **GL3 4663001 on Robinhood 4663**, with native $GH0ST gas. Launch uses official Nitro 3.12.2 and its standard `c10cd7…9dc97` machine, project-operated validators and operator-trusted fast confirmation. **ZK verification is not active at launch.** Chess and LLM proof research are preserved separately.

**Current candidate: [isolated-deployer/](isolated-deployer/).** The flat zero-owner proposal was rejected for native gas usability; the cold30-action candidate was superseded after unrelated cold nonce activity. Both remain preserved. The current plan separates a bounded deployment signer from cold administration.

Nothing here signs transactions, accepts a license, funds a wallet or activates public services. `production-profile.json` is a concrete proposal with approval flags false. The parent funding/owner wallet stays off the server.

## Reviewable parameters

| Setting | Proposal |
|---|---|
| Parent / child | Robinhood 4663 / GL3 4663001 |
| Native token / stake token | GH0ST `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559` |
| Parent owner, factory owner, poster manager, pricer owner | `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6` cold custody |
| Child initial owner / allocations | Temporary cold owner / empty; configure fees then final owner `[0]` |
| Isolated deployment signer | `0x1E0a95665dc872899eb89018455ef44B27108FCd`; no project administrative authority |
| Validator | `0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad` |
| Batch poster | `0x52cc715ef517CE1933142d2168B43F8fdc54b7c5` |
| Fast confirmer | `0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad`; operator authority |
| Normal exit | No fixed withdrawal wait after operator confirmation; processing and RH fees remain |
| Standard fallback confirmation / grace | 50,400 / 14,400 parent EVM `NUMBER` blocks (nominal 7d / 2d); bypassed by fast authority |
| Base / mini stakes | 100,000 / [50,000,25,000,12,500] GH0ST |
| One full challenge path | 187,500 GH0ST; additional assertions/rivals may require more |
| Manual fee conversion | 60,000,000 GH0ST per ETH, scaled 1e18; approval pending |
| Operating reserves | 0.01 ETH poster + 0.005 ETH validator; no automatic topups |
| Minimum assertion age / assertion polling | 0 parent blocks / 5s posting, 1s scan and confirmation; no artificial minimum gap |
| Child block spacing / posting deadline | 100ms minimum / 10s max batch delay; settings, not finality promises |

**Fast confirmation is operator-trusted.** The delegated fast key can bypass deadline, previous-assertion and challenge checks and can authorize an incorrect withdrawal root. This is not ZK or permissionless optimistic protection. The standard SDK process accepts actual locally derived execution state and a genuine history commitment, but the contract trusts this key. Operator availability is required; no instant-exit guarantee is made.

Low token collateral is not insurance for bridge TVL. This initial security model depends on the allowed project validators, their availability and the cold parent upgrade authority. The protocol can remove the allowlist after configured validator inactivity. Parent proxy upgrades remain powerful even though the child has no reachable native-mint administrator.

The zero child owner intentionally removes normal child fee, mint and ArbOS administration. Genesis has no allocated native balances, native supply management is disabled and no imported owner is allowed. It does not remove parent proxy upgrade authority.

## Deterministic genesis

The current [cold-owner genesis](isolated-deployer/genesis.proposed.json) has SHA256 `2b199bb88d307aac0f25bffb26154ec1a02b43541f7f0d1bf551b9980983c8dc`. The canonical helper actually produced block0 `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483`, state root `0x89c6557ad0c228cefb1769cf4107e7f0e39991620c995d0fe101238b0a71b842`, cursor `[1,0]`, and no allocations. Fixed data-cost calibration is `1448348398190243`; `createRollup` carries the identical configuration/calibration.

Genesis initially uses the standard minimum/current base fee. After a real 100 GH0ST escrow deposit to the cold child account, seven locally signed administrative calls set minimum/current fees to `1e13` native base units, set network/infra/reward treasury recipients, add zero owner, then remove the cold owner. Final reachable chain administration and native mint authorities are absent. The [fee policy](isolated-deployer/fee-policy.json) specifies the required real-header barriers and conservative full-gas floor; an ordinary estimate alone was unsafe during the transition. The first zero-owner genesis is retained only as a rejected usability candidate.

The fresh read-only market observation is a spot reference, not a trade quote or production oracle. The manual price owner can change the rate; no freshness or market bound is enforced by that small contract. Proposed alerts at 24h age or 10% spot drift require an operator and do not change price automatically.

## Transactions and signing

[The isolated plan](isolated-deployer/plan-isolated-deployer.json) contains 26 constructor calls and one `createRollup`, signed by the isolated deployer at nonces 0–26. [The separate sponsor plan](isolated-deployer/sponsor-plan.json) contains four cold-wallet funding actions: 0.005 ETH deployment reserve, 0.01 ETH poster reserve, 0.005 ETH validator reserve, and100,000GH0ST collateral. Deployment max gas fee is bounded below 0.005 ETH; that expense is inside the sponsored reserve, not an additional cold debit. It verifies pinned compiled artifacts and the genuine CREATE2 proxy and uses a fresh project namespace. Unknown mutable factories are never accepted through a runtime-only comparison. Public RPC is read-only; no signer or send method is present.

The public role addresses and cold authorities are bound in the unsigned call. `ADMIN_ROLE` belongs to the deployed UpgradeExecutor itself; the cold owner holds its `EXECUTOR_ROLE`. The deployment signer receives neither role. Explicit economic approval, applicable license confirmation and fresh nonce/code/fee checks are required before the encoded unsigned `createRollup` transaction can be signed. Prior independent RH constructor estimates are not a sequential simulation of the full deployment. Standard RollupCreator on RH is self-deployed; upstream does not list a canonical RH factory.

## Operator files

`../node/node.proposed.json` and `validator.proposed.json` use persistent `/workspace/gl3/mainnet` paths, Pebble synchronous writes, loopback RPC and authenticated loopback validation. Parent URL and keystore passwords are references, not values. They require a reviewed, receipt-derived chain-info file and private effective configuration before starting. An exact limited token allowance must be prepared because automatic allowance increases are disabled. The cold wallet is never a server key.

The ordinary node is a single sequencer with no HA coordinator. A durable volume preserves data but does not provide uptime, backup or an independent validator. Public RPC proxy, DNS, explorer, supervision, monitoring and bounded delegated-wallet funding are separate activation steps owned by the deployment operator.

## Acceptance boundary

Official node/machine provenance, real GH0ST bridge flow and full private standard dispute evidence already exist under `base/`. This new rehearsal additionally requires the exact zero-owner genesis and an actual ordinary SDK staker to generate a nonzero execution-history commitment, confirm using the selected policy and release a real private withdrawal. The updated fast-confirmation rehearsal requires the SDK-created existing assertion and a traced `fastConfirmAssertion` call before the standard deadline, plus altered/replayed withdrawal rejection. It does not replace a live operational observation, public deployment receipts, an independent audit or a production license.

The current Nitro license permits covered Arbitrum deployments or the applicable expansion terms; Robinhood must not be assumed covered without confirmation. No license was accepted here. See [Arbitrum licensing](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license) and [factory deployment scope](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts).
