# S0UL address reader

The address reader removes owner registration from public inspection. Every valid
same-chain address can return native-balance and runtime-code facts. Contracts
can additionally expose standard getter observations, structural bytecode signals
and caller-selected read-only function results.

The implementation reads Robinhood Chain state only. It does not fetch source
code, token listings, prices, explorer labels, social feeds or model responses
from an external data service. A public RPC transports contract calls and chain
records; it does not supply the analytical text. The reader contracts construct
that text from their own observations.

## Components

| Component | Responsibility |
| --- | --- |
| `S0ULUniversalReader` | Native/code facts for any address, bounded structural analysis, ERC165 interface probes, common getter hints and bounded arbitrary read-only calls |
| `S0ULPermissionlessObservations` | Compatible token supply, token/account balance and V2-style pool observations; permissionless shared history and personal watchlists |
| `S0ULIntelReports` | Existing report implementation, instantiated for the new observations contract and the existing classifier |
| Existing numeric classifier | Unchanged 25-parameter observation-routing model, used for supported historical comparisons |

The universal reader does not claim that the original S0UL-1M language model has
learned arbitrary contract auditing. Structural inspection and numeric history
comparison are distinct operations. Existing V1 records and contracts remain
available as historical evidence.

## Immediate inspection

Paste an address and choose **Analyze**. No wallet, registry entry or paid
transaction is required for a read-only inspection. The zero address and
addresses without deployed code also have inspectable balance/code facts.
Absence of code does not establish that an address is an externally owned wallet;
precompiles and undeployed addresses can also lack runtime bytecode.

For deployed code, the universal reader scans at most 24,576 bytes. It skips
`PUSH1` through `PUSH32` payloads when counting opcode positions, and retains at
most 32 distinct `PUSH4` candidates from the first 4,096 code bytes. Candidate
discovery has this separate bound to keep repetitive bytecode within the gas
budget; opcode counting continues across the full bounded code scan.
A candidate is a bytecode literal, not proof
that the contract exposes that function. Metadata and unreachable code can still
contribute to structural counts. A larger runtime is explicitly marked as a
partial scan; the full code size and code hash remain available.

ERC165 probes use the standard 30,000-gas allowance and require canonical true for
the standard identifier and canonical false for `0xffffffff`. Reported ERC721,
ERC1155 and ERC2981 support is an interface claim made by the target contract.
`owner()`, `paused()`, `implementation()` and `asset()` results are labelled as
getter observations. They do not prove ownership semantics, proxy architecture
or vault-standard conformance.

## Reading other exposed functions

The optional raw function reader accepts calldata up to 4,096 bytes and executes
it using `STATICCALL`, forwarding at most 200,000 gas. It returns at most 2,048
bytes plus the full return size and an explicit status:

| Status | Meaning |
| --- | --- |
| 0 | Call succeeded and the complete result fits the output bound |
| 1 | Target failed or reverted; returned bytes may be revert data |
| 2 | Call succeeded but the returned prefix is truncated |

Calls originate from the reader contract. A caller-dependent getter may therefore
return something different from a direct wallet call. The reader cannot write
target state or transfer funds. A successful call or plausible return value does
not establish the function's intended semantics.

## Optional on-chain history

Anyone may watch a compatible token supply, token/account balance or V2-style
pool source. The key commits to reader kind, target, watched account and target
runtime hash. A new subject stores its first validated sample in the same
transaction. Joining an existing key does not replace or resample shared history.

There is no global 256-subject cap. Each caller can retain up to 64 active watch
memberships; removing a membership frees that caller's slot. Removal does not
erase shared samples or another caller's membership. The sample ring retains 16
observations per subject. The deployed configuration sets a 60-second minimum
spacing and a 3,600-second freshness window.

A first sample establishes a baseline. A later capture can publish a comparison
through the pinned report contract and unchanged numeric classifier. Contracts
execute when a caller submits a transaction; watching is not a self-running
background scheduler. Native-only and unrecognized-contract inspections do not
pretend to have a supported numeric history model.

The website previews gas without a wallet, then discards that preview and
recalculates for the actual wallet before approval. Writes require a fresh exact
action, fee limit, consent and wallet confirmation. Existing runtime/model pins,
identity checks, nonce handling and durable transaction recovery remain required.

## Interpretation limits

This is an all-address evidence reader, with deeper observations where callable
interfaces exist. It cannot read another contract's private storage through an
ordinary EVM call, recover complete source logic from every bytecode, enumerate a
wallet's complete asset/history inventory, establish a USD price without an
appropriate on-chain source, or prove arbitrary-contract safety.

Getter-compatible contracts can mislead readers. Runtime identity pins proxy
bytecode, not an implementation hidden behind that proxy; pool metadata is
revalidated before samples and shared-watch joins. Structural signals are not a
honeypot verdict, exploit proof or security audit.

On Nitro, Solidity `block.number` is an ancestor-chain estimate rather than the
RPC L2 block number. EVM `BLOCKHASH` values in saved samples are not advertised as
canonical L2 parent hashes or finality proofs. Observation timestamps and the
RPC block used for a public read are shown separately.

Deployment addresses and receipt evidence are recorded in
[`deployments/robinhood-mainnet-intel-v2.json`](deployments/robinhood-mainnet-intel-v2.json)
and the browser configuration
[`website/s0ul-intel-v2-deployment.json`](../website/s0ul-intel-v2-deployment.json).
These paths are populated only from verified live deployment receipts.
