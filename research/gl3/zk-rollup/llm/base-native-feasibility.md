# Ethrex base-chain native GH0ST feasibility — read-only fallback audit

**Research only; no architecture switch.** The selected canonical Nitro route
remains the existing design. This audit assesses an Ethereum-EVM-only base-chain
fallback because the user deferred LLM proving. It does not claim Stylus, Nitro
STF compatibility, a built L2 guest, a deployed bridge or a mainnet launch.

Static source inspection ran on the existing Runpod Big worker. No builds,
proofs, node changes, new infrastructure, funds or license acceptance occurred.
The inspected checkout is exactly ethrex
`890efb6bf5dcc09b650cf105b8444d3793dffdf0`, verified with `git rev-parse HEAD`, at
`/root/gl3-sp1-cargo/git/checkouts/ethrex-b17359103979e28f/890efb6`.
Replay sources are `/workspace/gl3/zk-tests/evm-proof/source/replay` and
`replay-sp1-native`; their lockfiles pin that ethrex revision.

## Finding

**A genuine ERC20-on-Robinhood → native-balance-on-GL3 bridge is technically
credible using ethrex's existing L2 privileged execution. It is not a stock
custom-native-token setting, and it is not already proved by the frozen L1 EVM
benchmark.** A reviewed fixed-token parent escrow can enqueue the same kind of
native-value credit currently used for ETH deposits. The child receives actual
EVM account balance, usable for normal value transfers and gas, rather than a
wrapped ERC20 fee-token balance. The corresponding withdrawal must debit native
GH0ST, prove the actual message and release GH0ST ERC20 from Robinhood escrow.

## Exact upstream behavior

