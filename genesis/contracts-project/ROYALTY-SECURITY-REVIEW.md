# GH0ST Genesis — fixed secondary royalty review

Review date: 21 October 2026.

Subsequent configuration: the user supplied the permanent recipient
`0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`. The unsigned plan now
includes it; its exact six arguments and 25 helper regressions pass. A fresh
local fork at block 94141363 also passes with that recipient. See
`deployment/royalty-recipient-preparation.json`. The review below retains its
pre-recipient snapshot; the Solidity source is unchanged. No public NFT
contract has been deployed.

This is a scoped independent review within the development workflow, **not an
external audit, certification or guarantee of safety**. It covers the fixed
ERC-2981 royalty change, its deployment preparation/helper, and the public
mint controller's added royalty checks. The earlier SECURITY-REVIEW.md and
its five-argument deployment/test evidence remain historical records.

Reviewed contracts/GH0STGenesis.sol SHA-256:
9c28ed322d52cca1ea44cb917e6e60bfeab80acfe4979fff87b6b7e726228739

Current creation-bytecode Keccak-256:
0xa5f8590485154af7cbcb97fdd0260a08e2ba917d027c24c2897f398996dd4fb4

Build: Solidity 0.8.30, OpenZeppelin Contracts 5.4.0, optimizer enabled with
200 runs, Shanghai target. Creation/runtime sizes are 8,962/7,479 bytes.

## Result

No high- or medium-severity issue remains open within the reviewed scope.
The deployment workflow and helper findings below were fixed and retested.
**Production deployment remains blocked because no royalty recipient has
been supplied.** No real wallet signature or public transaction was sent
for this review or the recorded fork tests.

## Contract properties

- The royalty recipient is an immutable, explicit **sixth constructor
  argument**. The constructor rejects the zero address and the NFT contract
  itself. There is no administrator, recipient setter, rate setter or upgrade
  path. Local test recipients are not production payout choices.
- ROYALTY_BPS is fixed at **350**, representing **3.5%**. royaltyInfo returns
  the recipient and floor(salePrice × 350 / 10,000). OpenZeppelin Math.mulDiv
  uses full-width arithmetic, so intermediate multiplication cannot overflow
  for an otherwise valid uint256 sale price. The result fits uint256 because
  the fraction is below one. Zero and tiny prices may quote zero after
  rounding; the same formula applies to arbitrary and unminted IDs.
- ERC-165 reports IERC2981 support while retaining ERC-721 and metadata
  interface support. Unsupported interface IDs remain unsupported.
- The royalty query performs no transfer or external recipient call. Ordinary
  NFT transfers do not collect a royalty. Primary minting still burns exactly
  **200,000e18 GH0ST** from the immediate caller and retains **zero** mint
  tokens for the protocol or royalty recipient.
- The 495 unique-ID supply bound, three successful lifetime self-mints per
  address, transfer-independent quota, atomic rollback, reentrancy guard,
  immutable IPFS metadata and shard Merkle binding remain intact.

The recipient is permanent. Its exact address must be supplied and checked
before deployment; it is never inferred from the connected wallet, deployer,
token holder, environment variable or a test fixture.

## Findings closed during review

| Finding | Severity | Resolution |
| --- | --- | --- |
| The npm preparation entrypoint compiled before running the script that invalidates stale deployment files. A compiler failure could preserve an earlier usable plan. | Medium | prepare:deployment now invokes the invalidating preparation script directly. It replaces old outputs before reading configuration or loading third-party dependencies; compilation occurs inside that guarded flow after an explicit recipient is supplied. Failure produces a nonsignable blocked artifact. |
| The deployment helper recorded its duplicate-submission guard only after the wallet returned a hash. An ambiguous send error or reload during the prompt could allow a second creation request and duplicate gas spend. | Low | The helper persists an uncertain marker before eth_sendTransaction. A valid hash replaces it; ambiguous errors, malformed replies and reload retain it. Only explicit user rejection clears it without a receipt. Regression tests cover the saved marker before the request, reload, all accepted rejection codes and retry behavior. |

Six independent isolated preparation cases exercised direct and npm
entrypoints, missing/zero recipients, malformed configuration and forced
compilation failure. Seeded legacy plan/helper files were replaced with
transaction:null and static HTML containing no wallet script, with zero RPC
calls. Three additional template cases rejected blocked plans, legacy
five-argument plans and forged royalty fields on five arguments before any
wallet request.

