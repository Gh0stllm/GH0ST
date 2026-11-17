# Exact pinned Nitro licensing review — 17 November 2026

This records a deployment decision gate, not acceptance of an agreement. No agent has opted in, signed, contacted the Foundation, or represented that GH0ST already has a separate grant.

## Pins and conversion dates

| Work | Exact pin | Commit timestamp | Stated Change Date | Change License |
| --- | --- | --- | --- | --- |
| Nitro | `5f02f3f03076343061f167e81b8e82ec5518064b` | 2026-10-14T22:04:58Z | 2030-12-31 | Apache-2.0 |
| Nitro Contracts | `4341b132cfbdcc980ead03765ca5224ff6cb5d97` | 2026-01-07T16:37:10Z | 2028-12-31 | Apache-2.0 |

Both [Nitro's exact license](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/LICENSE.md) and [Contracts' exact license](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/LICENSE) specify conversion on the earlier of the stated date or the fourth anniversary of a specific version's first public distribution. The exact 2026 versions have not reached either date on 2026-11-17. The historical copyright range is not an expiry rule. Commit dates were read from each official GitHub commit API, not inferred from the copyright header.

## Robinhood as parent

The pinned Additional Use Grants allow a production chain settling to a Covered Arbitrum Chain, or use subject to AEP terms. The explicit Covered list names One, Nova and historical testnets; it also allows future DAO-authorized designations and L3s settling to another Covered chain. Robinhood `4663` is not explicitly named. AEP participation and Covered designation are different concepts; no separate DAO designation making Robinhood Covered was located in this bounded review. Do not assume Robinhood's AEP participation gives its children a free sublicense.

Current [official chain licensing guidance](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license) explicitly requires the AEP contribution for L3s settling somewhere other than One or Nova. Current [Foundation launch guidance](https://docs.arbitrum.foundation/new-arb-chains) allows any parent network through self-service AEP, without Foundation contact, provided the project opts in. Thus Robinhood is not excluded as a parent by an AEP approved-parent registry requirement. Technical parent compatibility is a separate test.

The [official Robinhood mainnet factsheet](https://forum.arbitrum.foundation/t/arbitrumdao-factsheet-robinhood-chain-mainnet-launch/31041) describes Robinhood itself as an Ethereum-settled Arbitrum chain participating in AEP. That is evidence of Robinhood's own arrangement, not a GH0ST grant.

## Current AEP action and economics

The grant links directly to [AEP Terms](https://docs.arbitrum.foundation/aep/ArbitrumExpansionProgramTerms.pdf), published 2025-06-04, effective 2025-06-06. This four-page agreement grants Nitro and Nitro Contracts use subject to its terms. It requires prompt payment of 10% of positive protocol net revenue, deducting settlement and permissionless DA fees. It includes sequencing, bridge and other attributable revenue and requires relevant non-public calculation information. Transfer failures do not cancel payment; alternate agreed payment remains required. The agreement also contains indemnity and Cayman dispute terms. No agent accepts them on the user's behalf.

No upfront license payment, required Foundation countersignature, or mandatory external onboarding wait was identified in the current agreement or self-service guide. The missing action is operator opt-in and a compliant fee accounting/payment arrangement, not an invented weeks-long license approval process. The docs do not supply a required click-through form; their AEP link is the agreement itself. Do not fabricate a completed registration receipt.

Payment setup has a separate concrete unresolved step: the [current official router guide](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/aep-router-contracts) instructs L3 custom-gas-token operators to confirm the parent-chain target with the Foundation. Robinhood/GH0ST is absent from its canonical router table. No verified GH0ST-specific payment target has been supplied or contacted in this work. Self-service license availability is not evidence that the payment route is already configured; see `aep-accounting-plan.md`. Merely reserving funds pending a target is not represented as satisfying the prompt-payment obligation.

[Official fee calculation guidance](https://docs.arbitrum.foundation/calculate-aep-fees) allocates 8% to the DAO and 2% to the developer guild and describes manual handling for special cases. Hosting, validator and proof CPU expenses are not listed settlement deductions. Burning user fees must not be assumed to make the payment zero: no burn exemption was found, broad attributable revenue and anti-circumvention provisions remain, and novel arrangements may need Foundation clarification. A genuinely non-positive net-revenue period has no positive amount under the stated formula, but accounting still needs an auditable basis.

## Information required at final deployment review

1. The actual operator (person or entity) and their explicit decision to opt into the linked current AEP agreement, or the exact alternative written permission / DAO Covered designation being relied on.
2. A concrete accounting and payment plan for native GH0ST fees, bridge/ordering revenue, deductible RH settlement costs, and the required 10% share. Router/recipient addresses must come from verified official deployment evidence; none is invented here.
3. If a burn-based zero-share model is intended, an explicit resolved basis for that treatment rather than assuming it. A conventional positive-revenue AEP route does not require such a special-case theory.

These are contractual and operating choices for the operator. This packet neither accepts the agreement nor silently chooses fee routing.