| Area | Verified source behavior |
| --- | --- |
| Transaction type | `PrivilegedL2Transaction` is unsigned type `0x7e`, with explicit `from`, chain ID, nonce, native value, target, gas and calldata. [Type definition](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/common/types/transaction.rs#L342-L376). |
| Genuine native mint | `L2Hook::prepare_execution_privileged` skips debiting the source only when `origin == 0x000000000000000000000000000000000000ffff`, then performs the normal native value transfer. Other privileged senders must have sufficient native funds and are debited. Privileged calls pay no gas but still obey block gas allowance. [Exact VM hook](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/vm/levm/src/hooks/l2_hook.rs#L452-L542). |
| Public admission | `eth_sendRawTransaction` rejects privileged transaction type. Privileged transactions are excluded from P2P broadcast; their mempool validation bypasses ordinary account/fee checks. This is an internal consensus input, not a public mint endpoint. [RPC](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/networking/rpc/eth/transaction.rs#L594-L603), [validation and P2P](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/blockchain/blockchain.rs#L2666-L2676). |
| Parent admission | The watcher reads the configured parent's `PrivilegedTxSent` logs and pending queue, converts the event into a privileged transaction using the event ID as nonce, checks whether it was processed, then inserts it into the internal pool. This watcher transports messages; it cannot replace parent queue checks in proof settlement. [Watcher](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/sequencer/l1_watcher.rs#L410-L478), [event codec](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/sdk/src/privileged_data.rs#L14-L120). |
| Current native deposit | `CommonBridge.deposit` locks **parent ETH**, queues `from=to=0xffff`, `value=msg.value`, calldata `mintETH(recipient)`. The L2 method is payable and `onlySelf`, and forwards the newly credited native value. [Parent](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/CommonBridge.sol#L295-L311), [child](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l2/CommonBridgeL2.sol#L21-L51). |
| Current ERC20 deposit | `depositERC20` locks the parent token but sets privileged native `value=0`, calling child `mintERC20`. That path calls an L2 ERC20's `crosschainMint`; it is not native balance minting. [Parent](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/CommonBridge.sol#L317-L337), [child](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l2/CommonBridgeL2.sol#L53-L99). |
| Deprecated configuration | `NATIVE_TOKEN_L1` still exists in parent storage but is explicitly deprecated and is not consulted by these deposit/claim paths. Setting it does not implement native GH0ST. [Declaration](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/CommonBridge.sol#L103-L107). |
| Native withdrawal | Child `withdraw` receives caller native value, transfers it to the zero address, then atomically asks the fixed messenger to emit `keccak256(ETH_TOKEN || ETH_TOKEN || recipient || amount)`. This is an economically unspendable-address burn; source does **not** subtract that amount from a separate protocol total-supply counter. Only the fixed bridge can call the messenger. [Withdrawal](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l2/CommonBridgeL2.sol#L30-L43), [messenger](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l2/Messenger.sol#L12-L25). |

## What the actual L2 guest and parent prove

The L2 guest executes blocks with `Evm::new_for_l2`, including the L2 hook,
checks witness/pre-state/block transitions, derives privileged transactions from
the actual blocks and withdrawal messages from the executed receipts. It emits
initial/final state roots, L1-out message Merkle root, L1-in ordered transaction
digest, cross-L2 message digests, blob versioned hash, last block hash, child chain
ID, non-privileged count and cross-L2 balance differences. [L2 execution](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/src/l2/program.rs#L14-L75),
[message derivation](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/src/l2/messages.rs#L30-L104),
[public output](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/src/l2/output.rs#L7-L67).

The privileged transaction hash is exactly:

```text
keccak256(childChainId32 || from20 || to20 || depositId32 ||
          nativeValue32 || gasLimit32 || keccak256(calldata)32)
```

The batch digest is zero for no deposits, otherwise
`count16be || keccak256(concat(transactionHashes))[2:32]`. The parent compares
this digest against the next actual escrow queue prefix. A malicious sequencer
can construct an unsigned native mint internally, but cannot settle it under a
correct coordinator without its matching parent-escrow queue entry.
[Transaction hash](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/common/types/transaction.rs#L1552-L1582),
[batch digest](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/common/src/privileged_transactions.rs#L71-L96),
[parent comparison](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/OnChainProposer.sol#L243-L251).

The native withdrawal leaf is
`keccak256(fixedBridge20 || dataHash32 || messageId32)`. The tree uses **sorted
Keccak pairs**, unlike Nitro's ordered Outbox tree. Parent claims require a
published batch root, `batch <= lastVerifiedBatch`, unused global message ID,
correct recipient/amount/token-pair hash and valid membership. Upstream native
claims currently transfer ETH; ERC20 claims transfer the requested ERC20. That
payout must be changed for the fixed GH0ST-native profile.
[Leaf and claim checks](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/CommonBridge.sol#L556-L654),
[sorted tree](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/common/src/merkle_tree.rs#L20-L54).

The stock proposer reconstructs public inputs from committed state/bridge fields
and verifies them against a versioned SP1 verification key when SP1 is required.
It is not enough to check that *some* SP1 proof verifies; the deployment must
require that proof and bind the exact guest key and public codec.
[Verification](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/OnChainProposer.sol#L355-L387),
[commitment encoding](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/l2/contracts/src/l1/OnChainProposer.sol#L590-L625).

## Smallest credible native-GH0ST adaptation, if root selects it

1. **Fixed-token Robinhood escrow/queue.** Replace the parent ETH-backed native
   deposit/claim asset with the immutable GH0ST ERC20. Pull it with an exact
   received-balance check and reentrancy protection; queue a native-value credit
   equal to the backed base-unit amount only after successful custody. Reject
   ordinary ETH native-deposit routes so ETH cannot mint unbacked native GH0ST.
   Unsolicited tokens remain surplus, not mint authority. Freeze parent/child
   token units, decimal policy and bridge/domain identities.
2. **Keep actual native execution.** The existing fixed-bridge privileged native
   credit and `mintETH`/payable native `withdraw` can be reused semantically,
   despite their ETH-oriented names. A reviewed profile could retain the current
   native sentinel message and have the parent pay GH0ST ERC20 for that sentinel;
   or explicitly version the message ABI. Neither requires making an ERC20 the
   child's fee token. Any code/genesis change must be committed in the proved
   profile. Native genesis allocations need exact parent backing or zero supply.
3. **L2 node/watcher/profile.** Run actual ethrex L2 execution and point its parent
   watcher at Robinhood and the fixed escrow. Preserve public privileged-tx
   rejection, exact queue ordering, persistent duplicate tracking and the
   required parent finality/reorg policy. Ordinary native transactions should
   pay GH0ST balance; wallets/explorer label that native unit GH0ST. Operator
   Robinhood ETH reserves and fee economics remain necessary even when child
   users pay GH0ST.
4. **Correct L2 guest and new accepted key.** Compile/select the `l2` feature and
   prove the actual L2 hook plus queue/message outputs. The frozen successful
   benchmark uses the released **L1 guest** (`f902422...`, ELF SHA256
   `25270f23a49d998e37769c775047a6c9c080cd5d02b9b036ac18facb60c59bbb`)
   with separately pinned host `890efb6...`; its five-field L1 result is not this
   L2 output. Appending host-supplied mint/withdrawal fields does not upgrade that
   proof. [Feature selection](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/bin/sp1/src/main.rs#L5-L10),
   [L2 feature](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/bin/sp1/Cargo.toml#L37-L39).
5. **Coordinator binding.** Verify the exact new guest/VK and previous accepted
   state, chain/domain/genesis/config, ordered data availability, parent queue
   start/count/digest, withdrawal root and next sequence. Consume the parent
   prefix and publish the withdrawal root atomically with proof finalization.
   Hashing omits privileged fee/access-list fields, so a narrow profile must
   constrain those separately. Reject foreign-chain privileged messages and
   nonempty cross-L2 outputs until deliberately supported; silently ignoring
   them could admit native minting outside the intended parent queue. Preserve
   recipient-bound claims and global nullifiers with exact escrow/recipient
   transfer checks. No administrator-only root setter or trusted mint oracle.

## Unresolved launch gates

- **No fallback authorization or built L2 proof yet.** The architecture, genesis,
  proof codec/key and chain ID require root review. `4663001` is only the current
  candidate; `scan.gh0st.fyi` is the requested explorer address, not evidence that
  an explorer/node is deployed. Do not connect an ethrex proof to Nitro state or
  its ordered Outbox roots as though they share semantics.
- **Parent DA remains essential.** L2 blob verification returns a zero versioned
  hash for zero commitment/proof and calls this *validium mode*. Using that
  branch does not prove Robinhood calldata availability. Review actual supported
  Robinhood posting/fee/finality capabilities and bind full batch data; do not
  silently substitute a validium or a hash-only publication. [Blob branch](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/src/l2/blobs.rs#L12-L46).
- **End-to-end evidence is missing.** Required: real parent GH0ST lock receipt;
  actual child native balance credit; ordinary GH0ST-paid transaction; native
  burn/message receipt; genuine new L2 proof and matching verifier/coordinator
  acceptance; exact parent ERC20 release; duplicate/altered mint, proof, domain,
  recipient and withdrawal rejection. Reconcile escrow against outstanding native
  claim liabilities, fees and economically burned units. No timeout refund may
  release collateral for an already executed but not yet finalized mint.
- **Production operations remain work.** RPC/chain identity, sequencer/prover,
  public explorer indexing, restart/reorg recovery, forced inclusion/escape,
  monitoring, DA retention, sustainable proof cost and independent security review
  must be demonstrated. Neither this source audit nor the L1 16-transaction proof
  measures the new L2 bridge's proving cost.
- **Licensing differs, but is not blanket approval.** Ethrex workspace and SP1
  guest package declare `MIT OR Apache-2.0`; inspected bridge/messenger contracts
  declare MIT. That removes Nitro's BUSL dependency only if the candidate actually
  replaces Nitro code/contracts. SP1/verifier, OpenZeppelin and other dependency
  notices still need their own review. No license was accepted in this audit.
  [Workspace license](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/Cargo.toml#L35-L40),
  [guest license](https://github.com/lambdaclass/ethrex/blob/890efb6bf5dcc09b650cf105b8444d3793dffdf0/crates/guest-program/bin/sp1/Cargo.toml#L1-L5).

**Comparison:** ethrex offers an existing scalar EVM/L2 native-mint hook and
bridge-specific proof outputs with a more permissive upstream license. It still
needs a new actual L2 proof/deposit/withdrawal integration, so it is a plausible
base-chain fallback rather than an immediate mainnet substitute. The canonical
Nitro route preserves its exact native-token bridge/STF semantics but currently
has the separately measured portable-loader proving-cost and production-license
gates. Root selects any change; this file changes no implementation or authority.