The source template also validates the production chain, five existing
identity pins, explicit royalty terms, six constructor arguments, primary
mint rules, CIDs and encoded argument tail before wallet access. Existing
chain/account race checks and explicit transaction chain binding remain.

## Completed evidence

These are separate completed component runs, not one combined test command.

| Component | Result | Record |
| --- | --- | --- |
| Current royalty contract | 33/33 passed; zero failed/skipped | test/royalty-battle.tap and test/royalty-battle-summary.json |
| Deployment helper | 25/25 passed; zero failed/skipped | test/royalty-deployment-helper.tap |
| Public mint wallet controller | 49/49 passed; zero failed/skipped; independently rerun | Public-site workspace test/royalty-wallet-test.tap |
| Actual GH0ST runtime on a local mainnet fork | PASS; zero public transactions | deployment/royalty-mainnet-fork-validation.json |

Contract tests cover sale prices through uint256.max, tiny-price rounding,
arbitrary/unminted IDs, zero/self recipient rejection, unsupported interfaces,
absence of royalty administration, unchanged primary burns and free ordinary
transfers. The complete 495-item sellout across 165 addresses still burns
exactly **99,000,000 GH0ST**; the 96-step seeded adversarial sequence passes.

The fresh local fork is pinned to block **94095738**, with the current creation
bytecode and actual GH0ST/index runtimes. IDs 1, 2 and 495 each reduce payer
balance, total supply and allowance by exactly 200,000e18. Royalty quotes
match for zero, ordinary and maximum prices, and remain unchanged after
transfer. Fourth lifetime mints fail before and after transferring an NFT
away. The fork recipient is explicitly labeled **LOCAL TEST ONLY**; the
report's productionRoyaltyRecipient remains null. Public RPC traffic was
restricted to read-only methods.

Before approval or mint, the public controller now checks ERC-2981 support,
ROYALTY_BPS, the immutable recipient against explicit configuration, and
royaltyInfo results at 10,000 and uint256.max. Six deliberately incorrect
royalty behaviors block both approval and mint before any signature request.
Existing exact-amount approval, chain/account, proof and pending-request
protections remain tested.

## Production gate and historical plans

Current configuration keeps royaltyRecipient, NFT address and NFT runtime
hash unset. Deployment status is **NEEDS_ROYALTY_RECIPIENT**. The replacement
unsigned plan has transaction:null and constructorArgs:null; its generated
HTML is a static notice with no wallet or signing path. The public mint
controller likewise cannot request approvals or mints while its required
deployment and royalty pins are missing.

After an explicit payout address is supplied, preparation must rebuild the
six-argument creation transaction and verify the live production pins. The
deployed receipt, runtime hash, recipient and 350-bps getter must then be
checked before activating the public page. No production recipient or
deployed NFT address has been approved by these tests.

Earlier five-argument/no-royalty deployment plans are **superseded**. Replacing
the current files does not revoke previously copied creation bytecode or
historical Git commits. Those old copies must not be used for this release.

## Royalty payment limits

[ERC-2981](https://eips.ethereum.org/EIPS/eip-2981) supplies royalty amount and
recipient information; marketplace settlement performs the payment. Its
amount uses the same currency units as the supplied sale price, and integer
rounding is permitted. Implementing the interface does not make every resale
or private transaction pay a fee.

[OpenSea's enforcement documentation](https://docs.opensea.io/docs/creator-fee-enforcement)
describes ERC721-C/ERC1155-C transfer validators and Seaport hooks. Its
[creator-earnings guidance](https://support.opensea.io/en/articles/8867026-how-do-i-set-creator-earnings-on-opensea)
distinguishes optional earnings for non-upgradeable custom contracts without
that compatibility. This contract does not implement those validators or an
upgrade path. Accordingly, this release declares a fixed 3.5% creator royalty;
it does **not** guarantee mandatory payment across marketplaces. Sources
checked 21 October 2026.

The 0% protocol-cut statement applies to the primary mint burn. Secondary
royalties, marketplace charges and network gas are separate. Browser pending
guards assume retained browser storage and a trusted wallet/site bundle;
uncertain submissions require wallet/explorer inspection before any retry.
