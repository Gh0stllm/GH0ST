# Solidity memory and typed-action research

The complete transformer runtime is now implemented separately in `S0ULInference.sol`, with immutable model storage, an on-chain tokenizer and cached continuation phases. See [complete Solidity inference](FULL-SOLIDITY.md) for the selected checkpoint, reproduction commands and evidence. The component descriptions below retain the scope of the original memory, gate and row-kernel work.

These components provide bounded caller-owned memory, read-only proposal
checks and a bounded integer dot-product kernel. They do **not** perform complete model inference, establish model provenance,
parse generated text, execute tasks or move tokens. A proposal passing the gate
does not establish that a user authorized it. No contracts have been deployed
to Robinhood Chain by this work.

## S0ULMemory

`remember(bytes32 key, bytes value)` and `forget(bytes32 key)` can modify only
`msg.sender`'s namespace. There is no writable account argument or privileged
writer. `recall(bytes32 key)` reads that same caller's entry. Keys must be
nonzero; values contain 1–128 bytes. Each account may hold at most 32 entries.
Replacing an entry does not consume another slot; deletion frees a slot.

All values are public blockchain data. Caller ownership is a write constraint,
not encryption or confidentiality. A future executor must preserve the original
requester's identity explicitly; calling this contract from an executor would
write the executor's own namespace with the current API.

## S0ULActionGate

The constructor installs a token-address allowlist and rejects EOAs and
duplicates. There is no setter. `nativeBalance()` reads `msg.sender.balance`;
`tokenBalance(address)` calls an allowlisted token's `balanceOf(msg.sender)`.
The address corresponding to `GH0ST` must be pinned by any future deployment
and text-to-proposal adapter. No address or financial arithmetic is invented by
these contracts.

`validateProposal` accepts a typed tuple `(kind, key, value, taskId, token)`:

| Kind | Text action | Required nonzero fields |
| --- | --- | --- |
| 0 | `WAIT` | None |
| 1 | `BALANCE\|SELF\|ETH` | None |
| 2 | `BALANCE\|SELF\|GH0ST` | `token`: pinned allowlisted token |
| 3 | `MEM_SET\|key\|value` | `key`, `value` |
| 4 | `MEM_GET\|key` | `key` |
| 5 | `TASK_ADD\|title` | `value`: title slug |
| 6 | `TASK_LIST\|SELF` | None |
| 7 | `TASK_DONE\|id` | `taskId`: 1–9999 |
| 8 | `CLARIFY\|field` | `key`: allowed field |
| 9 | `REFUSE\|reason` | `key`: allowed reason |

Unused fields must be zero or empty. Memory keys are `theme`, `language` and
`mode`. Value/title slugs match ASCII `[a-z][a-z0-9_]{0,23}`. Clarification
fields are `asset`, `key`, `value`, `title`, `task_id` and `request`; refusal
reasons are `unsupported`, `unauthorized` and `unsafe`. Strings carried in
`key` use UTF-8 right-padded with zero bytes to `bytes32`. The Python parser
must additionally reject noncanonical numeric spellings such as `01`; a typed
integer cannot preserve that textual distinction.

The gate's memory schema is narrower than the storage contract's generic
128-byte values. Integration must check the gate before mapping a model
proposal to a user-authorized operation. The gate currently has no execution
entrypoint, token transfer, approval, task store or arbitrary external call.

## Local validation

`S0ULInt8Kernel` implements the actual row-dot arithmetic used by an integer
matrix kernel. Each weight is one two's-complement byte in `[-128,127]`, each
activation is a signed INT32 and the accumulator is signed INT256. Widths must
be between 1 and 640. The exporter currently uses the symmetric subset
`[-127,127]`; the primitive also handles `-128` explicitly. It applies no scale,
rounding, activation, attention or normalization.

`dot(bytes,int32[])` receives a packed row. `dotFromCode(address,uint256,int32[])`
instead uses `EXTCODECOPY` to read an existing bytecode row at an explicit byte
offset. Offset includes any leading STOP/data header. Code ranges and widths
are checked. A future model runtime must pin the shard identity, hash, offsets,
scales and activation provenance; the caller-selected reader alone does not
establish them.

Run from `s0ul-1m` after installing the pinned JavaScript dependencies:

```bash
node --test tests/test_contracts.mjs
```

Tests compile with Solidity 0.8.30, optimizer 200 runs, EVM target Shanghai,
then deploy only to an in-process Ganache chain. They exercise memory
ownership/isolation, byte and entry bounds, overwrite/delete behavior,
caller-bound balance reads, allowlist construction and every supported action
plus malformed arguments. Integer arithmetic is checked against an independent
JavaScript BigInt oracle, including odd widths, signed extrema and rejected
dimensions. Bytecode reads are checked against the same oracle. Measured local
transaction gas for rows of 128 and 640 elements, both calldata and bytecode
read paths, is written to `reports/evm-kernel.json`, with source/compiler/code
hashes. The measurements include intrinsic transaction gas and exclude the
one-time deployment of the kernel and data shard. Tests run on an in-process
Shanghai EVM, not Robinhood Chain; L2 fee accounting will differ.

These tests are not a security audit. A row-dot result is not a complete token
generation or agent-action benchmark, and its gas cannot be multiplied into a
claimed full-model cost without the missing runtime work.
